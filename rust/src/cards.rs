//! Targets: the two-target rule and each card's action (checkShape, checkTarget, act).

use crate::board::*;
use crate::setup::*;
use crate::spec::{spec, Action, Card, Use};
use crate::types::*;

// ---------------------------------------------------------------------------
// Reading a target's ids
// ---------------------------------------------------------------------------

/// A target id as a location (None: absent, empty, or not a location).
#[inline]
pub fn as_loc(x: Option<Id>) -> Option<Loc> {
    x.and_then(|i| i.loc())
}
/// A target id as a faction in play.
#[inline]
pub fn as_fac(x: Option<Id>) -> Option<Fac> {
    x.and_then(|i| i.fac())
}
/// Whether an id is set and not the empty string (JavaScript truthiness of a string field).
#[inline]
pub fn truthy(x: Option<Id>) -> bool {
    !matches!(x, None | Some(Id::Empty))
}
/// A pick list with the stop marker taken out.
pub fn picked(xs: &Option<Ids>) -> Vec<Id> {
    xs.as_deref().unwrap_or(&[]).iter().copied().filter(|&x| x != Id::Stop).collect()
}
/// How many times each entry appears, in first-seen order.
pub fn tally(xs: &[Id]) -> Vec<(Id, i32)> {
    let mut out: Vec<(Id, i32)> = Vec::new();
    for &x in xs {
        match out.iter_mut().find(|e| e.0 == x) {
            Some(e) => e.1 += 1,
            None => out.push((x, 1)),
        }
    }
    out
}
fn distinct<T: PartialEq + Copy>(xs: &[T]) -> Vec<T> {
    let mut out = Vec::new();
    for &x in xs {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}
fn all_distinct<T: PartialEq + Copy>(xs: &[T]) -> bool {
    distinct(xs).len() == xs.len()
}
fn count_eq(xs: &Option<Ids>, x: Option<Id>) -> usize {
    match x {
        None => 0,
        Some(x) => xs.as_deref().unwrap_or(&[]).iter().filter(|&&y| y == x).count(),
    }
}

pub fn card(c: CardIx) -> &'static Card {
    &spec().cards[c as usize]
}

/// The suit's faction (its archetype's slot).
#[inline]
pub fn suit_faction(c: &Card) -> Option<Fac> {
    c.suit.map(|a| a as Fac)
}
/// The suit's three locations.
pub fn suit_locations(c: &Card) -> Vec<Loc> {
    match c.suit {
        None => vec![],
        Some(a) => (0..spec().locations.len() as Loc).filter(|&l| spec().locations[l as usize].archetype == a).collect(),
    }
}
#[inline]
fn is_suit_loc(c: &Card, l: Loc) -> bool {
    c.suit == Some(spec().locations[l as usize].archetype)
}

#[inline]
fn my_sway(s: &GameState, pid: Pid, l: Loc) -> i32 {
    s.board[l as usize].sway.get(pid)
}
/// Your standing with a faction (no limit in checkTarget's unpaid comparison).
#[inline]
fn my_standing(s: &GameState, pid: Pid, f: Fac) -> i64 {
    if s.options.sway_required { s.players[pid as usize].standing[f as usize] as i64 } else { i64::MAX }
}
#[inline]
fn standing(s: &GameState, pid: Pid, f: Fac) -> i32 {
    s.players[pid as usize].standing[f as usize]
}

/// Raise the Stakes, tokens: where a faction's kin next door can come from, and how many each may send.
pub fn stake_sources(s: &GameState, centre: Loc, f: Fac) -> Vec<(Loc, i32)> {
    adj(s, centre).into_iter().filter(|&l| !s.board[l as usize].scorched && free_of(s, l, f) > 0).map(|l| (l, free_of(s, l, f))).collect()
}

/// Is (location, faction) a legal group target under the two-target rule?
fn group_target(s: &GameState, c: &Card, t: &Target) -> Option<&'static str> {
    let (Some(loc), Some(f)) = (as_loc(t.location), as_fac(t.faction)) else { return Some("Choose a group on the board.") };
    if tokens_of(s, loc, f) <= 0 {
        return Some("Choose a group on the board.");
    }
    if c.suit.is_none() {
        return None;
    }
    match t.mode {
        Some(Mode::Location) => if is_suit_loc(c, loc) { None } else { Some("That location is not one of the suit's.") },
        Some(Mode::Faction) => if Some(f) == suit_faction(c) { None } else { Some("That group is not the suit's faction.") },
        None => Some("Choose a location target or a faction target."),
    }
}

/// Spill Blood, Study the Bodies, Night Terrors: the held locations they can mark (with the faction paying), and the
/// empty ones (the suit's faction pays).
pub fn altar_marks(s: &GameState, c: &Card, mode: Mode) -> (Vec<(Loc, Fac)>, Vec<Loc>) {
    let sf = suit_faction(c).expect("suited");
    let open: Vec<Loc> = (0..s.board.len() as Loc).filter(|&l| !s.board[l as usize].scorched).collect();
    if mode == Mode::Faction {
        return (open.iter().copied().filter(|&l| tokens_of(s, l, sf) > 0).map(|l| (l, sf)).collect(), vec![]);
    }
    let spots: Vec<Loc> = open.into_iter().filter(|&l| is_suit_loc(c, l)).collect();
    let held = spots.iter().flat_map(|&l| factions_at(s, l).into_iter().map(move |f| (l, f))).collect();
    let empty = spots.into_iter().filter(|&l| count_at(s, l) == 0).collect();
    (held, empty)
}

/// The marks a target names: the held locations with their payers, then the empty ones (the suit's faction pays).
pub fn altar_chosen(c: &Card, t: &Target) -> Vec<(Id, Id)> {
    let sf = Id::Fac(suit_faction(c).expect("suited"));
    let mut out: Vec<(Id, Id)> = t.moves.as_deref().unwrap_or(&[]).iter().filter(|m| m.location != Id::Stop).map(|m| (m.location, m.faction)).collect();
    out.extend(t.from.as_deref().unwrap_or(&[]).iter().filter(|&&l| l != Id::Stop).map(|&l| (l, sf)));
    out
}

/// Night Terrors at nightfall: the factions at a mark with a token free to leave, and where each may flee.
pub fn flee_options(s: &GameState, loc: Loc) -> Vec<(Fac, Vec<Loc>)> {
    factions_at(s, loc).into_iter().filter(|&f| free_of(s, loc, f) > 0).map(|f| (f, burst_spots(s, loc, f))).filter(|o| !o.1.is_empty()).collect()
}

/// The Gate: can this location be one of its ends?
pub fn gate_end(s: &GameState, c: &Card, loc: Option<Loc>) -> bool {
    let Some(loc) = loc else { return false };
    let p = &s.board[loc as usize];
    !p.scorched && p.gate.is_none() && (is_suit_loc(c, loc) || factions_at(s, loc).contains(&suit_faction(c).expect("suited")))
}
/// The factions present across two locations.
pub fn factions_across(s: &GameState, a: Loc, b: Loc) -> Facs {
    let mut v = factions_at(s, a);
    for f in factions_at(s, b) {
        if !v.contains(&f) {
            v.push(f);
        }
    }
    v
}

/// The neighbours a group of `f` at `loc` can send a token to (Draw Them Away, Cover Every Exit, nightfall).
pub fn burst_spots(s: &GameState, loc: Loc, f: Fac) -> Vec<Loc> {
    adj(s, loc).into_iter().filter(|&l| !s.board[l as usize].scorched && can_enter(s, l, f)).collect()
}

/// Take Control: how many of `f`'s tokens you may turn into trophies at the target.
pub fn control_room(s: &GameState, pid: Pid, c: &Card, ci: CardIx, t: &Target) -> i32 {
    let (Some(loc), Some(f)) = (as_loc(t.location), as_fac(t.faction)) else { return 0 };
    if s.board[loc as usize].scorched {
        return 0;
    }
    let sent = faction_of_archetype("sentients");
    let here = factions_at(s, loc);
    if here.len() < 2 || !here.contains(&f) {
        return 0;
    }
    let bad = if t.mode == Some(Mode::Location) { !is_suit_loc(c, loc) } else { !here.contains(&sent) || f == sent };
    if bad {
        return 0;
    }
    sway_for(s, pid, ci).min(my_sway(s, pid, loc)).min(tokens_of(s, loc, f))
}

/// Wake the Dead: (max, payers) at `loc`; `payer` None: the best of them.
pub fn raise_room(s: &GameState, pid: Pid, loc: Loc, mode: Option<Mode>, payer: Option<Fac>) -> (i32, Vec<Fac>) {
    let undead = faction_of_archetype("undead");
    let place = &s.board[loc as usize];
    if place.scorched {
        return (0, vec![]);
    }
    let here = factions_at(s, loc);
    let ok = if mode == Some(Mode::Faction) { here.contains(&undead) } else { alignment_of(loc) == undead as usize && (here.contains(&undead) || here.len() < 2 || place.gate.is_none()) };
    if !ok {
        return (0, vec![]);
    }
    let payers: Vec<Fac> = if mode == Some(Mode::Faction) { vec![undead] } else { let mut v = vec![undead]; for f in here { if !v.contains(&f) { v.push(f); } } v };
    let wake = spec().card_ix("wake-the-dead").expect("wake-the-dead");
    let room = |f: Fac| -> i64 { (sway_for(s, pid, wake) as i64).min(my_standing(s, pid, f)).min(s.supply[undead as usize] as i64) };
    let max = match payer {
        Some(p) => if payers.contains(&p) { room(p) } else { 0 },
        None => payers.iter().map(|&f| room(f)).max().unwrap_or(0).max(0),
    };
    (max as i32, payers.into_iter().filter(|&f| room(f) > 0).collect())
}

/// Plough Through: the sides of the fight at `loc`, in faction order: (faction, how many leave, exits).
pub fn plough_sides(s: &GameState, loc: Loc) -> Vec<(Fac, i32, Vec<Loc>)> {
    let here = factions_at(s, loc);
    (0..5u8).filter(|f| here.contains(f)).map(|f| (f, (tokens_of(s, loc, f) + 1).div_euclid(2), burst_spots(s, loc, f))).collect()
}
/// Plough Through: who may pay: the fight's factions, and the Nocturnals if they aren't in it.
pub fn plough_pool(s: &GameState, c: &Card, loc: Loc) -> Facs {
    let mut v = factions_at(s, loc);
    let sf = suit_faction(c).expect("suited");
    if !v.contains(&sf) {
        v.push(sf);
    }
    v
}
/// Plough Through: can the exits chosen so far be finished?
// PERF: called once per candidate exit while listing (each rebuilding sides, burst spots and a backtracking match).
pub fn plough_fits(s: &GameState, pid: Pid, c: &Card, loc: Loc, from: &[Id]) -> bool {
    let sides = plough_sides(s, loc);
    let mut used: Vec<Vec<Id>> = Vec::new();
    let mut i = 0usize;
    for side in &sides {
        let n = side.1 as usize;
        let a = i.min(from.len());
        let b = (i + n).min(from.len());
        used.push(from[a..b].to_vec());
        i += n;
    }
    if from.len() > i {
        return false;
    }
    for (k, side) in sides.iter().enumerate() {
        let taken: Vec<Id> = used.iter().enumerate().filter(|(j, _)| *j != k).flat_map(|(_, u)| u.iter().copied()).collect();
        if used[k].iter().any(|&l| !matches!(l, Id::Loc(x) if side.2.contains(&x)) || taken.contains(&l)) {
            return false;
        }
    }
    let need: Vec<usize> = (0..sides.len()).filter(|&k| used[k].is_empty()).collect();
    let held: Vec<Id> = distinct(&used.iter().flatten().copied().collect::<Vec<_>>());
    if s.options.sway_required {
        let budget: i64 = plough_pool(s, c, loc).iter().map(|&f| standing(s, pid, f) as i64).sum();
        if (held.len() + need.len() + 1) as i64 > budget {
            return false;
        }
    }
    fn matching(j: usize, need: &[usize], sides: &[(Fac, i32, Vec<Loc>)], busy: &mut Vec<Id>) -> bool {
        if j == need.len() {
            return true;
        }
        for &l in &sides[need[j]].2 {
            if !busy.contains(&Id::Loc(l)) {
                busy.push(Id::Loc(l));
                let ok = matching(j + 1, need, sides, busy);
                busy.pop();
                if ok {
                    return true;
                }
            }
        }
        false
    }
    let mut busy = held;
    matching(0, &need, &sides, &mut busy)
}

/// Cut the Powerlines: the faction's other groups a group at `loc` can rejoin (a Gate's ends listed once).
// PERF: N+1: every location runs can_enter (factions_at) and gate checks; a per-state index of where each faction is
// would answer this in one pass.
pub fn kin_of(s: &GameState, loc: Loc, f: Fac) -> Vec<Loc> {
    let (ends, k) = ends_of(s, loc);
    let sp = spec();
    (0..s.board.len() as Loc)
        .filter(|&l| {
            !ends[..k].contains(&l)
                && raw_tokens(s, l, f) > 0
                && !(matches!(gate_of(s, l), Some(g) if sp.locations[g as usize].id < sp.locations[l as usize].id && raw_tokens(s, g, f) > 0))
                && !s.board[l as usize].scorched
                && can_enter(s, l, f)
        })
        .collect()
}
/// Cut the Powerlines: (kin, n, each, extra, reached).
pub fn power_share(s: &GameState, loc: Loc, f: Fac) -> (Vec<Loc>, i32, i32, i32, i32) {
    let kin = kin_of(s, loc, f);
    let n = free_of(s, loc, f);
    let k = kin.len() as i32;
    let (each, extra) = if k > 0 { (n.div_euclid(k), n.rem_euclid(k)) } else { (0, 0) };
    (kin, n, each, extra, n.min(k))
}

/// The Big Chase: where a chased group may go next from `at`.
pub fn chase_steps(s: &GameState, at: Loc, f: Fac, chase: &[Loc]) -> Vec<Loc> {
    adj(s, at).into_iter().filter(|&l| !chase.iter().any(|&x| { let (e, k) = ends_of(s, x); e[..k].contains(&l) }) && !s.board[l as usize].scorched && can_enter(s, l, f)).collect()
}

/// Perform the Ritual: (lone groups next door, fights next door that can send some).
pub fn well_sources(s: &GameState, centre: Loc, f: Fac) -> (Vec<Loc>, Vec<Loc>) {
    let near: Vec<Loc> = adj(s, centre).into_iter().filter(|&l| !s.board[l as usize].scorched && tokens_of(s, l, f) > 0).collect();
    let lone = near.iter().copied().filter(|&l| lone_at(s, l) == Some(f)).collect();
    let fights = near.iter().copied().filter(|&l| count_at(s, l) >= 2 && tokens_of(s, l, f).div_euclid(2) > 0).collect();
    (lone, fights)
}
pub fn well_share(s: &GameState, l: Loc, f: Fac) -> i32 {
    tokens_of(s, l, f).div_euclid(2)
}

/// Bait the Herd: (pick-ups, crashes) from `at`.
pub fn trail_steps(s: &GameState, at: Loc, f: Fac, trail: &[Loc]) -> (Vec<Loc>, Vec<Loc>) {
    let open: Vec<Loc> = adj(s, at).into_iter().filter(|&l| !trail.iter().any(|&x| { let (e, k) = ends_of(s, x); e[..k].contains(&l) }) && !s.board[l as usize].scorched).collect();
    let pickups = open.iter().copied().filter(|&l| lone_at(s, l) == Some(f) || (count_at(s, l) >= 2 && tokens_of(s, l, f) > 0 && free_of(s, l, f) > 0)).collect();
    let crashes = open.iter().copied().filter(|&l| matches!(lone_at(s, l), Some(x) if x != f)).collect();
    (pickups, crashes)
}

/// Spoof the Signal: where a group at `loc` may march.
// PERF: N+1: lone_at/tokens_of recomputed per candidate (and again in `size`), adj per neighbour; precompute per state.
pub fn threats_of(s: &GameState, loc: Loc, f: Fac) -> Vec<Loc> {
    let (ends, k) = ends_of(s, loc);
    let mut near: Vec<Loc> = Vec::new();
    for l in adj(s, loc) {
        if !near.contains(&l) {
            near.push(l);
        }
    }
    let snapshot = near.clone();
    for l in snapshot {
        for m in adj(s, l) {
            if !near.contains(&m) {
                near.push(m);
            }
        }
    }
    let rivals: Vec<Loc> = near.into_iter().filter(|&l| !ends[..k].contains(&l) && matches!(lone_at(s, l), Some(x) if x != f) && can_enter(s, l, f)).collect();
    let size = |l: Loc| tokens_of(s, l, lone_at(s, l).expect("lone"));
    let most = rivals.iter().map(|&l| size(l)).max().unwrap_or(0).max(0);
    rivals.into_iter().filter(|&l| size(l) == most).collect()
}

/// Invite Them In: the groups that may be invited into `to`.
// PERF: can_leave (factions_at + free_of, which calls factions_at again) for every group next door.
pub fn guests_of(s: &GameState, c: &Card, mode: Mode, to: Loc) -> Vec<(Loc, Fac)> {
    let sf = suit_faction(c);
    let host = lone_at(s, to);
    let mut out = Vec::new();
    for l in adj(s, to) {
        for f in factions_at(s, l) {
            if can_leave(s, l, f) && (mode == Mode::Location || Some(f) == sf) && Some(f) != host {
                out.push((l, f));
            }
        }
    }
    out
}

/// A way back for factions: (spots, max, faction) for a suit card.
pub fn return_room(s: &GameState, pid: Pid, ci: CardIx) -> (Vec<Loc>, i32, Option<Fac>) {
    let c = card(ci);
    let Some(f) = suit_faction(c) else { return (vec![], 0, None) };
    if !s.options.way_back {
        return (vec![], 0, Some(f));
    }
    if (0..s.board.len() as Loc).any(|l| raw_tokens(s, l, f) >= 2) {
        return (vec![], 0, Some(f));
    }
    let spots: Vec<Loc> = (0..s.board.len() as Loc).filter(|&l| !s.board[l as usize].scorched && (is_suit_loc(c, l) || raw_tokens(s, l, f) > 0) && can_enter(s, l, f)).collect();
    let max = (sway_for(s, pid, ci) as i64).min(s.supply[f as usize] as i64).min(my_standing(s, pid, f)) as i32;
    let max = if spots.is_empty() { 0 } else { max };
    (spots, max, Some(f))
}

// ---------------------------------------------------------------------------
// Checking a target
// ---------------------------------------------------------------------------

/// Check a target for a card's turn action. Returns an error, or None.
// PERF: runs the action on a copy, twice when a move was refused (paid and free); bots memoise it per decision.
pub fn check_target(s: &GameState, pid: Pid, ci: CardIx, t: Option<&Target>) -> Option<String> {
    // Steal Their Playbook can't be your last card played (designer, 2026-10-29): as the last card in hand it is only
    // discarded, for no effect.
    let hand = &s.players[pid as usize].hand;
    if card(ci).action == Action::Playbook && hand.len() == 1 && hand.contains(&ci) {
        return if t.is_some() { Some("Steal Their Playbook can't be your last card played: discard it for no effect.".into()) } else { None };
    }
    let reason = check_shape(s, pid, ci, t);
    let Some(t) = t else { return reason };
    if reason.is_some() || !s.options.sway_required {
        return reason;
    }
    let tokens_after = |options: std::rc::Rc<Options>| -> [OMap; NLOC] {
        let mut copy = scratch(s); // no roundPlays: so a copied Playbook play skips this check, as in the JavaScript engine (to review)
        copy.options = options;
        act(&mut copy, pid, ci, t);
        copy.board.map(|p| p.tokens)
    };
    // Pay in full (D21): the action happens only if every move it makes can be paid.
    let refused = UNPAID.with(|u| u.get());
    let paid = tokens_after(s.options.clone());
    if UNPAID.with(|u| u.get()) == refused {
        return None;
    }
    let free = tokens_after(s.options.unpaid());
    if paid == free { None } else { Some("You need the sway to pay for all of it (all or nothing).".into()) }
}

/// A quiet copy of a state, for imagining a move (no log).
pub fn imagined(s: &GameState) -> GameState {
    GameState { round_plays: s.round_plays.clone(), ..scratch_base(s) }
}

/// A quiet copy without the round's plays (checkTarget's and previewTarget's copies, as the JavaScript's hold none).
pub fn scratch(s: &GameState) -> GameState {
    scratch_base(s)
}

fn scratch_base(s: &GameState) -> GameState {
    GameState {
        version: s.version.clone(),
        options: s.options.clone(),
        rng_state: s.rng_state,
        phase: s.phase,
        round: s.round,
        seating: s.seating.clone(),
        players: s.players.clone(),
        factions: s.factions,
        board: s.board,
        supply: s.supply,
        left_out: s.left_out,
        pass: s.pass,
        first: s.first,
        turn: s.turn,
        passes_in_row: s.passes_in_row,
        opened: s.opened,
        copying: s.copying,
        round_plays: Vec::new(),
        growing: s.growing.clone(),
        night: s.night.clone(),
        log: Vec::new(),
        result: s.result.clone(),
        quiet: true,
    }
}

fn reading(t: &Target) -> bool {
    matches!(t.mode, Some(Mode::Location) | Some(Mode::Faction))
}

/// The target's shape, before IC1.
pub fn check_shape(s: &GameState, pid: Pid, ci: CardIx, t: Option<&Target>) -> Option<String> {
    let c = card(ci);
    let Some(t) = t else { return None };
    let e = |m: &str| Some(m.to_string());
    let req = s.options.sway_required;
    let loc_mode = t.mode == Some(Mode::Location);
    let sf = suit_faction(c);
    match c.action {
        Action::Burst => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match (as_loc(t.location), as_fac(t.faction)) {
                (Some(loc), Some(f)) => can_leave(s, loc, f) && (if loc_mode { is_suit_loc(c, loc) } else { Some(f) == sf }),
                _ => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a group at a ☾ location." } else { "Choose an Undead group." });
            }
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let to = picked(&t.from);
            let spots = burst_spots(s, loc, f);
            if to.len() < 2 || !all_distinct(&to) || to.iter().any(|&l| !matches!(l, Id::Loc(x) if spots.contains(&x))) {
                return e("It bursts to at least two neighbouring locations it can enter, 1 token each.");
            }
            if to.len() as i32 > free_of(s, loc, f) {
                return e("One token to each: not more locations than tokens free to leave (from a fight, half).");
            }
            if req && standing(s, pid, f) < to.len() as i32 + 1 { e("You need the sway to pay where it leaves and at every location a token reaches (all or nothing).") } else { None }
        }
        Action::Control => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let max = control_room(s, pid, c, ci, t);
            if max <= 0 {
                return e(if loc_mode { "Choose a fight at a ⏏ location where you have sway, then the faction hit." } else { "Choose a fight the Sentients are in where you have sway, then their rival." });
            }
            let n = count_eq(&t.from, t.location) as i32;
            if n >= 1 && n <= max { None } else { Some(format!("Turn 1 to {max} tokens into trophies: 1 of your sway there for each, up to the card's sway.")) }
        }
        Action::Raise => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let undead = faction_of_archetype("undead");
            let payer: Option<Id> = if t.mode == Some(Mode::Faction) { Some(Id::Fac(undead)) } else { t.payer };
            let Some(loc) = as_loc(t.location) else {
                return e(if loc_mode { "Choose a ☾ location, with the standing to pay for the dead." } else { "Choose a location holding the Undead, with standing with them to raise more." });
            };
            if raise_room(s, pid, loc, t.mode, None).0 <= 0 {
                return e(if loc_mode { "Choose a ☾ location, with the standing to pay for the dead." } else { "Choose a location holding the Undead, with standing with them to raise more." });
            }
            // A payer that isn't a faction in play pays for nothing (raiseRoom with an unknown payer: 0).
            let max = match payer {
                Some(Id::Fac(p)) => raise_room(s, pid, loc, t.mode, Some(p)).0,
                Some(x) if truthy(Some(x)) => 0,
                _ => raise_room(s, pid, loc, t.mode, None).0,
            };
            if !truthy(payer) || max <= 0 {
                return e("Choose whose standing pays: a faction there, the risen Undead included.");
            }
            let n = count_eq(&t.from, t.location) as i32;
            if n >= 1 && n <= max { None } else { Some(format!("Raise from 1 to {max} of the dead: up to the card's sway, your standing with the faction paying and the Undead supply.")) }
        }
        Action::Plough => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match as_loc(t.location) {
                Some(loc) => !s.board[loc as usize].scorched && count_at(s, loc) >= 2 && (if loc_mode { is_suit_loc(c, loc) } else { factions_at(s, loc).contains(&sf.unwrap()) }),
                None => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a fight at a ◐ location." } else { "Choose a fight the Nocturnals are in." });
            }
            let loc = as_loc(t.location).unwrap();
            let from = picked(&t.from);
            let total: i32 = plough_sides(s, loc).iter().map(|x| x.1).sum();
            if from.len() as i32 != total {
                return Some(format!("Every side leaves by half, rounded up: choose {total} exits, one per token."));
            }
            if !plough_fits(s, pid, c, loc, &from) {
                return e("Each side goes out to neighbours it can enter, never where another side goes, and you need the sway for every exit and the fight (all or nothing).");
            }
            let payers = t.payers.clone().unwrap_or_default();
            let pool = plough_pool(s, c, loc);
            if payers.len() != distinct(&from).len() + 1 || payers.iter().any(|&f| !matches!(f, Id::Fac(x) if pool.contains(&x))) {
                return e("Choose who pays each sway: a faction in the fight, or the Nocturnals.");
            }
            if req && pool.iter().any(|&f| payers.iter().filter(|&&x| x == Id::Fac(f)).count() as i32 > standing(s, pid, f)) { e("You need the standing for each sway you split (all or nothing).") } else { None }
        }
        Action::Rejoin => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match (as_loc(t.location), as_fac(t.faction)) {
                (Some(loc), Some(f)) => factions_at(s, loc).contains(&f) && (if loc_mode { is_suit_loc(c, loc) } else { Some(f) == sf }),
                _ => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a group at a ⏏ location." } else { "Choose a Sentients group." });
            }
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let (kin, n, _each, extra, reached) = power_share(s, loc, f);
            if kin.is_empty() || n <= 0 {
                return e("It needs another group of its faction to rejoin, and tokens free to leave.");
            }
            let to = picked(&t.from);
            if to.len() as i32 != extra || !all_distinct(&to) || to.iter().any(|&l| !matches!(l, Id::Loc(x) if kin.contains(&x))) {
                return Some(format!("Choose {extra} of its other groups to get one more token each (1 at a time round them all)."));
            }
            if req && standing(s, pid, f) < reached + 1 { e("You need the sway to pay where it leaves and at every location a token reaches (all or nothing).") } else { None }
        }
        Action::Chase => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match (as_loc(t.location), as_fac(t.faction)) {
                (Some(loc), Some(f)) => can_leave(s, loc, f) && (if loc_mode { is_suit_loc(c, loc) } else { Some(f) == sf }),
                _ => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a group at an ↂ location (from a fight, half of it)." } else { "Choose a Sci-Fi group (from a fight, half of it)." });
            }
            let (start, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let path = picked(&t.path);
            if path.is_empty() {
                return e("Lead the chase at least one step.");
            }
            let mut chase = vec![start];
            for &l in &path {
                let ok = matches!(l, Id::Loc(x) if chase_steps(s, *chase.last().unwrap(), f, &chase).contains(&x));
                if !ok {
                    return e("The chase goes from neighbour to neighbour, where the group can enter, never back.");
                }
                chase.push(l.loc().unwrap());
            }
            if path.len() as i32 > free_of(s, start, f) {
                return e("At least 1 token must arrive: a token stays at every location passed.");
            }
            if req && standing(s, pid, f) < path.len() as i32 + 1 { e("You need the sway to pay at every location on the chase, the start too (all or nothing).") } else { None }
        }
        Action::Well => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let Some(centre) = as_loc(t.location) else { return e("Choose a centre that is empty or holds one faction.") };
            if s.board[centre as usize].scorched || count_at(s, centre) > 1 {
                return e("Choose a centre that is empty or holds one faction.");
            }
            if if loc_mode { !is_suit_loc(c, centre) } else { t.faction != sf.map(Id::Fac) } {
                return e(if loc_mode { "The centre is a ⎈ location." } else { "The ritual calls the Demon faction." });
            }
            let Some(f) = as_fac(t.faction) else { return e("Choose the faction the ritual calls.") };
            if count_at(s, centre) == 1 && !can_enter(s, centre, f) {
                return e("Choose the faction the ritual calls.");
            }
            let (lone, fights) = well_sources(s, centre, f);
            let picks = picked(&t.from);
            for l in distinct(&picks) {
                let k = picks.iter().filter(|&&x| x == l).count() as i32;
                if !matches!(l, Id::Loc(x) if fights.contains(&x) && k <= well_share(s, x, f)) {
                    return e("From a fight, up to half of the group, rounded down.");
                }
            }
            let origins = lone.len() + distinct(&picks).len();
            if origins == 0 {
                return e("Nothing of that faction is next door to answer.");
            }
            if req && standing(s, pid, f) < origins as i32 + 1 { e("You need the sway to pay at every location pulled from and at the centre (all or nothing).") } else { None }
        }
        Action::Herd => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match (as_loc(t.location), as_fac(t.faction)) {
                (Some(loc), Some(f)) => can_leave(s, loc, f) && (if loc_mode { is_suit_loc(c, loc) } else { Some(f) == sf }),
                _ => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a group at a ☾ location (from a fight, half of it)." } else { "Choose an Undead group (from a fight, half of it)." });
            }
            let (start, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let path = picked(&t.path);
            if path.is_empty() {
                return e("Lay the trail: at least one stop, or a group to crash into.");
            }
            let mut trail = vec![start];
            for (i, &l) in path.iter().enumerate() {
                let (pickups, crashes) = trail_steps(s, *trail.last().unwrap(), f, &trail);
                let x = l.loc();
                let pick = matches!(x, Some(x) if pickups.contains(&x));
                let crash = matches!(x, Some(x) if crashes.contains(&x));
                if !pick && !(i == path.len() - 1 && crash) {
                    return e(if i < path.len() - 1 { "Each stop must hold its own kind: a lone group, or its kind in a fight that some can leave." } else { "The trail ends at a stop, or crashing into a lone group of another faction." });
                }
                trail.push(x.unwrap());
            }
            if req && standing(s, pid, f) < path.len() as i32 + 1 { e("You need the sway to pay at every location on the trail (all or nothing).") } else { None }
        }
        Action::Threat => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let ok = match (as_loc(t.location), as_fac(t.faction)) {
                (Some(loc), Some(f)) => can_leave(s, loc, f) && (if loc_mode { is_suit_loc(c, loc) } else { Some(f) == sf }),
                _ => false,
            };
            if !ok {
                return e(if loc_mode { "Choose a group at a ⏏ location." } else { "Choose a Sentient group." });
            }
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            if !matches!(as_loc(t.to), Some(x) if threats_of(s, loc, f).contains(&x)) {
                return e("It marches on the largest lone group of another faction within two locations.");
            }
            if req && standing(s, pid, f) < 2 { e("You need the sway to pay where it leaves and at the fight (all or nothing).") } else { None }
        }
        Action::Gate => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let (a, b) = (as_loc(t.location), as_loc(t.to));
            if !gate_end(s, c, a) || !gate_end(s, c, b) || a == b {
                return e("Join two locations: each an ↂ location or one holding the Sci-Fi faction.");
            }
            let (a, b) = (a.unwrap(), b.unwrap());
            let across = factions_across(s, a, b);
            if across.len() > 2 {
                return e("The Gate can't join locations holding three or more factions between them.");
            }
            let payer = as_fac(t.payer);
            if !matches!(payer, Some(p) if Some(p) == sf || across.contains(&p)) {
                return e("Choose the faction whose sway pays: the Sci-Fi faction or one at either end.");
            }
            if req && standing(s, pid, payer.unwrap()) < 1 {
                return e("You need the sway to pay (all or nothing).");
            }
            if t.losses == Some(Id::Loc(a)) || t.losses == Some(Id::Loc(b)) { None } else { e("Choose which end the winner's losses come off first (they leave the board).") }
        }
        Action::Invite => {
            let Some(to) = as_loc(t.location) else { return e("Choose a location on the board.") };
            if s.board[to as usize].scorched {
                return e("Choose a location on the board.");
            }
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let host = lone_at(s, to);
            let bad = if loc_mode { !is_suit_loc(c, to) || count_at(s, to) > 0 } else { host.is_none() || host == sf };
            if bad {
                return e(if loc_mode { "Choose an empty ◐ location." } else { "Choose a location held by a lone group of another faction." });
            }
            let guests = t.moves.clone().unwrap_or_default();
            let ok = guests_of(s, c, t.mode.unwrap(), to);
            let need = if loc_mode { 2 } else { 1 };
            if guests.len() != need || guests.iter().any(|g| !ok.iter().any(|&(l, f)| g.location == Id::Loc(l) && g.faction == Id::Fac(f))) {
                return e("Choose the groups to invite.");
            }
            if guests.len() == 2 && (guests[0].faction == guests[1].faction || guests[0].location == guests[1].location) {
                return e("Invite two groups of different factions.");
            }
            let payer = if t.mode == Some(Mode::Faction) { sf.map(Id::Fac) } else { t.payer };
            if !truthy(payer) || !guests.iter().any(|g| Some(g.faction) == payer) {
                return e("Choose which invited faction pays at the fight.");
            }
            if req && guests.iter().any(|g| { let f = g.faction.fac().unwrap(); standing(s, pid, f) < 1 + if Some(g.faction) == payer { 1 } else { 0 } }) {
                return e("You need the sway to pay at every location.");
            }
            None
        }
        Action::Split => {
            if let Some(m) = group_target(s, c, t) {
                return e(m);
            }
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let split = t.split.clone().unwrap_or_default();
            let dests: Vec<(Id, i32)> = split.iter().copied().filter(|&(_, n)| n > 0).collect();
            let n = free_of(s, loc, f);
            if n < 2 {
                return e("A group of 1 can't be split.");
            }
            let near = adj(s, loc);
            if dests.len() != 2 || dests.iter().any(|&(d, _)| !matches!(d, Id::Loc(x) if near.contains(&x) && can_enter(s, x, f))) {
                return e("Split between two adjacent locations that can take the group.");
            }
            let mut sizes: Vec<i32> = dests.iter().map(|d| d.1).collect();
            sizes.sort();
            if sizes[0] != n.div_euclid(2) || sizes[1] != (n + 1).div_euclid(2) {
                return e("Split the group evenly.");
            }
            let cost = s.options.sway_per_move;
            if req && cost > 0 && standing(s, pid, f) < 2 * cost + 1 {
                return e("You need the sway to pay where it leaves and at both locations.");
            }
            None
        }
        Action::Favours => {
            let x = hand_x(s, pid, ci).min(s.players[pid as usize].supply);
            match t.use_ {
                Some(Use::Sway) => {
                    let at = picked(&t.from);
                    let fights = fights_now(s);
                    if at.is_empty() || !all_distinct(&at) || at.iter().any(|&l| !matches!(l, Id::Loc(y) if fights.contains(&y))) {
                        return e("Pick fights, each once.");
                    }
                    if at.len() as i32 <= x { None } else { e("At most the cards in your hand, and what your supply holds.") }
                }
                Some(Use::Standing) => {
                    let fs = picked(&t.payers);
                    if fs.is_empty() || fs.iter().any(|&f| f != fs[0]) || fs[0].fac().is_none() {
                        return e("Pick one faction.");
                    }
                    if fs.len() as i32 <= x { None } else { e("At most the cards in your hand, and what your supply holds.") }
                }
                _ => e("Pick a use: sway at fights, or standing."),
            }
        }
        Action::Stakes => {
            let x = hand_x(s, pid, ci);
            match t.use_ {
                Some(Use::Standing) => {
                    let Some(to) = as_fac(t.faction) else { return e("Pick the faction to raise your stake with.") };
                    let from = picked(&t.payers);
                    if from.is_empty() || from.len() as i32 > x || !all_distinct(&from) || from.iter().any(|&f| match f { Id::Fac(f) => f == to || my_standing(s, pid, f) < 1, _ => true }) {
                        return e("Take 1 standing from each of up to X other factions you have standing with.");
                    }
                    None
                }
                Some(Use::Sway) => {
                    let to = as_loc(t.location);
                    let from = picked(&t.from);
                    let n = tally(&from);
                    let Some(to) = to.filter(|&l| !s.board[l as usize].scorched) else { return e("Pick where your sway gathers.") };
                    let near = adj(s, to);
                    if from.is_empty() || from.len() as i32 > x || n.iter().any(|&(l, k)| !matches!(l, Id::Loc(y) if near.contains(&y) && my_sway(s, pid, y) >= k)) {
                        return e("Gather up to X of your sway from next door.");
                    }
                    None
                }
                Some(Use::Tokens) => {
                    let to = as_loc(t.location).filter(|&l| !s.board[l as usize].scorched && my_sway(s, pid, l) >= 1);
                    let Some(to) = to else { return e("Pick a location where you have sway.") };
                    let Some(f) = as_fac(t.faction).filter(|&f| can_enter(s, to, f)) else { return e("Pick a faction that can come in.") };
                    let from = picked(&t.from);
                    let n = tally(&from);
                    let src = stake_sources(s, to, f);
                    if from.is_empty() || from.len() as i32 > x || n.iter().any(|&(l, k)| src.iter().find(|q| Id::Loc(q.0) == l).map(|q| q.1).unwrap_or(0) < k) {
                        return e("Up to X of its tokens come in from next door (from a fight, half).");
                    }
                    if my_standing(s, pid, f) < n.len() as i64 + 1 { e("You need the sway to pay where they leave and where they arrive (all or nothing).") } else { None }
                }
                _ => e("Pick a use: standing, sway on the board, or tokens."),
            }
        }
        Action::Exit => {
            let x = hand_x(s, pid, ci);
            match t.use_ {
                Some(Use::Standing) => {
                    let Some(from) = as_fac(t.faction) else { return e("Pick the faction to spread your standing from.") };
                    let to = picked(&t.payers);
                    if to.is_empty() || to.len() as i64 > (x as i64).min(my_standing(s, pid, from)) || !all_distinct(&to) || to.iter().any(|&f| match f { Id::Fac(f) => f == from, _ => true }) {
                        return e("Move 1 standing to each of up to X other factions.");
                    }
                    None
                }
                Some(Use::Sway) => {
                    let Some(from) = as_loc(t.location).filter(|&l| my_sway(s, pid, l) >= 1) else { return e("Pick a location where you have sway.") };
                    let to = picked(&t.from);
                    let near = adj(s, from);
                    if to.is_empty() || to.len() as i32 > x.min(my_sway(s, pid, from)) || !all_distinct(&to) || to.iter().any(|&l| !matches!(l, Id::Loc(y) if near.contains(&y) && !s.board[y as usize].scorched)) {
                        return e("Send 1 of your sway to each of up to X neighbours.");
                    }
                    None
                }
                Some(Use::Tokens) => {
                    let ok = matches!((as_loc(t.location), as_fac(t.faction)), (Some(l), Some(f)) if can_leave(s, l, f));
                    if !ok {
                        return e("Pick a group (from a fight, half of it).");
                    }
                    let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
                    let to = picked(&t.from);
                    let spots = burst_spots(s, loc, f);
                    if to.is_empty() || to.len() as i32 > x.min(free_of(s, loc, f)) || !all_distinct(&to) || to.iter().any(|&l| !matches!(l, Id::Loc(y) if spots.contains(&y))) {
                        return e("It sends 1 token to each of up to X neighbours it can enter.");
                    }
                    if my_standing(s, pid, f) < to.len() as i64 + 1 { e("You need the sway to pay where it leaves and at every location a token reaches (all or nothing).") } else { None }
                }
                _ => e("Pick a use: standing, sway on the board, or tokens."),
            }
        }
        Action::Showdown => {
            let n = picked(&t.from).iter().filter(|&&l| Some(l) == t.location).count() as i32;
            let ok = matches!((as_loc(t.location), as_fac(t.faction)), (Some(l), Some(f)) if lone_at(s, l) == Some(f));
            if !ok {
                return e("Pick a lone group (never a fight).");
            }
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            if my_sway(s, pid, loc) < 1 {
                return e("You need sway there to fight them.");
            }
            if n >= 1 && n <= my_sway(s, pid, loc).min(tokens_of(s, loc, f)) { None } else { e("As many as your sway there, and the group, allow.") }
        }
        Action::Switch => {
            let x = hand_x(s, pid, ci);
            match t.use_ {
                Some(Use::Standing) => {
                    let (from, to) = (as_fac(t.faction), as_fac(t.to));
                    let n = picked(&t.payers).len() as i64;
                    match (from, to) {
                        (Some(a), Some(b)) if a != b => if n >= 1 && n <= (x as i64).min(my_standing(s, pid, a)) { None } else { e("Up to X of your standing with it.") },
                        _ => e("Pick the faction you leave, then the one you join."),
                    }
                }
                Some(Use::Sway) => {
                    let (from, to) = (as_loc(t.location), as_loc(t.to));
                    let n = picked(&t.from).len() as i32;
                    match (from, to) {
                        (Some(a), Some(b)) if a != b && !s.board[b as usize].scorched => if n >= 1 && n <= x.min(my_sway(s, pid, a)) { None } else { e("Up to X of your sway there.") },
                        _ => e("Pick where your sway leaves, then where it goes."),
                    }
                }
                _ => e("Pick a use: standing, or sway on the board."),
            }
        }
        Action::Playbook => match t.use_ {
            Some(Use::Yours) => if matches!(t.back, Some(Id::Card(b)) if own_plays(s, pid).contains(&b)) { None } else { e("Pick a card you played earlier this round.") },
            Some(Use::Theirs) => match t.back {
                Some(Id::Card(copied)) if copy_options(s, pid).contains(&copied) => None,
                _ => e("Pick a card another player played this round, to take."),
            },
            _ => e("Pick a use: theirs, or yours."),
        },
        Action::Altar | Action::Study | Action::Terror => {
            if !reading(t) {
                return e("Choose a location target or a faction target.");
            }
            let (held, empty) = altar_marks(s, c, t.mode.unwrap());
            let marks = altar_chosen(c, t);
            if marks.is_empty() {
                return e("Mark at least one location.");
            }
            if distinct(&marks.iter().map(|m| m.0).collect::<Vec<_>>()).len() != marks.len() {
                return e("Each location takes one mark.");
            }
            let from = t.from.as_deref().unwrap_or(&[]);
            if marks.iter().any(|m| !held.iter().any(|&(l, f)| m.0 == Id::Loc(l) && m.1 == Id::Fac(f)) && !(matches!(m.0, Id::Loc(x) if empty.contains(&x)) && from.contains(&m.0))) {
                return if loc_mode {
                    let sym = match c.action { Action::Altar => "⎈", Action::Study => "ↂ", _ => "◐" };
                    Some(format!("Mark {sym} locations, each paid by a faction there (an empty one by the suit's faction)."))
                } else {
                    e("Mark locations holding the suit's faction.")
                };
            }
            if marks.len() as i32 > sway_for(s, pid, ci) {
                return e("Mark no more locations than the card's sway: 1 sway on each.");
            }
            let owed = tally(&marks.iter().map(|m| m.1).collect::<Vec<_>>());
            if req && owed.iter().any(|&(f, n)| standing(s, pid, f.fac().unwrap()) < n) { e("You need the standing for every mark: 1 sway on each (all or nothing).") } else { None }
        }
    }
}

// ---------------------------------------------------------------------------
// Carrying out a card's action
// ---------------------------------------------------------------------------

/// Carry out a card's turn action on `s` (a copy).
pub fn act(s: &mut GameState, pid: Pid, ci: CardIx, t: &Target) {
    let c = card(ci);
    let mut placed: Placed = Vec::new();
    let me = pid as usize;
    let seating = s.seating.clone();
    let who: &str = &seating[me];
    match c.action {
        Action::Burst => {
            let (f, loc) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
            let to = picked(&t.from);
            let mut n = 0;
            for &l in &to {
                n += mv(s, pid, f, loc, l.loc().unwrap(), 1, &mut placed, false);
            }
            place_one(s, pid, f, loc);
            let fnm = fname(s, f);
            log_line(s, |_| { let names = to.iter().map(|l| lname(l.loc().unwrap())).collect::<Vec<_>>().join(", "); format!("{who}: {}: the {fnm} at {} scatter{}.", c.name, lname(loc), if n > 0 { format!(" to {names}") } else { String::new() }) });
        }
        Action::Control => {
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let n = count_eq(&t.from, t.location) as i32;
            take_tokens(s, loc, f, n);
            s.players[me].trophies[f as usize] += n;
            let v = s.board[loc as usize].sway.get(pid) - n;
            s.board[loc as usize].sway.set(pid, v);
            if v <= 0 {
                s.board[loc as usize].sway.remove(pid);
            }
            s.players[me].supply += n;
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {}: the machines cut down {n} {fnm} at {}.", c.name, lname(loc)));
        }
        Action::Raise => {
            let loc = as_loc(t.location).unwrap();
            let undead = faction_of_archetype("undead");
            let n = count_eq(&t.from, t.location) as i32;
            s.supply[undead as usize] -= n;
            add_tokens(s, loc, undead, n);
            let payer = if t.mode == Some(Mode::Faction) { undead } else { as_fac(t.payer).unwrap_or(undead) };
            for _ in 0..n {
                place_one(s, pid, payer, loc);
            }
            let fnm = fname(s, undead);
            log_line(s, |_| format!("{who}: {}: {n} {fnm} rise at {}.", c.name, lname(loc)));
        }
        Action::Plough => {
            let loc = as_loc(t.location).unwrap();
            let from = picked(&t.from);
            let mut i = 0usize;
            for (f, n, _) in plough_sides(s, loc) {
                let a = i.min(from.len());
                let b = (i + n as usize).min(from.len());
                let mine: Vec<Id> = from[a..b].to_vec();
                i += n as usize;
                for l in distinct(&mine) {
                    let l = l.loc().unwrap();
                    if !placed.contains(&(l, f)) {
                        placed.push((l, f));
                    }
                    let k = mine.iter().filter(|&&x| x == Id::Loc(l)).count() as i32;
                    mv(s, pid, f, loc, l, k, &mut placed, true);
                }
            }
            let exits = distinct(&from);
            let payers = t.payers.clone().unwrap_or_default();
            let mut spots: Vec<Loc> = exits.iter().map(|l| l.loc().unwrap()).collect();
            spots.push(loc);
            for (k, &l) in spots.iter().enumerate() {
                if let Some(Id::Fac(f)) = payers.get(k) {
                    place_one(s, pid, *f, l);
                }
            }
            log_line(s, |_| { let names = exits.iter().map(|l| lname(l.loc().unwrap())).collect::<Vec<_>>().join(", "); format!("{who}: {}: the fight at {} scatters to {names}.", c.name, lname(loc)) });
        }
        Action::Rejoin => {
            let (f, loc) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
            let (kin, _n, each, _extra, _r) = power_share(s, loc, f);
            let extra = picked(&t.from);
            let went: Vec<(Loc, i32)> = kin.iter().map(|&l| (l, each + if extra.contains(&Id::Loc(l)) { 1 } else { 0 })).filter(|x| x.1 > 0).collect();
            for &(l, k) in &went {
                mv(s, pid, f, loc, l, k, &mut placed, true);
            }
            place_one(s, pid, f, loc);
            let fnm = fname(s, f);
            log_line(s, |_| { let names = went.iter().map(|x| lname(x.0)).collect::<Vec<_>>().join(", "); format!("{who}: {}: the {fnm} at {} scatter to their own at {names}.", c.name, lname(loc)) });
        }
        Action::Chase => {
            let (f, start) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
            let path: Vec<Loc> = picked(&t.path).iter().map(|l| l.loc().unwrap()).collect();
            let n = free_of(s, start, f);
            take_tokens(s, start, f, n);
            place_one(s, pid, f, start);
            for &l in &path[..path.len() - 1] {
                add_tokens(s, l, f, 1);
                place_one(s, pid, f, l);
            }
            let end = *path.last().unwrap();
            add_tokens(s, end, f, n - (path.len() as i32 - 1));
            place_one(s, pid, f, end);
            let fnm = fname(s, f);
            log_line(s, |_| { let strag = if path.len() > 1 { format!(", leaving stragglers at {}", path[..path.len() - 1].iter().map(|&l| lname(l)).collect::<Vec<_>>().join(", ")) } else { String::new() }; format!("{who}: {}: {fnm} chased from {} to {}{strag}.", c.name, lname(start), lname(end)) });
        }
        Action::Well => {
            let (centre, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let (lone, _) = well_sources(s, centre, f);
            let picks = picked(&t.from);
            let mut pulls: Vec<(Loc, i32)> = lone.iter().map(|&l| (l, tokens_of(s, l, f))).collect();
            for l in distinct(&picks) {
                pulls.push((l.loc().unwrap(), picks.iter().filter(|&&x| x == l).count() as i32));
            }
            if !placed.contains(&(centre, f)) {
                placed.push((centre, f));
            }
            let mut n = 0;
            for (l, k) in pulls {
                let m = mv(s, pid, f, l, centre, k, &mut placed, false);
                if m > 0 {
                    n += m;
                    place_one(s, pid, f, l);
                }
            }
            if n > 0 {
                place_one(s, pid, f, centre);
            }
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {}: {n} {fnm} are drawn into {}.", c.name, lname(centre)));
        }
        Action::Herd => {
            let (f, start) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
            let path: Vec<Loc> = picked(&t.path).iter().map(|l| l.loc().unwrap()).collect();
            let end = *path.last().unwrap();
            let crashes = !factions_at(s, end).contains(&f);
            let mut n = free_of(s, start, f);
            take_tokens(s, start, f, n);
            place_one(s, pid, f, start);
            let stops: &[Loc] = if crashes { &path[..path.len() - 1] } else { &path[..] };
            for &l in stops {
                let k = if count_at(s, l) >= 2 { free_of(s, l, f) } else { tokens_of(s, l, f) };
                take_tokens(s, l, f, k);
                n += k;
                place_one(s, pid, f, l);
            }
            add_tokens(s, end, f, n);
            if crashes {
                place_one(s, pid, f, end);
            }
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {}: {n} {fnm} follow the trail {} {}.", c.name, if crashes { "and crash into" } else { "to" }, lname(end)));
        }
        Action::Threat => {
            let (f, from, to) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap(), as_loc(t.to).unwrap());
            placed.push((to, f));
            let all = tokens_of(s, from, f);
            let n = mv(s, pid, f, from, to, all, &mut placed, false);
            if n > 0 {
                place_one(s, pid, f, from);
                place_one(s, pid, f, to);
            }
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {}: {n} {fnm} march on {}.", c.name, lname(to)));
        }
        Action::Gate => {
            let (a, b) = (as_loc(t.location).unwrap(), as_loc(t.to).unwrap());
            s.board[a as usize].gate = Some(b);
            s.board[b as usize].gate = Some(a);
            s.board[a as usize].gate_loss = as_loc(t.losses);
            s.board[b as usize].gate_loss = as_loc(t.losses);
            if let Some(p) = as_fac(t.payer) {
                place_one(s, pid, p, a);
            }
            log_line(s, |_| format!("{who}: {} joins {} and {} for the rest of the round.", c.name, lname(a), lname(b)));
        }
        Action::Invite => {
            let to = as_loc(t.location).unwrap();
            let payer = if t.mode == Some(Mode::Faction) { suit_faction(c) } else { as_fac(t.payer) };
            let guests = t.moves.clone().unwrap_or_default();
            for g in &guests {
                let (gl, gf) = (g.location.loc().unwrap(), g.faction.fac().unwrap());
                if !placed.contains(&(to, gf)) {
                    placed.push((to, gf));
                }
                let all = tokens_of(s, gl, gf);
                if mv(s, pid, gf, gl, to, all, &mut placed, false) > 0 {
                    place_one(s, pid, gf, gl);
                }
            }
            if let Some(p) = payer {
                place_one(s, pid, p, to);
            }
            log_line(s, |s| { let names = guests.iter().map(|g| fname(s, g.faction.fac().unwrap())).collect::<Vec<_>>().join(" and "); format!("{who}: {}: {names} come into {}.", c.name, lname(to)) });
        }
        Action::Split => {
            let (f, from) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
            for &(to, n) in t.split.as_deref().unwrap_or(&[]) {
                mv(s, pid, f, from, to.loc().unwrap(), n, &mut placed, false);
            }
            place_one(s, pid, f, from);
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {} turns {fnm} away from {}.", c.name, lname(from)));
        }
        Action::Favours => {
            if t.use_ == Some(Use::Sway) {
                let at = picked(&t.from);
                for &l in &at {
                    if s.players[me].supply <= 0 {
                        break;
                    }
                    s.players[me].supply -= 1;
                    s.board[l.loc().unwrap() as usize].sway.add(pid, 1);
                }
                log_line(s, |_| { let names = at.iter().map(|l| lname(l.loc().unwrap())).collect::<Vec<_>>().join(", "); format!("{who}: {}: sway from the supply at {names}.", c.name) });
            } else {
                let fs = picked(&t.payers);
                let f = fs[0].fac().unwrap();
                let n = (fs.len() as i32).min(s.players[me].supply);
                s.players[me].supply -= n;
                s.players[me].standing[f as usize] += n;
                let fnm = fname(s, f);
                log_line(s, |_| format!("{who}: {}: {n} standing with {fnm}, from the supply.", c.name));
            }
        }
        Action::Stakes => {
            match t.use_ {
                Some(Use::Standing) => {
                    let to = as_fac(t.faction).unwrap();
                    let from = picked(&t.payers);
                    for f in &from {
                        s.players[me].standing[f.fac().unwrap() as usize] -= 1;
                    }
                    s.players[me].standing[to as usize] += from.len() as i32;
                    let fnm = fname(s, to);
                    log_line(s, |_| format!("{who}: {}: {} standing gathered with {fnm}.", c.name, from.len()));
                }
                Some(Use::Sway) => {
                    let to = as_loc(t.location).unwrap();
                    let from = picked(&t.from);
                    for l in &from {
                        let l = l.loc().unwrap() as usize;
                        let v = s.board[l].sway.get(pid) - 1;
                        s.board[l].sway.set(pid, v);
                        if v == 0 {
                            s.board[l].sway.remove(pid);
                        }
                    }
                    s.board[to as usize].sway.add(pid, from.len() as i32);
                    log_line(s, |_| format!("{who}: {}: {} sway gathered at {}.", c.name, from.len(), lname(to)));
                }
                _ => {
                    // Tokens: up to X come in from next door; 1 sway where each group left and 1 at the centre.
                    let (to, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
                    let n = tally(&picked(&t.from));
                    placed.push((to, f));
                    let mut moved = 0;
                    for (l, k) in n {
                        let l = l.loc().unwrap();
                        let m = mv(s, pid, f, l, to, k, &mut placed, false);
                        if m > 0 {
                            moved += m;
                            place_one(s, pid, f, l);
                        }
                    }
                    if moved > 0 {
                        place_one(s, pid, f, to);
                    }
                    let fnm = fname(s, f);
                    log_line(s, |_| format!("{who}: {}: {moved} {fnm} come in to {}.", c.name, lname(to)));
                }
            }
        }
        Action::Exit => match t.use_ {
            Some(Use::Standing) => {
                let from = as_fac(t.faction).unwrap();
                let to = picked(&t.payers);
                s.players[me].standing[from as usize] -= to.len() as i32;
                for f in &to {
                    s.players[me].standing[f.fac().unwrap() as usize] += 1;
                }
                let fnm = fname(s, from);
                log_line(s, |s| { let names = to.iter().map(|f| fname(s, f.fac().unwrap())).collect::<Vec<_>>().join(", "); format!("{who}: {}: standing with {fnm} spread to {names}.", c.name) });
            }
            Some(Use::Sway) => {
                let from = as_loc(t.location).unwrap();
                let to = picked(&t.from);
                let v = s.board[from as usize].sway.get(pid) - to.len() as i32;
                s.board[from as usize].sway.set(pid, v);
                if v == 0 {
                    s.board[from as usize].sway.remove(pid);
                }
                for l in &to {
                    s.board[l.loc().unwrap() as usize].sway.add(pid, 1);
                }
                log_line(s, |_| { let names = to.iter().map(|l| lname(l.loc().unwrap())).collect::<Vec<_>>().join(", "); format!("{who}: {}: sway spread from {} to {names}.", c.name, lname(from)) });
            }
            _ => {
                let (f, loc) = (as_fac(t.faction).unwrap(), as_loc(t.location).unwrap());
                let to = picked(&t.from);
                let mut n = 0;
                for l in &to {
                    n += mv(s, pid, f, loc, l.loc().unwrap(), 1, &mut placed, false);
                }
                place_one(s, pid, f, loc);
                let fnm = fname(s, f);
                log_line(s, |_| format!("{who}: {}: {n} {fnm} scatter from {}.", c.name, lname(loc)));
            }
        },
        Action::Showdown => {
            let (loc, f) = (as_loc(t.location).unwrap(), as_fac(t.faction).unwrap());
            let k = picked(&t.from).iter().filter(|&&l| l == Id::Loc(loc)).count() as i32;
            let n = k.min(s.board[loc as usize].sway.get(pid)).min(tokens_of(s, loc, f));
            take_tokens(s, loc, f, n);
            s.players[me].trophies[f as usize] += n;
            let v = s.board[loc as usize].sway.get(pid) - n;
            s.board[loc as usize].sway.set(pid, v);
            if v == 0 {
                s.board[loc as usize].sway.remove(pid);
            }
            s.players[me].supply += n;
            let fnm = fname(s, f);
            log_line(s, |_| format!("{who}: {} at {}: {n} {fnm} slain, {who}'s trophies.", c.name, lname(loc)));
        }
        Action::Switch => {
            if t.use_ == Some(Use::Standing) {
                let n = picked(&t.payers).len() as i32;
                let (from, to) = (as_fac(t.faction).unwrap(), as_fac(t.to).unwrap());
                s.players[me].standing[from as usize] -= n;
                s.players[me].standing[to as usize] += n;
                let (a, b) = (fname(s, from), fname(s, to));
                log_line(s, |_| format!("{who}: {}: {n} standing from {a} to {b}.", c.name));
            } else {
                let n = picked(&t.from).len() as i32;
                let (from, to) = (as_loc(t.location).unwrap(), as_loc(t.to).unwrap());
                let v = s.board[from as usize].sway.get(pid) - n;
                s.board[from as usize].sway.set(pid, v);
                if v == 0 {
                    s.board[from as usize].sway.remove(pid);
                }
                s.board[to as usize].sway.add(pid, n);
                log_line(s, |_| format!("{who}: {}: {n} sway from {} to {}.", c.name, lname(from), lname(to)));
            }
        }
        Action::Playbook => {
            if t.use_ == Some(Use::Yours) {
                let Some(Id::Card(back)) = t.back else { return };
                if let Some(i) = s.round_plays.iter().rposition(|x| x.pid == pid && x.card == back) {
                    s.round_plays.remove(i);
                }
                s.players[me].hand.push(back);
                log_line(s, |_| format!("{who}: {}: takes {} back.", c.name, card(back).name));
            } else if let Some(Id::Card(copied)) = t.back {
                // Theirs (D30): the card comes from another player's plays into your hand, to be played now as your own.
                if let Some(i) = s.round_plays.iter().rposition(|x| x.pid != pid && x.card == copied) {
                    s.round_plays.remove(i);
                }
                s.players[me].hand.push(copied);
                s.copying = Some(copied);
                log_line(s, |_| format!("{who}: {}: takes {} from the cards played this round, to play as their own.", c.name, card(copied).name));
            }
        }
        Action::Altar | Action::Terror | Action::Study => {
            let marks = altar_chosen(c, t);
            for &(l, f) in &marks {
                let l = l.loc().unwrap();
                match c.action {
                    Action::Altar => s.board[l as usize].altar = true,
                    Action::Terror => s.board[l as usize].terror = Some(pid),
                    _ => s.board[l as usize].study = Some(pid),
                }
                place_one(s, pid, f.fac().unwrap(), l);
            }
            log_line(s, |_| {
                let names = marks.iter().map(|m| lname(m.0.loc().unwrap())).collect::<Vec<_>>().join(", ");
                match c.action {
                    Action::Altar => format!("{who}: {}: blood on {names}.", c.name),
                    Action::Terror => format!("{who}: {}: terror waits for nightfall at {names}.", c.name),
                    _ => format!("{who}: {}: the kids will study the bodies at {names}.", c.name),
                }
            });
        }
    }
}
