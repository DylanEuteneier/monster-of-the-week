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
    /// Per round: tokens the cards added and removed (play by play), lost in fights, grown.
    pub flow: Vec<Flow>,
    /// Rounds as votes: each round's vote in order (true: the invaders').
    pub votes: Vec<bool>,
    /// The ending study: the factions in play (by slot), the winning ones, each round's state and every play.
    pub factions: Vec<String>,
    pub won_by: Vec<String>,
    pub rounds: Vec<RoundLog>,
    pub playlog: Vec<PlayLog>,
    /// Final scores by seat (the ending's own measure).
    pub scores: Vec<i32>,
    /// Each turn of play's swing diagnosis (SWING=1 or `swing=1`).
    pub swings: Vec<SwingLog>,
}

/// A round's close: each faction's presence (by slot) before and after its fights and at its end (after nightfall and
/// growth), and every seat's state then.
#[derive(Clone, Debug)]
pub struct RoundLog {
    pub round: i32,
    pub before_fights: [i32; 5],
    pub after_fights: [i32; 5],
    pub end: [i32; 5],
    pub seats: Vec<SeatLog>,
    /// The round's first player; how many fights it had; locations holding monsters and fights due at its end.
    pub first: Option<Pid>,
    pub fights: usize,
    pub occupied: usize,
}

#[derive(Clone, Debug)]
pub struct SeatLog {
    pub standing: [i32; 5],
    pub trophies: [i32; 5],
    pub supply: i32,
    pub on_board: i32,
    pub goal: Option<&'static str>,
    pub p_invaders: f64,
}

/// What the board and the hand allowed on one turn of play (the ending study's swing diagnosis): the groups on the
/// board, and the biggest swing (monsters moved, brought on or removed) any legal action in hand could make, as it is
/// and with the sway requirement off; per card in hand, the same.
#[derive(Clone, Debug)]
pub struct SwingLog {
    pub round: i32,
    pub seat: Pid,
    pub presence: i32,
    pub groups: i32,
    pub max_group: i32,
    pub groups4: i32,
    pub best: i32,
    pub best_free: i32,
    pub cards: Vec<(String, i32, i32)>,
}

/// Monsters a step moved, brought on or removed (each arrival at a location, plus the board's net loss).
fn swing_between(a: &crate::types::GameState, b: &crate::types::GameState) -> i32 {
    let arrivals: i32 = (0..a.board.len()).map(|l| (0..5u8).map(|f| (b.board[l].tokens.get(f) - a.board[l].tokens.get(f)).max(0)).sum::<i32>()).sum();
    arrivals + (crate::board::total_presence(a) - crate::board::total_presence(b)).max(0)
}

/// The biggest swing a card's legal actions could make here (up to 80 targets; a play that would close the round left out).
fn best_swing(s: &crate::types::GameState, pid: Pid, c: crate::types::CardIx) -> i32 {
    let (ts, _) = crate::choice::list_targets(s, pid, c, 80, true);
    ts.into_iter().filter_map(|t| {
        let m = crate::types::Move::Play { card: c, use_: crate::types::PlayUse::Action, target: Some(Some(t)), places: None };
        let b = crate::game::apply_move(s, pid, &m).ok()?;
        (b.round == s.round && b.phase == Phase::Play).then(|| swing_between(s, &b))
    }).max().unwrap_or(0)
}

fn swing_log(s: &crate::types::GameState, pid: Pid) -> SwingLog {
    let quiet = crate::cards::imagined(s);
    let mut free = quiet.clone();
    free.options = s.options.unpaid();
    let sizes: Vec<i32> = (0..s.board.len()).flat_map(|l| (0..5u8).map(move |f| (l, f))).map(|(l, f)| s.board[l].tokens.get(f)).filter(|&x| x > 0).collect();
    let cards: Vec<(String, i32, i32)> = s.players[pid as usize].hand.iter().map(|&c| (crate::spec::spec().cards[c as usize].id.clone(), best_swing(&quiet, pid, c), best_swing(&free, pid, c))).collect();
    SwingLog {
        round: s.round, seat: pid, presence: crate::board::total_presence(s), groups: sizes.len() as i32, max_group: sizes.iter().copied().max().unwrap_or(0),
        groups4: sizes.iter().filter(|&&x| x >= 4).count() as i32, best: cards.iter().map(|c| c.1).max().unwrap_or(0), best_free: cards.iter().map(|c| c.2).max().unwrap_or(0), cards,
    }
}

/// One card play: what it did, by faction slot, and the seat's goal and forecast as it played. A play that closed the
/// round (`closed`) has its presence change measured before the fights, but its standing and trophies include them.
#[derive(Clone, Debug)]
pub struct PlayLog {
    pub round: i32,
    pub seat: Pid,
    pub card: String,
    pub use_: &'static str,
    pub d_presence: [i32; 5],
    pub d_standing: [i32; 5],
    pub d_trophies: [i32; 5],
    pub placed: i32,
    /// Monsters that changed location (each one counted once where it arrived); 0 on a closing play (fights mix in).
    pub moved: i32,
    pub closed: bool,
    pub goal: Option<&'static str>,
    pub p_invaders: f64,
}

fn by_faction(s: &crate::types::GameState) -> [i32; 5] {
    let mut out = [0; 5];
    for (f, x) in out.iter_mut().enumerate() {
        *x = crate::board::presence_of(s, f as u8);
    }
    out
}

fn on_board(s: &crate::types::GameState, pid: Pid) -> i32 {
    s.board.iter().map(|b| b.sway.get(pid)).sum()
}

fn goal_name(m: &BotMemory) -> Option<&'static str> {
    m.goal.map(|g| match g { crate::bots::Goal::Invaders => "invaders", crate::bots::Goal::Island => "island" })
}

fn seat_log(s: &crate::types::GameState, pid: Pid, m: &BotMemory) -> SeatLog {
    let p = &s.players[pid as usize];
    SeatLog { standing: p.standing, trophies: p.trophies, supply: p.supply, on_board: on_board(s, pid), goal: goal_name(m), p_invaders: crate::bots::win_chances(s, pid).p_invaders }
}

/// Where a round's tokens came from and went.
#[derive(Clone, Copy, Debug, Default)]
pub struct Flow {
    pub round: i32,
    pub cards_in: i32,
    pub cards_out: i32,
    pub fights: i32,
    pub growth: i32,
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
/// Testing (the opening study): stop every game once this round is over (0: play to the end). The bots play as if
/// the whole game lies ahead.
pub static SWING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub static STOP_AFTER: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

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
    let (mut votes, mut last_votes) = (Vec::new(), s.votes);
    let mut passes: Vec<Pass> = Vec::new();
    let mut plays: Vec<(Pid, i32, bool)> = Vec::new();
    let mut turns: Vec<Turn> = Vec::new();
    let mut flow: Vec<Flow> = Vec::new();
    crate::game::take_flow();
    crate::game::take_fights();
    let mut fights_seen: Vec<([i32; 5], [i32; 5], usize)> = Vec::new();
    let mut rounds: Vec<RoundLog> = Vec::new();
    let mut playlog: Vec<PlayLog> = Vec::new();
    let mut round_first = None;
    let mut swings: Vec<SwingLog> = Vec::new();
    let swing_on = SWING.load(std::sync::atomic::Ordering::Relaxed);
    let mut played_round = 0usize;
    let mut round = s.round;
    let mut moves = 0;
    let stop = STOP_AFTER.load(std::sync::atomic::Ordering::Relaxed);
    while moves < MAX_MOVES && s.phase != Phase::Ended && (stop == 0 || s.round <= stop) {
        let mut moved = false;
        if s.phase == Phase::Play && round_first.is_none_or(|_| false) {
            round_first = s.first;
        }
        if swing_on && s.phase == Phase::Play && !s.players[s.turn].hand.is_empty() {
            swings.push(swing_log(&s, s.turn as Pid));
        }
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
                            let round_now = s.round;
                            let (pres0, me0) = (by_faction(&s), s.players[pid as usize].clone());
                            let (board0, p_inv) = (on_board(&s, pid), crate::bots::win_chances(&s, pid).p_invaders);
                            let next = apply_legal(&s, pid, &m);
                            let closes = crate::game::take_fights();
                            let shifted: i32 = if closes.is_empty() {
                                (0..s.board.len()).map(|l| (0..5u8).map(|f| (next.board[l].tokens.get(f) - s.board[l].tokens.get(f)).max(0)).sum::<i32>()).sum()
                            } else { 0 };
                            let pres1 = closes.first().map(|x| x.0).unwrap_or_else(|| by_faction(&next));
                            let me1 = &next.players[pid as usize];
                            if let crate::types::Move::Play { card, use_, .. } = &m {
                                let d = |a: [i32; 5], b: [i32; 5]| { let mut o = [0; 5]; for i in 0..5 { o[i] = b[i] - a[i]; } o };
                                playlog.push(PlayLog {
                                    round: round_now, seat: pid, card: crate::spec::spec().cards[*card as usize].id.clone(),
                                    use_: match use_ { crate::types::PlayUse::Action => "action", crate::types::PlayUse::Sway => "sway", crate::types::PlayUse::Return => "return" },
                                    d_presence: d(pres0, pres1), d_standing: d(me0.standing, me1.standing), d_trophies: d(me0.trophies, me1.trophies),
                                    placed: on_board(&next, pid) - board0, moved: shifted, closed: !closes.is_empty(), goal: goal_name(&memory[pid as usize]), p_invaders: p_inv,
                                });
                            }
                            fights_seen.extend(closes);
                            let (lost, grown) = note(&mut flow, round_now, before, crate::board::total_presence(&next), true);
                            plays.push((pid, crate::board::total_presence(&next) - before + lost - grown, waited));
                            s = next;
                            moved = true;
                            break;
                        }
                        _ => {}
                    }
                }
                let round_now = s.round;
                let before = crate::board::total_presence(&s);
                s = apply_legal(&s, pid, &m);
                fights_seen.extend(crate::game::take_fights());
                note(&mut flow, round_now, before, crate::board::total_presence(&s), matches!(m, crate::types::Move::Play { .. }));
                moved = true;
                break;
            }
        }
        assert!(moved, "game {g}: nobody can move in {:?}", s.phase);
        moves += 1;
        if s.votes != last_votes {
            votes.push(s.votes[0] > last_votes[0]);
            last_votes = s.votes;
        }
        if s.round != round || s.phase == Phase::Ended {
            let (bf, af, nf) = fights_seen.last().copied().unwrap_or(([0; 5], [0; 5], 0));
            fights_seen.clear();
            rounds.push(RoundLog { round, before_fights: bf, after_fights: af, end: by_faction(&s), seats: (0..n).map(|p| seat_log(&s, p as Pid, &memory[p])).collect(), first: round_first, fights: nf, occupied: (0..s.board.len() as u8).filter(|&l| crate::board::count_at(&s, l) >= 1).count() });
            round_first = None;
            presence.push(crate::board::total_presence(&s));
            round = s.round;
            played_round = 0;
        }
    }
    // Stopped early (STOP_AFTER): no result; the record keeps the turns.
    let (island, winners, placings) = match s.result.as_ref() {
        Some(r) => (r.island, r.players.clone(), r.placings.clone()),
        None => { assert!(stop > 0, "a finished game"); (false, Vec::new(), Vec::new()) }
    };
    Game {
        g,
        seats,
        island,
        winners,
        placings,
        groups: s.players.iter().map(|p| spec().slayer_groups[p.group as usize].id.clone()).collect(),
        presence,
        moves,
        seconds: t0.elapsed().as_secs_f64(),
        passes,
        plays,
        turns,
        flow,
        votes,
        factions: s.factions.iter().map(|&f| crate::spec::spec().factions[f as usize].id.clone()).collect(),
        won_by: s.result.as_ref().map(|r| r.factions.iter().map(|&f| crate::spec::spec().factions[s.factions[f as usize] as usize].id.clone()).collect()).unwrap_or_default(),
        rounds,
        playlog,
        scores: s.result.as_ref().map(|r| r.scores.clone()).unwrap_or_default(),
        swings,
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

/// Adds one move's tokens to its round's flow: the fights and growth it set off (from the engine's counters), and
/// what is left of the change, the card's own. Returns the fights and growth.
fn note(flow: &mut Vec<Flow>, round: i32, before: i32, after: i32, card: bool) -> (i32, i32) {
    let (lost, grown) = crate::game::take_flow();
    if !flow.iter().any(|f| f.round == round) {
        flow.push(Flow { round, ..Default::default() });
    }
    let f = flow.iter_mut().find(|f| f.round == round).unwrap();
    f.fights += lost;
    f.growth += grown;
    let own = after - before + lost - grown;
    if card {
        if own > 0 { f.cards_in += own } else { f.cards_out -= own }
    }
    (lost, grown)
}
