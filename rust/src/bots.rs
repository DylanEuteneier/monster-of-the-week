//! Bots (a port of public/bots.js): the trophy and backer profiles, their evaluation, search, play-outs and hand
//! planning. Tuning numbers, not rules. Random draws and floating-point sums follow the JavaScript's order exactly, so
//! the same seed plays the same game.

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
const ROLLOUT: &str = "trophy:sim=0,enum=0,combo=0";
const TABLE_BACKING: i32 = 8;
const TABLE_BASE: f64 = 0.3;
const TABLE_STEP: f64 = 0.15;
const ISLAND: [f64; 4] = [1.0, 0.35, 0.12, 0.02];

/// A goal bot's persona (bots.js Persona); 0 is a switch off.
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
    pub keep: Option<f64>,
    pub playouts: Option<f64>,
    pub save: Option<f64>,
    pub soft: Option<f64>,
    pub w2: Option<f64>,
    pub w3: Option<f64>,
    pub all: Option<f64>,
    pub table: f64,
    pub commit: f64,
    pub allies: f64,
    pub protect: f64,
    pub top: f64,
    pub race: f64,
    pub even: f64,
    pub plan: f64,
    pub plan_budget: Option<f64>,
    pub plan_depth: Option<f64>,
    pub steer: f64,
}

fn base(name: &str) -> Option<Persona> {
    let trophy = Persona {
        lean: -0.3, jitter: 0.15, hold: 0.05, push: 2.0, margin: 3.0, linear: 1.0, threat: 3.0, enumerate: 1.0, sim: 1.0, combo: 1.0, sets: 2.0,
        keep: None, playouts: None, save: None, soft: None, w2: None, w3: None, all: None, table: 1.0, commit: 0.0, allies: 0.0, protect: 0.0, top: 0.0,
        race: 0.0, even: 1.0, plan: 0.0, plan_budget: None, plan_depth: None, steer: 0.0,
    };
    match name {
        "trophy" | "goal" => Some(trophy),
        "backer" => Some(Persona { lean: 0.3, threat: 1.0, protect: 4.0, commit: 2.0, top: 2.0, race: 2.0, plan: 1.0, steer: 1.0, ..trophy }),
        _ => None,
    }
}

/// A profile's persona ("trophy", "backer", or "trophy:lean=0,hold=0.1").
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
                "keep" => p.keep = Some(x),
                "playouts" => p.playouts = Some(x),
                "save" => p.save = Some(x),
                "soft" => p.soft = Some(x),
                "w2" => p.w2 = Some(x),
                "w3" => p.w3 = Some(x),
                "all" => p.all = Some(x),
                "table" => p.table = x,
                "commit" => p.commit = x,
                "allies" => p.allies = x,
                "protect" => p.protect = x,
                "top" => p.top = x,
                "race" => p.race = x,
                "even" => p.even = x,
                "plan" => p.plan = x,
                "planBudget" => p.plan_budget = Some(x),
                "planDepth" => p.plan_depth = Some(x),
                "steer" => p.steer = x,
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

fn colours_of(p: &Persona) -> [f64; 4] {
    if p.w2.is_none() && p.w3.is_none() && p.all.is_none() {
        ISLAND
    } else {
        [1.0, p.w2.unwrap_or(ISLAND[1]), p.w3.unwrap_or(ISLAND[2]), p.all.unwrap_or(ISLAND[3])]
    }
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
    pub p_invaders: f64,
    pub prior: f64,
    pub known: f64,
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

pub fn win_chances(s: &GameState, pid: Pid, soft: f64, colours: &[f64; 4]) -> Chances {
    chances_after(&project_fights(s), pid, soft, colours)
}

/// win_chances for a position every seat asks about (the goal checks in a play-out): its projection remembered.
fn win_chances_shared(s: &GameState, pid: Pid, soft: f64, colours: &[f64; 4]) -> Chances {
    chances_after(&project_fights_cached(s), pid, soft, colours)
}

/// The board after this round's fights.
fn project_fights(s: &GameState) -> GameState {
    let locs = fights_due(s);
    let mut out = imagined(s);
    if !locs.is_empty() {
        resolve_fights(&mut out, &locs);
    }
    out
}

fn chances_after(s: &GameState, pid: Pid, soft: f64, colours: &[f64; 4]) -> Chances {
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
    let spread_p = soft * (2.0 + 3.0 * rounds_left);
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
    let spread_i = soft * (1.0 + rounds_left);
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
    let spread_t = soft * (0.6 + 0.8 * rounds_left);
    let as_island = sigmoid(margin_island / spread_t);
    let prior = (TABLE_BASE + TABLE_STEP * backers as f64).max(0.1).min(0.9);
    let known = if rounds > 1.0 { ((s.round as f64 - 1.0) / (rounds - 1.0)).min(1.0) } else { 1.0 };
    let p_invaders = (1.0 - known) * prior + known * sigmoid((projected - threshold - 0.5) / spread_p);
    Chances { p_invaders, prior, known, backers, linear_island, rival_invaders, as_invaders, as_island, margin_invaders, margin_island, projected, threshold, spread_p, rounds_left }
}

/// How good a position is for `pid` (evaluate).
pub fn evaluate(s: &GameState, pid: Pid, profile: &str, goal: Option<Goal>) -> f64 {
    let persona = persona_of(profile).unwrap_or_else(|| base("trophy").unwrap());
    goal_value(s, pid, goal.unwrap_or(Goal::Island), &persona)
}

fn goal_value(s: &GameState, pid: Pid, goal: Goal, p: &Persona) -> f64 {
    let c = win_chances(s, pid, p.soft.unwrap_or(1.0), &colours_of(p));
    let inv = c.p_invaders * 10.0 * c.as_invaders + p.margin * c.margin_invaders;
    let island_margin = p.linear * 10.0 * c.linear_island;
    let isl = (1.0 - c.p_invaders) * 10.0 * c.as_island + island_margin;
    let threat = p.threat * 10.0 * c.p_invaders * c.rival_invaders;
    let guard = if on(p.protect) && goal == Goal::Invaders { p.protect * presence_guard(s, pid, &c, p) } else { 0.0 };
    let main = if goal == Goal::Invaders { inv + guard } else { isl + if on(p.sets) { p.sets * (1.0 - c.p_invaders) * set_access(s, pid) } else { 0.0 } };
    main - threat + p.save.unwrap_or(0.02) * s.players[pid as usize].supply as f64
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
        acc += need[i] * (((p.standing[f] + on_board(f)) as f64).max(0.0)).sqrt(); // negative standing: no access (as bots.js)
    }
    acc * (rounds_left / 2.0).min(1.0)
}

/// Which goal to pursue now (chooseGoal). Draws from `rng` once per game, for the memory's jitter.
pub fn choose_goal(s: &GameState, pid: Pid, p: &Persona, memory: Option<&mut BotMemory>, rng: Rng) -> Goal {
    let c = win_chances_shared(s, pid, p.soft.unwrap_or(1.0), &colours_of(p));
    let push = p.push * (c.rounds_left + 1.0);
    let push_inv = push * (1.0 + p.allies * c.backers as f64);
    let reach_inv = (1.0 - c.known) * (c.prior + 0.15).min(1.0) + c.known * sigmoid((c.projected - c.threshold - 0.5 + push_inv) / c.spread_p);
    let reach_isl = (1.0 - c.known) * (1.0 - c.prior + 0.15).min(1.0) + c.known * (1.0 - sigmoid((c.projected - c.threshold - 0.5 - push) / c.spread_p));
    let evidence = reach_inv * c.as_invaders - reach_isl * c.as_island;
    let mut memory = memory;
    if let Some(m) = memory.as_deref_mut() {
        if m.jitter.is_none() {
            m.jitter = Some((rng() * 2.0 - 1.0) * p.jitter);
        }
    }
    let jitter = memory.as_deref().and_then(|m| m.jitter).unwrap_or(0.0);
    let score = evidence + (p.lean + jitter) * (1.0 - c.known);
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
    // As the JavaScript: `targets` grows with each listed card and is never reset, so later cards in the hand sample
    // more (to review: probably unintended).
    let mut targets = targets;
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
                    targets += seen.len();
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
            targets += seen.len();
        }
        let mut i = 0;
        while i < targets * 2 && seen.len() < targets {
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
    play_move(s, pid, rng, profile, memory, seats)
}

fn play_move(s: &GameState, pid: Pid, rng: Rng, profile: &str, memory: Option<&mut BotMemory>, seats: &Seats) -> Option<Move> {
    let me = pid as usize;
    let persona = persona_of(profile);
    let mut memory = memory;
    let goal = persona.as_ref().map(|p| choose_goal(s, pid, p, memory.as_deref_mut(), &mut *rng));
    let ev = |x: &GameState| evaluate(x, pid, profile, goal);
    let p = &s.players[me];
    let noise = |v: f64, rng: &mut dyn FnMut() -> f64| v + (rng() - 0.5) * SEARCH_NOISE;
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
                let w = if combo { combo_worth(s, pid, c, &p.kept, rng, &ev, base_v) } else { card_worth(s, pid, c, rng, &ev, base_v) };
                worth.push((c, noise(w, rng)));
            }
            worth.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let n = p.kept.len() + 1;
            let m = Move::Pick { keep: worth[..n.min(worth.len())].iter().map(|w| w.0).collect() };
            if legal(s, pid, &m) { Some(m) } else { None }
        }
        Phase::Growth => {
            let g = s.growing.as_ref()?;
            if g.leaders[g.next as usize % g.leaders.len()] != pid {
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
            let moves = candidates(s, pid, rng, SEARCH_TARGETS, pe.as_ref().is_some_and(|x| on(x.enumerate)), pe.as_ref().is_some_and(|x| on(x.even)), steer, None);
            let table = pe.as_ref().filter(|x| on(x.table)).map(|_| {
                let mut profiles = seats.profiles.clone().unwrap_or_default();
                profiles.insert(pid, profile.to_string());
                Seats { profiles: Some(profiles), memories: seats.memories.clone() }
            });
            if let Some(x) = pe.as_ref() {
                if on(x.sim) && on(x.plan) {
                    let keep = x.keep.map(|k| k as usize).unwrap_or(SIM_KEEP);
                    return plan_pick(s, pid, rng, moves, &ev, memory.as_deref(), keep, x.plan_budget.map(|b| b as usize).unwrap_or(PLAN_BUDGET), x.plan_depth.map(|d| d as usize).unwrap_or(PLAN_DEPTH), table.as_ref());
                }
                if on(x.sim) {
                    let keep = x.keep.map(|k| k as usize).unwrap_or(SIM_KEEP);
                    return sim_pick(s, pid, rng, moves, &ev, memory.as_deref(), keep, x.playouts.map(|k| k as usize).unwrap_or(SIM_PLAYOUTS), table.as_ref());
                }
            }
            let mut best: Option<Move> = moves.first().cloned();
            let mut best_v = f64::NEG_INFINITY;
            for m in moves {
                let v = noise(ev(&after(s, pid, &m)), rng);
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

/// The play-out search (persona sim).
#[allow(clippy::too_many_arguments)]
fn sim_pick(s: &GameState, pid: Pid, rng: Rng, moves: Vec<Move>, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, keep: usize, playouts: usize, table: Option<&Seats>) -> Option<Move> {
    let mut ranked: Vec<(Move, GameState, f64)> = moves.into_iter().map(|m| { let x = after(s, pid, &m); let v = ev(&x); (m, x, v) }).collect();
    ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let pass_i = ranked.iter().position(|r| r.0 == Move::Pass);
    let mut short: Vec<usize> = (0..keep.min(ranked.len())).collect();
    if let Some(i) = pass_i {
        if !short.contains(&i) {
            short.push(i);
        }
    }
    let seeds: Vec<i64> = (0..playouts).map(|_| seed_of(rng)).collect();
    let mut best = short.first().map(|&i| ranked[i].0.clone());
    let mut best_v = f64::NEG_INFINITY;
    for &i in &short {
        let mut total = 0.0;
        for &seed in &seeds {
            total += ev(&play_out_round(&ranked[i].1, seed, pid, memory, table, None));
        }
        let v = total / seeds.len() as f64;
        if v > best_v {
            best = Some(ranked[i].0.clone());
            best_v = v;
        }
    }
    best
}

/// Hand planning (persona plan): plain play-outs for the shortlisted first moves, then (move, plan) pairs by
/// successive halving; a plan wins only if, scored again on the plain seeds, it beats the best plain move.
#[allow(clippy::too_many_arguments)]
fn plan_pick(s: &GameState, pid: Pid, rng: Rng, moves: Vec<Move>, ev: &dyn Fn(&GameState) -> f64, memory: Option<&BotMemory>, keep: usize, budget: usize, depth: usize, table: Option<&Seats>) -> Option<Move> {
    let mut ranked: Vec<(Move, GameState, f64)> = moves.into_iter().map(|m| { let x = after(s, pid, &m); let v = ev(&x); (m, x, v) }).collect();
    ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let pass_i = ranked.iter().position(|r| r.0 == Move::Pass);
    let mut short: Vec<usize> = (0..keep.min(ranked.len())).collect();
    if let Some(i) = pass_i {
        if !short.contains(&i) {
            short.push(i);
        }
    }
    let seeds: Vec<i64> = (0..SIM_PLAYOUTS).map(|_| seed_of(rng)).collect();
    let mut plain: Vec<(usize, f64)> = short.iter().map(|&i| {
        let mut n = 0.0;
        for &seed in &seeds {
            n += ev(&play_out_round(&ranked[i].1, seed, pid, memory, table, None));
        }
        (i, n / seeds.len() as f64)
    }).collect();
    plain.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
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
    let mut todo: Vec<CardIx> = plan.cloned().unwrap_or_default();
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
    }).collect();
    let mut moves = 0;
    while moves < SIM_MAX_MOVES && s.phase == Phase::Play && s.round == round {
        moves += 1;
        let mut moved = false;
        for id in 0..n as Pid {
            let profile = &profiles[id as usize];
            let mut m: Option<Move> = None;
            if id == pid && !todo.is_empty() && s.phase == Phase::Play && s.turn == pid as usize {
                while !todo.is_empty() && m.is_none() {
                    let c = todo.remove(0);
                    if s.players[pid as usize].hand.contains(&c) {
                        m = planned_move(&s, pid, c, &mut r, profile, Some(&mem[id as usize]));
                    }
                }
                if let Some(planned) = m.clone() {
                    let own = play_move(&s, id, &mut r, profile, Some(&mut mem[id as usize]), &Seats::default());
                    let goal = mem[id as usize].goal;
                    let v = |x: &Move| evaluate(&after(&s, pid, x), pid, profile, goal);
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
                m = play_move(&s, id, &mut r, profile, Some(&mut mem[id as usize]), &Seats::default());
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

/// How much a card adds, played as well as the bot can find right now (the draft's rough worth).
fn card_worth(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, ev: &dyn Fn(&GameState) -> f64, base_v: f64) -> f64 {
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
    for _ in 0..4 {
        let Some(t) = sample_target(&x, pid, ci, rng) else { continue };
        let m = action(ci, Some(t));
        if !legal(&x, pid, &m) {
            continue;
        }
        best = best.max(ev(&after(&x, pid, &m)) - base_v);
    }
    best + if c.marked.is_some() { 0.2 } else { 0.0 }
}

/// In the draft (persona combo): a card's worth with the cards already kept.
fn combo_worth(s: &GameState, pid: Pid, ci: CardIx, kept: &[CardIx], rng: Rng, ev: &dyn Fn(&GameState) -> f64, base_v: f64) -> f64 {
    let mut best = card_worth(s, pid, ci, rng, ev, base_v);
    for &k in kept.iter().filter(|&&k| k != ci) {
        let mut x = imagined(s);
        x.phase = Phase::Play;
        x.turn = pid as usize;
        x.opened = true;
        x.players[pid as usize].hand = Hand::from_slice(&[k, ci]);
        let firsts = best_plays(&x, pid, k, rng, ev);
        if firsts.is_empty() {
            continue;
        }
        let alone = firsts[0].1;
        for f in firsts.iter().take(2) {
            let mut x2 = f.0.clone();
            x2.phase = Phase::Play;
            x2.turn = pid as usize;
            let seconds = best_plays(&x2, pid, ci, rng, ev);
            if let Some(sec) = seconds.first() {
                best = best.max(sec.1 - alone);
            }
        }
    }
    best + if card(ci).marked.is_some() { 0.2 } else { 0.0 }
}

/// A card's best few plays for its action, best first.
fn best_plays(s: &GameState, pid: Pid, ci: CardIx, rng: Rng, ev: &dyn Fn(&GameState) -> f64) -> Vec<(GameState, f64)> {
    let mut out = Vec::new();
    for _ in 0..4 {
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
