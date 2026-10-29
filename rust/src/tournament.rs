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
    /// With `board` on: on every turn of play, the board and the hand to act (how much is happening, and how many
    /// options the cards have).
    pub turns: Vec<Turn>,
}

/// One turn of play, as the seat to act sees it.
#[derive(Clone, Debug)]
pub struct Turn {
    pub round: i32,
    /// Per card in hand: (card, its legal action targets, up to 40; whether the list is complete).
    pub cards: Vec<(crate::types::CardIx, usize, bool)>,
    pub occupied: usize,
    pub contested: usize,
    pub presence: i32,
    /// For each card with no legal action: per reading, what stopped it (a step with nothing to pick, or why the
    /// finished targets were refused, by the engine's own words).
    pub blocked: Vec<(crate::types::CardIx, String)>,
}

/// Why a card has no legal action now, per reading: the first step with nothing to pick, or the most common reason
/// the engine refuses random finished targets.
fn blockers(s: &crate::types::GameState, pid: Pid, ci: crate::types::CardIx) -> Vec<String> {
    use crate::choice::{complete_target, next_choice};
    use crate::types::{Mode, Target};
    let suited = crate::cards::card(ci).suit.is_some();
    let modes: Vec<Option<Mode>> = if suited { vec![Some(Mode::Location), Some(Mode::Faction)] } else { vec![None] };
    let mut x: u64 = 0x5eed;
    let mut rng = move || { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 11) as f64 / (1u64 << 53) as f64 };
    let mut out = Vec::new();
    for m in modes {
        let t = match m { Some(m) => Target::with_mode(m), None => Target::default() };
        let label = match m { Some(Mode::Location) => "LOC: ", Some(Mode::Faction) => "FAC: ", None => "" };
        let first = next_choice(s, pid, ci, &t);
        let key = crate::json::choice_to_value(&s.factions, &first);
        if first.options.is_empty() && !matches!(first.kind, crate::choice::Kind::Done) {
            // Cost or board: with the sway requirement off, would anything be offered?
            let mut free = crate::cards::imagined(s);
            free.options = s.options.unpaid();
            let freed = next_choice(&free, pid, ci, &t);
            let what = key["key"].as_str().unwrap_or(key["kind"].as_str().unwrap_or("choice")).to_string();
            out.push(if freed.options.is_empty() { format!("{label}board: no {what} fits") } else { format!("{label}cost: no standing to pay for any {what}") });
            continue;
        }
        let mut reasons: std::collections::BTreeMap<String, usize> = Default::default();
        for _ in 0..12 {
            let reason = match complete_target(s, pid, ci, &t, &mut rng) {
                Some(done) => crate::cards::check_target(s, pid, ci, Some(&done)).unwrap_or_else(|| "(legal)".into()),
                None => "a later step had nothing to pick".into(),
            };
            *reasons.entry(reason).or_default() += 1;
        }
        let top = reasons.into_iter().filter(|r| r.0 != "(legal)").max_by_key(|r| r.1).map(|r| r.0).unwrap_or_else(|| "?".into());
        out.push(format!("{label}{top}"));
    }
    out
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
    play_with(seed, g, list, options, duplicate, false)
}

/// play, and with `board` the board and hand at every turn of play.
pub fn play_with(seed: i64, g: usize, list: &[String], options: &[(String, String)], duplicate: bool, board: bool) -> Game {
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
    let mut turns: Vec<Turn> = Vec::new();
    let mut played_round = 0usize;
    let mut round = s.round;
    let mut moves = 0;
    while moves < MAX_MOVES && s.phase != Phase::Ended {
        let mut moved = false;
        if board && s.phase == Phase::Play {
            let pid = s.turn as Pid;
            let mut cards = Vec::new();
            let mut blocked = Vec::new();
            for &c in s.players[pid as usize].hand.iter() {
                let (ts, complete) = crate::choice::list_targets(&s, pid, c, 40, false);
                cards.push((c, ts.len(), complete));
                if ts.is_empty() {
                    for b in blockers(&s, pid, c) {
                        blocked.push((c, b));
                    }
                }
            }
            let occupied = (0..s.board.len() as u8).filter(|&l| crate::board::count_at(&s, l) >= 1).count();
            let contested = crate::game::fights_due(&s).len();
            turns.push(Turn { round: s.round, cards, occupied, contested, presence: crate::board::total_presence(&s), blocked });
        }
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
        turns,
    }
}

/// Games 0..games of a run on `workers` threads (each game on one thread; results in game order). `done` is told of
/// each game as it finishes.
pub fn run(seed: i64, games: usize, list: &[String], options: &[(String, String)], duplicate: bool, workers: usize, done: &(dyn Fn(&Game) + Sync)) -> Vec<Game> {
    run_with(seed, games, list, options, duplicate, workers, false, done)
}

#[allow(clippy::too_many_arguments)]
pub fn run_with(seed: i64, games: usize, list: &[String], options: &[(String, String)], duplicate: bool, workers: usize, board: bool, done: &(dyn Fn(&Game) + Sync)) -> Vec<Game> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let out = std::sync::Mutex::new(Vec::with_capacity(games));
    std::thread::scope(|scope| {
        for _ in 0..workers.max(1) {
            scope.spawn(|| loop {
                let g = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if g >= games {
                    break;
                }
                let game = play_with(seed, g, list, options, duplicate, board);
                done(&game);
                out.lock().unwrap().push(game);
            });
        }
    });
    let mut v = out.into_inner().unwrap();
    v.sort_by_key(|x| x.g);
    v
}
