//! Bots: the trophy and backer profiles, their evaluation, search, play-outs and hand planning. Tuning numbers, not
//! rules. Random draws and floating-point sums keep the order of the JavaScript bots they were ported from, so the
//! recorded games (tests/fixtures/fingerprints.json) still play the same.

use crate::board::*;
use crate::cards::*;
use crate::choice::*;
use crate::game::*;
use crate::spec::spec;
use crate::types::*;
use std::collections::HashMap;

pub type Rng<'a> = &'a mut dyn FnMut() -> f64;

// Sorting by value: a NaN compares as a tie, as a JavaScript comparator returning NaN does (none should arise).

/// What a bot remembers between its turns: its goal, and this game's variation in its lean.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BotMemory {
    pub goal: Option<Goal>,
    pub jitter: Option<f64>,
    /// The cards this seat's full bot last planned to play after its move (hand planning), for play-outs that play
    /// every seat by its own plan (persona rplan; testing).
    pub plan: Vec<CardIx>,
}

thread_local! {
    static LAST_PLAN: std::cell::RefCell<Vec<CardIx>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Goal {
    Island,
    Invaders,
}

/// Every seat's profile and memory, for play-outs (persona table).
#[derive(Clone, Default)]
pub struct Seats {
    pub profiles: Option<HashMap<Pid, String>>,
    pub memories: Option<HashMap<Pid, BotMemory>>,
    /// Testing (persona rollList): the play-out bots list targets as the full bots do.
    pub roll_list: bool,
    /// Testing (persona rjudge): every seat in the play-outs judges with the learned judge.
    pub judge: bool,
    /// Testing (persona rimit): every seat in the play-outs scores moves with the imitation weights.
    pub imit: bool,
    /// Persona rplan (default on, designer 2026-11-04): every seat in the play-outs follows its own remembered hand
    /// plan, not only the deciding seat (100 games, seat 5: 30.0% vs 27.3%).
    pub plans: bool,
}

const SEARCH_TARGETS: usize = 8;
const SEARCH_NOISE: f64 = 0.15;
const LIST_CAP: usize = 40;
const SIM_KEEP: usize = 8;
const SIM_PLAYOUTS: usize = 6;
const SIM_MAX_MOVES: usize = 400;
const PLAN_BUDGET: usize = 450;
const PLAN_DEPTH: usize = 2;
const PLAN_MOVES: usize = 99;
const ROLLOUT: &str = "bot:lean=-0.3,sim=0,enum=0,combo=0";
const TABLE_BACKING: i32 = 8;
const TABLE_BASE: f64 = 0.3;
const TABLE_STEP: f64 = 0.15;
pub const ISLAND: [f64; 4] = [1.0, 0.35, 0.12, 0.02];
/// What a cube in a bot's own supply is worth to it.
const SUPPLY_VALUE: f64 = 0.02;

/// The last top-level play decision's estimates, for the pass study (motw tournament): the play-out value of passing
/// (None if passing wasn't a candidate), of the best play, and of the position before moving. A measuring aid.
#[derive(Clone, Copy, Debug, Default)]
pub struct Decision {
    pub pass: Option<f64>,
    pub best_play: Option<f64>,
    pub now: f64,
}

thread_local! {
    static DECISION: std::cell::Cell<Option<Decision>> = const { std::cell::Cell::new(None) };
}

/// Takes the estimates the last top-level play decision left (None if it made none).
pub fn take_decision() -> Option<Decision> {
    DECISION.with(|d| d.take())
}

/// Keep every top-level decision's candidates (a measuring aid, the runner's `ties=1`).
pub static KEEP_CONSIDERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
thread_local! {
    static CONSIDERED: std::cell::RefCell<Vec<(Move, f64, Option<f64>)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// The last top-level decision's candidates, best one-step score first: (move, one-step score, play-out value if
/// shortlisted).
pub fn take_considered() -> Vec<(Move, f64, Option<f64>)> {
    CONSIDERED.with(|c| std::mem::take(&mut *c.borrow_mut()))
}

fn note_decision(ranked: &[(Move, GameState, f64)], values: &[(usize, f64)], now: f64) {
    if KEEP_CONSIDERED.load(std::sync::atomic::Ordering::Relaxed) {
        let list = ranked.iter().enumerate().map(|(i, r)| (r.0.clone(), r.2, values.iter().find(|v| v.0 == i).map(|v| v.1))).collect();
        CONSIDERED.with(|c| *c.borrow_mut() = list);
    }
    let pass = values.iter().find(|(i, _)| ranked[*i].0 == Move::Pass).map(|x| x.1);
    let best_play = values.iter().filter(|(i, _)| ranked[*i].0 != Move::Pass).map(|x| x.1).fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))));
    DECISION.with(|d| d.set(Some(Decision { pass, best_play, now })));
}

/// A goal bot's persona; 0 is a switch off.
#[derive(Clone, Debug, PartialEq)]
pub struct Persona {
    pub lean: f64,
    pub jitter: f64,
    pub hold: f64,
    pub push: f64,
    pub margin: f64,
    pub linear: f64,
    pub threat: f64,
    pub enumerate: f64,
    pub sim: f64,
    pub combo: f64,
    pub sets: f64,
    pub table: f64,
    pub commit: f64,
    pub protect: f64,
    pub top: f64,
    pub race: f64,
    pub even: f64,
    pub plan: f64,
    pub steer: f64,
    /// Search sizes, for testing (unset: SIM_KEEP, SIM_PLAYOUTS, PLAN_BUDGET, PLAN_DEPTH).
    pub keep: Option<usize>,
    pub playouts: Option<usize>,
    pub plan_budget: Option<usize>,
    pub plan_depth: Option<usize>,
    /// Testing: the jitter on one-step values (unset: SEARCH_NOISE); the draft's sampled plays per card (unset: 4);
    /// the play-out search's value mixed with the one-step value (0: play-outs only); play-out bots listing targets.
    pub noise: Option<f64>,
    pub draft: Option<usize>,
    pub mix: f64,
    pub roll_list: f64,
    /// Testing (the pass study): never pass while a card can be played.
    pub no_pass: f64,
    /// Rounds as votes: judge each vote as it comes (optimism grows with how far off a vote is, not one sum for the
    /// game; the lean fades with how decided the tally is, not the round clock). No effect with votes off.
    pub pace: f64,
    /// Paced: the lean fades with the vote tally (on) or the round clock (0).
    pub tally: f64,
    /// Testing: how much the lean fades as the game settles (1: fully, as always; 0: never, a seat keeps its side).
    pub fade: f64,
    /// Rounds as votes: the fight losses still to come this round, at a full round left (0: none, as before); the
    /// vote is after fights the round's plays are yet to make (2026-11-02: the board shows 30 before round 1, 14 at its vote).
    pub drain: f64,
    /// ...and how much each later round's vote rises on this one's (0: flat, as before).
    pub trend: f64,
    /// The goal's forecast from play-outs (2026-11-02, the designer: derive it, no set numbers): before a real decision,
    /// play the round out this many times and read the vote from where it ends (0: from the board as it stands).
    pub look: f64,
    /// The draft by play-outs (designer, 2026-11-02: a card is worth what it adds to the hand's play this round, and
    /// what that sets up after): each card this pick could add, the rest of the draft finished by every seat's own
    /// bot, then the round played out, this many times; its worth is the position at the vote (0: one step, alone).
    pub dplan: f64,
    /// Always play out the plays that break a tie for the most sway at a fight already set (2026-11-03; default on,
    /// designer 2026-11-04; 100 games, seat 5: 29.0% vs 26.0%).
    pub tiekeep: f64,
    /// Testing (2026-11-04, designer: does breaking ties stubbornly pay?): when tied for the most sway at a fight
    /// already set and some play breaks the tie, choose only among the plays that break it.
    pub stubborn: f64,
    /// Testing (2026-11-04): the one-step pick scores candidates with the imitation weights (rust/data/imit.json).
    pub imit: f64,
    /// The learned judge (judge.rs, `npm run judge`) in place of the hand formula's chances (0: the hand formula).
    pub judge: f64,
    /// The play-out bots (every seat) judge with the learned judge too (designer, 2026-11-03: no quick-and-dirty play-outs).
    pub rjudge: f64,
    pub rimit: f64,
    pub rplan: f64,
}

/// The one bot (designer, 2026-10-29): its lean slides it from the island-minded settings (lean -0.3, the old trophy
/// bot) to the faction-backing ones (+0.3, the old backer), the backer's habits growing with the lean; beyond those
/// ends the habits stay as at the end.
pub fn at_lean(lean: f64) -> Persona {
    let t = ((lean + 0.3) / 0.6).clamp(0.0, 1.0);
    let mix = |a: f64, b: f64| if t == 0.0 { a } else if t == 1.0 { b } else { a + (b - a) * t };
    Persona {
        lean, jitter: 0.15, hold: 0.05, push: 2.0, margin: 3.0, linear: 1.0, threat: mix(3.0, 1.0), enumerate: 1.0, sim: 1.0, combo: 1.0, sets: 2.0,
        table: 1.0, commit: mix(0.0, 2.0), protect: mix(0.0, 4.0), top: mix(0.0, 2.0),
        race: mix(0.0, 2.0), even: 1.0, plan: 1.0, steer: 1.0, keep: Some(mix(12.0, SIM_KEEP as f64).round() as usize), playouts: None, plan_budget: None, plan_depth: None,
        noise: Some(mix(0.0, SEARCH_NOISE)), draft: None, mix: 0.0, roll_list: 0.0, no_pass: 0.0, pace: 0.0, tally: 1.0, fade: 1.0, drain: 0.0, trend: 0.0, look: 0.0, dplan: 0.0, tiekeep: 1.0, stubborn: 0.0, imit: 0.0, judge: 0.0, rjudge: 0.0, rimit: 0.0, rplan: 1.0,
    }
}

fn base(name: &str) -> Option<Persona> {
    match name {
        "bot" => Some(at_lean(0.0)),
        _ => None,
    }
}

/// A profile's persona ("bot", or "bot:lean=0.3,hold=0.1": the lean sets the settings it slides, then the others apply).
pub fn persona_of(profile: &str) -> Option<Persona> {
    thread_local! {
        static CACHE: std::cell::RefCell<std::collections::HashMap<String, Option<Persona>>> = std::cell::RefCell::new(std::collections::HashMap::new());
    }
    if let Some(p) = CACHE.with(|c| c.borrow().get(profile).cloned()) {
        return p;
    }
    let p = parse_persona(profile);
    CACHE.with(|c| c.borrow_mut().insert(profile.to_string(), p.clone()));
    p
}

fn parse_persona(profile: &str) -> Option<Persona> {
    let (name, over) = match profile.split_once(':') {
        Some((n, o)) => (n, Some(o)),
        None => (profile, None),
    };
    let mut p = base(name)?;
    // The lean first: it sets the settings that slide with it.
    if let Some(l) = over.and_then(|o| o.split(',').find_map(|kv| kv.strip_prefix("lean=")).and_then(|v| v.trim().parse::<f64>().ok())) {
        p = at_lean(l);
    }
    if let Some(o) = over {
        for kv in o.split(',') {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            let x: f64 = v.trim().parse().unwrap_or(f64::NAN);
            match k {
                "lean" => p.lean = x,
                "jitter" => p.jitter = x,
                "hold" => p.hold = x,
                "push" => p.push = x,
                "margin" => p.margin = x,
                "linear" => p.linear = x,
                "threat" => p.threat = x,
                "enum" => p.enumerate = x,
                "sim" => p.sim = x,
                "combo" => p.combo = x,
                "sets" => p.sets = x,
                "table" => p.table = x,
                "commit" => p.commit = x,
                "protect" => p.protect = x,
                "top" => p.top = x,
                "race" => p.race = x,
                "even" => p.even = x,
                "plan" => p.plan = x,
                "steer" => p.steer = x,
                "keep" => p.keep = Some(x as usize),
                "playouts" => p.playouts = Some(x as usize),
                "planBudget" => p.plan_budget = Some(x as usize),
                "planDepth" => p.plan_depth = Some(x as usize),
                "noise" => p.noise = Some(x),
                "draft" => p.draft = Some(x as usize),
                "mix" => p.mix = x,
                "rollList" => p.roll_list = x,
                "noPass" => p.no_pass = x,
                "pace" => p.pace = x,
                "tally" => p.tally = x,
                "fade" => p.fade = x,
                "drain" => p.drain = x,
                "trend" => p.trend = x,
                "look" => p.look = x,
                "dplan" => p.dplan = x,
                "tiekeep" => p.tiekeep = x,
                "stubborn" => p.stubborn = x,
                "imit" => p.imit = x,
                "rimit" => p.rimit = x,
                "rplan" => p.rplan = x,
                "judge" => p.judge = x,
                "rjudge" => p.rjudge = x,
                _ => {}
            }
        }
    }
    Some(p)
}

/// A play-out bot that lists targets (persona rollList): the same persona, one move ahead, no draft combos.
fn listing(profile: &str) -> String {
    if persona_of(profile).is_none() {
        return profile.to_string();
    }
    format!("{profile}{}sim=0,combo=0", if profile.contains(':') { "," } else { ":" })
}

/// A profile with the slow search switched off (play-outs): the same persona, one move ahead, sampled targets.
pub fn fast(profile: &str) -> String {
    if persona_of(profile).is_none() {
        return profile.to_string();
    }
    format!("{profile}{}sim=0,enum=0,combo=0", if profile.contains(':') { "," } else { ":" })
}

#[inline]
fn on(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

#[inline]
fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + libm::exp(-x))
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

/// The board after this round's fights, as they stand now.
/// The board after this round's fights, remembered for the few positions asked about most recently.
fn project_fights_cached(s: &GameState) -> GameState {
    // A few recent projections, by the position's content (the board, players and supply, the round and phase, the
    // options): every seat asks about the same position in a play-out before one of them moves.
    thread_local! {
        static CACHE: std::cell::RefCell<Vec<(u64, GameState, GameState)>> = const { std::cell::RefCell::new(Vec::new()) };
    }
    let same = |a: &GameState, b: &GameState| a.board == b.board && a.players == b.players && a.supply == b.supply && a.round == b.round && a.phase == b.phase && std::rc::Rc::ptr_eq(&a.options, &b.options);
    let key = {
        use std::hash::{Hash, Hasher};
        let mut h = crate::small::Fx::default();
        for p in &s.board {
            p.tokens.hash(&mut h);
            p.sway.hash(&mut h);
        }
        for p in &s.players {
            p.standing.hash(&mut h);
            p.trophies.hash(&mut h);
            p.supply.hash(&mut h);
        }
        s.supply.hash(&mut h);
        h.write_u64(s.round as u64);
        h.finish()
    };
    if let Some(hit) = CACHE.with(|c| c.borrow().iter().find(|e| e.0 == key && same(&e.1, s)).map(|e| e.2.clone())) {
        return hit;
    }
    let locs = fights_due(s);
    let mut out = imagined(s);
    if !locs.is_empty() {
        resolve_fights(&mut out, &locs);
    }
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= 8 {
            c.remove(0);
        }
        c.push((key, imagined(s), out.clone()));
    });
    out
}

/// The chance of winning, by ending (winChances).
#[derive(Clone, Copy, Debug)]
pub struct Chances {
    /// The seat this reading is for.
    pub pid: Pid,
    pub p_invaders: f64,
    pub prior: f64,
    pub known: f64,
    /// How far the game has gone (0 at round 1, 1 at the last); the lean fades with it.
    pub settled: f64,
    pub backers: i32,
    pub linear_island: f64,
    pub rival_invaders: f64,
    pub as_invaders: f64,
    pub as_island: f64,
    pub margin_invaders: f64,
    pub margin_island: f64,
    pub projected: f64,
    pub threshold: f64,
    pub spread_p: f64,
    pub rounds_left: f64,
}

pub fn win_chances(s: &GameState, pid: Pid) -> Chances {
    chances_after(&project_fights(s), pid)
}

/// win_chances for a position every seat asks about (the goal checks in a play-out): its projection remembered.
fn win_chances_shared(s: &GameState, pid: Pid) -> Chances {
    chances_after(&project_fights_cached(s), pid)
}

/// A location's fight, as what it does: the location (and a Gate partner) afterwards, and what it adds to each supply
/// and to each seat's standing, trophies and supply.
#[derive(Clone, Copy)]
struct FightResult {
    place: Place,
    partner: Option<(Loc, Place)>,
    supply: [i32; 5],
    seats: [([i32; 5], [i32; 5], i32); 5],
}

/// What a fight depends on besides its location's content: the game's options and the seats' groups (affinity).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct FightKey {
    seats: usize,
    factions: [u8; 5],
    groups: [u8; 5],
    loc: Loc,
    place: Place,
    partner: Option<(Loc, Place)>,
}

/// The board after this round's fights. Each location's fight depends only on that location (and its Gate partner),
/// the seats' groups and the options, and only adds to the players' and supplies' totals, so fights are independent:
/// each is remembered by its content, and a position that differs from one already projected at a few locations
/// fights only those again.
/// The board after this round's fights already set (for the learned judge's features).
pub fn projected(s: &GameState) -> GameState {
    project_fights_cached(s)
}

fn project_fights(s: &GameState) -> GameState {
    thread_local! {
        // The options the results hold for (kept alive, so the cache starts afresh when another game's differ).
        static FIGHTS: std::cell::RefCell<(Option<std::rc::Rc<Options>>, crate::small::FxMap<FightKey, FightResult>)> = std::cell::RefCell::new(Default::default());
    }
    let locs = fights_due(s);
    let mut out = imagined(s);
    if locs.is_empty() {
        return out;
    }
    FIGHTS.with(|c| {
        let mut c = c.borrow_mut();
        if !c.0.as_ref().is_some_and(|o| std::rc::Rc::ptr_eq(o, &out.options) || **o == *out.options) {
            *c = (Some(out.options.clone()), Default::default());
        }
    });
    let mut groups = [0u8; 5];
    for (i, p) in out.players.iter().enumerate() {
        groups[i] = p.group;
    }
    for &l in &locs {
        let li = l as usize;
        if out.board[li].scorched || count_at(&out, l) < 2 {
            continue; // as fight_at: none here, or already fought through its Gate
        }
        let partner = out.board[li].gate.map(|g| (g, out.board[g as usize]));
        let key = FightKey { seats: out.players.len(), factions: out.factions, groups, loc: l, place: out.board[li], partner };
        let hit = FIGHTS.with(|c| c.borrow().1.get(&key).copied());
        let r = match hit {
            Some(r) => r,
            None => {
                let before = (out.supply, out.players.iter().map(|p| (p.standing, p.trophies, p.supply)).collect::<Vec<_>>());
                fight_at(&mut out, l);
                let mut r = FightResult { place: out.board[li], partner: partner.map(|(g, _)| (g, out.board[g as usize])), supply: [0; 5], seats: [([0; 5], [0; 5], 0); 5] };
                for f in 0..5 {
                    r.supply[f] = out.supply[f] - before.0[f];
                }
                for (i, p) in out.players.iter().enumerate() {
                    let b = before.1[i];
                    for f in 0..5 {
                        r.seats[i].0[f] = p.standing[f] - b.0[f];
                        r.seats[i].1[f] = p.trophies[f] - b.1[f];
                    }
                    r.seats[i].2 = p.supply - b.2;
                }
                FIGHTS.with(|c| {
                    let mut c = c.borrow_mut();
                    if c.1.len() > 200_000 {
                        c.1.clear();
                    }
                    c.1.insert(key, r);
                });
                continue; // already applied to `out`
            }
        };
        out.board[li] = r.place;
        if let Some((g, p)) = r.partner {
            out.board[g as usize] = p;
        }
        for f in 0..5 {
            out.supply[f] += r.supply[f];
        }
        for (i, p) in out.players.iter_mut().enumerate() {
            for f in 0..5 {
                p.standing[f] += r.seats[i].0[f];
                p.trophies[f] += r.seats[i].1[f];
            }
            p.supply += r.seats[i].2;
        }
    }
    out
}

/// The chance the invaders win, from the projected presence against the bar, shifted by `push` (a goal's optimism).
/// Rounds as votes: each round left is a vote, this round's close sharp, later ones less so; the chance of a majority.
/// `paced`: `push` is per round, so a vote k rounds off gets k + 1 of it (this round's vote, one).
fn invaders_reach(s: &GameState, projected: f64, threshold: f64, spread_p: f64, push: f64, paced: bool) -> f64 {
    invaders_reach_by(s, projected, threshold, spread_p, push, paced, 0.0, 0.0)
}

/// The fight losses still to come this round (`drain` at a full round) and each later vote's rise (`trend`).
fn round_left(s: &GameState) -> f64 {
    if s.phase != Phase::Play {
        return 1.0;
    }
    let full = (spec().hand_size[s.n()] * s.n()) as f64;
    let held: usize = s.players.iter().map(|p| p.hand.len()).sum();
    if full > 0.0 { (held as f64 / full).min(1.0) } else { 0.0 }
}

#[allow(clippy::too_many_arguments)]
fn invaders_reach_by(s: &GameState, projected: f64, threshold: f64, spread_p: f64, push: f64, paced: bool, drain: f64, trend: f64) -> f64 {
    if !s.options.round_votes {
        return sigmoid((projected - threshold - 0.5 + push) / spread_p);
    }
    // Rounds closed so far (each vote 1 until the last round, which ends the game); the last round left may count more.
    let closed = (s.votes[0] + s.votes[1]).min(s.options.rounds);
    let left = (s.options.rounds - closed).max(0) as usize;
    let need = (s.options.votes_total() / 2 + 1 - s.votes[0]).max(0) as usize;
    let most = (s.options.votes_total() - closed).max(0) as usize;
    let mut dp = vec![0.0f64; most + 1];
    dp[0] = 1.0;
    for k in 0..left {
        let w = s.options.vote_weight(closed + 1 + k as i32) as usize;
        let shift = if paced { push * (k as f64 + 1.0) } else { push };
        let ahead = -drain + trend * k as f64;
        let q = sigmoid((projected + ahead - threshold - 0.5 + shift) / (2.0 + 3.0 * k as f64));
        for j in (0..=most).rev() {
            dp[j] = dp[j] * (1.0 - q) + if j >= w { dp[j - w] * q } else { 0.0 };
        }
    }
    dp.iter().enumerate().filter(|(j, _)| *j >= need).map(|(_, p)| p).sum()
}

fn chances_after(s: &GameState, pid: Pid) -> Chances {
    let colours = &ISLAND;
    let rounds = s.options.rounds as f64;
    let rounds_left = (rounds - s.round as f64).max(0.0);
    let threshold = s.options.threshold as f64;
    let grow = growth_total(s) as f64;
    let n_f = 5usize;
    let presence: Vec<f64> = (0..5).map(|f| presence_of(s, f) as f64).collect();
    let mut total = 0.0;
    for p in &presence {
        total += p;
    }
    let projected = total + if s.phase == Phase::Play { grow } else { 0.0 };
    let spread_p = 2.0 + 3.0 * rounds_left;
    let mut top = f64::NEG_INFINITY;
    for &p in &presence {
        if p > top {
            top = p;
        }
    }
    let w: Vec<f64> = presence.iter().map(|&n| libm::exp((n - top) / (1.5 + 1.5 * rounds_left))).collect();
    let mut w_sum = 0.0;
    for x in &w {
        w_sum += x;
    }
    let seats = s.n();
    let nets: Vec<[f64; 5]> = (0..seats).map(|id| {
        let pl = &s.players[id];
        let mut row = [0.0; 5];
        for (i, r) in row.iter_mut().enumerate() {
            *r = (pl.standing[i] - pl.trophies[i]) as f64;
        }
        row
    }).collect();
    let mut best_a = [0.0f64; 5];
    let mut best_b = [0.0f64; 5];
    let mut best_who = [usize::MAX; 5];
    for i in 0..n_f {
        let (mut a, mut b, mut who) = (f64::NEG_INFINITY, f64::NEG_INFINITY, usize::MAX);
        for (id, row) in nets.iter().enumerate() {
            let v = row[i];
            if v > a {
                b = a;
                a = v;
                who = id;
            } else if v > b {
                b = v;
            }
        }
        best_a[i] = a;
        best_b[i] = b;
        best_who[i] = who;
    }
    let best_other = |id: usize, i: usize| if best_who[i] == id { best_b[i] } else { best_a[i] };
    let spread_i = 1.0 + rounds_left;
    let me = pid as usize;
    let mut as_invaders = 0.0;
    let mut margin_invaders = 0.0;
    for i in 0..n_f {
        let l = nets[me][i] - best_other(me, i);
        as_invaders += (w[i] / w_sum) * sigmoid(l / spread_i);
    }
    for i in 0..n_f {
        margin_invaders += (w[i] / w_sum) * (nets[me][i] - best_other(me, i));
    }
    let mut rival_invaders = 0.0;
    let mut isl_of = vec![0.0f64; seats];
    let mut all_of = vec![0.0f64; seats];
    for id in 0..seats {
        let tr = &s.players[id].trophies;
        let mut t = [0i32; 5];
        let mut sum = 0.0;
        for i in 0..n_f {
            t[i] = tr[i];
            sum += t[i] as f64;
        }
        t.sort();
        isl_of[id] = colours[0] * t[0] as f64 + colours[1] * t[1] as f64 + colours[2] * t[2] as f64;
        all_of[id] = isl_of[id] + colours[3] * sum;
        if id == me {
            continue;
        }
        let mut r = 0.0;
        for i in 0..n_f {
            r += (w[i] / w_sum) * sigmoid((nets[id][i] - best_other(id, i)) / spread_i);
        }
        if r > rival_invaders {
            rival_invaders = r;
        }
    }
    let (mut best_isl, mut best_all, mut backers) = (f64::NEG_INFINITY, f64::NEG_INFINITY, 0);
    for id in 0..seats {
        if id == me {
            continue;
        }
        if isl_of[id] > best_isl {
            best_isl = isl_of[id];
        }
        if all_of[id] > best_all {
            best_all = all_of[id];
        }
        let mut m = f64::NEG_INFINITY;
        for i in 0..n_f {
            if nets[id][i] > m {
                m = nets[id][i];
            }
        }
        if m >= TABLE_BACKING as f64 {
            backers += 1;
        }
    }
    let margin_island = isl_of[me] - best_isl;
    let linear_island = all_of[me] - best_all;
    let spread_t = 0.6 + 0.8 * rounds_left;
    let as_island = sigmoid(margin_island / spread_t);
    let prior = (TABLE_BASE + TABLE_STEP * backers as f64).max(0.1).min(0.9);
    // Rounds as votes: this round's vote is cast at its close, so the board counts from round 1; the later votes'
    // wider spreads (invaders_reach) carry the uncertainty the blend with the table's prior stood for.
    // How far the game has gone: a seat's lean (its starting preference) fades with it (choose_goal).
    let settled = if rounds > 1.0 { ((s.round as f64 - 1.0) / (rounds - 1.0)).min(1.0) } else { 1.0 };
    let known = if s.options.round_votes { 1.0 } else { settled };
    let p_invaders = (1.0 - known) * prior + known * invaders_reach(s, projected, threshold, spread_p, 0.0, false);
    Chances { pid, p_invaders, prior, known, settled, backers, linear_island, rival_invaders, as_invaders, as_island, margin_invaders, margin_island, projected, threshold, spread_p, rounds_left }
}

/// How good a position is for `pid` (evaluate).
pub fn evaluate(s: &GameState, pid: Pid, profile: &str, goal: Option<Goal>) -> f64 {
    let persona = persona_of(profile).unwrap_or_else(|| at_lean(-0.3));
    goal_value(s, pid, goal.unwrap_or(Goal::Island), &persona)
}

fn goal_value(s: &GameState, pid: Pid, goal: Goal, p: &Persona) -> f64 {
    let mut c = win_chances(s, pid);
    let _ = &mut c;
    if s.options.round_votes && (on(p.drain) || on(p.trend)) {
        c.p_invaders = invaders_reach_by(s, c.projected, c.threshold, c.spread_p, 0.0, false, p.drain * round_left(s), p.trend);
    }
    if on(p.judge) {
        if let Some(w) = crate::judge::weights() {
            // The chance of winning, whichever ending comes: what a bot playing to win values.
            let (pi, wi, ws) = crate::judge::judge_with(s, &c, w);
            return 10.0 * (pi * wi + (1.0 - pi) * ws) + SUPPLY_VALUE * s.players[pid as usize].supply as f64;
        }
    }
    let inv = c.p_invaders * 10.0 * c.as_invaders + p.margin * c.margin_invaders;
    let island_margin = p.linear * 10.0 * c.linear_island;
    let isl = (1.0 - c.p_invaders) * 10.0 * c.as_island + island_margin;
    let threat = p.threat * 10.0 * c.p_invaders * c.rival_invaders;
    let guard = if on(p.protect) && goal == Goal::Invaders { p.protect * presence_guard(s, pid, &c, p) } else { 0.0 };
    let main = if goal == Goal::Invaders { inv + guard } else { isl + if on(p.sets) { p.sets * (1.0 - c.p_invaders) * set_access(s, pid) } else { 0.0 } };
    main - threat + SUPPLY_VALUE * s.players[pid as usize].supply as f64
}

fn presence_guard(s: &GameState, pid: Pid, c: &Chances, p: &Persona) -> f64 {
    let me = &s.players[pid as usize];
    let others: Vec<usize> = (0..s.n()).filter(|&i| i != pid as usize).collect();
    let lead = |f: usize| -> f64 {
        let mine = (me.standing[f] - me.trophies[f]) as f64;
        let best = others.iter().map(|&o| (s.players[o].standing[f] - s.players[o].trophies[f]) as f64).fold(f64::NEG_INFINITY, f64::max);
        mine - best
    };
    let mut order: Vec<usize> = (0..5).collect();
    order.sort_by(|&a, &b| lead(b).partial_cmp(&lead(a)).unwrap_or(std::cmp::Ordering::Equal));
    let backed = order[0];
    let margin = ((c.projected - c.threshold) / 5.0).min(3.0).max(-3.0);
    let rival_top = (0..5).filter(|&f| f != backed).map(|f| presence_of(s, f as Fac) as f64).fold(f64::NEG_INFINITY, f64::max);
    let ahead = ((presence_of(s, backed as Fac) as f64 - rival_top) / 3.0).min(2.0).max(-2.0);
    let safe = sigmoid((c.projected - c.threshold - 3.0) / 2.0);
    let race = p.race * safe * (lead(backed) / 2.0).min(3.0).max(-3.0);
    margin + 0.1 * presence_of(s, backed as Fac) as f64 + p.top * ahead + race
}

fn set_access(s: &GameState, pid: Pid) -> f64 {
    let p = &s.players[pid as usize];
    let rounds_left = (s.options.rounds as f64 - s.round as f64).max(0.0);
    if rounds_left == 0.0 {
        return 0.0;
    }
    let mut order: Vec<usize> = (0..5).collect();
    order.sort_by_key(|&f| p.trophies[f]);
    let need = [1.0, 0.35, 0.12, 0.0, 0.0];
    let on_board = |f: usize| -> i32 { s.board.iter().map(|pl| if pl.tokens.get(f as Fac) > 0 { pl.sway.get(pid) } else { 0 }).sum() };
    let mut acc = 0.0;
    for (i, &f) in order.iter().enumerate() {
        acc += need[i] * (((p.standing[f] + on_board(f)) as f64).max(0.0)).sqrt(); // negative standing: no access
    }
    acc * (rounds_left / 2.0).min(1.0)
}

/// Which goal to pursue now (chooseGoal). Draws from `rng` once per game, for the memory's jitter.
pub fn choose_goal(s: &GameState, pid: Pid, p: &Persona, memory: Option<&mut BotMemory>, rng: Rng) -> Goal {
    choose_goal_seen(s, pid, p, memory, rng, None)
}

/// The round played out `n` times from here by every seat's own bot: where this round's vote lands, on average.
fn vote_ahead(s: &GameState, pid: Pid, rng: Rng, memory: Option<&BotMemory>, seats: &Seats, n: usize) -> f64 {
    let mut sum = 0.0;
    for _ in 0..n {
        let end = play_out_round(s, seed_of(rng), pid, memory, Some(seats), None);
        sum += win_chances(&end, pid).projected;
    }
    sum / n.max(1) as f64
}

fn choose_goal_seen(s: &GameState, pid: Pid, p: &Persona, memory: Option<&mut BotMemory>, rng: Rng, seen: Option<f64>) -> Goal {
    let mut c = win_chances_shared(s, pid);
    if let Some(v) = seen {
        c.projected = v;
    }
    let paced = on(p.pace) && s.options.round_votes;
    let push = if paced { p.push * p.pace } else { p.push * (c.rounds_left + 1.0) };
    let (drain, trend) = (p.drain * round_left(s), p.trend);
    let reach_inv = (1.0 - c.known) * (c.prior + 0.15).min(1.0) + c.known * invaders_reach_by(s, c.projected, c.threshold, c.spread_p, push, paced, drain, trend);
    let reach_isl = (1.0 - c.known) * (1.0 - c.prior + 0.15).min(1.0) + c.known * (1.0 - invaders_reach_by(s, c.projected, c.threshold, c.spread_p, -push, paced, drain, trend));
    // Paced: the lean fades as the tally nears a majority (0 at 0-0, 1 once a side has it), not with the round.
    let majority = (s.options.votes_total() / 2 + 1).max(1) as f64;
    let settled = if paced && on(p.tally) { (s.votes[0].max(s.votes[1]) as f64 / majority).min(1.0) } else { c.settled };
    let mut evidence = reach_inv * c.as_invaders - reach_isl * c.as_island;
    if on(p.judge) {
        if let Some(w) = crate::judge::weights() {
            let (pi, wi, ws) = crate::judge::judge_with(s, &c, w);
            evidence = pi * wi - (1.0 - pi) * ws;
        }
    }
    let mut memory = memory;
    if let Some(m) = memory.as_deref_mut() {
        if m.jitter.is_none() {
            m.jitter = Some((rng() * 2.0 - 1.0) * p.jitter);
        }
    }
    let jitter = memory.as_deref().and_then(|m| m.jitter).unwrap_or(0.0);
    let score = evidence + (p.lean + jitter) * (1.0 - p.fade * settled);
    let held = memory.as_deref().and_then(|m| m.goal);
    let bar = match held {
        Some(Goal::Invaders) => -p.hold,
        Some(Goal::Island) => p.hold,
        None => 0.0,
    };
    let mut goal = if score > bar { Goal::Invaders } else { Goal::Island };
    if held == Some(Goal::Invaders) && goal == Goal::Island && on(p.commit) && reach_isl * c.as_island < p.commit * reach_inv * c.as_invaders {
        goal = Goal::Invaders;
    }
    if let Some(m) = memory {
        m.goal = Some(goal);
    }
    goal
}

// ---------------------------------------------------------------------------
// Choosing a move
// ---------------------------------------------------------------------------

fn spend(card: CardIx) -> Move {
    Move::Play { card, use_: PlayUse::Sway, target: None, places: None }
}
/// An unsuited card spent for sway with a chosen faction (unsuitedSway).
fn spend_on(card: CardIx, f: Fac) -> Move {
    let mut t = Target::default();
    t.set_faction(Id::Fac(f));
    Move::Play { card, use_: PlayUse::Sway, target: Some(Some(t)), places: None }
}
fn action(card: CardIx, t: Option<Target>) -> Move {
    Move::Play { card, use_: PlayUse::Action, target: Some(t), places: None }
}
/// The state after a move, quiet (a search's imagined states write no log; nothing in a search reads it).
fn after(s: &GameState, pid: Pid, m: &Move) -> GameState {
    // Every move a bot imagines was validated when its search made it, so it isn't checked again.
    if s.quiet {
        return apply_legal(s, pid, m);
    }
    apply_legal(&imagined(s), pid, m)
}
fn legal(s: &GameState, pid: Pid, m: &Move) -> bool {
    validate(s, pid, m).is_none()
}

/// Every move worth considering on this bot's turn (candidates).
// PERF: every candidate is validated (check_target clones the state twice) after listing already checked it.
#[allow(clippy::too_many_arguments)]
pub fn candidates(s: &GameState, pid: Pid, rng: Rng, targets: usize, list: bool, even: bool, steer: Option<&dyn Fn(&GameState) -> f64>, only: Option<CardIx>) -> Vec<Move> {
    let p = &s.players[pid as usize];
    let mut memo = Memo::default();
    let mut moves = vec![Move::Pass];
    let mut hand: Vec<CardIx> = Vec::new();
    for &c in &p.hand {
        if !hand.contains(&c) {
            hand.push(c);
        }
    }
    for ci in hand {
        if only.is_some_and(|o| o != ci) {
            continue;
        }
        let c = card(ci);
        if c.suit.is_none() && s.options.unsuited_sway != 0 {
            for f in 0..s.factions.len() as Fac {
                moves.push(spend_on(ci, f));
            }
        }
        if c.suit.is_some() {
            moves.push(spend(ci));
            let (spots, max, _) = return_room(s, pid, ci);
            if max > 0 {
                let mut ways: Vec<Vec<Loc>> = Vec::new();
                for &l in &spots {
                    ways.push(vec![l]);
                    if max > 1 {
                        ways.push(vec![l; max as usize]);
                    }
                }
                if spots.len() > 1 && max > 1 {
                    ways.push(spots[..(max as usize).min(spots.len())].to_vec());
                }
                for places in ways {
                    moves.push(Move::Play { card: ci, use_: PlayUse::Return, target: None, places: Some(places) });
                }
            }
        }
        // Targets already offered (equal targets are those JSON.stringify would write alike: fields in order).
        let mut seen: Vec<Option<Target>> = Vec::new();
        // How many targets this card offers: `targets` sampled, beyond any it listed.
        let mut want = targets;
        if list {
            if let Some(value) = steer {
                if !list_targets_memo(s, pid, ci, LIST_CAP + 1, even, &mut memo).1 {
                    for t in steered(s, pid, ci, rng, value, LIST_CAP, &mut memo) {
                        if seen.contains(&Some(t)) {
                            continue;
                        }
                        seen.push(Some(t));
                        moves.push(action(ci, Some(t)));
                    }
                    want = targets + seen.len();
                }
            }
        }
        if list && seen.is_empty() {
            let (l, complete) = list_targets_memo(s, pid, ci, LIST_CAP, even, &mut memo);
            let none = l.is_empty();
            for t in l {
                seen.push(Some(t));
                moves.push(action(ci, Some(t)));
            }
            if complete && none {
                moves.push(action(ci, None));
            }
            if complete {
                continue;
            }
            want = targets + seen.len();
        }
        let mut i = 0;
        while i < want * 2 && seen.len() < want {
            i += 1;
            let t = sample_target_memo(s, pid, ci, rng, &mut memo);
            if seen.contains(&t) {
                continue;
            }
            seen.push(t);
            moves.push(action(ci, t));
        }
    }
    moves.into_iter().filter(|m| match m {
        // An action's target was checked as it was listed or sampled (memo); the rest of the move is checked here.
        Move::Play { card, use_: PlayUse::Action, target: Some(Some(t)), .. } => legal(s, pid, &action(*card, None)) && memo.legal(s, pid, *card, t),
        _ => legal(s, pid, m),
    }).collect()
}

/// Best-first targets for a card (persona steer).
fn steered(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, value: &dyn Fn(&GameState) -> f64, budget: usize, memo: &mut Memo) -> Vec<Target> {
    let mut found: Vec<(Target, f64)> = Vec::new();
    let mut score = |t: &Target, found: &mut Vec<(Target, f64)>| -> f64 {
        if let Some(hit) = found.iter().find(|e| e.0 == *t) {
            return hit.1;
        }
        let m = action(ci, Some(*t));
        if !(legal(s, pid, &action(ci, None)) && memo.legal(s, pid, ci, t)) {
            return f64::NEG_INFINITY;
        }
        let v = value(&after(s, pid, &m));
        found.push((*t, v));
        v
    };
    let mut open: Vec<(Target, f64)> = Vec::new();
    let mut look = |t: &Target, found: &mut Vec<(Target, f64)>, open: &mut Vec<(Target, f64)>, rng: &mut dyn FnMut() -> f64| {
        let (done, next) = choice_steps(s, pid, ci, t);
        for d in &done {
            score(d, found);
        }
        for n in next {
            let mut v = f64::NEG_INFINITY;
            let mut i = 0;
            while i < 2 && found.len() < budget {
                i += 1;
                if let Some(c) = complete_target(s, pid, ci, &n, rng) {
                    v = v.max(score(&c, found));
                }
            }
            if v > f64::NEG_INFINITY {
                open.push((n, v));
            }
        }
    };
    look(&Target::default(), &mut found, &mut open, rng);
    let mut guard = 0;
    while guard < 200 && found.len() < budget && !open.is_empty() {
        guard += 1;
        open.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let (t, _) = open.remove(0);
        look(&t, &mut found, &mut open, rng);
    }
    found.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    found.into_iter().map(|e| e.0).collect()
}

/// The move this bot should make right now (botMove), or None.
pub fn bot_move(s: &GameState, pid: Pid, rng: Rng, profile: &str, memory: Option<&mut BotMemory>, seats: &Seats) -> Option<Move> {
    if pid as usize >= s.n() || s.phase == Phase::Ended {
        return None;
    }
    play_move(s, pid, rng, profile, memory, seats, None)
}

/// The `random` profile, a baseline for measuring the bots (does their play beat chance?): every choice uniformly at
/// random among the legal ones the bots consider. Never a default.
fn random_move(s: &GameState, pid: Pid, rng: Rng) -> Option<Move> {
    let me = pid as usize;
    let pick = |n: usize, rng: &mut dyn FnMut() -> f64| ((rng() * n as f64) as usize).min(n.saturating_sub(1));
    match s.phase {
        Phase::Draft => {
            let p = &s.players[me];
            if p.picked {
                return None;
            }
            let mut pool: Vec<CardIx> = p.kept.iter().chain(p.batch.iter()).copied().collect();
            let mut keep = Vec::new();
            while keep.len() < p.kept.len() + 1 && !pool.is_empty() {
                let i = pick(pool.len(), &mut *rng);
                keep.push(pool.swap_remove(i));
            }
            let m = Move::Pick { keep };
            if legal(s, pid, &m) { Some(m) } else { None }
        }
        Phase::Growth => {
            let g = s.growing.as_ref()?;
            if g.favourites[g.next as usize % g.favourites.len()] != pid {
                return None;
            }
            let ls: Vec<Loc> = g.due.keys().collect();
            Some(Move::Grow { location: ls[pick(ls.len(), &mut *rng)] })
        }
        Phase::Night => {
            let n = s.night.as_ref()?;
            if n.player != pid {
                return None;
            }
            let mut ms = night_moves(s, n.left[0]);
            let i = pick(ms.len(), &mut *rng);
            Some(ms.swap_remove(i))
        }
        Phase::Play => {
            if s.turn != me {
                return None;
            }
            let mut ms = candidates(s, pid, rng, SEARCH_TARGETS, false, false, None, None);
            if ms.is_empty() {
                return None;
            }
            let i = pick(ms.len(), &mut *rng);
            Some(ms.swap_remove(i))
        }
        Phase::Ended => None,
    }
}

/// The bot's best move with a chosen card, extending the target chosen so far (for hints that follow the player's
/// choice, designer 2026-10-28): a card alone, its best use (action, sway or bringing tokens back); a reading or
/// part of a target, the best action that goes on from there. None if no such move is legal.
pub fn bot_move_with(s: &GameState, pid: Pid, rng: Rng, profile: &str, memory: Option<&mut BotMemory>, seats: &Seats, card: CardIx, so_far: &Target) -> Option<Move> {
    if pid as usize >= s.n() || s.phase != Phase::Play {
        return None;
    }
    play_move(s, pid, rng, profile, memory, seats, Some((card, so_far)))
}

/// Does a finished target go on from a partial one (every field chosen so far the same; lists begun the same way)?
fn extends(t: &Target, p: &Target) -> bool {
    fn same<T: PartialEq>(a: &Option<T>, b: &Option<T>) -> bool {
        b.is_none() || a == b
    }
    fn starts(a: &Option<Ids>, b: &Option<Ids>) -> bool {
        let want: Vec<Id> = b.as_deref().unwrap_or(&[]).iter().copied().filter(|&x| x != Id::Stop).collect();
        let have: &[Id] = a.as_deref().unwrap_or(&[]);
        have.len() >= want.len() && have[..want.len()] == want[..]
    }
    let want: Vec<(Id, Id)> = p.moves.as_deref().unwrap_or(&[]).iter().filter(|g| g.location != Id::Stop).map(|g| (g.location, g.faction)).collect();
    let have: Vec<(Id, Id)> = t.moves.as_deref().unwrap_or(&[]).iter().map(|g| (g.location, g.faction)).collect();
    same(&t.mode, &p.mode) && same(&t.location, &p.location) && same(&t.faction, &p.faction) && same(&t.to, &p.to) && same(&t.payer, &p.payer)
        && same(&t.use_, &p.use_) && same(&t.back, &p.back) && same(&t.losses, &p.losses)
        && starts(&t.from, &p.from) && starts(&t.path, &p.path) && starts(&t.payers, &p.payers)
        && have.len() >= want.len() && have[..want.len()] == want[..]
}

/// A move that fits a hint's focus: the chosen card; once a reading or a pick is made, its action going on from them.
fn fits(m: &Move, card: CardIx, so_far: &Target) -> bool {
    let Move::Play { card: c, use_, target, .. } = m else { return false };
    if *c != card {
        return false;
    }
    if *so_far == Target::default() {
        return true;
    }
    matches!((use_, target), (PlayUse::Action, Some(Some(t))) if extends(t, so_far))
}

fn play_move(s: &GameState, pid: Pid, rng: Rng, profile: &str, memory: Option<&mut BotMemory>, seats: &Seats, focus: Option<(CardIx, &Target)>) -> Option<Move> {
    let me = pid as usize;
    if profile == "random" {
        return random_move(s, pid, rng);
    }
    let persona = persona_of(profile);
    let mut memory = memory;
    // A real decision (the table given), with look on: the forecast from play-outs of the round.
    let seen = match &persona {
        Some(p) if on(p.look) && seats.profiles.is_some() && s.phase == Phase::Play && s.options.round_votes => Some(vote_ahead(s, pid, &mut *rng, memory.as_deref(), seats, p.look as usize)),
        _ => None,
    };
    let goal = persona.as_ref().map(|p| choose_goal_seen(s, pid, p, memory.as_deref_mut(), &mut *rng, seen));
    let ev = |x: &GameState| evaluate(x, pid, profile, goal);
    let p = &s.players[me];
    let jitter = persona.as_ref().and_then(|x| x.noise).unwrap_or(SEARCH_NOISE);
    let draws = persona.as_ref().and_then(|x| x.draft).unwrap_or(4);
    let noise = |v: f64, rng: &mut dyn FnMut() -> f64| v + (rng() - 0.5) * jitter;
    match s.phase {
        Phase::Draft => {
            if p.picked {
                return None;
            }
            if let Some(n) = persona.as_ref().filter(|x| on(x.dplan) && seats.profiles.is_some()).map(|x| x.dplan as usize) {
                if let Some(m) = draft_by_playouts(s, pid, rng, &ev, memory.as_deref(), seats, n) {
                    return Some(m);
                }
            }
            let pool: Vec<CardIx> = p.kept.iter().chain(p.batch.iter()).copied().collect();
            let base_v = ev(s);
            let combo = persona.as_ref().is_some_and(|x| on(x.combo));
            let mut worth: Vec<(CardIx, f64)> = Vec::new();
            for &c in &pool {
                let w = if combo { combo_worth(s, pid, c, &p.kept, rng, &ev, base_v, draws) } else { card_worth(s, pid, c, rng, &ev, base_v, draws) };
                worth.push((c, noise(w, rng)));
            }
            worth.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let n = p.kept.len() + 1;
            let m = Move::Pick { keep: worth[..n.min(worth.len())].iter().map(|w| w.0).collect() };
            if legal(s, pid, &m) { Some(m) } else { None }
        }
        Phase::Growth => {
            let g = s.growing.as_ref()?;
            if g.favourites[g.next as usize % g.favourites.len()] != pid {
                return None;
            }
            let mut options: Vec<(Loc, f64)> = Vec::new();
            for l in g.due.keys() {
                let v = noise(ev(&after(s, pid, &Move::Grow { location: l })), rng);
                options.push((l, v));
            }
            options.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            Some(Move::Grow { location: options[0].0 })
        }
        Phase::Night => {
            let n = s.night.as_ref()?;
            if n.player != pid {
                return None;
            }
            let mut options: Vec<(Move, f64)> = Vec::new();
            for m in night_moves(s, n.left[0]) {
                let v = noise(ev(&after(s, pid, &m)), rng);
                options.push((m, v));
            }
            options.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            Some(options.swap_remove(0).0)
        }
        Phase::Play => {
            if s.turn != me {
                return None;
            }
            let pe = persona.clone();
            let steer_fn = |x: &GameState| ev(x);
            let steer: Option<&dyn Fn(&GameState) -> f64> = if pe.as_ref().is_some_and(|x| on(x.steer)) { Some(&steer_fn) } else { None };
            let moves = candidates(s, pid, rng, SEARCH_TARGETS, pe.as_ref().is_some_and(|x| on(x.enumerate)), pe.as_ref().is_some_and(|x| on(x.even)), steer, focus.map(|f| f.0));
            let moves: Vec<Move> = match focus {
                Some((card, so_far)) => moves.into_iter().filter(|m| fits(m, card, so_far)).collect(),
                None => moves,
            };
            let moves: Vec<Move> = if pe.as_ref().is_some_and(|x| on(x.no_pass)) && moves.iter().any(|m| *m != Move::Pass) { moves.into_iter().filter(|m| *m != Move::Pass).collect() } else { moves };
            let moves: Vec<Move> = if pe.as_ref().is_some_and(|x| on(x.stubborn)) {
                let breaking = tie_breakers(s, pid, &moves);
                if breaking.iter().any(|&b| b) { moves.into_iter().zip(breaking).filter(|x| x.1).map(|x| x.0).collect() } else { moves }
            } else { moves };
            if moves.is_empty() {
                return None;
            }
            let table = pe.as_ref().filter(|x| on(x.table)).map(|x| {
                let mut profiles = seats.profiles.clone().unwrap_or_default();
                profiles.insert(pid, profile.to_string());
                Seats { profiles: Some(profiles), memories: seats.memories.clone(), roll_list: on(x.roll_list), judge: on(x.rjudge), imit: on(x.rimit), plans: on(x.rplan) }
            });
            if let Some(x) = pe.as_ref() {
                if on(x.sim) && on(x.plan) {
                    LAST_PLAN.with(|p| p.borrow_mut().clear());
                    let picked = plan_pick(s, pid, rng, moves, &ev, memory.as_deref(), x.keep.unwrap_or(SIM_KEEP), x.plan_budget.unwrap_or(PLAN_BUDGET), x.plan_depth.unwrap_or(PLAN_DEPTH), x.playouts.unwrap_or(SIM_PLAYOUTS), table.as_ref(), on(x.tiekeep));
                    if let Some(m) = memory.as_deref_mut() {
                        m.plan = LAST_PLAN.with(|p| p.borrow().clone());
                    }
                    return picked;
                }
                if on(x.sim) {
                    return sim_pick(s, pid, rng, moves, &ev, memory.as_deref(), x.keep.unwrap_or(SIM_KEEP), x.playouts.unwrap_or(SIM_PLAYOUTS), x.mix, table.as_ref(), on(x.tiekeep));
                }
            }
            let mut best: Option<Move> = moves.first().cloned();
            let mut best_v = f64::NEG_INFINITY;
            let imitate = pe.as_ref().is_some_and(|x| on(x.imit));
            for m in moves {
                let a = after(s, pid, &m);
                let quick = ev(&a);
                let v = noise(if imitate { crate::imit::score(&a, pid, quick).unwrap_or(quick) } else { quick }, rng);
                if v > best_v {
                    best = Some(m);
                    best_v = v;
                }
            }
            best
        }
        Phase::Ended => None,
    }
}

fn seed_of(rng: Rng) -> i64 {
    (rng() * 2147483648.0).floor() as i64
}

/// Which moves leave `pid` strictly first where it was tied for the most sway at a fight already set (moves that end
/// the round are not judged: their fights are already resolved).
fn tie_breakers(s: &GameState, pid: Pid, moves: &[Move]) -> Vec<bool> {
    let tied: Vec<Loc> = crate::game::fights_due(s).into_iter().filter(|&l| {
        let sw = &s.board[l as usize].sway;
        let me = sw.get(pid);
        me > 0 && (0..s.n() as Pid).filter(|&o| o != pid).map(|o| sw.get(o)).max().unwrap_or(0) == me
    }).collect();
    if tied.is_empty() {
        return vec![false; moves.len()];
    }
    moves.iter().map(|m| {
        if *m == Move::Pass {
            return false;
        }
        let b = after(s, pid, m);
        b.round == s.round && b.phase == Phase::Play && tied.iter().any(|&l| { let sw = &b.board[l as usize].sway; let me = sw.get(pid); me > 0 && (0..b.n() as Pid).filter(|&o| o != pid).all(|o| sw.get(o) < me) })
    }).collect()
}

/// The moves to play out: the best `keep` by one-step score, Pass, and (tiekeep) every play that leaves this seat
/// strictly first where it was tied for the most sway at a fight already set.
fn shortlist(s: &GameState, pid: Pid, ranked: &[(Move, GameState, f64)], keep: usize, tiekeep: bool) -> Vec<usize> {
    let mut short: Vec<usize> = (0..keep.min(ranked.len())).collect();
    if let Some(i) = ranked.iter().position(|r| r.0 == Move::Pass) {
        if !short.contains(&i) {
            short.push(i);
        }
    }
    if tiekeep {
        let first = |g: &GameState, l: Loc| { let sw = &g.board[l as usize].sway; let me = sw.get(pid); me > 0 && (0..g.n() as Pid).filter(|&o| o != pid).all(|o| sw.get(o) < me) };
        let tied: Vec<Loc> = crate::game::fights_due(s).into_iter().filter(|&l| {
            let sw = &s.board[l as usize].sway;
            let me = sw.get(pid);
            me > 0 && (0..s.n() as Pid).filter(|&o| o != pid).map(|o| sw.get(o)).max().unwrap_or(0) == me
        }).collect();
        if !tied.is_empty() {
            for (i, r) in ranked.iter().enumerate() {
                if !short.contains(&i) && r.1.round == s.round && tied.iter().any(|&l| first(&r.1, l)) {
                    short.push(i);
                }
            }
        }
    }
    short
}

/// The play-out search (persona sim).
#[allow(clippy::too_many_arguments)]
fn sim_pick(s: &GameState, pid: Pid, rng: Rng, moves: Vec<Move>, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, keep: usize, playouts: usize, mix: f64, table: Option<&Seats>, tiekeep: bool) -> Option<Move> {
    let mut ranked: Vec<(Move, GameState, f64)> = moves.into_iter().map(|m| { let x = after(s, pid, &m); let v = ev(&x); (m, x, v) }).collect();
    ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let short = shortlist(s, pid, &ranked, keep, tiekeep);
    let seeds: Vec<i64> = (0..playouts).map(|_| seed_of(rng)).collect();
    let mut best = short.first().map(|&i| ranked[i].0.clone());
    let mut best_v = f64::NEG_INFINITY;
    let mut values: Vec<(usize, f64)> = Vec::new();
    for &i in &short {
        let mut total = 0.0;
        for &seed in &seeds {
            total += ev(&play_out_round(&ranked[i].1, seed, pid, memory, table, None));
        }
        let v = (1.0 - mix) * (total / seeds.len() as f64) + mix * ranked[i].2;
        values.push((i, v));
        if v > best_v {
            best = Some(ranked[i].0.clone());
            best_v = v;
        }
    }
    note_decision(&ranked, &values, ev(s));
    best
}

/// Hand planning (persona plan): plain play-outs for the shortlisted first moves, then (move, plan) pairs by
/// successive halving; a plan wins only if, scored again on the plain seeds, it beats the best plain move.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn plan_pick(s: &GameState, pid: Pid, rng: Rng, moves: Vec<Move>, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, keep: usize, budget: usize, depth: usize, playouts: usize, table: Option<&Seats>, tiekeep: bool) -> Option<Move> {
    let mut ranked: Vec<(Move, GameState, f64)> = moves.into_iter().map(|m| { let x = after(s, pid, &m); let v = ev(&x); (m, x, v) }).collect();
    ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let short = shortlist(s, pid, &ranked, keep, tiekeep);
    let seeds: Vec<i64> = (0..playouts).map(|_| seed_of(rng)).collect();
    let mut plain: Vec<(usize, f64)> = short.iter().map(|&i| {
        let mut n = 0.0;
        for &seed in &seeds {
            n += ev(&play_out_round(&ranked[i].1, seed, pid, memory, table, None));
        }
        (i, n / seeds.len() as f64)
    }).collect();
    plain.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    note_decision(&ranked, &plain, ev(s));
    // (index into ranked, plan)
    let mut arms: Vec<(usize, Vec<CardIx>)> = Vec::new();
    for &(i, _) in plain.iter().take(PLAN_MOVES) {
        let mut left: Vec<CardIx> = Vec::new();
        for &c in &ranked[i].1.players[pid as usize].hand {
            if !left.contains(&c) {
                left.push(c);
            }
        }
        for &a in &left {
            arms.push((i, vec![a]));
            if depth > 1 {
                for &b in &left {
                    if b != a {
                        arms.push((i, vec![a, b]));
                    }
                }
            }
        }
    }
    if arms.is_empty() {
        return plain.first().map(|&(i, _)| ranked[i].0.clone());
    }
    let (arm, _v) = halving_best(&arms, &ranked, pid, rng, ev, memory, budget, table);
    let (i, plan) = &arms[arm];
    LAST_PLAN.with(|p| *p.borrow_mut() = plan.clone());
    let mut fair = 0.0;
    for &seed in &seeds {
        fair += ev(&play_out_round(&ranked[*i].1, seed, pid, memory, table, Some(plan)));
    }
    let fair = fair / seeds.len() as f64;
    Some(if fair > plain[0].1 { ranked[*i].0.clone() } else { ranked[plain[0].0].0.clone() })
}

/// Successive halving over (move, plan) arms; the best arm and its mean value.
#[allow(clippy::too_many_arguments)]
fn halving_best(arms: &[(usize, Vec<CardIx>)], ranked: &[(Move, GameState, f64)], pid: Pid, rng: Rng, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, budget: usize, table: Option<&Seats>) -> (usize, f64) {
    let rounds = ((arms.len() as f64).log2().ceil() as usize).max(1);
    let mut seeds: Vec<i64> = Vec::new();
    // (arm, total, n)
    let mut alive: Vec<(usize, f64, usize)> = (0..arms.len()).map(|a| (a, 0.0, 0)).collect();
    for _ in 0..rounds {
        let each = ((budget as f64 / (alive.len() * rounds) as f64).floor() as usize).max(1);
        let upto = alive[0].2 + each;
        while seeds.len() < upto {
            seeds.push(seed_of(rng));
        }
        for a in alive.iter_mut() {
            while a.2 < upto {
                let (i, plan) = &arms[a.0];
                a.1 += ev(&play_out_round(&ranked[*i].1, seeds[a.2], pid, memory, table, Some(plan)));
                a.2 += 1;
            }
        }
        alive.sort_by(|x, y| (y.1 / y.2 as f64).partial_cmp(&(x.1 / x.2 as f64)).unwrap_or(std::cmp::Ordering::Equal));
        if alive.len() > 1 {
            alive.truncate(alive.len().div_ceil(2));
        }
    }
    (alive[0].0, alive[0].1 / alive[0].2 as f64)
}

/// The planned card's move in a play-out: its best play now, by the bot's own value one move ahead.
fn planned_move(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, profile: &str, memory: Option<&BotMemory>) -> Option<Move> {
    let options: Vec<Move> = candidates(s, pid, rng, SEARCH_TARGETS, true, true, None, Some(ci)).into_iter().filter(|m| matches!(m, Move::Play { card, .. } if *card == ci)).collect();
    let goal = memory.and_then(|m| m.goal);
    let mut best = None;
    let mut best_v = f64::NEG_INFINITY;
    for m in options {
        let v = evaluate(&after(s, pid, &m), pid, profile, goal);
        if v > best_v {
            best = Some(m);
            best_v = v;
        }
    }
    best
}

/// Fast bots play from here to the end of this round's play: each seat's own profile (persona table) or ROLLOUT.
// PERF: every move asks every seat before the one to act for its move, and each of those runs choose_goal (a full
// projection) before seeing it isn't their turn; kept for now because it sets their goals and draws their jitter.
fn play_out_round(state: &GameState, seed: i64, pid: Pid, memory: Option<&BotMemory>, table: Option<&Seats>, plan: Option<&Vec<CardIx>>) -> GameState {
    let plans = table.is_some_and(|t| t.plans);
    let mut todos: Vec<Vec<CardIx>> = (0..state.n()).map(|id| {
        if id == pid as usize {
            plan.cloned().unwrap_or_default()
        } else if plans {
            table.and_then(|t| t.memories.as_ref()).and_then(|m| m.get(&(id as Pid))).map(|m| m.plan.clone()).unwrap_or_default()
        } else {
            Vec::new()
        }
    }).collect();
    let mut x = seed as i32;
    let mut r = move || {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        (x as u32) as f64 / 4294967296.0
    };
    let n = state.n();
    let mut mem: Vec<BotMemory> = (0..n).map(|id| {
        if id == pid as usize {
            if let Some(m) = memory {
                return m.clone();
            }
        }
        table.and_then(|t| t.memories.as_ref()).and_then(|m| m.get(&(id as Pid))).cloned().unwrap_or_default()
    }).collect();
    let mut s = imagined(state);
    let round = s.round;
    let profiles: Vec<String> = (0..n).map(|id| match table.and_then(|t| t.profiles.as_ref()).and_then(|p| p.get(&(id as Pid))) {
        Some(p) if table.is_some_and(|t| t.roll_list) => listing(p),
        Some(p) => fast(p),
        None => ROLLOUT.to_string(),
    }).map(|p| if table.is_some_and(|t| t.judge) && persona_of(&p).is_some() { format!("{p},judge=1") } else { p })
        .map(|p| if table.is_some_and(|t| t.imit) && persona_of(&p).is_some() { format!("{p},imit=1") } else { p }).collect();
    let mut moves = 0;
    // On through nightfall and growth to the round's end (2026-11-04: play-outs had stopped at nightfall, before the
    // fights and the vote, whenever a location was marked).
    while moves < SIM_MAX_MOVES && s.round == round && matches!(s.phase, Phase::Play | Phase::Night | Phase::Growth) {
        moves += 1;
        let mut moved = false;
        for id in 0..n as Pid {
            let profile = &profiles[id as usize];
            let mut m: Option<Move> = None;
            let todo = &mut todos[id as usize];
            if !todo.is_empty() && s.phase == Phase::Play && s.turn == id as usize {
                while !todo.is_empty() && m.is_none() {
                    let c = todo.remove(0);
                    if s.players[id as usize].hand.contains(&c) {
                        m = planned_move(&s, id, c, &mut r, profile, Some(&mem[id as usize]));
                    }
                }
                if let Some(planned) = m.clone() {
                    let own = play_move(&s, id, &mut r, profile, Some(&mut mem[id as usize]), &Seats::default(), None);
                    let goal = mem[id as usize].goal;
                    let v = |x: &Move| evaluate(&after(&s, id, x), id, profile, goal);
                    if let Some(own) = own {
                        if matches!(own, Move::Play { .. }) && v(&own) > v(&planned) {
                            if let Move::Play { card, .. } = planned {
                                todo.insert(0, card);
                            }
                            m = Some(own);
                        }
                    }
                }
            }
            if m.is_none() {
                m = play_move(&s, id, &mut r, profile, Some(&mut mem[id as usize]), &Seats::default(), None);
            }
            let Some(m) = m else { continue };
            s = after(&s, id, &m);
            moved = true;
            break;
        }
        if !moved {
            break;
        }
    }
    s
}

/// Play-out values of moves as this seat's full bot would score them, on given seeds (for measuring play-out noise):
/// each move's state after it, played out to the round's end once per seed, scored and averaged.
pub fn playout_values(s: &GameState, pid: Pid, profile: &str, memory: Option<&BotMemory>, seats: &Seats, moves: &[Move], seeds: &[i64]) -> Vec<f64> {
    let goal = memory.and_then(|m| m.goal);
    let mut profiles = seats.profiles.clone().unwrap_or_default();
    profiles.insert(pid, profile.to_string());
    let pe = persona_of(profile);
    let table = Seats { profiles: Some(profiles), memories: seats.memories.clone(), roll_list: pe.as_ref().is_some_and(|x| on(x.roll_list)), judge: pe.as_ref().is_some_and(|x| on(x.rjudge)), imit: pe.as_ref().is_some_and(|x| on(x.rimit)), plans: pe.as_ref().is_some_and(|x| on(x.rplan)) };
    moves.iter().map(|m| {
        let a = after(s, pid, m);
        seeds.iter().map(|&seed| evaluate(&play_out_round(&a, seed, pid, memory, Some(&table), None), pid, profile, goal)).sum::<f64>() / seeds.len() as f64
    }).collect()
}

/// What the quick (play-out) bot would play here, for measuring how well it stands in for this seat's real bot.
pub fn quick_move(s: &GameState, pid: Pid, rng: Rng, profile: &str, memory: Option<&mut BotMemory>) -> Option<Move> {
    play_move(s, pid, rng, &fast(profile), memory, &Seats::default(), None)
}

/// One imagined round from here, as a full bot's play-outs play it (for measuring them).
pub fn imagine_round(s: &GameState, seed: i64, pid: Pid, memory: Option<&BotMemory>, table: &Seats) -> GameState {
    play_out_round(s, seed, pid, memory, Some(table), None)
}

/// The draft by play-outs (persona dplan): keep the cards already kept and add the batch card whose hand plays the
/// round best: the rest of the draft picked by every seat's own (fast) bot, then the round played out to its vote.
fn draft_by_playouts(s: &GameState, pid: Pid, rng: Rng, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, seats: &Seats, n: usize) -> Option<Move> {
    let me = pid as usize;
    let p = &s.players[me];
    let mut cands: Vec<CardIx> = Vec::new();
    for &c in &p.batch {
        if !cands.contains(&c) {
            cands.push(c);
        }
    }
    if cands.len() < 2 {
        return None;
    }
    let profiles: Vec<String> = (0..s.n()).map(|id| seats.profiles.as_ref().and_then(|t| t.get(&(id as Pid))).map(|x| fast(x)).unwrap_or_else(|| ROLLOUT.to_string())).collect();
    let mems: Vec<BotMemory> = (0..s.n()).map(|id| if id == me { memory.cloned().unwrap_or_default() } else { seats.memories.as_ref().and_then(|m| m.get(&(id as Pid))).cloned().unwrap_or_default() }).collect();
    let mut best: Option<(Move, f64)> = None;
    for &c in &cands {
        let mut keep: Vec<CardIx> = p.kept.iter().copied().collect();
        keep.push(c);
        let m = Move::Pick { keep };
        if !legal(s, pid, &m) {
            continue;
        }
        let mut total = 0.0;
        for _ in 0..n {
            let mut x = after(s, pid, &m);
            let mut mem = mems.clone();
            // The rest of the draft, every seat by its own fast bot.
            let mut guard = 0;
            while x.phase == Phase::Draft && guard < 200 {
                guard += 1;
                let Some(id) = (0..x.n()).find(|&i| !x.players[i].picked) else { break };
                let Some(mv) = play_move(&x, id as Pid, &mut *rng, &profiles[id], Some(&mut mem[id]), &Seats::default(), None) else { break };
                x = after(&x, id as Pid, &mv);
            }
            if x.phase != Phase::Play {
                total += ev(&x);
                continue;
            }
            let end = play_out_round(&x, seed_of(rng), pid, Some(&mem[me]), Some(seats), None);
            total += ev(&end);
        }
        let v = total / n as f64;
        if best.as_ref().is_none_or(|b| v > b.1) {
            best = Some((m, v));
        }
    }
    best.map(|b| b.0)
}

/// How much a card adds, played as well as the bot can find right now (the draft's rough worth).
fn card_worth(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, ev: &dyn Fn(&GameState) -> f64, base_v: f64, draws: usize) -> f64 {
    let c = card(ci);
    let mut x = imagined(s);
    x.phase = Phase::Play;
    x.turn = pid as usize;
    x.opened = true;
    x.players[pid as usize].hand = Hand::from_slice(&[ci]);
    let mut best: f64 = 0.0;
    let infl = spend(ci);
    if c.suit.is_some() && legal(&x, pid, &infl) {
        best = best.max(ev(&after(&x, pid, &infl)) - base_v);
    }
    if c.suit.is_none() && s.options.unsuited_sway != 0 {
        for f in 0..x.factions.len() as Fac {
            let m = spend_on(ci, f);
            if legal(&x, pid, &m) {
                best = best.max(ev(&after(&x, pid, &m)) - base_v);
            }
        }
    }
    for _ in 0..draws {
        let Some(t) = sample_target(&x, pid, ci, rng) else { continue };
        let m = action(ci, Some(t));
        if !legal(&x, pid, &m) {
            continue;
        }
        best = best.max(ev(&after(&x, pid, &m)) - base_v);
    }
    best
}

/// In the draft (persona combo): a card's worth with the cards already kept.
fn combo_worth(s: &GameState, pid: Pid, ci: CardIx, kept: &[CardIx], rng: Rng, ev: &dyn Fn(&GameState) -> f64, base_v: f64, draws: usize) -> f64 {
    let mut best = card_worth(s, pid, ci, rng, ev, base_v, draws);
    for &k in kept.iter().filter(|&&k| k != ci) {
        let mut x = imagined(s);
        x.phase = Phase::Play;
        x.turn = pid as usize;
        x.opened = true;
        x.players[pid as usize].hand = Hand::from_slice(&[k, ci]);
        let firsts = best_plays(&x, pid, k, rng, ev, draws);
        if firsts.is_empty() {
            continue;
        }
        let alone = firsts[0].1;
        for f in firsts.iter().take(2) {
            let mut x2 = f.0.clone();
            x2.phase = Phase::Play;
            x2.turn = pid as usize;
            let seconds = best_plays(&x2, pid, ci, rng, ev, draws);
            if let Some(sec) = seconds.first() {
                best = best.max(sec.1 - alone);
            }
        }
    }
    best
}

/// A card's best few plays for its action, best first.
fn best_plays(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, ev: &dyn Fn(&GameState) -> f64, draws: usize) -> Vec<(GameState, f64)> {
    let mut out = Vec::new();
    for _ in 0..draws {
        let Some(t) = sample_target(s, pid, ci, rng) else { continue };
        let m = action(ci, Some(t));
        if !legal(s, pid, &m) {
            continue;
        }
        let a = after(s, pid, &m);
        let v = ev(&a);
        out.push((a, v));
    }
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Night Terrors' nightfall: every choice at one mark.
fn night_moves(s: &GameState, loc: Loc) -> Vec<Move> {
    let mut out = vec![Move::Flee { location: loc, faction: None, to: None, follow: None }];
    for (f, tos) in flee_options(s, loc) {
        for to in tos {
            for follow in [false, true] {
                out.push(Move::Flee { location: loc, faction: Some(f), to: Some(to), follow: Some(follow) });
            }
        }
    }
    let owner = s.night.as_ref().map(|n| n.player).unwrap_or(0);
    out.into_iter().filter(|m| !matches!(m, Move::Flee { follow: Some(true), .. }) || s.board[loc as usize].sway.get(owner) > 0).collect()
}

/// The deck's cards (for callers that need the list).
pub fn all_cards() -> usize {
    spec().cards.len()
}

/// A hint's ranking (rankForHint): the seat's goal, then its options ranked by their worth one move ahead, with no
/// noise and no play-outs (play-outs would play rivals' hidden hands). Draft: each card in the pool by its best play's
/// worth now. Growth and nightfall: each choice the seat may make. `memory` keeps the goal between hints.
pub struct HintRanking {
    pub goal: Goal,
    pub moves: Vec<(Move, GameState, f64)>,
    pub worth: Vec<(CardIx, f64)>,
}

pub fn rank_for_hint(s: &GameState, pid: Pid, memory: &mut BotMemory, profile: &str) -> HintRanking {
    // The hint's own fixed sequence (an LCG), so the same position always gets the same hint.
    let mut x: i32 = 12345;
    let mut r = move || {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        (x as u32) as f64 / 4294967296.0
    };
    let rng: Rng = &mut r;
    let persona = persona_of(profile).unwrap_or_else(|| at_lean(-0.3));
    if memory.jitter.is_none() {
        memory.jitter = Some(0.0); // no random lean in a hint
    }
    let goal = choose_goal(s, pid, &persona, Some(memory), rng);
    let ev = |x: &GameState| evaluate(x, pid, profile, Some(goal));
    let base_v = ev(s);
    let p = &s.players[pid as usize];
    let mut moves: Vec<(Move, GameState, f64)> = Vec::new();
    let mut worth: Vec<(CardIx, f64)> = Vec::new();
    let played = |m: Move| {
        let x = apply_move(s, pid, &m).expect("a hint's move is legal");
        let v = ev(&x);
        (m, x, v)
    };
    match s.phase {
        Phase::Draft if !p.picked => {
            let pool: Vec<CardIx> = p.kept.iter().chain(p.batch.iter()).copied().collect();
            worth = pool.into_iter().map(|c| (c, card_worth(s, pid, c, rng, &ev, base_v, 4))).collect();
            worth.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        }
        Phase::Growth => {
            if let Some(g) = &s.growing {
                if g.favourites[g.next as usize % g.favourites.len()] == pid {
                    moves = g.due.iter().map(|(l, _)| played(Move::Grow { location: l })).collect();
                }
            }
        }
        Phase::Night => {
            if let Some(n) = &s.night {
                if n.player == pid {
                    moves = night_moves(s, n.left[0]).into_iter().map(played).collect();
                }
            }
        }
        Phase::Play if s.turn == pid as usize => {
            moves = candidates(s, pid, rng, SEARCH_TARGETS, true, false, None, None).into_iter().map(|m| {
                let x = after(s, pid, &m);
                let v = ev(&x);
                (m, x, v)
            }).collect();
        }
        _ => {}
    }
    moves.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    HintRanking { goal, moves, worth }
}

/// A state after a move played straight through (for hints: afterMove).
pub fn after_move(s: &GameState, pid: Pid, m: &Move) -> GameState {
    after(s, pid, m)
}

/// A seat's position as numbers (features), for fitting the evaluation to how games end; tournament logs record it at
/// the start of each round's play. A measuring tool: the bots don't read it. In the JavaScript's key order.
pub fn features(s0: &GameState, pid: Pid) -> Vec<(&'static str, f64)> {
    let c = win_chances(s0, pid);
    let s = project_fights(s0);
    let p = &s.players[pid as usize];
    let n = s.factions.len();
    let mut t: Vec<i32> = (0..n).map(|f| p.trophies[f]).collect();
    t.sort();
    let others: Vec<usize> = (0..s.players.len()).filter(|&i| i != pid as usize).collect();
    let net = |i: usize, f: usize| (s.players[i].standing[f] - s.players[i].trophies[f]) as f64;
    let presence: Vec<i32> = (0..n).map(|f| presence_of(&s, f as Fac)).collect();
    let top_n = *presence.iter().max().unwrap();
    let top = presence.iter().position(|&x| x == top_n).unwrap();
    let best_other = |f: usize| others.iter().map(|&o| net(o, f)).fold(f64::NEG_INFINITY, f64::max);
    let r3 = |x: f64| (x * 1000.0 + 0.5).floor() / 1000.0; // Math.round(x * 1000) / 1000
    let raw: Vec<(&'static str, f64)> = vec![
        ("pInvaders", c.p_invaders),
        ("invWin", c.p_invaders * c.as_invaders),
        ("islWin", (1.0 - c.p_invaders) * c.as_island),
        ("rivalWin", c.p_invaders * c.rival_invaders),
        ("asInvaders", c.as_invaders),
        ("asIsland", c.as_island),
        ("marginIsland", c.margin_island),
        ("marginInvaders", c.margin_invaders),
        ("rivalInvaders", c.rival_invaders),
        ("linearIsland", c.linear_island),
        ("roundsLeft", c.rounds_left),
        ("projected", c.projected - c.threshold),
        ("weakest", t[0] as f64),
        ("second", t[1] as f64),
        ("third", t[2] as f64),
        ("trophies", t.iter().sum::<i32>() as f64),
        ("leadTop", net(pid as usize, top) - best_other(top)),
        ("bestLead", (0..n).map(|f| net(pid as usize, f) - best_other(f)).fold(f64::NEG_INFINITY, f64::max)),
        ("standing", (0..n).map(|f| p.standing[f]).sum::<i32>() as f64),
        ("supply", p.supply as f64),
        ("hand", s0.players[pid as usize].hand.len() as f64),
        ("onBoard", s.board.iter().map(|pl| pl.sway.get(pid)).sum::<i32>() as f64),
        ("access", set_access(s0, pid)),
    ];
    raw.into_iter().map(|(k, v)| (k, r3(v))).collect()
}

/// A table's leans for its bot seats (designer, 2026-10-29): always fewer leaning to back a faction than to the
/// island. Balanced: the backing ones evenly between +0.15 and +0.3, the rest evenly from -0.3 to -0.1; random: the same
/// leans in a shuffled order (`shuffle` gives the order).
pub fn table_leans(bots: usize) -> Vec<f64> {
    let backing = bots.saturating_sub(1) / 2;
    let island = bots - backing;
    let spread = |n: usize, a: f64, b: f64| -> Vec<f64> { if n == 1 { vec![a] } else { (0..n).map(|i| a + (b - a) * i as f64 / (n - 1) as f64).collect() } };
    let mut out = spread(island, -0.3, -0.1);
    out.extend(spread(backing, 0.3, 0.15).into_iter().rev());
    out.iter().map(|x| (x * 1000.0).round() / 1000.0).collect()
}
