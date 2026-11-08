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
    /// A hedging bot's break-glass commitment (persona glass; testing): once set, its goal for the rest of the game,
    /// played without hedging.
    pub broke: Option<Goal>,
    /// A hedger's draw for being a gut player (persona gut), made once a game: 0 to 1.
    pub early: Option<f64>,
    /// The seat's dials for this game (nerve, loyalty, sharpness, then the irrational draw and its timing), drawn once.
    pub traits: Vec<f64>,
    /// The seat's last reading of the votes from play-outs of the round (end_read): its round, this round's vote
    /// presence, and each later round's change. Play-outs and the draft read the votes from it within that round.
    pub read: Option<[f64; 3]>,
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
    /// Testing (persona rjudge): every seat in the play-outs judges with the learned judge.
    pub judge: bool,
    /// Persona rplan (default on, designer 2026-11-04): every seat in the play-outs follows its own remembered hand
    /// plan, not only the deciding seat (100 games, seat 5: 30.0% vs 27.3%).
    pub plans: bool,
}

const SEARCH_TARGETS: usize = 8;
const SEARCH_NOISE: f64 = 0.15;
const LIST_CAP: usize = 40;
const SIM_KEEP: usize = 8;
const SIM_PLAYOUTS: usize = 6;
/// Rounds as votes (designer, 2026-11-05: bots never consider opening presence, only potential end-of-round presence,
/// with no constants from past tests): play-outs of the round giving the goal choice's vote reading at a real decision.
const END_READ_PLAYOUTS: usize = 4;
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
    pub commit: f64,
    pub protect: f64,
    pub top: f64,
    pub race: f64,
    /// Search sizes, for testing (unset: SIM_KEEP, SIM_PLAYOUTS, PLAN_BUDGET, PLAN_DEPTH).
    pub keep: Option<usize>,
    pub playouts: Option<usize>,
    pub plan_budget: Option<usize>,
    pub plan_depth: Option<usize>,
    /// Testing: the jitter on one-step values (unset: SEARCH_NOISE); the draft's sampled plays per card (unset: 4).
    pub noise: Option<f64>,
    pub draft: Option<usize>,
    /// The learned judge (judge.rs, `npm run judge`) in place of the hand formula's chances (0: the hand formula).
    pub judge: f64,
    /// The play-out bots (every seat) judge with the learned judge too (designer, 2026-11-03: no quick-and-dirty play-outs).
    pub rjudge: f64,
    /// Testing (designer, 2026-11-04: a hedging bot keeps its options open, building trophies all game; backing a
    /// faction early doesn't pay): the island half of the value counts in full from the start and the invaders' half is
    /// phased in by a ramp (0 through round 3, rising through round 4), so the bot pivots late if the board tips. 0: off.
    pub hedge: f64,
    /// Testing, with hedge (designer, 2026-11-04: a hedging bot can still loosely back and protect a single faction):
    /// the weight on guarding the faction it backs most (its largest standing lead), whatever its goal: a quarter of
    /// it early, rising with the ramp to all of it (designer: early protection is fine but worth little; trophies first).
    pub hguard: f64,
    /// Testing, with hedge (designer, 2026-11-04: break glass; once a hedger commits it no longer hedges at all; only
    /// round 5's evidence is enough for a full commit): from round glass_from (5), when one ending holds this share of the bot's winning chances (chance of the ending × its
    /// chance of winning under it), the bot commits to it for good. 0: never.
    pub glass: f64,
    pub glass_from: f64,
    /// Testing (designer, 2026-11-05: under votes the invaders have to win votes, in rounds 2–3, to have a shot): the
    /// round through which a hedger's invaders' half phases in (unset: the last but one); 1: in full from round 2.
    pub hfrom: f64,
    /// Testing (designer: some players are irrational): the chance a game's hedger is a gut player, who commits in
    /// round 2 or 3 to the ending it leans to then, whatever the evidence.
    pub gut: f64,
    /// One bot with dials (designer, 2026-11-05; the default since 2026-11-06, `dials=0` for the steady bot): hedging on a spectrum, set by four dials,
    /// each 0 to 1, drawn each game within `vary` of its set value. Lean stays the ending it starts out preferring.
    /// nerve: the evidence it needs to commit for good (low: early, on gut; high: keeps hedging); loyalty: how hard it
    /// guards and pushes the faction it backs; sharp: how carefully it plays (search noise, turns on instinct).
    /// The lean centres nerve and loyalty (0.5 less and 0.5 plus the lean): a backer commits early and guards hard.
    pub dials: f64,
    pub nerve: f64,
    pub loyalty: f64,
    pub sharp: f64,
    pub vary: f64,
}

/// The one bot (designer, 2026-10-29): its lean slides it from the island-minded settings (lean -0.3, the old trophy
/// bot) to the faction-backing ones (+0.3, the old backer), the backer's habits growing with the lean; beyond those
/// ends the habits stay as at the end.
pub fn at_lean(lean: f64) -> Persona {
    let t = ((lean + 0.3) / 0.6).clamp(0.0, 1.0);
    let mix = |a: f64, b: f64| if t == 0.0 { a } else if t == 1.0 { b } else { a + (b - a) * t };
    Persona {
        lean, jitter: 0.15, hold: 0.05, push: 2.0, margin: 3.0, linear: 1.0, threat: mix(3.0, 1.0), enumerate: 1.0, sim: 1.0, combo: 1.0, sets: 2.0,
        commit: mix(0.0, 2.0), protect: mix(0.0, 4.0), top: mix(0.0, 2.0),
        race: mix(0.0, 2.0), keep: Some(mix(12.0, SIM_KEEP as f64).round() as usize), playouts: None, plan_budget: None, plan_depth: None,
        noise: Some(mix(0.0, SEARCH_NOISE)), draft: None, judge: 0.0, rjudge: 0.0, hedge: 0.0, hguard: 0.5, glass: 0.0, glass_from: 5.0, hfrom: 0.0, gut: 0.0, dials: 1.0, nerve: (0.5 - lean).clamp(0.0, 1.0), loyalty: (0.5 + lean).clamp(0.0, 1.0), sharp: 0.8, vary: 0.25,
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
                "commit" => p.commit = x,
                "protect" => p.protect = x,
                "top" => p.top = x,
                "race" => p.race = x,
                "keep" => p.keep = Some(x as usize),
                "playouts" => p.playouts = Some(x as usize),
                "planBudget" => p.plan_budget = Some(x as usize),
                "planDepth" => p.plan_depth = Some(x as usize),
                "noise" => p.noise = Some(x),
                "draft" => p.draft = Some(x as usize),
                "hedge" => p.hedge = x,
                "hguard" => p.hguard = x,
                "glass" => p.glass = x,
                "glassFrom" => p.glass_from = x,
                "hfrom" => p.hfrom = x,
                "gut" => p.gut = x,
                "dials" => p.dials = x,
                "nerve" => p.nerve = x,
                "loyalty" => p.loyalty = x,
                "sharp" => p.sharp = x,
                "vary" => p.vary = x,
                "judge" => p.judge = x,
                "rjudge" => p.rjudge = x,
                _ => {}
            }
        }
    }
    Some(p)
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
fn project_fights_cached(s: &GameState) -> std::rc::Rc<GameState> {
    // A few recent projections, by the position's content (the board, players and supply, the round and phase, the
    // options): every seat asks about the same position in a play-out before one of them moves.
    thread_local! {
        // Shared, not copied: a hit hands out the projection itself (2026-11-05: copying whole states out of here, and
        // shifting the list on each new entry, was a fifth of the bots' time once the end-of-round reading asked twice).
        // Each entry keeps only what a hit is confirmed by (not a copy of the whole position).
        static CACHE: std::cell::RefCell<std::collections::VecDeque<(u64, Seen, std::rc::Rc<GameState>)>> = const { std::cell::RefCell::new(std::collections::VecDeque::new()) };
    }
    struct Seen {
        board: [crate::types::Place; crate::types::NLOC],
        players: Vec<crate::types::Player>,
        supply: [i32; 5],
        round: i32,
        phase: Phase,
        options: std::rc::Rc<Options>,
    }
    let same = |a: &Seen, b: &GameState| a.board == b.board && a.players == b.players && a.supply == b.supply && a.round == b.round && a.phase == b.phase && std::rc::Rc::ptr_eq(&a.options, &b.options);
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
    // A miss projects with the per-fight memo (project_fights), not from scratch.
    let out = std::rc::Rc::new(project_fights(s));
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= 8 {
            c.pop_front();
        }
        c.push_back((key, Seen { board: s.board, players: s.players.clone(), supply: s.supply, round: s.round, phase: s.phase, options: s.options.clone() }, out.clone()));
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
    chances_after(&*project_fights_cached(s), pid)
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
    (*project_fights_cached(s)).clone()
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
fn invaders_reach(s: &GameState, projected: f64, threshold: f64, spread_p: f64, push: f64) -> f64 {
    invaders_reach_by(s, projected, threshold, spread_p, push, 0.0)
}

/// The share of the round's cards still in hand (1 outside the play phase).
fn round_left(s: &GameState) -> f64 {
    if s.phase != Phase::Play {
        return 1.0;
    }
    let full = (spec().hand_size[s.n()] * s.n()) as f64;
    let held: usize = s.players.iter().map(|p| p.hand.len()).sum();
    if full > 0.0 { (held as f64 / full).min(1.0) } else { 0.0 }
}

#[allow(clippy::too_many_arguments)]
/// `trend`: each later vote's change on this one's (end_read).
fn invaders_reach_by(s: &GameState, projected: f64, threshold: f64, spread_p: f64, push: f64, trend: f64) -> f64 {
    if !s.options.round_votes {
        return sigmoid((projected - threshold - 0.5 + push) / spread_p);
    }
    // Rounds closed so far (each vote 1 until the last round, which ends the game); the last round left may count more.
    let closed = s.options.rounds_closed(s.votes[0] + s.votes[1], s.round);
    let left = (s.options.rounds - closed).max(0) as usize;
    let need = (s.options.votes_total() / 2 + 1 - s.votes[0]).max(0) as usize;
    let most = (s.options.votes_total() - closed).max(0) as usize;
    let mut dp = vec![0.0f64; most + 1];
    dp[0] = 1.0;
    for k in 0..left {
        let w = s.options.vote_weight(closed + 1 + k as i32) as usize;
        let shift = push;
        let ahead = trend * k as f64;
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
    let n_f = 5usize;
    let presence: Vec<f64> = (0..5).map(|f| presence_of(s, f) as f64).collect();
    let mut total = 0.0;
    for p in &presence {
        total += p;
    }
    let projected = total;
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
    let p_invaders = (1.0 - known) * prior + known * invaders_reach(s, projected, threshold, spread_p, 0.0);
    Chances { pid, p_invaders, prior, known, settled, backers, linear_island, rival_invaders, as_invaders, as_island, margin_invaders, margin_island, projected, threshold, spread_p, rounds_left }
}

/// How good a position is for `pid` (evaluate).
pub fn evaluate(s: &GameState, pid: Pid, profile: &str, goal: Option<Goal>) -> f64 {
    let persona = persona_of(profile).unwrap_or_else(|| at_lean(-0.3));
    goal_value(s, pid, goal.unwrap_or(Goal::Island), &persona)
}

fn goal_value(s: &GameState, pid: Pid, goal: Goal, p: &Persona) -> f64 {
    // One projection for the chances and the vote reading (looked up once: confirming a hit compares whole states).
    let proj = project_fights_cached(s);
    let mut c = chances_after(&proj, pid);
    end_read_into(s, &mut c, &proj);
    if on(p.judge) {
        if let Some(w) = crate::judge::weights() {
            // The chance of winning, whichever ending comes: what a bot playing to win values.
            let (pi, wi, ws) = crate::judge::judge_with(s, &c, w);
            return 10.0 * (pi * wi + (1.0 - pi) * ws) + SUPPLY_VALUE * s.players[pid as usize].supply as f64;
        }
    }
    if on(p.hedge) {
        let r = hedge_ramp(s, p);
        let pi = r * c.p_invaders;
        let inv = pi * 10.0 * c.as_invaders + r * p.margin * c.margin_invaders;
        let isl = (1.0 - pi) * 10.0 * c.as_island + p.linear * 10.0 * c.linear_island + if on(p.sets) { p.sets * (1.0 - pi) * set_access(s, pid) } else { 0.0 };
        let full = if on(p.protect) && goal == Goal::Invaders { r * p.protect } else { 0.0 };
        let guard = if on(p.hguard) || full > 0.0 { (p.hguard * (0.25 + 0.75 * r) + full) * presence_guard(s, pid, &c, p) } else { 0.0 };
        let threat = p.threat * 10.0 * c.p_invaders * c.rival_invaders;
        return inv + isl + guard - threat + SUPPLY_VALUE * s.players[pid as usize].supply as f64;
    }
    let inv = c.p_invaders * 10.0 * c.as_invaders + p.margin * c.margin_invaders;
    let island_margin = p.linear * 10.0 * c.linear_island;
    let isl = (1.0 - c.p_invaders) * 10.0 * c.as_island + island_margin;
    let threat = p.threat * 10.0 * c.p_invaders * c.rival_invaders;
    let guard = if on(p.protect) && goal == Goal::Invaders { p.protect * presence_guard(s, pid, &c, p) } else { 0.0 };
    let main = if goal == Goal::Invaders { inv + guard } else { isl + if on(p.sets) { p.sets * (1.0 - c.p_invaders) * set_access(s, pid) } else { 0.0 } };
    main - threat + SUPPLY_VALUE * s.players[pid as usize].supply as f64
}

/// The chance of the invaders' ending as this seat reads it (end_read), for measuring the
/// forecast's calibration (the round logs' pForecast).
pub fn forecast(s: &GameState, pid: Pid) -> f64 {
    let proj = project_fights_cached(s);
    let mut c = chances_after(&proj, pid);
    end_read_into(s, &mut c, &proj);
    c.p_invaders
}

/// Under votes, each vote read at its end-of-round presence (end_read): the chance of the invaders' ending from it.
fn end_read_into(s: &GameState, c: &mut Chances, proj: &GameState) {
    if s.options.round_votes {
        let (after, t) = end_read_at(s, || crate::board::total_presence(proj) as f64);
        c.projected = after;
        c.p_invaders = invaders_reach_by(s, after, c.threshold, c.spread_p, 0.0, t);
    }
}

/// The hedging bot's ramp (persona hedge): how much of the invaders' half of the value counts, 0 to 1.
/// Designer (2026-11-04): the evidence means nothing at the start and isn't trustworthy in rounds 2 and 3; the ramp is
/// 0 until round `from` begins, rises through that round as its cards are played, and is 1 after (unset: round 3 of 5).
/// The designer withdrew the rounds 2–3 part (2026-11-05); hfrom=1 phases it in through round 1, full from round 2.
fn hedge_ramp(s: &GameState, p: &Persona) -> f64 {
    let from = if on(p.hfrom) { p.hfrom } else { (s.options.rounds - 2).max(1) as f64 };
    let at = (s.round - 1) as f64 + (1.0 - round_left(s));
    (at - (from - 1.0)).clamp(0.0, 1.0)
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

/// A position's round as it stands: the presence after its fights (this round's vote), and the change per later round
/// (the nightfall tokens after those fights, less those fights' losses), from the game itself.
pub fn round_flow(s: &GameState) -> (f64, f64) {
    let p = project_fights_cached(s);
    let after = crate::board::total_presence(&p) as f64;
    (after, round_change(s, &p, after))
}

/// This round's vote presence alone (round_flow without the change per round).
fn round_after(s: &GameState) -> f64 {
    crate::board::total_presence(&project_fights_cached(s)) as f64
}

fn round_change(s: &GameState, p: &GameState, after: f64) -> f64 {
    let losses = crate::board::total_presence(s) as f64 - after;
    let fought: Vec<bool> = {
        let due = fights_due(s);
        (0..s.board.len() as Loc).map(|l| due.contains(&l)).collect()
    };
    let grows = if s.options.nightfall { crate::game::nightfall_due(p, &fought).iter().map(|x| x.1).sum::<i32>() as f64 } else { 0.0 };
    grows - losses
}

/// The end-of-round reading of a position (persona endread), from the game itself. Mid-round: the fights as they stand
/// (round_flow). At a round's start, after a close (a play-out's end, where the bots score their moves), the board holds
/// no fights yet: this round's vote is read as today's presence less the last close's fight losses, and each later
/// round's change as the last close's nightfall tokens less its fight losses.
fn end_read(s: &GameState) -> (f64, f64) {
    end_read_at(s, || round_after(s))
}

/// end_read, given this round's after-fights presence (`after_fights`, asked only when needed).
fn end_read_at(s: &GameState, after_fights: impl FnOnce() -> f64) -> (f64, f64) {
    match s.last_close {
        Some([r, before, after, brought]) if r == s.round - 1 && s.round_plays.is_empty() => {
            let losses = (before - after) as f64;
            (crate::board::total_presence(s) as f64 - losses, brought as f64 - losses)
        }
        Some([r, before, after, brought]) if r == s.round - 1 => {
            (after_fights(), (brought - (before - after)) as f64)
        }
        // No close yet (round 1): this round's fights as they stand; no later change can be read from the game yet
        // (mid-round, the nightfall to come counts sway at locations whose fights haven't formed).
        _ => (after_fights(), 0.0),
    }
}

/// The round played out `n` times from here by every seat's own bot: its end-of-round reading (round_flow), on average.
pub fn flow_ahead(s: &GameState, pid: Pid, rng: Rng, memory: Option<&BotMemory>, seats: &Seats, n: usize) -> (f64, f64) {
    let (mut a, mut t) = (0.0, 0.0);
    for _ in 0..n {
        // The play-out runs on through the round's close (fights, vote, nightfall): read the close itself.
        let end = play_out_round(s, seed_of(rng), pid, memory, Some(seats), None);
        match end.last_close {
            Some([r, before, after, brought]) if r == s.round => {
                a += after as f64;
                t += (brought - (before - after)) as f64;
            }
            _ => {
                let (x, y) = round_flow(&end);
                a += x;
                t += y;
            }
        }
    }
    let k = n.max(1) as f64;
    (a / k, t / k)
}

/// `seen`: this round's vote presence and each later vote's change, read from play-outs of the round (flow_ahead);
/// without them, from the position (end_read).
fn choose_goal_seen(s: &GameState, pid: Pid, p: &Persona, memory: Option<&mut BotMemory>, rng: Rng, seen: Option<(f64, f64)>) -> Goal {
    let mut c = win_chances_shared(s, pid);
    let remembered = memory.as_deref().and_then(|m| m.read).filter(|r| r[0] as i32 == s.round && s.last_close.is_none_or(|lc| lc[0] < s.round)).map(|r| (r[1], r[2]));
    let (now, trend) = seen.or(remembered).unwrap_or_else(|| end_read(s));
    if s.options.round_votes {
        c.projected = now;
        c.p_invaders = invaders_reach_by(s, now, c.threshold, c.spread_p, 0.0, trend);
    }
    let mut memory = memory;
    let mut gut_now = false;
    if on(p.hedge) && on(p.glass) {
        if let Some(g) = memory.as_deref().and_then(|m| m.broke) {
            return g;
        }
        if on(p.gut) {
            if let Some(m) = memory.as_deref_mut() {
                if m.early.is_none() {
                    m.early = Some(rng());
                }
            }
            let e = memory.as_deref().and_then(|m| m.early).unwrap_or(1.0);
            if e < p.gut {
                // A gut player: commits in round 2 or 3 on its leaning (lean and jitter), not on the evidence.
                gut_now = s.round as f64 >= if e < p.gut / 2.0 { 2.0 } else { 3.0 };
            }
        }
        let (from, glass) = (p.glass_from, p.glass);
        if !gut_now && s.round as f64 >= from {
            let (ei, es) = (c.p_invaders * c.as_invaders, (1.0 - c.p_invaders) * c.as_island);
            let share = if ei + es > 0.0 { ei / (ei + es) } else { 0.5 };
            let broke = if share >= glass { Some(Goal::Invaders) } else if share <= 1.0 - glass { Some(Goal::Island) } else { None };
            if let Some(g) = broke {
                if let Some(m) = memory.as_deref_mut() {
                    m.broke = Some(g);
                    m.goal = Some(g);
                }
                return g;
            }
        }
    }
    let push = p.push * (c.rounds_left + 1.0);
    let reach_inv = (1.0 - c.known) * (c.prior + 0.15).min(1.0) + c.known * invaders_reach_by(s, c.projected, c.threshold, c.spread_p, push, trend);
    let reach_isl = (1.0 - c.known) * (1.0 - c.prior + 0.15).min(1.0) + c.known * (1.0 - invaders_reach_by(s, c.projected, c.threshold, c.spread_p, -push, trend));
    let settled = c.settled;
    let mut evidence = reach_inv * c.as_invaders - reach_isl * c.as_island;
    if on(p.judge) {
        if let Some(w) = crate::judge::weights() {
            let (pi, wi, ws) = crate::judge::judge_with(s, &c, w);
            evidence = pi * wi - (1.0 - pi) * ws;
        }
    }
    if let Some(m) = memory.as_deref_mut() {
        if m.jitter.is_none() {
            m.jitter = Some((rng() * 2.0 - 1.0) * p.jitter);
        }
    }
    let jitter = memory.as_deref().and_then(|m| m.jitter).unwrap_or(0.0);
    let score = evidence + (p.lean + jitter) * (1.0 - settled);
    let held = memory.as_deref().and_then(|m| m.goal);
    let bar = match held {
        Some(Goal::Invaders) => -p.hold,
        Some(Goal::Island) => p.hold,
        None => 0.0,
    };
    let mut goal = if score > bar { Goal::Invaders } else { Goal::Island };
    if gut_now {
        // On its leaning alone: the gut player ignores the board's evidence.
        goal = if p.lean + jitter > 0.0 { Goal::Invaders } else { Goal::Island };
    }
    if held == Some(Goal::Invaders) && goal == Goal::Island && on(p.commit) && reach_isl * c.as_island < p.commit * reach_inv * c.as_invaders {
        goal = Goal::Invaders;
    }
    if let Some(m) = memory {
        m.goal = Some(goal);
        if gut_now {
            m.broke = Some(goal);
        }
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
    let mut memory = memory;
    // Dials: the seat's nerve, loyalty and sharpness for this game, drawn once within `vary` of their set values, set as
    // concrete settings for this whole decision (the hedger's and the search's own switches).
    let dialled;
    let profile: &str = match persona_of(profile) {
        Some(q) if on(q.dials) => {
            if let Some(m) = memory.as_deref_mut() {
                if m.traits.len() < 5 {
                    m.traits = [q.nerve, q.loyalty, q.sharp].iter().map(|&v| (v + (rng() * 2.0 - 1.0) * q.vary).clamp(0.0, 1.0)).collect();
                    // The irrational draw (one game in ten) and where its late timing lands.
                    m.traits.push(rng());
                    m.traits.push(rng());
                }
            }
            let d = memory.as_deref().map(|m| m.traits.clone()).filter(|t| t.len() >= 3).unwrap_or_else(|| vec![q.nerve, q.loyalty, q.sharp]);
            let (nerve, loyalty, sharp) = (d[0], d[1], d[2]);
            // Irrational (designer, 2026-11-06: real players occasionally play irrationally, so the jitter should
            // allow it): about one game in ten a hedger starts counting the invaders late (round 3 to 5) and can't
            // commit for good before round 4 or 5.
            let wild = d.get(3).is_some_and(|&u| u < 0.1);
            let late = d.get(4).copied().unwrap_or(0.5);
            // Nerve: the share of its winning chances one ending must hold before it commits (0.6 to 0.95), the round
            // from which it may (2 to 4), and the chance it is a gut player, committing in round 2 or 3 on its leaning.
            // Loyalty: the guard on its faction while hedging (0.1 to 0.9) and once committed to the invaders (0 to 4).
            // Sharpness: search noise (none at 1) and the share of turns played on instinct (up to a quarter at 0).
            // Low nerve (under 0.35): no hedging at all, the committed player from round 1 (today's backer, with its
            // push for its faction), guarding by loyalty; above it, hedging, committing later the higher the nerve.
            // The dials' settings, each unless the profile sets it itself (tests). When a hedger counts the invaders
            // in full (designer, 2026-11-06: early backer and late joiner are the spectrum's ends; in between plays a
            // little worse, as people do): round 1 at the hedgers' least nerve (0.35) to round 3 at the most.
            let set: Vec<(&str, f64)> = if nerve < 0.35 {
                vec![("protect", 4.0 * loyalty), ("noise", SEARCH_NOISE * (1.0 - sharp))]
            } else {
                vec![
                    ("hedge", 1.0),
                    ("hfrom", if wild { 3.0 + 2.0 * late } else { 1.0 + 2.0 * ((nerve - 0.35) / 0.65).clamp(0.0, 1.0) }),
                    ("glass", 0.6 + 0.35 * nerve),
                    ("glassFrom", if wild { 4.0 + late.round() } else { 2.0 + (2.0 * nerve).round() }),
                    ("gut", 0.4 * (1.0 - nerve)),
                    ("hguard", 0.1 + 0.8 * loyalty),
                    ("protect", 4.0 * loyalty),
                    ("noise", SEARCH_NOISE * (1.0 - sharp)),
                ]
            };
            let own = |k: &str| profile.split([':', ',']).any(|kv| kv.split_once('=').is_some_and(|(a, _)| a == k));
            dialled = set.iter().filter(|(k, _)| !own(k)).fold(profile.to_string(), |acc, (k, v)| format!("{acc},{k}={v:.4}")) + ",dials=0";
            // Instinct: some turns, more for a careless seat, the move that looks best at a glance (no play-outs).
            if on(q.sim) && s.phase == Phase::Play && rng() < 0.25 * (1.0 - sharp) {
                return play_move(s, pid, rng, &fast(&dialled), memory, seats, focus);
            }
            &dialled
        }
        _ => profile,
    };
    let persona = persona_of(profile);
    // A real decision (the table given), with look on: the forecast from play-outs of the round.
    let seen = match &persona {
        Some(_) if seats.profiles.is_some() && s.phase == Phase::Play && s.options.round_votes => {
            let (a, t) = flow_ahead(s, pid, &mut *rng, memory.as_deref(), seats, END_READ_PLAYOUTS);
            if let Some(m) = memory.as_deref_mut() {
                m.read = Some([s.round as f64, a, t]);
            }
            Some((a, t))
        }
        _ => None,
    };
    let goal = persona.as_ref().map(|p| choose_goal_seen(s, pid, p, memory.as_deref_mut(), &mut *rng, seen));
    // A hedger that has broken glass plays the plain committed value from then on.
    let committed = persona.as_ref().is_some_and(|p| on(p.hedge)) && memory.as_deref().is_some_and(|m| m.broke.is_some());
    // It plays as a full bot of its side: the lean's end for that side (backer habits for the invaders), no hedging.
    let plain = if committed {
        let side = if memory.as_deref().and_then(|m| m.broke) == Some(Goal::Invaders) { 0.3 } else { -0.3 };
        let (name, over) = profile.split_once(':').unwrap_or((profile, ""));
        let rest: Vec<&str> = over.split(',').filter(|kv| !kv.is_empty() && !kv.starts_with("lean=") && !kv.starts_with("hedge=")).collect();
        format!("{name}:lean={side},{}hedge=0", rest.iter().map(|kv| format!("{kv},")).collect::<String>())
    } else { String::new() };
    let value_profile: &str = if committed { &plain } else { profile };
    let ev = |x: &GameState| evaluate(x, pid, value_profile, goal);
    let p = &s.players[me];
    let jitter = persona.as_ref().and_then(|x| x.noise).unwrap_or(SEARCH_NOISE);
    let draws = persona.as_ref().and_then(|x| x.draft).unwrap_or(4);
    let noise = |v: f64, rng: &mut dyn FnMut() -> f64| v + (rng() - 0.5) * jitter;
    match s.phase {
        Phase::Draft => {
            if p.picked {
                return None;
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
            let moves = candidates(s, pid, rng, SEARCH_TARGETS, pe.as_ref().is_some_and(|x| on(x.enumerate)), true, Some(&steer_fn), focus.map(|f| f.0));
            let moves: Vec<Move> = match focus {
                Some((card, so_far)) => moves.into_iter().filter(|m| fits(m, card, so_far)).collect(),
                None => moves,
            };
            if moves.is_empty() {
                return None;
            }
            let table = pe.as_ref().map(|x| {
                let mut profiles = seats.profiles.clone().unwrap_or_default();
                profiles.insert(pid, profile.to_string());
                Seats { profiles: Some(profiles), memories: seats.memories.clone(), judge: on(x.rjudge), plans: true }
            });
            if let Some(x) = pe.as_ref() {
                if on(x.sim) {
                    LAST_PLAN.with(|p| p.borrow_mut().clear());
                    let picked = plan_pick(s, pid, rng, moves, &ev, memory.as_deref(), x.keep.unwrap_or(SIM_KEEP), x.plan_budget.unwrap_or(PLAN_BUDGET), x.plan_depth.unwrap_or(PLAN_DEPTH), x.playouts.unwrap_or(SIM_PLAYOUTS), table.as_ref());
                    if let Some(m) = memory.as_deref_mut() {
                        m.plan = LAST_PLAN.with(|p| p.borrow().clone());
                    }
                    return picked;
                }
            }
            let mut best: Option<Move> = moves.first().cloned();
            let mut best_v = f64::NEG_INFINITY;
            for m in moves {
                let a = after(s, pid, &m);
                let quick = ev(&a);
                let v = noise(quick, rng);
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

/// The moves to play out: the best `keep` by one-step score, Pass, and every play that leaves this seat
/// strictly first where it was tied for the most sway at a fight already set.
fn shortlist(s: &GameState, pid: Pid, ranked: &[(Move, GameState, f64)], keep: usize) -> Vec<usize> {
    let mut short: Vec<usize> = (0..keep.min(ranked.len())).collect();
    if let Some(i) = ranked.iter().position(|r| r.0 == Move::Pass) {
        if !short.contains(&i) {
            short.push(i);
        }
    }
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
    short
}

/// Hand planning: plain play-outs for the shortlisted first moves, then (move, plan) pairs by
/// successive halving; a plan wins only if, scored again on the plain seeds, it beats the best plain move.
#[allow(clippy::too_many_arguments)]
fn plan_pick(s: &GameState, pid: Pid, rng: Rng, moves: Vec<Move>, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, keep: usize, budget: usize, depth: usize, playouts: usize, table: Option<&Seats>) -> Option<Move> {
    let mut ranked: Vec<(Move, GameState, f64)> = moves.into_iter().map(|m| { let x = after(s, pid, &m); let v = ev(&x); (m, x, v) }).collect();
    ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let short = shortlist(s, pid, &ranked, keep);
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
        Some(p) => fast(p),
        None => ROLLOUT.to_string(),
    }).map(|p| if table.is_some_and(|t| t.judge) && persona_of(&p).is_some() { format!("{p},judge=1") } else { p }).collect();
    let mut moves = 0;
    // On through nightfall and growth to the round's end (2026-11-04: play-outs had stopped at nightfall, before the
    // fights and the vote, whenever a location was marked).
    while moves < SIM_MAX_MOVES && s.round == round && matches!(s.phase, Phase::Play | Phase::Night) {
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
    let table = Seats { profiles: Some(profiles), memories: seats.memories.clone(), judge: pe.as_ref().is_some_and(|x| on(x.rjudge)), plans: true };
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
/// worth now. Nightfall: each choice the seat may make. `memory` keeps the goal between hints.
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
