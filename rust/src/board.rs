//! Board helpers: what is where, who may enter, and moving tokens.

use crate::spec::spec;
use crate::types::*;
use std::cell::Cell;

/// The location joined to this one by an open Gate, if any.
#[inline]
pub fn gate_of(s: &GameState, loc: Loc) -> Option<Loc> {
    s.board[loc as usize].gate
}

/// The locations that make up this one: itself, and its Gate partner while the Gate is open.
#[inline]
pub fn ends_of(s: &GameState, loc: Loc) -> ([Loc; 2], usize) {
    match gate_of(s, loc) {
        Some(g) => ([loc, g], 2),
        None => ([loc, loc], 1),
    }
}

/// The factions at a location (both ends of a Gate together), in the order their tokens were placed.
#[inline]
pub fn factions_at(s: &GameState, loc: Loc) -> Facs {
    let mut out = Facs::new();
    for (f, n) in s.board[loc as usize].tokens.iter() {
        if n > 0 && !out.contains(&f) {
            out.push(f);
        }
    }
    if let Some(g) = gate_of(s, loc) {
        for (f, n) in s.board[g as usize].tokens.iter() {
            if n > 0 && !out.contains(&f) {
                out.push(f);
            }
        }
    }
    out
}

/// How many factions are at a location.
#[inline]
pub fn count_at(s: &GameState, loc: Loc) -> usize {
    factions_at(s, loc).len()
}

/// A location's neighbours. Through an open Gate the two ends are one location.
pub fn adj(s: &GameState, loc: Loc) -> Locs {
    let sp = spec();
    let base = &sp.locations[loc as usize].adjacent;
    let g = gate_of(s, loc);
    if g.is_none() && !base.iter().any(|&l| gate_of(s, l).is_some()) {
        return Locs::from_slice(base);
    }
    let mut out = Locs::new();
    for &l in base {
        out.add(l);
    }
    if let Some(g) = g {
        for &l in &sp.locations[g as usize].adjacent {
            out.add(l);
        }
    }
    let snapshot = out;
    for l in snapshot {
        if let Some(p) = gate_of(s, l) {
            out.add(p);
        }
    }
    out.retain(|l| l != loc && Some(l) != g);
    out
}

/// Every group on the board, location by location.
pub fn groups_of(s: &GameState) -> Vec<(Loc, Fac)> {
    let mut out = Vec::new();
    for loc in 0..s.board.len() as Loc {
        for f in factions_at(s, loc) {
            out.push((loc, f));
        }
    }
    out
}

/// A faction's tokens at a location (both ends of a Gate together: one group).
#[inline]
pub fn tokens_of(s: &GameState, loc: Loc, f: Fac) -> i32 {
    let mut n = s.board[loc as usize].tokens.get(f);
    if let Some(g) = gate_of(s, loc) {
        n += s.board[g as usize].tokens.get(f);
    }
    n
}

/// A faction's tokens at one end only.
#[inline]
pub fn raw_tokens(s: &GameState, loc: Loc, f: Fac) -> i32 {
    s.board[loc as usize].tokens.get(f)
}

/// Add tokens at one end.
#[inline]
pub fn add_tokens(s: &mut GameState, loc: Loc, f: Fac, n: i32) {
    if n > 0 {
        let v = raw_tokens(s, loc, f) + n;
        s.board[loc as usize].tokens.set(f, v);
    }
}

/// Take tokens from a location: this end first, then its Gate partner.
pub fn take_tokens(s: &mut GameState, loc: Loc, f: Fac, n: i32) {
    let mut left = n;
    let (ends, k) = ends_of(s, loc);
    for &l in &ends[..k] {
        let take = left.min(raw_tokens(s, l, f));
        if take <= 0 {
            continue;
        }
        let t = &mut s.board[l as usize].tokens;
        let v = t.get(f) - take;
        t.set(f, v);
        if v <= 0 {
            t.remove(f);
        }
        left -= take;
    }
}

pub fn presence_of(s: &GameState, f: Fac) -> i32 {
    (0..s.board.len()).map(|l| s.board[l].tokens.get(f)).sum()
}

pub fn total_presence(s: &GameState) -> i32 {
    (0..5).map(|f| presence_of(s, f)).sum()
}

/// The archetype a location is aligned with (spec index, the same as the slot of its faction).
#[inline]
pub fn alignment_of(loc: Loc) -> usize {
    spec().locations[loc as usize].archetype
}

/// The faction slot of an archetype (by its spec id).
pub fn faction_of_archetype(id: &str) -> Fac {
    spec().arch_ix(id).expect("archetype") as Fac
}

/// May a faction's tokens be moved into this location? Not scorched, and never a third faction (LL1).
pub fn can_enter(s: &GameState, loc: Loc, f: Fac) -> bool {
    let place = &s.board[loc as usize];
    if place.scorched {
        return false;
    }
    let here = factions_at(s, loc);
    here.contains(&f) || here.len() < 2
}

/// Who controls a location (LC2): the faction with most tokens; a tie goes to the aligned faction, else no one.
pub fn controller_of(s: &GameState, loc: Loc) -> Option<Fac> {
    let mut here = factions_at(s, loc);
    here.sort_by(|&a, &b| tokens_of(s, loc, b).cmp(&tokens_of(s, loc, a)));
    if here.is_empty() {
        return None;
    }
    if here.len() == 1 || tokens_of(s, loc, here[0]) > tokens_of(s, loc, here[1]) {
        return Some(here[0]);
    }
    here.iter().copied().find(|&f| f as usize == alignment_of(loc))
}

/// The player's slayer group archetype.
#[inline]
pub fn affinity_of(s: &GameState, pid: Pid) -> usize {
    spec().slayer_groups[s.players[pid as usize].group as usize].archetype
}

/// Sway leaders of a faction: the most standing; affinity breaks a tie (AB1); otherwise all tied are leaders.
pub fn sway_leaders(s: &GameState, f: Fac) -> Vec<Pid> {
    let n = s.n();
    let best = (0..n).map(|p| s.players[p].standing[f as usize]).max().unwrap_or(0);
    let tied: Vec<Pid> = (0..n as Pid).filter(|&p| s.players[p as usize].standing[f as usize] == best).collect();
    let aff: Vec<Pid> = tied.iter().copied().filter(|&p| affinity_of(s, p) == f as usize).collect();
    if aff.is_empty() { tied } else { aff }
}

/// Tokens of a faction free to leave a location: half from a fight (D22; variant fightHalf).
// PERF: tokens_of and factions_at each walk the location again; callers usually just did both.
pub fn free_of(s: &GameState, loc: Loc, f: Fac) -> i32 {
    let n = tokens_of(s, loc, f);
    let here = factions_at(s, loc);
    if !here.iter().any(|&x| x != f) {
        return n;
    }
    if s.options.fight_half { n.div_euclid(2) } else { n }
}

/// A group that can set off: present, with some free to leave.
pub fn can_leave(s: &GameState, loc: Loc, f: Fac) -> bool {
    factions_at(s, loc).contains(&f) && free_of(s, loc, f) > 0
}

/// The one faction at a location, if exactly one is there, else None.
pub fn lone_at(s: &GameState, loc: Loc) -> Option<Fac> {
    let here = factions_at(s, loc);
    if !s.board[loc as usize].scorched && here.len() == 1 { Some(here[0]) } else { None }
}

thread_local! {
    /// Moves refused for want of standing (IC1), counted so checkTarget can tell when paying changed nothing.
    pub static UNPAID: Cell<u64> = const { Cell::new(0) };
}

/// Where sway was placed this action, as "to:faction" (engine move's placedAt).
pub type Placed = Vec<(Loc, Fac)>;

/// Move tokens, placing sway at the destination from the player's standing with the faction moved (CA2); under IC1
/// a move it can't pay for doesn't happen. Returns the number moved.
#[allow(clippy::too_many_arguments)]
pub fn mv(s: &mut GameState, pid: Pid, f: Fac, from: Loc, to: Loc, count: i32, placed: &mut Placed, freed: bool) -> i32 {
    let n = count.min(if freed { tokens_of(s, from, f) } else { free_of(s, from, f) });
    if n <= 0 || from == to {
        return 0;
    }
    if !can_enter(s, to, f) {
        return 0;
    }
    let cost = s.options.sway_per_move;
    let key = (to, f);
    let has = placed.contains(&key);
    if s.options.sway_required && cost > 0 && !has && s.players[pid as usize].standing[f as usize] < cost {
        UNPAID.with(|u| u.set(u.get() + 1));
        return 0;
    }
    take_tokens(s, from, f, n);
    add_tokens(s, to, f, n);
    if has {
        return n;
    }
    placed.push(key);
    let k = cost.min(s.players[pid as usize].standing[f as usize]);
    if k > 0 {
        s.players[pid as usize].standing[f as usize] -= k;
        s.board[to as usize].sway.add(pid, k);
    }
    n
}

/// Place 1 of the player's sway at a location, from standing with a faction (if they have it).
pub fn place_one(s: &mut GameState, pid: Pid, f: Fac, loc: Loc) {
    if s.players[pid as usize].standing[f as usize] <= 0 {
        return;
    }
    s.players[pid as usize].standing[f as usize] -= 1;
    s.board[loc as usize].sway.add(pid, 1);
}

/// The fights now (not scorched): locations with two or more factions, a Gate's ends each listed.
pub fn fights_now(s: &GameState) -> Vec<Loc> {
    (0..s.board.len() as Loc).filter(|&l| !s.board[l as usize].scorched && count_at(s, l) >= 2).collect()
}

/// A faction's name. @param slot
pub fn fname(s: &GameState, f: Fac) -> &'static str {
    &spec().factions[s.factions[f as usize] as usize].name
}

/// A location's name.
pub fn lname(l: Loc) -> &'static str {
    &spec().locations[l as usize].name
}

/// A seat's name.
pub fn pname(s: &GameState, p: Pid) -> &str {
    &s.seating[p as usize]
}
