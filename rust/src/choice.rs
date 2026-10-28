//! Building a card's target one choice at a time (engine.js nextChoice, the walks and listing). Not rules: they offer
//! the legal options a step at a time, and checkTarget still checks the finished target.

use crate::board::*;
use crate::cards::*;
use crate::setup::*;
use crate::spec::{spec, Action, Card, Use};
use crate::types::*;

/// One option of a choice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Opt {
    Loc(Loc),
    Group(Loc, Fac),
    Fac(Fac),
    Use(Use),
    Card(CardIx),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocKey {
    Location,
    To,
    Path,
    From,
    Losses,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupKey {
    Group,
    Move,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FacKey {
    Faction,
    To,
    Payer,
    Payers,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UseKey {
    Use,
    Back,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Mode,
    Done,
    Location(LocKey),
    Group(GroupKey),
    /// None: no key given (it sets `faction`).
    Faction(Option<FacKey>),
    Use(UseKey),
    Split,
}

/// The next choice in building a target (engine Choice).
#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub kind: Kind,
    pub options: Vec<Opt>,
    /// None: the JavaScript choice has no `optional` field.
    pub optional: Option<bool>,
    pub left: Option<i32>,
}

impl Choice {
    fn done() -> Choice {
        Choice { kind: Kind::Done, options: vec![], optional: None, left: None }
    }
    fn mode() -> Choice {
        Choice { kind: Kind::Mode, options: vec![], optional: None, left: None }
    }
    fn locs(key: LocKey, options: Vec<Loc>, optional: Option<bool>, left: Option<i32>) -> Choice {
        Choice { kind: Kind::Location(key), options: options.into_iter().map(Opt::Loc).collect(), optional, left }
    }
    fn groups(key: GroupKey, options: Vec<(Loc, Fac)>, optional: Option<bool>) -> Choice {
        Choice { kind: Kind::Group(key), options: options.into_iter().map(|(l, f)| Opt::Group(l, f)).collect(), optional, left: None }
    }
    fn facs(key: Option<FacKey>, options: Vec<Fac>, optional: Option<bool>) -> Choice {
        Choice { kind: Kind::Faction(key), options: options.into_iter().map(Opt::Fac).collect(), optional, left: None }
    }
    /// Whether the choice has options at all (`'options' in c`).
    pub fn has_options(&self) -> bool {
        !matches!(self.kind, Kind::Mode | Kind::Done)
    }
    pub fn is_optional(&self) -> bool {
        self.optional == Some(true)
    }
}

fn has_stop(xs: &Option<Ids>) -> bool {
    xs.as_deref().unwrap_or(&[]).contains(&Id::Stop)
}
fn len_of(xs: &Option<Ids>) -> usize {
    xs.as_deref().unwrap_or(&[]).len()
}
fn contains_loc(xs: &Option<Ids>, l: Loc) -> bool {
    xs.as_deref().unwrap_or(&[]).contains(&Id::Loc(l))
}
fn count_loc(xs: &[Id], l: Loc) -> i32 {
    xs.iter().filter(|&&x| x == Id::Loc(l)).count() as i32
}

#[inline]
fn standing(s: &GameState, pid: Pid, f: Fac) -> i64 {
    s.players[pid as usize].standing[f as usize] as i64
}
/// Standing with a faction, or no limit when sway isn't required.
#[inline]
fn my_standing(s: &GameState, pid: Pid, f: Fac) -> i64 {
    if s.options.sway_required { standing(s, pid, f) } else { i64::MAX / 4 }
}
#[inline]
fn can(s: &GameState, pid: Pid, f: Fac, n: i64) -> bool {
    !s.options.sway_required || standing(s, pid, f) >= n
}
#[inline]
fn is_suit_loc(c: &Card, l: Loc) -> bool {
    c.suit == Some(spec().locations[l as usize].archetype)
}
fn all_locs(s: &GameState) -> impl Iterator<Item = Loc> {
    0..s.board.len() as Loc
}

/// For the table: the next choice in building a card's target, given what has been chosen so far.
// PERF: the JavaScript memoises this per state while a bot searches (the same first questions asked again and again).
pub fn next_choice(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> Choice {
    next_shape(s, pid, ci, t)
}

fn next_shape(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> Choice {
    let c = card(ci);
    let mode = t.mode.unwrap_or(Mode::Location);
    if c.suit.is_some() && t.mode.is_none() {
        return Choice::mode();
    }
    let sf = suit_faction(c);
    let group_ok = |l: Loc, f: Fac| c.suit.is_none() || if mode == Mode::Location { is_suit_loc(c, l) } else { Some(f) == sf };
    // PERF: groups_of then a filter per group, each filter re-walking the location (factions_at, free_of, spots).
    let groups = || groups_of(s);
    let loc = as_loc(t.location);
    let fac = as_fac(t.faction);
    match c.action {
        Action::Burst => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && free_of(s, gl, gf) >= 2 && can(s, pid, gf, 3) && burst_spots(s, gl, gf).len() >= 2).collect(), None);
            };
            let f = fac.unwrap();
            if has_stop(&t.from) {
                return Choice::done();
            }
            let n = len_of(&t.from);
            let more: Vec<Loc> = if (n as i32) < free_of(s, l, f) && can(s, pid, f, n as i64 + 2) { burst_spots(s, l, f).into_iter().filter(|&x| !contains_loc(&t.from, x)).collect() } else { vec![] };
            if more.is_empty() && n >= 2 {
                return Choice::done();
            }
            Choice::locs(LocKey::From, more, Some(n >= 2), None)
        }
        Action::Control => {
            let hits = |l: Loc| -> Vec<Fac> {
                factions_at(s, l).into_iter().filter(|&f| {
                    let mut x = Target::with_mode(mode);
                    x.set_location(Id::Loc(l));
                    x.set_faction(Id::Fac(f));
                    control_room(s, pid, card(ci), ci, &x) > 0
                }).collect()
            };
            let Some(l) = loc else { return Choice::locs(LocKey::Location, all_locs(s).filter(|&l| !hits(l).is_empty()).collect(), None, None) };
            if !truthy(t.faction) {
                return Choice::facs(Some(FacKey::Faction), hits(l), None);
            }
            if has_stop(&t.from) {
                return Choice::done();
            }
            let n = len_of(&t.from) as i32;
            let max = control_room(s, pid, card(ci), ci, t);
            if n >= max {
                return Choice::done();
            }
            Choice::locs(LocKey::From, vec![l], Some(n >= 1), Some(max - n))
        }
        Action::Raise => {
            let Some(l) = loc else { return Choice::locs(LocKey::Location, all_locs(s).filter(|&l| raise_room(s, pid, l, Some(mode), None).0 > 0).collect(), None, None) };
            if mode == Mode::Location && !truthy(t.payer) {
                return Choice::facs(Some(FacKey::Payer), raise_room(s, pid, l, Some(mode), None).1, None);
            }
            if has_stop(&t.from) {
                return Choice::done();
            }
            let n = len_of(&t.from) as i32;
            let max = if mode == Mode::Faction { raise_room(s, pid, l, Some(mode), None).0 } else {
                match t.payer { Some(Id::Fac(p)) => raise_room(s, pid, l, Some(mode), Some(p)).0, _ => 0 }
            };
            if n >= max {
                return Choice::done();
            }
            Choice::locs(LocKey::From, vec![l], Some(n >= 1), Some(max - n))
        }
        Action::Plough => {
            let fight_ok = |l: Loc| !s.board[l as usize].scorched && count_at(s, l) >= 2 && if mode == Mode::Location { is_suit_loc(c, l) } else { factions_at(s, l).contains(&sf.unwrap()) };
            let Some(l) = loc else { return Choice::locs(LocKey::Location, all_locs(s).filter(|&l| fight_ok(l) && plough_fits(s, pid, c, l, &[])).collect(), None, None) };
            let sides = plough_sides(s, l);
            let from: Vec<Id> = t.from.unwrap_or_default().to_vec();
            let total: i32 = sides.iter().map(|x| x.1).sum();
            if from.len() as i32 >= total {
                let mut uniq: Vec<Id> = Vec::new();
                for &x in &from {
                    if !uniq.contains(&x) {
                        uniq.push(x);
                    }
                }
                let owed = uniq.len() + 1;
                let payers = t.payers.clone().unwrap_or_default();
                if payers.len() >= owed {
                    return Choice::done();
                }
                let left = |f: Fac| my_standing(s, pid, f) - payers.iter().filter(|&&x| x == Id::Fac(f)).count() as i64;
                let pool = plough_pool(s, c, l);
                let rest = owed as i64 - payers.len() as i64 - 1;
                let opts = pool.iter().copied().filter(|&f| left(f) >= 1 && pool.iter().map(|&g| (left(g) - if g == f { 1 } else { 0 }).max(0)).sum::<i64>() >= rest).collect();
                return Choice::facs(Some(FacKey::Payers), opts, None);
            }
            let mut i = 0;
            let mut side = &sides[0];
            for x in &sides {
                if (from.len() as i32) < i + x.1 {
                    side = x;
                    break;
                }
                i += x.1;
            }
            let opts = side.2.iter().copied().filter(|&x| { let mut f2 = from.clone(); f2.push(Id::Loc(x)); plough_fits(s, pid, c, l, &f2) }).collect();
            Choice::locs(LocKey::From, opts, None, Some(total - from.len() as i32))
        }
        Action::Rejoin => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && { let (kin, n, _, _, reached) = power_share(s, gl, gf); !kin.is_empty() && n > 0 && can(s, pid, gf, reached as i64 + 1) }).collect(), None);
            };
            let (kin, _, _, extra, _) = power_share(s, l, fac.unwrap());
            let n = len_of(&t.from) as i32;
            if n >= extra {
                return Choice::done();
            }
            Choice::locs(LocKey::From, kin.into_iter().filter(|&x| !contains_loc(&t.from, x)).collect(), None, Some(extra - n))
        }
        Action::Chase => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && can_leave(s, gl, gf) && can(s, pid, gf, 2) && !chase_steps(s, gl, gf, &[gl]).is_empty()).collect(), None);
            };
            let f = fac.unwrap();
            if has_stop(&t.path) {
                return Choice::done();
            }
            let path: Vec<Loc> = t.path.as_deref().unwrap_or(&[]).iter().map(|x| x.loc().unwrap()).collect();
            let mut chase = vec![l];
            chase.extend(path.iter().copied());
            let options = if path.len() as i32 + 1 <= free_of(s, l, f) && can(s, pid, f, path.len() as i64 + 2) { chase_steps(s, *chase.last().unwrap(), f, &chase) } else { vec![] };
            if options.is_empty() && !path.is_empty() {
                return Choice::done();
            }
            let left = (free_of(s, l, f).min(standing(s, pid, f) as i32) - path.len() as i32).max(0);
            Choice::locs(LocKey::Path, options, Some(!path.is_empty()), Some(left))
        }
        Action::Well => {
            let callable = |centre: Loc| -> Vec<Fac> {
                let pool: Vec<Fac> = if mode == Mode::Faction { vec![sf.unwrap()] } else { (0..5).collect() };
                pool.into_iter().filter(|&f| {
                    if count_at(s, centre) == 1 && !can_enter(s, centre, f) {
                        return false;
                    }
                    let (lone, fights) = well_sources(s, centre, f);
                    lone.len() + fights.len() > 0 && can(s, pid, f, (if lone.is_empty() { 1 } else { lone.len() }) as i64 + 1)
                }).collect()
            };
            let centre_ok = |x: Loc| !s.board[x as usize].scorched && count_at(s, x) <= 1 && (mode == Mode::Faction || is_suit_loc(c, x)) && !callable(x).is_empty();
            let Some(l) = loc else { return Choice::locs(LocKey::Location, all_locs(s).filter(|&x| centre_ok(x)).collect(), None, None) };
            if !truthy(t.faction) {
                return Choice::facs(None, callable(l), None);
            }
            let f = fac.unwrap();
            let (lone, fights) = well_sources(s, l, f);
            if has_stop(&t.from) {
                return Choice::done();
            }
            let picks: Vec<Id> = t.from.unwrap_or_default().to_vec();
            let mut chosen: Vec<Id> = Vec::new();
            for &x in &picks {
                if !chosen.contains(&x) {
                    chosen.push(x);
                }
            }
            let more: Vec<Loc> = fights.into_iter().filter(|&x| count_loc(&picks, x) < well_share(s, x, f) && can(s, pid, f, (lone.len() + chosen.len() + if chosen.contains(&Id::Loc(x)) { 0 } else { 1 }) as i64 + 1)).collect();
            if more.is_empty() {
                return if !lone.is_empty() || !chosen.is_empty() { Choice::done() } else { Choice::locs(LocKey::From, vec![], None, None) };
            }
            Choice::locs(LocKey::From, more, Some(lone.len() + chosen.len() > 0), None)
        }
        Action::Herd => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && can_leave(s, gl, gf) && can(s, pid, gf, 2) && { let (p, c2) = trail_steps(s, gl, gf, &[gl]); p.len() + c2.len() > 0 }).collect(), None);
            };
            let f = fac.unwrap();
            let raw_path = t.path.clone().unwrap_or_default();
            let mut trail = vec![l];
            trail.extend(raw_path.iter().filter_map(|x| x.loc()));
            let at = *trail.last().unwrap();
            if raw_path.contains(&Id::Stop) || (!raw_path.is_empty() && matches!(lone_at(s, at), Some(x) if x != f)) {
                return Choice::done();
            }
            let (pickups, crashes) = trail_steps(s, at, f, &trail);
            let options: Vec<Loc> = if can(s, pid, f, raw_path.len() as i64 + 2) { pickups.into_iter().chain(crashes).collect() } else { vec![] };
            if options.is_empty() && !raw_path.is_empty() {
                return Choice::done();
            }
            let left = (standing(s, pid, f) as i32 - raw_path.len() as i32 - 1).max(0);
            Choice::locs(LocKey::Path, options, Some(!raw_path.is_empty()), Some(left))
        }
        Action::Threat => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && can_leave(s, gl, gf) && can(s, pid, gf, 2) && !threats_of(s, gl, gf).is_empty()).collect(), None);
            };
            if truthy(t.to) { Choice::done() } else { Choice::locs(LocKey::To, threats_of(s, l, fac.unwrap()), None, None) }
        }
        Action::Gate => {
            let sf = sf.unwrap();
            let ends: Vec<Loc> = all_locs(s).filter(|&l| gate_end(s, c, Some(l))).collect();
            let payers = |x: Loc, y: Loc| -> Vec<Fac> {
                let mut v = vec![sf];
                for f in factions_across(s, x, y) {
                    if !v.contains(&f) {
                        v.push(f);
                    }
                }
                v.into_iter().filter(|&f| can(s, pid, f, 1)).collect()
            };
            let pairs = |x: Loc| -> Vec<Loc> { ends.iter().copied().filter(|&y| y != x && factions_across(s, x, y).len() <= 2 && !payers(x, y).is_empty()).collect() };
            let Some(a) = loc else { return Choice::locs(LocKey::Location, ends.iter().copied().filter(|&x| !pairs(x).is_empty()).collect(), None, None) };
            let Some(b) = as_loc(t.to) else { return Choice::locs(LocKey::To, pairs(a), None, None) };
            if !truthy(t.payer) {
                return Choice::facs(Some(FacKey::Payer), payers(a, b), None);
            }
            if !truthy(t.losses) {
                return Choice::locs(LocKey::Losses, vec![a, b], None, None);
            }
            Choice::done()
        }
        Action::Invite => {
            let need = if mode == Mode::Location { 2 } else { 1 };
            let pays_n = if mode == Mode::Faction { 2 } else { 1 };
            let open = |to: Loc, chosen: &[(Loc, Fac)]| -> Vec<(Loc, Fac)> {
                guests_of(s, c, mode, to).into_iter().filter(|&(gl, gf)| !chosen.iter().any(|&(cl, cf)| cl == gl || cf == gf) && can(s, pid, gf, pays_n)).collect()
            };
            let fits = |to: Loc| -> bool {
                let place_ok = if mode == Mode::Location { is_suit_loc(c, to) && !s.board[to as usize].scorched && count_at(s, to) == 0 } else { matches!(lone_at(s, to), Some(x) if Some(x) != sf) };
                place_ok && if need == 1 { !open(to, &[]).is_empty() } else {
                    open(to, &[]).into_iter().any(|g| { let next = open(to, &[g]); !next.is_empty() && (can(s, pid, g.1, 2) || next.iter().any(|h| can(s, pid, h.1, 2))) })
                }
            };
            let Some(l) = loc else { return Choice::locs(LocKey::Location, all_locs(s).filter(|&x| fits(x)).collect(), None, None) };
            let chosen: Vec<(Loc, Fac)> = t.moves.as_deref().unwrap_or(&[]).iter().filter_map(|m| Some((m.location.loc()?, m.faction.fac()?))).collect();
            if chosen.len() < need {
                return Choice::groups(GroupKey::Move, open(l, &chosen), None);
            }
            if mode == Mode::Location && !truthy(t.payer) {
                return Choice::facs(Some(FacKey::Payer), chosen.iter().map(|g| g.1).filter(|&f| can(s, pid, f, 2)).collect(), None);
            }
            Choice::done()
        }
        Action::Split => {
            let size = |gl: Loc, gf: Fac| free_of(s, gl, gf);
            let pays = |f: Fac| can(s, pid, f, 2 * s.options.sway_per_move as i64 + 1);
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| group_ok(gl, gf) && size(gl, gf) >= 2 && adj(s, gl).into_iter().filter(|&x| x != gl && can_enter(s, x, gf)).count() >= 2 && pays(gf)).collect(), None);
            };
            let f = fac.unwrap();
            let n = size(l, f);
            let split: Vec<(Id, i32)> = t.split.unwrap_or_default().to_vec();
            let placed_n: i32 = split.iter().map(|x| x.1).sum();
            let left = n - placed_n;
            let used: Vec<Id> = split.iter().filter(|x| x.1 > 0).map(|x| x.0).collect();
            let big = (n + 1).div_euclid(2);
            let at = |d: Id| split.iter().find(|x| x.0 == d).map(|x| x.1).unwrap_or(0);
            let full = |d: Id| at(d) + 1 > big || (n % 2 == 1 && at(d) + 1 == big && used.iter().any(|&u| u != d && at(u) == big));
            let dests: Vec<Loc> = adj(s, l).into_iter().filter(|&x| can_enter(s, x, f) && (used.len() < 2 || used.contains(&Id::Loc(x))) && !full(Id::Loc(x))).collect();
            if left > 0 { Choice { kind: Kind::Split, options: dests.into_iter().map(Opt::Loc).collect(), optional: None, left: Some(left) } } else { Choice::done() }
        }
        Action::Favours | Action::Stakes | Action::Exit | Action::Switch | Action::Playbook => {
            match t.use_ {
                None => {
                    let opts = c.uses.iter().copied().filter(|&u| { let ch = unsuited_shape(s, pid, ci, &Target::with_use(u)); ch.kind == Kind::Done || (ch.has_options() && !ch.options.is_empty()) }).map(Opt::Use).collect();
                    Choice { kind: Kind::Use(UseKey::Use), options: opts, optional: None, left: None }
                }
                Some(_) => {
                    let ch = unsuited_shape(s, pid, ci, t);
                    if ch.has_options() && ch.options.is_empty() && ch.is_optional() { Choice::done() } else { ch }
                }
            }
        }
        Action::Showdown => {
            let Some(l) = loc else {
                return Choice::groups(GroupKey::Group, groups().into_iter().filter(|&(gl, gf)| lone_at(s, gl) == Some(gf) && s.board[gl as usize].sway.get(pid) > 0).collect(), None);
            };
            let n = picked(&t.from).len() as i32;
            let cap = s.board[l as usize].sway.get(pid).min(tokens_of(s, l, fac.unwrap()));
            if has_stop(&t.from) || n >= cap {
                return Choice::done();
            }
            Choice::locs(LocKey::From, vec![l], Some(n > 0), Some(cap - n))
        }
        Action::Altar | Action::Study | Action::Terror => {
            let (held, empty) = altar_marks(s, c, mode);
            let marks = altar_chosen(c, t);
            let cap = sway_for(s, pid, ci);
            let left = |f: Fac| if !s.options.sway_required { i64::MAX / 4 } else { standing(s, pid, f) - marks.iter().filter(|m| m.1 == Id::Fac(f)).count() as i64 };
            let free = |l: Loc| !marks.iter().any(|m| m.0 == Id::Loc(l));
            if marks.len() as i32 >= cap || has_stop(&t.from) {
                return Choice::done();
            }
            let groups_done = t.moves.as_deref().unwrap_or(&[]).iter().any(|m| m.location == Id::Stop) || len_of(&t.from) > 0;
            let empties: Vec<Loc> = empty.into_iter().filter(|&l| free(l) && left(sf.unwrap()) >= 1).collect();
            if !groups_done {
                let options: Vec<(Loc, Fac)> = held.into_iter().filter(|&(l, f)| free(l) && left(f) >= 1).collect();
                if !options.is_empty() {
                    return Choice::groups(GroupKey::Move, options, Some(!marks.is_empty() || !empties.is_empty()));
                }
            }
            if empties.is_empty() {
                return if !marks.is_empty() { Choice::done() } else { Choice::groups(GroupKey::Move, vec![], None) };
            }
            Choice::locs(LocKey::From, empties, Some(!marks.is_empty()), None)
        }
    }
}

/// The unsuited cards' choices once a use is picked.
fn unsuited_shape(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> Choice {
    let c = card(ci);
    let x = hand_x(s, pid, ci);
    let open: Vec<Loc> = all_locs(s).filter(|&l| !s.board[l as usize].scorched).collect();
    let all: Vec<Fac> = (0..5).collect();
    let my_sway = |l: Loc| s.board[l as usize].sway.get(pid);
    match c.action {
        Action::Favours => {
            let cap = x.min(s.players[pid as usize].supply);
            if cap < 1 {
                return Choice::facs(Some(FacKey::Payers), vec![], None);
            }
            if t.use_ == Some(Use::Sway) {
                let at = picked(&t.from);
                if has_stop(&t.from) || at.len() as i32 >= cap {
                    return Choice::done();
                }
                return Choice::locs(LocKey::From, fights_now(s).into_iter().filter(|&l| !at.contains(&Id::Loc(l))).collect(), Some(!at.is_empty()), Some(cap - at.len() as i32));
            }
            let fs = picked(&t.payers);
            if has_stop(&t.payers) || fs.len() as i32 >= cap {
                return Choice::done();
            }
            let opts = if let Some(&f0) = fs.first() { vec![f0.fac().unwrap()] } else { all.clone() };
            Choice::facs(Some(FacKey::Payers), opts, Some(!fs.is_empty()))
        }
        Action::Stakes => match t.use_ {
            Some(Use::Standing) => {
                let Some(to) = as_fac(t.faction) else {
                    return Choice::facs(Some(FacKey::Faction), all.iter().copied().filter(|&f| all.iter().any(|&g| g != f && my_standing(s, pid, g) >= 1)).collect(), None);
                };
                let from = picked(&t.payers);
                if has_stop(&t.payers) || from.len() as i32 >= x {
                    return Choice::done();
                }
                Choice::facs(Some(FacKey::Payers), all.iter().copied().filter(|&f| f != to && !from.contains(&Id::Fac(f)) && my_standing(s, pid, f) >= 1).collect(), Some(!from.is_empty()))
            }
            Some(Use::Sway) => {
                let Some(to) = as_loc(t.location) else {
                    return Choice::locs(LocKey::Location, open.iter().copied().filter(|&l| adj(s, l).into_iter().any(|n| my_sway(n) > 0)).collect(), None, None);
                };
                let from = picked(&t.from);
                let n = tally(&from);
                if has_stop(&t.from) || from.len() as i32 >= x {
                    return Choice::done();
                }
                let had = |l: Loc| n.iter().find(|e| e.0 == Id::Loc(l)).map(|e| e.1).unwrap_or(0);
                Choice::locs(LocKey::From, adj(s, to).into_iter().filter(|&l| my_sway(l) > had(l)).collect(), Some(!from.is_empty()), Some(x - from.len() as i32))
            }
            _ => {
                let able = |cl: Loc, f: Fac| can_enter(s, cl, f) && !stake_sources(s, cl, f).is_empty() && my_standing(s, pid, f) >= 2;
                let Some(to) = as_loc(t.location) else {
                    return Choice::locs(LocKey::Location, open.iter().copied().filter(|&l| my_sway(l) > 0 && all.iter().any(|&f| able(l, f))).collect(), None, None);
                };
                let Some(f) = as_fac(t.faction) else {
                    return Choice::facs(Some(FacKey::Faction), all.iter().copied().filter(|&f| able(to, f)).collect(), None);
                };
                let from = picked(&t.from);
                let n = tally(&from);
                if has_stop(&t.from) || from.len() as i32 >= x {
                    return Choice::done();
                }
                let sources = n.len() as i64;
                let had = |l: Loc| n.iter().find(|e| e.0 == Id::Loc(l)).map(|e| e.1).unwrap_or(0);
                let options = stake_sources(s, to, f).into_iter().filter(|&(l, k)| k > had(l) && my_standing(s, pid, f) >= sources + if had(l) > 0 { 0 } else { 1 } + 1).map(|q| q.0).collect();
                Choice::locs(LocKey::From, options, Some(!from.is_empty()), Some(x - from.len() as i32))
            }
        },
        Action::Exit => match t.use_ {
            Some(Use::Standing) => {
                let Some(from) = as_fac(t.faction) else {
                    return Choice::facs(Some(FacKey::Faction), all.iter().copied().filter(|&f| my_standing(s, pid, f) >= 1).collect(), None);
                };
                let to = picked(&t.payers);
                let cap = (x as i64).min(my_standing(s, pid, from));
                if has_stop(&t.payers) || to.len() as i64 >= cap {
                    return Choice::done();
                }
                Choice::facs(Some(FacKey::Payers), all.iter().copied().filter(|&f| f != from && !to.contains(&Id::Fac(f))).collect(), Some(!to.is_empty()))
            }
            Some(Use::Sway) => {
                let Some(l) = as_loc(t.location) else {
                    return Choice::locs(LocKey::Location, open.iter().copied().filter(|&l| my_sway(l) > 0 && adj(s, l).into_iter().any(|n| !s.board[n as usize].scorched)).collect(), None, None);
                };
                let to = picked(&t.from);
                let cap = x.min(my_sway(l));
                if has_stop(&t.from) || to.len() as i32 >= cap {
                    return Choice::done();
                }
                Choice::locs(LocKey::From, adj(s, l).into_iter().filter(|&n| !s.board[n as usize].scorched && !to.contains(&Id::Loc(n))).collect(), Some(!to.is_empty()), Some(cap - to.len() as i32))
            }
            _ => {
                let Some(l) = as_loc(t.location) else {
                    return Choice::groups(GroupKey::Group, groups_of(s).into_iter().filter(|&(gl, gf)| can_leave(s, gl, gf) && !burst_spots(s, gl, gf).is_empty() && my_standing(s, pid, gf) >= 2).collect(), None);
                };
                let f = as_fac(t.faction).unwrap();
                let to = picked(&t.from);
                let cap = (x as i64).min(free_of(s, l, f) as i64).min(my_standing(s, pid, f) - 1);
                if has_stop(&t.from) || to.len() as i64 >= cap {
                    return Choice::done();
                }
                Choice::locs(LocKey::From, burst_spots(s, l, f).into_iter().filter(|&n| !to.contains(&Id::Loc(n))).collect(), Some(!to.is_empty()), Some((cap - to.len() as i64) as i32))
            }
        },
        Action::Switch => {
            if t.use_ == Some(Use::Standing) {
                let Some(from) = as_fac(t.faction) else {
                    return Choice::facs(Some(FacKey::Faction), all.iter().copied().filter(|&f| my_standing(s, pid, f) >= 1).collect(), None);
                };
                if !truthy(t.to) {
                    return Choice::facs(Some(FacKey::To), all.iter().copied().filter(|&f| f != from).collect(), None);
                }
                let n = picked(&t.payers).len() as i64;
                let cap = (x as i64).min(my_standing(s, pid, from));
                if has_stop(&t.payers) || n >= cap {
                    return Choice::done();
                }
                return Choice::facs(Some(FacKey::Payers), vec![from], Some(n > 0));
            }
            let Some(l) = as_loc(t.location) else {
                return Choice::locs(LocKey::Location, open.iter().copied().filter(|&l| my_sway(l) > 0).collect(), None, None);
            };
            let Some(to) = as_loc(t.to) else {
                return Choice::locs(LocKey::To, open.iter().copied().filter(|&o| o != l).collect(), None, None);
            };
            let n = picked(&t.from).len() as i32;
            let cap = x.min(my_sway(l));
            if has_stop(&t.from) || n >= cap {
                return Choice::done();
            }
            Choice::locs(LocKey::From, vec![to], Some(n > 0), Some(cap - n))
        }
        Action::Playbook => {
            if t.use_ == Some(Use::Yours) {
                return if truthy(t.back) { Choice::done() } else { Choice { kind: Kind::Use(UseKey::Back), options: own_plays(s, pid).into_iter().map(Opt::Card).collect(), optional: None, left: None } };
            }
            match last_action(s) {
                Some(last) => next_shape(s, pid, last, t),
                None => Choice { kind: Kind::Use(UseKey::Back), options: vec![], optional: None, left: None },
            }
        }
        _ => Choice::done(),
    }
}

/// A target with one more choice made.
pub fn choose_step(t: &Target, c: &Choice, o: Opt) -> Target {
    let mut x = t.clone();
    match (c.kind, o) {
        (Kind::Use(UseKey::Use), Opt::Use(u)) => x.set_use(u),
        (Kind::Use(UseKey::Back), Opt::Card(b)) => x.set_back(Id::Card(b)),
        (Kind::Faction(Some(FacKey::Payers)), Opt::Fac(f)) => {
            let mut v = x.payers.clone().unwrap_or_default();
            v.push(Id::Fac(f));
            x.set_payers(v);
        }
        (Kind::Faction(k), Opt::Fac(f)) => match k {
            Some(FacKey::To) => x.set_to(Id::Fac(f)),
            Some(FacKey::Payer) => x.set_payer(Id::Fac(f)),
            _ => x.set_faction(Id::Fac(f)),
        },
        (Kind::Split, Opt::Loc(l)) => {
            let mut v = x.split.clone().unwrap_or_default();
            match v.iter_mut().find(|e| e.0 == Id::Loc(l)) {
                Some(e) => e.1 += 1,
                None => v.push((Id::Loc(l), 1)),
            }
            x.set_split(v);
        }
        (Kind::Group(GroupKey::Move), Opt::Group(l, f)) => {
            let mut v = x.moves.clone().unwrap_or_default();
            v.push(GroupMove { location: Id::Loc(l), faction: Id::Fac(f), to: Id::Empty });
            x.set_moves(v);
        }
        (Kind::Group(_), Opt::Group(l, f)) => {
            x.set_location(Id::Loc(l));
            x.set_faction(Id::Fac(f));
        }
        (Kind::Location(k), Opt::Loc(l)) => match k {
            LocKey::Path => {
                let mut v = x.path.clone().unwrap_or_default();
                v.push(Id::Loc(l));
                x.set_path(v);
            }
            LocKey::From => {
                let mut v = x.from.clone().unwrap_or_default();
                v.push(Id::Loc(l));
                x.set_from(v);
            }
            LocKey::Location => x.set_location(Id::Loc(l)),
            LocKey::To => x.set_to(Id::Loc(l)),
            LocKey::Losses => x.set_losses(Id::Loc(l)),
        },
        _ => {}
    }
    x
}

/// For a bot's steered search: (finished targets, partial ones one choice further).
pub fn choice_steps(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> (Vec<Target>, Vec<Target>) {
    let c = next_choice(s, pid, ci, t);
    match c.kind {
        Kind::Done => (vec![t.clone()], vec![]),
        Kind::Mode => {
            let mut a = t.clone();
            a.set_mode(Mode::Location);
            let mut b = t.clone();
            b.set_mode(Mode::Faction);
            (vec![], vec![a, b])
        }
        _ => (if c.is_optional() { vec![t.clone()] } else { vec![] }, c.options.iter().map(|&o| choose_step(t, &c, o)).collect()),
    }
}

/// For a bot's steered search: a random finished target from a partial one; None if the walk gets stuck.
pub fn complete_target(s: &GameState, pid: Pid, ci: CardIx, t: &Target, rng: &mut dyn FnMut() -> f64) -> Option<Target> {
    let mut x = t.clone();
    for _ in 0..30 {
        let c = next_choice(s, pid, ci, &x);
        match c.kind {
            Kind::Done => return Some(x),
            Kind::Mode => {
                let m = if rng() < 0.5 { Mode::Location } else { Mode::Faction };
                x.set_mode(m);
                continue;
            }
            _ => {}
        }
        if c.is_optional() && rng() < 0.3 {
            return Some(x);
        }
        if c.options.is_empty() {
            return None;
        }
        let i = (rng() * c.options.len() as f64).floor() as usize;
        x = choose_step(&x, &c, c.options[i]);
    }
    None
}

/// A random target built one choice at a time, as the table offers them (for bots).
// PERF: the JavaScript memoises each step by the path of picks that led to it, per state.
fn walk_target(s: &GameState, pid: Pid, ci: CardIx, mode: Mode, rng: &mut dyn FnMut() -> f64) -> Option<Target> {
    let mut t = if card(ci).suit.is_some() { Target::with_mode(mode) } else { Target::default() };
    for _ in 0..30 {
        let c = next_choice(s, pid, ci, &t);
        match c.kind {
            Kind::Done => return Some(t),
            Kind::Mode => {
                t.set_mode(mode);
                continue;
            }
            _ => {}
        }
        if c.is_optional() && rng() < 0.3 {
            return Some(t);
        }
        if c.options.is_empty() {
            return None;
        }
        let i = (rng() * c.options.len() as f64).floor() as usize;
        t = choose_step(&t, &c, c.options[i]);
    }
    None
}

/// For the bots: a random legal target for a card's turn action, or None.
pub fn sample_target(s: &GameState, pid: Pid, ci: CardIx, rng: &mut dyn FnMut() -> f64) -> Option<Target> {
    let c = card(ci);
    let sampled = c.action == Action::Split;
    let groups: Vec<(Loc, Fac)> = if sampled { groups_of(s) } else { vec![] };
    let modes: &[Mode] = if c.suit.is_some() { &[Mode::Location, Mode::Faction] } else { &[Mode::Location] };
    for _ in 0..40 {
        let mode = modes[(rng() * modes.len() as f64).floor() as usize];
        let mut t: Option<Target> = None;
        let pick_i = (rng() * groups.len() as f64).floor() as usize; // drawn either way, as the JavaScript does
        if sampled {
            if let Some(&(gl, gf)) = groups.get(pick_i) {
                let n = free_of(s, gl, gf);
                let dests: Vec<Loc> = adj(s, gl).into_iter().filter(|&d| can_enter(s, d, gf)).collect();
                if n >= 2 && dests.len() >= 2 {
                    let a = dests[(rng() * dests.len() as f64).floor() as usize];
                    let rest: Vec<Loc> = dests.iter().copied().filter(|&d| d != a).collect();
                    let b = rest[(rng() * rest.len() as f64).floor() as usize];
                    let na = n.div_euclid(2) + if n % 2 == 1 && rng() < 0.5 { 1 } else { 0 };
                    let mut x = Target::with_mode(mode);
                    x.set_location(Id::Loc(gl));
                    x.set_faction(Id::Fac(gf));
                    x.set_split(vec![(Id::Loc(a), na), (Id::Loc(b), n - na)]);
                    t = Some(x);
                }
            }
        } else {
            t = walk_target(s, pid, ci, mode, rng);
        }
        if let Some(x) = t {
            if check_target(s, pid, ci, Some(&x)).is_none() {
                return Some(x);
            }
        }
    }
    None
}

/// For bots: the legal targets of a card, listed by walking every choice the table offers, up to `cap`; whether the
/// list is complete. `even`: a card with several uses shares the cap between them.
pub fn list_targets(s: &GameState, pid: Pid, ci: CardIx, cap: usize, even: bool) -> (Vec<Target>, bool) {
    let c = card(ci);
    if even && c.uses.len() > 1 {
        let each = ((cap as f64 / c.uses.len() as f64).ceil() as usize).max(1);
        let mut targets = Vec::new();
        let mut complete = true;
        for &u in &c.uses {
            let (t, done) = list_targets_from(s, pid, ci, each, vec![Target::with_use(u)]);
            targets.extend(t);
            complete &= done;
        }
        return (targets, complete);
    }
    let start = if c.suit.is_some() { vec![Target::with_mode(Mode::Faction), Target::with_mode(Mode::Location)] } else { vec![Target::default()] };
    list_targets_from(s, pid, ci, cap, start)
}

// PERF: N+1: every node of the walk asks next_choice (rebuilding candidate lists) and every leaf runs check_target
// (which clones the state twice); a cap of 40 targets can mean hundreds of state copies per card.
fn list_targets_from(s: &GameState, pid: Pid, ci: CardIx, cap: usize, start: Vec<Target>) -> (Vec<Target>, bool) {
    let mut stack = start;
    let mut found: Vec<(String, Target)> = Vec::new();
    let mut visits = 0usize;
    let keep = |t: &Target, found: &mut Vec<(String, Target)>| {
        let k = crate::json::target_key(t);
        if !found.iter().any(|e| e.0 == k) && check_target(s, pid, ci, Some(t)).is_none() {
            found.push((k, t.clone()));
        }
    };
    while !stack.is_empty() && found.len() < cap {
        visits += 1;
        if visits > cap * 40 {
            return (found.into_iter().map(|e| e.1).collect(), false);
        }
        let t = stack.pop().unwrap();
        let c = next_choice(s, pid, ci, &t);
        match c.kind {
            Kind::Done => {
                keep(&t, &mut found);
                continue;
            }
            Kind::Mode => {
                if t.mode.is_none() {
                    let mut a = t.clone();
                    a.set_mode(Mode::Faction);
                    let mut b = t.clone();
                    b.set_mode(Mode::Location);
                    stack.push(a);
                    stack.push(b);
                }
                continue;
            }
            _ => {}
        }
        if c.is_optional() {
            keep(&t, &mut found);
        }
        for &o in &c.options {
            stack.push(choose_step(&t, &c, o));
        }
    }
    let complete = stack.is_empty();
    (found.into_iter().map(|e| e.1).collect(), complete)
}
