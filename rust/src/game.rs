//! Validation, applying moves, the resolve phase and the end of the game .

use crate::board::*;
use crate::cards::*;
use crate::setup::*;
use crate::spec::spec;
use crate::types::*;
use std::rc::Rc;

/// A move's verdict: None is legal, Some(reason) is not.
pub type Verdict = Option<String>;

fn no(m: &str) -> Verdict {
    Some(m.to_string())
}


/// Is a move legal? (validate)
pub fn validate(s: &GameState, pid: Pid, m: &Move) -> Verdict {
    if pid as usize >= s.n() {
        return no("You are not seated at this table.");
    }
    if s.phase == Phase::Ended {
        return no("The game is over.");
    }
    let p = &s.players[pid as usize];
    match s.phase {
        Phase::Draft => {
            let Move::Pick { keep } = m else { return no("Pick cards in the draft.") };
            if p.picked {
                return no("You have already picked from this batch.");
            }
            if keep.len() != p.kept.len() + 1 {
                return Some(format!("Keep {} cards.", p.kept.len() + 1));
            }
            let dup = keep.iter().enumerate().any(|(i, c)| keep[..i].contains(c));
            if dup || keep.iter().any(|c| !p.kept.contains(c) && !p.batch.contains(c)) {
                return no("Keep cards from your kept cards and this batch.");
            }
            None
        }
        Phase::Night => {
            let (Move::Flee { location, faction, to, follow }, Some(n)) = (m, s.night.as_ref()) else { return no("Night has fallen: decide who flees from each mark.") };
            if n.player != pid {
                return no("Another player decides at nightfall.");
            }
            if !n.left.contains(location) {
                return no("Choose one of your marks.");
            }
            let Some(f) = faction else { return None };
            let exits = flee_options(s, *location).into_iter().find(|o| o.0 == *f).map(|o| o.1).unwrap_or_default();
            if !matches!(to, Some(t) if exits.contains(t)) {
                return no("1 token flees to a neighbouring location it can enter (from a fight, half may leave).");
            }
            if follow.unwrap_or(false) && s.board[*location as usize].sway.get(pid) < 1 { no("You have no sway there to follow.") } else { None }
        }
        Phase::Play => {
            if s.turn != pid as usize {
                return no("It is not your turn.");
            }
            // A card taken with Steal Their Playbook is played now (D30).
            if let Some(x) = s.copying {
                if !matches!(m, Move::Play { card, .. } if *card == x) {
                    return Some(format!("Play {} now: you took it with Steal Their Playbook.", spec().cards[x as usize].name));
                }
            }
            match m {
                Move::Pass => {
                    if !s.options.passing {
                        no("No passing: play a card.")
                    } else {
                        None
                    }
                }
                Move::Play { card, use_, target, places } => {
                    if !p.hand.contains(card) {
                        return no("That card is not in your hand.");
                    }
                    let c = &spec().cards[*card as usize];
                    match use_ {
                        PlayUse::Sway => {
                            if c.suit.is_none() {
                                if s.options.unsuited_sway == 0 {
                                    return no("Unsuited cards have no sway use.");
                                }
                                let f = target.as_ref().and_then(|t| t.as_ref()).and_then(|t| crate::cards::as_fac(t.faction));
                                if f.is_none_or(|f| f as usize >= s.factions.len()) {
                                    return no("Pick the faction to gain sway with.");
                                }
                            }
                            if p.supply <= 0 { no("Your supply is empty.") } else { None }
                        }
                        PlayUse::Return => {
                            let (spots, max, _) = return_room(s, pid, *card);
                            let places = places.clone().unwrap_or_default();
                            if max == 0 {
                                return no("Its faction can come back only when it has no location with 2 or more of its tokens, and you need standing with it.");
                            }
                            if !places.is_empty() && places.len() as i32 <= max && places.iter().all(|l| spots.contains(l)) { None } else { Some(format!("Bring back 1 to {max} of its tokens, at its own locations or where it already is.")) }
                        }
                        PlayUse::Action => check_target(s, pid, *card, target.as_ref().and_then(|t| t.as_ref())),
                    }
                }
                _ => no("Play a card or pass."),
            }
        }
        Phase::Ended => no("The game is over."),
    }
}

/// Validates, copies, changes the copy, and runs any automatic steps (applyMove).
pub fn apply_move(s: &GameState, pid: Pid, m: &Move) -> Result<GameState, String> {
    if let Some(reason) = validate(s, pid, m) {
        return Err(reason);
    }
    Ok(apply_legal(s, pid, m))
}

/// Applies a move already known to be legal (a bot's search, which validated it when it made it). Debug builds check.
pub fn apply_legal(s: &GameState, pid: Pid, m: &Move) -> GameState {
    debug_assert!(validate(s, pid, m).is_none(), "apply_legal with an illegal move: {m:?}");
    let mut next = s.clone();
    let me = pid as usize;
    let seating = s.seating.clone();
    let who: &str = &seating[me];
    match m {
        Move::Pick { keep } => {
            let p = &mut next.players[me];
            let pool: Vec<CardIx> = p.kept.iter().chain(p.batch.iter()).copied().collect();
            p.kept = Hand::from_slice(keep);
            p.batch = pool.into_iter().filter(|c| !keep.contains(c)).collect();
            p.picked = true;
            if next.players.iter().all(|p| p.picked) {
                pass_batches(&mut next);
            }
        }
        Move::Flee { location, faction, to, follow } => {
            let loc = *location;
            if let (Some(f), Some(to)) = (*faction, *to) {
                take_tokens(&mut next, loc, f, 1);
                add_tokens(&mut next, to, f, 1);
                let follow = follow.unwrap_or(false);
                if follow {
                    let sw = &mut next.board[loc as usize].sway;
                    let v = sw.get(pid) - 1;
                    sw.set(pid, v);
                    if v == 0 {
                        sw.remove(pid);
                    }
                    next.board[to as usize].sway.add(pid, 1);
                }
                let fnm = fname(&next, f);
                log_line(&mut next, |_| format!("  Night terrors at {}: 1 {fnm} flees to {}{}.", lname(loc), lname(to), if follow { format!(", {who}'s sway following") } else { String::new() }));
            }
            next.board[loc as usize].terror = None;
            let n = next.night.as_mut().expect("night");
            n.left.retain(|l| l != loc);
            if n.left.is_empty() {
                close_round(&mut next);
            }
        }
        Move::Pass => {
            next.passes_in_row += 1;
            log_line(&mut next, |_| format!("{who} passes."));
            if next.passes_in_row >= next.n() as i32 {
                end_of_play(&mut next);
            } else {
                next.turn = (next.turn + 1) % next.n();
            }
        }
        Move::Play { card, use_, target, places } => {
            let ci = *card;
            if next.copying == Some(ci) {
                next.copying = None; // the card taken with Steal Their Playbook, played
            }
            next.players[me].hand.retain(|c| c != ci);
            next.round_plays.push(RoundPlay { pid, card: ci, use_: *use_ });
            next.passes_in_row = 0;
            if Some(pid) == next.first {
                next.opened = true;
            }
            let c = &spec().cards[ci as usize];
            match use_ {
                PlayUse::Sway => {
                    let f = match c.suit { Some(x) => x as Fac, None => target.as_ref().and_then(|t| t.as_ref()).and_then(|t| crate::cards::as_fac(t.faction)).expect("a faction") };
                    let gain = sway_gain(s, pid, ci).min(next.players[me].supply);
                    next.players[me].supply -= gain;
                    next.players[me].standing[f as usize] += gain;
                    let fnm = fname(&next, f);
                    log_line(&mut next, |_| format!("{who} plays {} for {gain} sway with {fnm}.", c.name));
                }
                PlayUse::Return => {
                    let (_, _, f) = return_room(s, pid, ci);
                    let f = f.expect("suited");
                    let places = places.clone().unwrap_or_default();
                    for &l in &places {
                        add_tokens(&mut next, l, f, 1);
                    }
                    let k = places.len() as i32;
                    next.supply[f as usize] -= k;
                    next.players[me].standing[f as usize] -= k;
                    next.players[me].supply += k;
                    let mut uniq: Vec<Loc> = Vec::new();
                    for &l in &places {
                        if !uniq.contains(&l) {
                            uniq.push(l);
                        }
                    }
                    let fnm = fname(&next, f);
                    log_line(&mut next, |_| { let names = uniq.iter().map(|&l| lname(l)).collect::<Vec<_>>().join(", "); format!("{who} plays {} to bring {k} {fnm} back, at {names}.", c.name) });
                }
                PlayUse::Action => {
                    log_line(&mut next, |_| format!("{who} plays {}.", c.name));
                    match target {
                        Some(Some(t)) => {
                            act(&mut next, pid, ci, t);
                            // D44: Steal Their Playbook's player goes first next round.
                            if c.action == crate::spec::Action::Playbook {
                                next.next_first = Some(pid);
                            }
                        }
                        _ if c.action == crate::spec::Action::Playbook && s.players[me].hand.len() == 1 => log_line(&mut next, |_| format!("{who} discards {}: it can't be the last card played.", c.name)),
                        _ => log_line(&mut next, |_| format!("{} has nothing to act on.", c.name)),
                    }
                }
            }
            if next.copying.is_some() {
                // Steal Their Playbook took a card: the same seat plays it now, in the same turn.
                return next;
            }
            next.turn = (next.turn + 1) % next.n();
            if !next.options.passing {
                // No passing: the round's play ends when the last card is played; a seat with an empty hand is skipped.
                if next.players.iter().all(|p| p.hand.is_empty()) {
                    end_of_play(&mut next);
                } else {
                    while next.players[next.turn].hand.is_empty() {
                        next.turn = (next.turn + 1) % next.n();
                    }
                }
            }
        }
    }
    next
}

/// Everyone has picked: pass the rest on; when the batches are empty the draft is over.
fn pass_batches(s: &mut GameState) {
    let n = s.n();
    let batches: Vec<Hand> = s.players.iter().map(|p| p.batch).collect();
    for i in 0..n {
        s.players[i].batch = batches[(i + n - 1) % n];
        s.players[i].picked = false;
    }
    s.pass += 1;
    if s.players.iter().all(|p| p.batch.len() == 1) {
        for p in s.players.iter_mut() {
            let b = std::mem::take(&mut p.batch);
            p.kept.extend(b);
        }
    }
    if s.players.iter().all(|p| p.batch.is_empty()) {
        start_play(s);
    }
}

/// The draft is done: hands are the kept cards. D44: the first player stays, unless Steal Their Playbook was played
/// last round (its player goes first); round 1's is random (create_game). The first player opens with any card.
fn start_play(s: &mut GameState) {
    for p in s.players.iter_mut() {
        p.hand = std::mem::take(&mut p.kept);
    }
    let first = s.next_first.take().or(s.first).unwrap_or(0);
    s.first = Some(first);
    s.turn = first as usize;
    s.opened = true;
    s.passes_in_row = 0;
    s.phase = Phase::Play;
    let name = s.seating[first as usize].clone();
    log_line(s, |_| format!("Draft done. {name} goes first."));
}

/// The round's play is over: unplayed cards go back; nightfall, or the fights.
fn end_of_play(s: &mut GameState) {
    for p in s.players.iter_mut() {
        p.hand = Hand::new();
    }
    let marks: Vec<Loc> = (0..s.board.len() as Loc).filter(|&l| s.board[l as usize].terror.is_some()).collect();
    if !marks.is_empty() {
        s.phase = Phase::Night;
        s.night = Some(Night { player: s.board[marks[0] as usize].terror.unwrap(), left: Locs::from_slice(&marks) });
        let why = if s.options.passing { "Everyone passed" } else { "Every card is played" };
        log_line(s, |_| format!("{why}. Night falls."));
        return;
    }
    close_round(s);
}

// Tokens leaving the board in the real game's fights and coming onto it by growth, since last taken (the game-feel
// measurements, `motw tournament`; imagined states don't count). A measuring aid.
thread_local! {
    static FLOW: std::cell::Cell<(i32, i32)> = const { std::cell::Cell::new((0, 0)) };
}

/// Takes the flow since last taken: (lost in fights, grown).
pub fn take_flow() -> (i32, i32) {
    FLOW.with(|f| f.replace((0, 0)))
}

/// Put back what take_flow and take_fights took (the runner's what-if checks play real states).
pub fn put_back(flow: (i32, i32), fights: Vec<([i32; 5], [i32; 5], usize)>, log: Vec<FightRec>) {
    FLOW.with(|f| f.set(flow));
    FIGHTS.with(|f| *f.borrow_mut() = fights);
    FIGHT_LOG.with(|f| *f.borrow_mut() = log);
}

thread_local! {
    static FIGHTS: std::cell::RefCell<Vec<([i32; 5], [i32; 5], usize)>> = const { std::cell::RefCell::new(Vec::new()) };
    static FIGHT_LOG: std::cell::RefCell<Vec<FightRec>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// One real fight, for measuring how the bots contest fights (designer, 2026-11-03): the round, the location, each
/// seat's sway there before it, and each pile (its size and who took it; None: back to supply). Scorched: piles empty.
#[derive(Clone, Debug)]
pub struct FightRec {
    pub round: i32,
    pub loc: Loc,
    pub sway: [i32; 5],
    pub piles: Vec<(i32, Option<Pid>)>,
    pub scorched: i32,
    /// Each seat's unspent sway and cards in hand when the fight came (could a tie have been broken?).
    pub supply: [i32; 5],
    pub hand: [i32; 5],
    /// The move of the game it came in (set by the runner, to order it against sway changes).
    pub mv: usize,
    /// Each seat's sway left at the location after the fight (AF3: all but first claim's; none when scorched).
    pub left: [i32; 5],
    /// Each pile's faction (with piles), the winning faction (-1 when scorched), each seat's trophies taken by faction
    /// (piles and Study the Bodies), and the standing first claim took in the winner (measuring aids, bot-focus).
    pub colours: Vec<i32>,
    pub winner: i32,
    pub took: [[i32; 5]; 5],
    pub standing: [i32; 5],
}

/// One nightfall arrival (a measuring aid, `motw tournament`, designer 2026-11-04): the round, the location, the
/// tokens it brought, and each seat's sway there that brought them.
#[derive(Clone, Debug)]
pub struct NightRec {
    pub round: i32,
    pub loc: Loc,
    pub n: i32,
    pub sway: [i32; 5],
}

thread_local! {
    static NIGHT_LOG: std::cell::RefCell<Vec<NightRec>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// The real game's nightfall arrivals since last taken.
pub fn take_night_log() -> Vec<NightRec> {
    NIGHT_LOG.with(|f| std::mem::take(&mut *f.borrow_mut()))
}

/// Put back what take_night_log took (the runner's what-if checks play real states).
pub fn put_back_night(log: Vec<NightRec>) {
    NIGHT_LOG.with(|f| *f.borrow_mut() = log);
}

/// The real game's fights since last taken (a measuring aid, `motw tournament`).
pub fn take_fight_log() -> Vec<FightRec> {
    FIGHT_LOG.with(|f| std::mem::take(&mut *f.borrow_mut()))
}

/// The real game's round closes since last taken: each faction's presence just before and just after the fights (the
/// vote's moment). A measuring aid (`motw tournament`).
pub fn take_fights() -> Vec<([i32; 5], [i32; 5], usize)> {
    FIGHTS.with(|f| std::mem::take(&mut *f.borrow_mut()))
}

fn by_faction(s: &GameState) -> [i32; 5] {
    let mut out = [0; 5];
    for (f, x) in out.iter_mut().enumerate() {
        *x = presence_of(s, f as Fac);
    }
    out
}

fn note_flow(lost: i32, grown: i32) {
    FLOW.with(|f| { let (a, b) = f.get(); f.set((a + lost, b + grown)); });
}

/// The fights, then growth.
fn close_round(s: &mut GameState) {
    s.phase = Phase::Play;
    s.night = None;
    log_line(s, |_| "Fights:".to_string());
    let before = total_presence(s);
    let before_by = by_faction(s);
    let due = if s.quiet { 0 } else { fights_due(s).len() };
    let mut fought: Vec<bool> = (0..s.board.len() as Loc).map(|l| !s.board[l as usize].scorched && count_at(s, l) >= 2).collect();
    for l in 0..s.board.len() as Loc {
        if let Some(g) = gate_of(s, l) {
            let both = fought[l as usize] || fought[g as usize] || (count_at(s, l) + count_at(s, g) >= 2 && factions_at(s, l).iter().chain(factions_at(s, g).iter()).collect::<std::collections::BTreeSet<_>>().len() >= 2);
            fought[l as usize] = both;
            fought[g as usize] = both;
        }
    }
    for l in 0..s.board.len() as Loc {
        fight_at(s, l);
    }
    if !s.quiet {
        note_flow(before - total_presence(s), 0);
        let after_by = by_faction(s);
        FIGHTS.with(|f| f.borrow_mut().push((before_by, after_by, due)));
    }
    let after_fights = total_presence(s);
    s.last_close = Some([s.round, before, after_fights, 0]);
    if s.options.round_votes {
        let (total, bar) = (total_presence(s), s.options.threshold);
        let over = total > bar;
        s.votes[if over { 0 } else { 1 }] += s.options.vote_weight(s.round);
        let (a, b) = (s.votes[0], s.votes[1]);
        log_line(s, |_| format!("Round's vote: presence {total} is {} {bar}: {}. Invaders {a}, island {b}.", if over { "more than" } else { "not more than" }, if over { "the invaders" } else { "the island" }));
        // The invaders need strictly more votes (designer, 2026-11-01): a tie goes to the island.
        let total = s.options.votes_total();
        if s.options.votes_early && (a > total / 2 || b >= (total + 1) / 2) {
            end_game(s);
            return;
        }
    }
    // The last round's monsters don't grow (designer, 2026-10-31): the game ends after its fights.
    let last = s.round >= s.options.rounds && s.options.last_growth == false;
    if s.options.nightfall && !last {
        nightfall_tokens(s, &fought);
        let brought = total_presence(s) - after_fights;
        s.last_close = Some([s.round, before, after_fights, brought]);
    }
    for p in s.board.iter_mut() {
        p.gate = None;
        p.gate_loss = None;
        p.altar = false;
        p.study = None;
        p.terror = None;
    }
    end_round(s);
}

/// Nightfall tokens (D38, GR6; designer, 2026-10-30): each location where there was no fight gains 1 of its own
/// faction's tokens per sway there, if it can. *Prototype:* a short supply fills locations in board order.
fn nightfall_tokens(s: &mut GameState, fought: &[bool]) {
    let mut brought = 0;
    for (l, n) in nightfall_due(s, fought) {
        let f = alignment_of(l) as Fac;
        s.board[l as usize].tokens.add(f, n);
        s.supply[f as usize] -= n;
        brought += n;
        if !s.quiet {
            let sway: [i32; 5] = std::array::from_fn(|o| s.board[l as usize].sway.get(o as u8));
            NIGHT_LOG.with(|x| x.borrow_mut().push(NightRec { round: s.round, loc: l, n, sway }));
        }
    }
    if !s.quiet {
        note_flow(0, brought);
    }
    if brought > 0 {
        log_line(s, |_| format!("Nightfall brings {brought} token{}.", if brought == 1 { "" } else { "s" }));
    }
}

/// Several locations' fights in turn (resolveFights).
pub fn resolve_fights(s: &mut GameState, locs: &[Loc]) {
    for &l in locs {
        fight_at(s, l);
    }
}

/// The locations that will fight at round end as things stand.
pub fn fights_due(s: &GameState) -> Vec<Loc> {
    fights_now(s)
}

/// A location's fight: a Gate's two ends fight once, as one.
pub fn fight_at(s: &mut GameState, loc: Loc) {
    if s.board[loc as usize].scorched || count_at(s, loc) < 2 {
        return;
    }
    match gate_of(s, loc) {
        Some(g) => joined_fight(s, loc, g),
        None => fight(s, loc, None),
    }
}

/// `{ ...x }` merged with y's counts (y's new keys after x's).
fn merge(x: &OMap, y: &OMap) -> OMap {
    let mut out = x.clone();
    for (k, n) in y.iter() {
        out.add(k, n);
    }
    out
}

/// The Gate's fight: its two ends fight as one location.
fn joined_fight(s: &mut GameState, a: Loc, b: Loc) {
    let (ai, bi) = (a as usize, b as usize);
    let loss_end = s.board[ai].gate_loss.or(s.board[bi].gate_loss).unwrap_or(a);
    let other = if loss_end == a { b } else { a };
    let before_a = s.board[ai].tokens.clone();
    let before_b = s.board[bi].tokens.clone();
    let sway_a = s.board[ai].sway.clone();
    let sway_b = s.board[bi].sway.clone();
    for i in [ai, bi] {
        s.board[i].gate = None;
        s.board[i].gate_loss = None;
    }
    s.board[ai].tokens = merge(&before_a, &before_b);
    s.board[ai].sway = merge(&sway_a, &sway_b);
    if s.board[bi].altar {
        s.board[ai].altar = true;
    }
    if s.board[bi].study.is_some() && s.board[ai].study.is_none() {
        s.board[ai].study = s.board[bi].study;
    }
    s.board[bi].tokens = OMap::new();
    s.board[bi].sway = OMap::new();
    fight(s, a, Some(b));
    if s.board[ai].scorched {
        s.board[bi].scorched = true;
        return;
    }
    let after = std::mem::take(&mut s.board[ai].tokens);
    s.board[bi].tokens = OMap::new();
    let before_of = |end: Loc, f: Fac| if end == a { before_a.get(f) } else { before_b.get(f) };
    for (f, n) in after.iter() {
        if n <= 0 {
            continue;
        }
        let mut lost = before_a.get(f) + before_b.get(f) - n;
        for end in [loss_end, other] {
            let k = lost.max(0).min(before_of(end, f));
            add_tokens(s, end, f, before_of(end, f) - k);
            lost -= k;
        }
    }
    let kept = std::mem::take(&mut s.board[ai].sway);
    s.board[bi].sway = OMap::new();
    for pid in kept.keys() {
        for (end, sw) in [(a, &sway_a), (b, &sway_b)] {
            let v = sw.get(pid);
            if v != 0 {
                s.board[end as usize].sway.set(pid, v);
            }
        }
    }
}

/// A fight's name in the log: the location, or a Gate's two ends.
fn fight_name(loc: Loc, other: Option<Loc>) -> String {
    match other {
        Some(b) => format!("{} and {}, through the Gate", lname(loc), lname(b)),
        None => lname(loc).to_string(),
    }
}

/// One fight (FR5, TF1, TD1, AF3 adjusted). `joined`: a Gate's fight on the merged location (the other end).
fn fight(s: &mut GameState, loc: Loc, joined: Option<Loc>) {
    let li = loc as usize;
    let sides = factions_at(s, loc);
    let sway0: [i32; 5] = std::array::from_fn(|p| s.board[li].sway.get(p as u8));
    let supply0: [i32; 5] = std::array::from_fn(|p| s.players.get(p).map_or(0, |q| q.supply));
    let hand0: [i32; 5] = std::array::from_fn(|p| s.players.get(p).map_or(0, |q| q.hand.len() as i32));
    let strength = |s: &GameState, f: Fac| s.board[li].tokens.get(f);
    let mut ranked = sides.clone();
    ranked.sort_by(|&x, &y| strength(s, y).cmp(&strength(s, x)));
    let top: Vec<Fac> = ranked.iter().copied().filter(|&f| strength(s, f) == strength(s, ranked[0])).collect();
    let other = joined;
    let aligned = top.iter().copied().find(|&f| f as usize == alignment_of(loc) || other.is_some_and(|o| f as usize == alignment_of(o)));
    if top.len() > 1 && aligned.is_none() {
        // TF1 + TM1: both wiped, the location scorched, nothing rewarded; everything back to its supply.
        for &f in &sides {
            s.supply[f as usize] += s.board[li].tokens.get(f);
        }
        let sway = s.board[li].sway.clone();
        for (p, n) in sway.iter() {
            s.players[p as usize].supply += n;
        }
        s.board[li].tokens = OMap::new();
        s.board[li].sway = OMap::new();
        s.board[li].scorched = true;
        if !s.quiet {
            let lost: i32 = s.board[li].tokens.iter().map(|e| e.1).sum::<i32>();
            FIGHT_LOG.with(|f| f.borrow_mut().push(FightRec { round: s.round, loc, sway: sway0, piles: vec![], scorched: lost.max(0), supply: supply0, hand: hand0, mv: 0, left: [0; 5], colours: vec![], winner: -1, took: [[0; 5]; 5], standing: [0; 5] }));
        }
        let all = if sides.len() > 2 { "Every side is" } else { "Both sides are" };
        log_line(s, |_| { let name = fight_name(loc, other); format!("  {name}: a true tie. {all} wiped out and {name} is scorched.") });
        return;
    }
    let winner = if top.len() > 1 { aligned.unwrap() } else { ranked[0] };
    let losers: Vec<Fac> = sides.iter().copied().filter(|&f| f != winner).collect();
    let mut by_size = losers.clone();
    by_size.sort_by(|&x, &y| s.board[li].tokens.get(y).cmp(&s.board[li].tokens.get(x)));
    let loser = by_size[0];
    let lost: Vec<(Fac, i32)> = losers.iter().map(|&f| (f, s.board[li].tokens.get(f))).collect();
    let nl = s.board[li].tokens.get(loser);
    // D25: the winner loses half the (larger) loser's number, rounded up.
    let mut winner_loss = (nl + 1).div_euclid(2);
    if s.board[li].altar {
        winner_loss = nl;
    }
    winner_loss = winner_loss.min(s.board[li].tokens.get(winner));
    for &(f, n) in &lost {
        let v = s.board[li].tokens.get(f) - n;
        s.board[li].tokens.set(f, v);
    }
    let v = s.board[li].tokens.get(winner) - winner_loss;
    s.board[li].tokens.set(winner, v);
    for &f in &sides {
        if s.board[li].tokens.get(f) <= 0 {
            s.board[li].tokens.remove(f);
        }
    }
    if !s.quiet {
        let (wn, ln, ls) = (fname(s, winner).to_string(), losers.iter().map(|&f| fname(s, f)).collect::<Vec<_>>().join(" and "), lost.iter().map(|x| x.1.to_string()).collect::<Vec<_>>().join(", "));
        let name = fight_name(loc, other);
        log_line(s, |_| format!("  {name}: {wn} beat {ln}; casualties {ls} and {winner_loss}."));
    }
    // Trophies (TD1): bigger pile to first claim, smaller to second claim; with three piles, first claim takes the two larger.
    let mut piles: Vec<(Fac, i32)> = lost.iter().copied().chain(std::iter::once((winner, winner_loss))).filter(|x| x.1 > 0).collect();
    piles.sort_by(|x, y| y.1.cmp(&x.1));
    let place_for = |i: usize, n: usize| if n > 1 && i == n - 1 { 1 } else { 0 };
    let (places, involved, tied_first) = rank_at(s, loc);
    let trophies0: Vec<[i32; 5]> = if s.quiet { vec![] } else { s.players.iter().map(|p| p.trophies).collect() };
    if let Some(st) = s.board[li].study {
        if places.first().copied().flatten() == Some(st) && places.get(1).copied().flatten().is_some() && piles.len() > 1 {
            // Study the Bodies: first claim also takes 1 from second claim's pile, the smallest.
            let last = piles.len() - 1;
            piles[last].1 -= 1;
            let rf = piles[last].0;
            s.players[st as usize].trophies[rf as usize] += 1;
            let (seating, fnm) = (s.seating.clone(), fname(s, rf));
            log_line(s, |_| format!("  {} studies one of the {fnm} dead.", seating[st as usize]));
            if piles[last].1 == 0 {
                piles.pop();
            }
        }
    }
    let give = |s: &mut GameState, (f, n): (Fac, i32), pid: Option<Pid>| match pid {
        Some(p) => {
            s.players[p as usize].trophies[f as usize] += n;
            let (seating, fnm) = (s.seating.clone(), fname(s, f));
            log_line(s, |_| format!("  {} takes a pile of {n} {fnm}.", seating[p as usize]));
        }
        None => s.supply[f as usize] += n,
    };
    let mut taken: Vec<(i32, Option<Pid>)> = Vec::new();
    let colours: Vec<i32> = piles.iter().map(|p| p.0 as i32).collect();
    if involved == 1 && places.first().copied().flatten().is_some() {
        for &pile in &piles {
            give(s, pile, places[0]); // UP1
            taken.push((pile.1, places[0]));
        }
    } else {
        let n = piles.len();
        for (i, &pile) in piles.iter().enumerate() {
            let who = places.get(place_for(i, n)).copied().flatten();
            give(s, pile, who);
            taken.push((pile.1, who));
        }
    }
    if !s.quiet {
        FIGHT_LOG.with(|f| f.borrow_mut().push(FightRec { round: s.round, loc, sway: sway0, piles: taken, scorched: 0, supply: supply0, hand: hand0, mv: 0, left: [0; 5], colours, winner: winner as i32, took: std::array::from_fn(|p| s.players.get(p).map_or([0; 5], |x| std::array::from_fn(|f| x.trophies[f] - trophies0[p][f]))), standing: [0; 5] }));
    }
    // Sway after the fight (AF3 adjusted, AS1).
    if let Some(first) = places.first().copied().flatten() {
        let n = s.board[li].sway.get(first);
        let half = n.div_euclid(2);
        s.players[first as usize].standing[winner as usize] += half;
        if !s.quiet {
            FIGHT_LOG.with(|f| if let Some(r) = f.borrow_mut().last_mut() { if r.loc == loc { r.standing[first as usize] = half; } });
        }
        s.players[first as usize].supply += n - half;
        s.board[li].sway.remove(first);
    }
    for p in tied_first {
        let n = s.board[li].sway.get(p);
        s.players[p as usize].supply += n;
        s.board[li].sway.remove(p);
    }
    if !s.quiet {
        let left: [i32; 5] = std::array::from_fn(|o| s.board[li].sway.get(o as u8));
        FIGHT_LOG.with(|f| if let Some(r) = f.borrow_mut().last_mut() { if r.loc == loc { r.left = left; } });
    }
}

/// Rank players by sway at a location (AB1, PT2, ST1): (places: who collects first and second, None where a tie used
/// the place up; how many are involved; players tied for first claim).
pub fn rank_at(s: &GameState, loc: Loc) -> (List<Option<Pid>, 2>, usize, Small<5>) {
    let sway = &s.board[loc as usize].sway;
    let mut involved = 0;
    // Each amount with the players on it, in first-seen order (a Map by amount).
    let mut by_amount: List<(i32, Small<5>), 5> = List::new();
    for (p, n) in sway.iter() {
        if n <= 0 {
            continue;
        }
        involved += 1;
        match by_amount.iter_mut().find(|e| e.0 == n) {
            Some(e) => e.1.push(p),
            None => by_amount.push((n, Small::from_slice(&[p]))),
        }
    }
    let mut amounts: Small<5> = Small::new();
    let mut vals: [i32; 5] = [0; 5];
    for (k, e) in by_amount.iter().enumerate() {
        vals[k] = e.0;
        amounts.push(k as u8);
    }
    amounts.sort_by(|&x, &y| vals[y as usize].cmp(&vals[x as usize]));
    let mut places: List<Option<Pid>, 2> = List::new();
    let mut tied_first: Small<5> = Small::new();
    for k in amounts {
        if places.len() >= 2 {
            break;
        }
        let mut tied = by_amount[k as usize].1;
        if tied.len() > 1 {
            let aff: Small<5> = tied.iter().copied().filter(|&p| affinity_of(s, p) == alignment_of(loc)).collect();
            if aff.len() == 1 {
                places.push(Some(aff[0]));
                tied.retain(|p| p != aff[0]);
                if places.len() >= 2 {
                    break;
                }
                if tied.len() == 1 {
                    places.push(Some(tied[0]));
                    continue;
                }
            }
            if places.is_empty() {
                tied_first = tied;
            }
            let mut i = 0;
            while i < tied.len() && places.len() < 2 {
                places.push(None);
                i += 1;
            }
        } else {
            places.push(Some(tied[0]));
        }
    }
    (places, involved, tied_first)
}

/// Where nightfall brings tokens and how many (each of the location's own faction), on a board whose fights are
/// done: every location not in `fought`, 1 per sway there, if its faction can enter and has them in supply.
pub fn nightfall_due(s: &GameState, fought: &[bool]) -> Vec<(Loc, i32)> {
    let mut supply = s.supply.clone();
    let mut due = Vec::new();
    for l in 0..s.board.len() as Loc {
        if fought.get(l as usize).copied().unwrap_or(false) {
            continue;
        }
        let f = alignment_of(l) as Fac;
        let n = s.board[l as usize].sway.iter().map(|e| e.1).sum::<i32>().min(supply[f as usize]);
        if n <= 0 || !can_enter(s, l, f) {
            continue;
        }
        supply[f as usize] -= n;
        due.push((l, n));
    }
    due
}

fn end_round(s: &mut GameState) {
    s.phase = Phase::Play;
    if s.round >= s.options.rounds {
        end_game(s);
        return;
    }
    s.round += 1;
    deal(s);
}

/// The end of the game (G.5): the invaders or the island, the scores and the winners.
fn end_game(s: &mut GameState) {
    s.phase = Phase::Ended;
    let total = total_presence(s);
    let threshold = s.options.threshold;
    let n = s.n();
    // Rounds as votes: the invaders need strictly more votes; a tie goes to the island (designer, 2026-11-01).
    let invaders = if s.options.round_votes { s.votes[0] > s.votes[1] } else { total > threshold };
    if invaders {
        // TH1: the invaders win; most presence, then most locations controlled (FX1), else they win together (FX2).
        let mut ranked: Vec<(Fac, i32, usize)> = (0..5u8).map(|f| (f, presence_of(s, f), (0..s.board.len() as Loc).filter(|&l| controller_of(s, l) == Some(f)).count())).collect();
        ranked.sort_by(|x, y| y.1.cmp(&x.1).then(y.2.cmp(&x.2)));
        let top: Vec<Fac> = ranked.iter().filter(|x| x.1 == ranked[0].1 && x.2 == ranked[0].2).map(|x| x.0).collect();
        let scores: Vec<i32> = (0..n).map(|p| top.iter().map(|&f| s.players[p].standing[f as usize] - s.players[p].trophies[f as usize]).sum()).collect();
        let order: Vec<Fac> = ranked.iter().map(|x| x.0).collect();
        let tiebreak = |a: Pid, b: Pid| -> i32 {
            let (pa, pb) = (&s.players[a as usize], &s.players[b as usize]);
            let ta: i32 = top.iter().map(|&f| pa.trophies[f as usize]).sum();
            let tb: i32 = top.iter().map(|&f| pb.trophies[f as usize]).sum();
            if ta != tb {
                return ta - tb;
            }
            let aa = top.iter().any(|&f| f as usize == affinity_of(s, a));
            let ab = top.iter().any(|&f| f as usize == affinity_of(s, b));
            if aa != ab {
                return if aa { -1 } else { 1 };
            }
            for &f in order.iter().filter(|f| !top.contains(f)) {
                let sa = pa.standing[f as usize] - pa.trophies[f as usize];
                let sb = pb.standing[f as usize] - pb.trophies[f as usize];
                if sa != sb {
                    return sb - sa;
                }
            }
            0
        };
        let winners = rank_players(n, &scores, &tiebreak);
        let placings = placings(n, &scores, &winners, &tiebreak);
        let names = top.iter().map(|&f| fname(s, f)).collect::<Vec<_>>().join(" and ");
        let wn = winners.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>().join(", ");
        s.result = Some(GameResult { island: false, factions: top, players: winners, scores, placings });
        let why = if s.options.round_votes { format!("The invaders took {} of the rounds to the island's {}", s.votes[0], s.votes[1]) } else { format!("Total presence {total} is more than {threshold}") };
        log_line(s, |_| format!("{why}: the invaders win. {names} take the island. Winner: {wn}."));
    } else {
        // TS2: the count of the colour held fewest of; WT1 compares the next weakest.
        let sorted = |p: Pid| { let mut v = s.players[p as usize].trophies.to_vec(); v.sort(); v };
        let scores: Vec<i32> = (0..n as Pid).map(|p| sorted(p)[0]).collect();
        let tiebreak = |a: Pid, b: Pid| -> i32 {
            let (sa, sb) = (sorted(a), sorted(b));
            for i in 1..sa.len() {
                if sa[i] != sb[i] {
                    return sb[i] - sa[i];
                }
            }
            0
        };
        let winners = rank_players(n, &scores, &tiebreak);
        let placings = placings(n, &scores, &winners, &tiebreak);
        let wn = winners.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>().join(", ");
        s.result = Some(GameResult { island: true, factions: vec![], players: winners, scores, placings });
        let why = if s.options.round_votes { format!("The island took {} of the rounds to the invaders' {}", s.votes[1], s.votes[0]) } else { format!("Total presence {total} is not more than {threshold}") };
        log_line(s, |_| format!("{why}: the island wins. Winner: {wn}."));
    }
}

fn ord(x: i32) -> std::cmp::Ordering {
    x.cmp(&0)
}

/// The best score wins; ties go to the tiebreak; players still tied share it.
fn rank_players(n: usize, scores: &[i32], tiebreak: &dyn Fn(Pid, Pid) -> i32) -> Vec<Pid> {
    let best = *scores.iter().max().unwrap();
    let mut tied: Vec<Pid> = (0..n as Pid).filter(|&p| scores[p as usize] == best).collect();
    tied.sort_by(|&a, &b| ord(tiebreak(a, b)));
    let first = tied[0];
    tied.into_iter().filter(|&p| tiebreak(p, first) == 0).collect()
}

/// Every seat in order, by the same score and tiebreaks as the winners (a measuring aid).
fn placings(n: usize, scores: &[i32], winners: &[Pid], tiebreak: &dyn Fn(Pid, Pid) -> i32) -> Vec<Pid> {
    let mut rest: Vec<Pid> = (0..n as Pid).filter(|p| !winners.contains(p)).collect();
    rest.sort_by(|&a, &b| ord(scores[b as usize] - scores[a as usize]).then(ord(tiebreak(a, b))));
    winners.iter().copied().chain(rest).collect()
}

/// Seats the current phase is waiting on.
pub fn waiting_on(s: &GameState) -> Vec<Pid> {
    match s.phase {
        Phase::Ended => vec![],
        Phase::Draft => (0..s.n() as Pid).filter(|&p| !s.players[p as usize].picked).collect(),
        Phase::Night => s.night.as_ref().map(|n| vec![n.player]).unwrap_or_else(|| vec![s.turn as Pid]),
        Phase::Play => vec![s.turn as Pid],
    }
}

/// Share the log between copies (a bot's imagined states don't need it).
pub fn drop_log(s: &mut GameState) {
    s.log = Vec::<Rc<RoundLog>>::new();
}
