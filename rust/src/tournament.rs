//! The tuning tournament's games, natively (`motw tournament`): whole bot games with the profiles rotated through the
//! seats, on every core, for iterating on the bots. The deals and the bots' randomness are scripts/tournament.js's
//! (the same seeds, the same streams, every seat offered the move in seat order), so a run here plays the same games
//! as the same run there; the card figures, probes and calibration stay in the JavaScript tournament. A measuring tool,
//! not a rule.

use crate::bots::{bot_move, BotMemory, Seats};
use crate::game::apply_legal;
use crate::setup::{create_game, next_random};
use crate::spec::spec;
use crate::types::{Phase, Pid};
use std::collections::HashMap;

/// The longest game played before giving up (scripts/lib.js MAX_MOVES).
const MAX_MOVES: usize = 20_000;

/// One finished game.
#[derive(Clone, Debug)]
pub struct Game {
    pub g: usize,
    /// The profile in each seat (P1, P2, ...).
    pub seats: Vec<String>,
    pub island: bool,
    /// Winning seats.
    pub winners: Vec<Pid>,
    pub placings: Vec<Pid>,
    /// Each seat's slayer group id.
    pub groups: Vec<String>,
    /// Total presence at the start and after each round.
    pub presence: Vec<i32>,
    pub moves: usize,
    pub seconds: f64,
    /// Every pass made while holding cards (the pass study).
    pub passes: Vec<Pass>,
    /// Every card play: the seat, the change in total invader presence it made, and whether the seat had passed earlier
    /// that round (a play after waiting).
    pub plays: Vec<(Pid, i32, bool)>,
}

/// A pass made while holding cards, with the passing bot's own estimates, and whether it played again that round.
#[derive(Clone, Debug)]
pub struct Pass {
    pub round: i32,
    pub seat: Pid,
    pub hand: usize,
    /// Cards played this round before the pass (by anyone), and still in hands across the table.
    pub played_before: usize,
    pub left: usize,
    pub decision: Option<crate::bots::Decision>,
    /// The seat played a card later in the same round (a deferral); false: the pass held to the round's end.
    pub played_later: bool,
}

/// A seeded stream as scripts/lib.js seededRng: mulberry32 from `seed | 0`.
fn seeded(seed: i64) -> impl FnMut() -> f64 {
    let mut s = seed as i32;
    move || {
        let (v, next) = next_random(s);
        s = next;
        v
    }
}

/// Game `g` of a run: profile list `list` rotated so seat i plays list[(i + g) mod n].
pub fn play(seed: i64, g: usize, list: &[String], options: &[(String, String)], duplicate: bool) -> Game {
    let t0 = std::time::Instant::now();
    let n = list.len();
    let names: Vec<String> = (1..=n).map(|i| format!("P{i}")).collect();
    let seats: Vec<String> = (0..n).map(|i| list[(i + g) % n].clone()).collect();
    let deal = if duplicate { g / n } else { g };
    let mut s = create_game(seed * 10007 + deal as i64, &names, options).expect("game");
    // One stream for the table, or with duplicate=1 one per seat seeded by the deal (so two tables meet the same luck).
    let mut shared = seeded(seed * 7 + g as i64);
    let mut own: Vec<Box<dyn FnMut() -> f64>> = (0..n).map(|i| Box::new(seeded(seed * 7919 + deal as i64 * 31 + i as i64)) as Box<dyn FnMut() -> f64>).collect();
    let mut memory: Vec<BotMemory> = vec![BotMemory::default(); n];
    let profiles: HashMap<Pid, String> = seats.iter().enumerate().map(|(i, p)| (i as Pid, p.clone())).collect();
    let mut presence = vec![crate::board::total_presence(&s)];
    let mut passes: Vec<Pass> = Vec::new();
    let mut plays: Vec<(Pid, i32, bool)> = Vec::new();
    let mut played_round = 0usize;
    let mut round = s.round;
    let mut moves = 0;
    while moves < MAX_MOVES && s.phase != Phase::Ended {
        let mut moved = false;
        // Every seat is offered the move in seat order, as the JavaScript tournament does; the first with one makes it.
        for pid in 0..n as Pid {
            let table = Seats { profiles: Some(profiles.clone()), memories: Some(memory.iter().enumerate().map(|(i, m)| (i as Pid, m.clone())).collect()), ..Default::default() };
            let m = {
                let rng: &mut dyn FnMut() -> f64 = if duplicate { &mut *own[pid as usize] } else { &mut shared };
                bot_move(&s, pid, rng, &seats[pid as usize], Some(&mut memory[pid as usize]), &table)
            };
            if let Some(m) = m {
                let decision = crate::bots::take_decision();
                if s.phase == Phase::Play {
                    let hand = s.players[pid as usize].hand.len();
                    match m {
                        crate::types::Move::Pass if hand > 0 => passes.push(Pass { round: s.round, seat: pid, hand, played_before: played_round, left: s.players.iter().map(|p| p.hand.len()).sum(), decision, played_later: false }),
                        crate::types::Move::Play { .. } => {
                            played_round += 1;
                            let waited = passes.iter().any(|p| p.round == s.round && p.seat == pid);
                            for p in passes.iter_mut().filter(|p| p.round == s.round && p.seat == pid) {
                                p.played_later = true;
                            }
                            let before = crate::board::total_presence(&s);
                            let next = apply_legal(&s, pid, &m);
                            plays.push((pid, crate::board::total_presence(&next) - before, waited));
                            s = next;
                            moved = true;
                            break;
                        }
                        _ => {}
                    }
                }
                s = apply_legal(&s, pid, &m);
                moved = true;
                break;
            }
        }
        assert!(moved, "game {g}: nobody can move in {:?}", s.phase);
        moves += 1;
        if s.round != round || s.phase == Phase::Ended {
            presence.push(crate::board::total_presence(&s));
            round = s.round;
            played_round = 0;
        }
    }
    let r = s.result.as_ref().expect("a finished game");
    Game {
        g,
        seats,
        island: r.island,
        winners: r.players.clone(),
        placings: r.placings.clone(),
        groups: s.players.iter().map(|p| spec().slayer_groups[p.group as usize].id.clone()).collect(),
        presence,
        moves,
        seconds: t0.elapsed().as_secs_f64(),
        passes,
        plays,
    }
}

/// Games 0..games of a run on `workers` threads (each game on one thread; results in game order). `done` is told of
/// each game as it finishes.
pub fn run(seed: i64, games: usize, list: &[String], options: &[(String, String)], duplicate: bool, workers: usize, done: &(dyn Fn(&Game) + Sync)) -> Vec<Game> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let out = std::sync::Mutex::new(Vec::with_capacity(games));
    std::thread::scope(|scope| {
        for _ in 0..workers.max(1) {
            scope.spawn(|| loop {
                let g = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if g >= games {
                    break;
                }
                let game = play(seed, g, list, options, duplicate);
                done(&game);
                out.lock().unwrap().push(game);
            });
        }
    });
    let mut v = out.into_inner().unwrap();
    v.sort_by_key(|x| x.g);
    v
}
