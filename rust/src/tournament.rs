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
    /// Positions for the learned judge (POSITIONS or `positions=1`): each seat's judge row at each turn of play.
    pub positions: Vec<Vec<f64>>,
    /// Every real fight: who held what sway there and who took which pile (how bots contest fights).
    pub fight_log: Vec<crate::game::FightRec>,
    /// Every nightfall arrival, with the sway that brought it.
    pub night_log: Vec<crate::game::NightRec>,
    /// Every change of a seat's sway at a location during play: (move, round, location, mover, sway before, after).
    pub sway_log: Vec<SwayChange>,
    /// Turns tied for the most sway at a fight already set (`ties=1`).
    pub tie_turns: Vec<TieTurn>,
    /// Quick-bot checks (`fidelity=1`).
    pub quick_turns: Vec<QuickTurn>,
    pub quick_rounds: Vec<QuickRound>,
    /// The card study (`cards=1`): every turn of play with cards in hand, and every draft pick.
    pub card_turns: Vec<CardTurn>,
    pub draft_picks: Vec<DraftPick>,
    /// The strength probe (`probe=RATE`): controlled card tests on a share of turns.
    pub probes: Vec<ProbeLog>,
}

/// One turn of play in the card study (`cards=1`): the hand, how many legal action targets each card had (up to 40),
/// every move the bot weighed (the move, its one-step score, its play-out value if shortlisted; best one-step first),
/// and the move made. `instinct`: no play-outs this turn (an instinct turn, or a lone option), so `options` is empty.
#[derive(Clone, Debug)]
pub struct CardTurn {
    pub mv: usize,
    pub round: i32,
    pub seat: Pid,
    pub goal: Option<&'static str>,
    pub hand: Vec<String>,
    pub acts: Vec<usize>,
    pub options: Vec<(serde_json::Value, f64, Option<f64>)>,
    pub chosen: serde_json::Value,
    pub instinct: bool,
}

/// One controlled card test (`probe=RATE`): at a turn of play, a card is given to the seat to act (taken out of the
/// hand first if held, so both sides differ by that card alone), and the seat's own bot decides with and without it,
/// each decision then played out to the round's end on the same seeds. `benefit`: the seat's value with the card
/// minus without; `used`: the bot played that card when it had it.
#[derive(Clone, Debug)]
pub struct ProbeLog {
    pub mv: usize,
    pub round: i32,
    pub seat: Pid,
    pub goal: Option<&'static str>,
    pub card: String,
    pub held: bool,
    pub benefit: f64,
    pub used: bool,
}

/// One draft pick in the card study: the cards already kept, the batch offered, each pool card's worth to the bot
/// (best first), and the card it took.
#[derive(Clone, Debug)]
pub struct DraftPick {
    pub round: i32,
    pub seat: Pid,
    pub kept: Vec<String>,
    pub offered: Vec<String>,
    pub worth: Vec<(String, f64)>,
    pub picked: String,
}

/// A change of sway at one location in one move (for who made a tie, 2026-11-03).
#[derive(Clone, Debug)]
pub struct SwayChange {
    pub mv: usize,
    pub round: i32,
    pub loc: u8,
    pub mover: Pid,
    pub before: [i32; 5],
    pub after: [i32; 5],
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
    /// At the round's first play: the presence on the board, and the bots' reading of this round's vote presence
    /// (their projected presence), to compare with the presence after the fights.
    pub opening: i32,
    pub read: f64,
    /// ...and the end-of-round reading (persona endread): the presence after the round's fights from 8 play-outs of
    /// the round by every seat's own bot, and the change per later round.
    pub end_read: f64,
    pub end_trend: f64,
}

#[derive(Clone, Debug)]
pub struct SeatLog {
    pub standing: [i32; 5],
    pub trophies: [i32; 5],
    pub supply: i32,
    pub on_board: i32,
    pub goal: Option<&'static str>,
    pub p_invaders: f64,
    /// A hedger's break-glass commitment so far (persona glass), and its gut draw.
    pub broke: Option<&'static str>,
    pub early: Option<f64>,
    /// The seat's dials this game (nerve, loyalty, sharpness, the irrational draw, its timing).
    pub traits: Vec<f64>,
    /// The seat's own forecast of the invaders' ending, by its settings (vknown, drain, trend).
    pub p_forecast: f64,
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
    /// The move of the game it was (matches the sway log's and fight log's mv).
    pub mv: usize,
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
    SeatLog { standing: p.standing, trophies: p.trophies, supply: p.supply, on_board: on_board(s, pid), goal: goal_name(m), p_invaders: crate::bots::win_chances(s, pid).p_invaders,
        broke: m.broke.map(|g| match g { crate::bots::Goal::Invaders => "invaders", crate::bots::Goal::Island => "island" }), early: m.early, traits: m.traits.clone(), p_forecast: crate::bots::forecast(s, pid) }
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
pub static POSITIONS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Quick-bot checks (`fidelity=1`, 2026-11-03): at each real play decision, what the quick bot would have played; at
/// each round's first play, imagined rounds as the full bots' play-outs play them.
pub static FIDELITY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Quick-bot variants to check beside the plain one (`quickvars=judge=1|...`): persona settings added to the seat's
/// quick profile.
pub static QUICK_VARIANTS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// A real play decision against the quick bot's choice in the same position.
#[derive(Clone, Debug)]
pub struct QuickTurn {
    pub mv: usize,
    pub round: i32,
    pub seat: Pid,
    pub same: bool,
    pub same_card: bool,
    pub real_pass: bool,
    pub quick_pass: bool,
    /// The full bot's own scores of the quick bot's move and of its chosen one (one-step; play-out if shortlisted).
    pub quick_score: Option<(f64, Option<f64>)>,
    pub real_score: Option<(f64, Option<f64>)>,
    /// At fights already set: did the real move / the quick move make a tie by matching the leader, or break a tie?
    pub real_tie: bool,
    pub quick_tie: bool,
    pub real_break: bool,
    pub quick_break: bool,
    /// Could the mover match the leader somewhere (second, within its reach is not checked: second place with sway)?
    pub second: bool,
    /// Each extra quick-bot variant (QUICK_VARIANTS, in order): (same move, same card, the full bot's scores of its move).
    pub variants: Vec<(bool, bool, Option<(f64, Option<f64>)>)>,
    /// Play-out noise (every fourth decision): for each shortlisted move, (one-step score, the bot's own play-out
    /// value, two fresh 6-seed values, a 48-seed value, chosen?).
    pub noise: Vec<(f64, f64, f64, f64, f64, bool)>,
}

/// A round's imagined outcome (8 play-outs from its first play) against what happened.
#[derive(Clone, Debug)]
pub struct QuickRound {
    pub round: i32,
    pub seat: Pid,
    pub p_invaders: f64,
    pub trophies: Vec<f64>,
    pub standing: Vec<f64>,
    pub start_trophies: Vec<i32>,
    pub start_standing: Vec<i32>,
    /// Where each imagined round stopped: past its fights, or still in the round (and in which phase).
    pub stops: Vec<String>,
}

/// Tie actions of a move at fights already set: (made a tie by matching the leader, broke a tie).
fn tie_actions(s: &crate::types::GameState, pid: Pid, m: &crate::types::Move) -> (bool, bool) {
    let locs = crate::game::fights_due(s);
    if locs.is_empty() { return (false, false); }
    let (flow, fights, earlier, night) = (crate::game::take_flow(), crate::game::take_fights(), crate::game::take_fight_log(), crate::game::take_night_log());
    let b = crate::game::apply_move(s, pid, m);
    let fought = crate::game::take_fight_log();
    crate::game::put_back(flow, fights, earlier);
    crate::game::put_back_night(night);
    let Ok(b) = b else { return (false, false) };
    let (mut made, mut broke) = (false, false);
    for l in locs {
        let before: [i32; 5] = std::array::from_fn(|o| s.board[l as usize].sway.get(o as u8));
        let after: [i32; 5] = match fought.iter().find(|f| f.loc == l) {
            Some(f) => f.sway,
            None if b.round == s.round => std::array::from_fn(|o| b.board[l as usize].sway.get(o as u8)),
            None => continue,
        };
        let me = pid as usize;
        let best_other = |w: &[i32; 5]| (0..s.n()).filter(|&o| o != me).map(|o| w[o]).max().unwrap_or(0);
        if before[me] < best_other(&before) && after[me] == best_other(&after) && after[me] > 0 { made = true; }
        if before[me] > 0 && before[me] == best_other(&before) && after[me] > best_other(&after) { broke = true; }
    }
    (made, broke)
}

/// Tie checks (`ties=1`): at each turn, could the player break a tie for the most sway at a fight already set?
/// The card study (`cards=1`): log every turn's hand and weighed moves, and every draft pick.
pub static CARDS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The strength probe: the share of turns of play probed (in thousandths), the cards tested per probe, and the
/// play-outs per side.
pub static PROBE_RATE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub static PROBE_SAMPLE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(4);
pub static PROBE_PLAYOUTS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(4);
/// The cards the probe tests (`probeCards=a,b`, the measuring tool's focus=); empty: the whole deck.
pub static PROBE_CARDS: std::sync::RwLock<Vec<crate::types::CardIx>> = std::sync::RwLock::new(Vec::new());

/// One controlled card test's value: the seat's own bot decides from `s` (its memory and the table as they are), and
/// that decision is played out to the round's end on `seeds`. The decision's random draws come from `seed` alone, so
/// the two sides of a test meet the same luck.
fn probe_value(s: &crate::types::GameState, pid: Pid, profile: &str, memory: &BotMemory, table: &Seats, seed: i64, seeds: &[i64]) -> (f64, Option<crate::types::Move>) {
    let mut mem = memory.clone();
    let mut rng = seeded(seed);
    let m = bot_move(s, pid, &mut rng, profile, Some(&mut mem), table);
    let v = match &m {
        Some(m) => crate::bots::playout_values(s, pid, profile, Some(&mem), table, std::slice::from_ref(m), seeds)[0],
        None => f64::NAN,
    };
    (v, m)
}
pub static TIES: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A turn where the player was tied for the most sway at a fight already set (2026-11-03): could any legal play in hand
/// make them strictly first there (`could`; plays that end the round are judged by the sway just before its fights),
/// and did the play they chose (`did`)? `size`: the monsters at the location.
#[derive(Clone, Debug)]
pub struct TieTurn {
    pub mv: usize,
    pub round: i32,
    pub seat: Pid,
    pub loc: u8,
    pub size: i32,
    pub could: bool,
    pub did: bool,
    /// The bot's own view (when it could break and didn't): candidates it scored, the best-ranked breaking play's
    /// place among them (0 = top; None: not among them), whether that one was played out, its play-out value and the
    /// chosen play's.
    pub listed: usize,
    pub rank: Option<usize>,
    pub played_out: bool,
    pub break_value: Option<f64>,
    pub chosen_value: Option<f64>,
    /// The one-step (quick) scores of the same two plays: the shortlist is cut on these.
    pub break_quick: Option<f64>,
    pub chosen_quick: Option<f64>,
    /// The seat's goal then (which ending it plays for: it values trophies or standing accordingly).
    pub goal: Option<String>,
}

/// The fights already set where `pid` is tied for the most sway (with sway there).
fn tied_at(s: &crate::types::GameState, pid: Pid) -> Vec<u8> {
    crate::game::fights_due(s).into_iter().filter(|&l| {
        let sw = &s.board[l as usize].sway;
        let mine = sw.get(pid);
        mine > 0 && (0..s.n() as u8).filter(|&o| o != pid).map(|o| sw.get(o)).max().unwrap_or(0) == mine
    }).collect()
}

/// Strictly first at `l` in a state (or at the fight's own reading when the play ended the round).
fn first_at(sway: &[i32; 5], pid: Pid, n: usize) -> bool {
    let mine = sway[pid as usize];
    mine > 0 && (0..n).filter(|&o| o != pid as usize).all(|o| sway[o] < mine)
}

/// Which of `locs` a move leaves `pid` strictly first at (a play that ends the round: the sway just before its fights).
/// Real (logging) states, so the runner's own logs are set aside first and put back after.
fn breaks(s: &crate::types::GameState, pid: Pid, m: &crate::types::Move, locs: &[u8]) -> Vec<bool> {
    let (flow, fights, earlier, night) = (crate::game::take_flow(), crate::game::take_fights(), crate::game::take_fight_log(), crate::game::take_night_log());
    let b = crate::game::apply_move(s, pid, m);
    let fought = crate::game::take_fight_log();
    crate::game::put_back(flow, fights, earlier);
    crate::game::put_back_night(night);
    let Ok(b) = b else { return vec![false; locs.len()] };
    locs.iter().map(|&l| {
        let sway: [i32; 5] = match fought.iter().find(|f| f.loc == l) {
            Some(f) => f.sway,
            None if b.round == s.round => std::array::from_fn(|o| b.board[l as usize].sway.get(o as u8)),
            None => return false,
        };
        first_at(&sway, pid, s.n())
    }).collect()
}

/// Which tied locations some legal play breaks in `pid`'s favour.
fn breakable(s: &crate::types::GameState, pid: Pid, locs: &[u8]) -> Vec<bool> {
    let mut x: u64 = 0x7155;
    let mut rng = move || { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 11) as f64 / (1u64 << 53) as f64 };
    let mut out = vec![false; locs.len()];
    for m in crate::bots::candidates(s, pid, &mut rng, 40, true, false, None, None) {
        for (o, b) in out.iter_mut().zip(breaks(s, pid, &m, locs)) {
            *o |= b;
        }
    }
    out
}
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
    crate::game::take_fight_log();
    crate::game::take_night_log();
    let mut fight_log: Vec<crate::game::FightRec> = Vec::new();
    let mut night_log: Vec<crate::game::NightRec> = Vec::new();
    let mut sway_log: Vec<SwayChange> = Vec::new();
    let mut tie_turns: Vec<TieTurn> = Vec::new();
    let ties_on = TIES.load(std::sync::atomic::Ordering::Relaxed);
    let fidelity_on = FIDELITY.load(std::sync::atomic::Ordering::Relaxed);
    let mut quick_turns: Vec<QuickTurn> = Vec::new();
    let mut quick_rounds: Vec<QuickRound> = Vec::new();
    let cards_on = CARDS.load(std::sync::atomic::Ordering::Relaxed);
    let mut card_turns: Vec<CardTurn> = Vec::new();
    let mut draft_picks: Vec<DraftPick> = Vec::new();
    let probe_rate = PROBE_RATE.load(std::sync::atomic::Ordering::Relaxed);
    let mut probes: Vec<ProbeLog> = Vec::new();
    // Its own stream, so probing never changes the game's draws (the same games, probed or not).
    let mut probe_rng = seeded(seed * 31_337 + g as i64 * 101 + 7);
    let mut imagined_round = -1;
    let grid = |s: &crate::types::GameState| -> Vec<[i32; 5]> { s.board.iter().map(|p| std::array::from_fn(|i| p.sway.get(i as u8))).collect() };
    let mut fights_seen: Vec<([i32; 5], [i32; 5], usize)> = Vec::new();
    let mut rounds: Vec<RoundLog> = Vec::new();
    let mut playlog: Vec<PlayLog> = Vec::new();
    let mut round_first = None;
    let mut round_open = (0, 0.0, 0.0, 0.0);
    let mut swings: Vec<SwingLog> = Vec::new();
    let swing_on = SWING.load(std::sync::atomic::Ordering::Relaxed);
    let positions_on = POSITIONS.load(std::sync::atomic::Ordering::Relaxed);
    let mut positions: Vec<Vec<f64>> = Vec::new();
    let mut played_round = 0usize;
    let mut round = s.round;
    let mut moves = 0;
    let stop = STOP_AFTER.load(std::sync::atomic::Ordering::Relaxed);
    while moves < MAX_MOVES && s.phase != Phase::Ended && (stop == 0 || s.round <= stop) {
        let mut moved = false;
        let (sway_before, round_before, in_play) = (grid(&s), s.round, s.phase == Phase::Play);
        let mut mover: Pid = 0;
        // Tie checks: the player to move, tied for the most sway at fights already set.
        let tie_check: Vec<(u8, bool, i32)> = if ties_on && in_play {
            let pid = s.turn as Pid;
            let locs = tied_at(&s, pid);
            if locs.is_empty() { Vec::new() } else {
                let could = breakable(&s, pid, &locs);
                locs.iter().zip(could).map(|(&l, c)| (l, c, s.board[l as usize].tokens.iter().map(|e| e.1).sum())).collect()
            }
        } else { Vec::new() };
        let tie_seat = s.turn as Pid;
        let fid = fidelity_on && in_play && !s.players[s.turn].hand.is_empty();
        if fid && imagined_round != s.round {
            // Imagined rounds from the round's first play, as this seat's full bot would imagine them.
            imagined_round = s.round;
            let pid = s.turn as Pid;
            let table = Seats { profiles: Some(profiles.clone()), memories: Some(memory.iter().enumerate().map(|(i, m)| (i as Pid, m.clone())).collect()), ..Default::default() };
            let k = 8;
            let (mut inv, mut tr, mut st) = (0.0, vec![0.0; n], vec![0.0; n]);
            let mut stops: Vec<String> = Vec::new();
            for i in 0..k {
                let e = crate::bots::imagine_round(&s, 7_000 + i as i64 + 101 * moves as i64, pid, Some(&memory[pid as usize]), &table);
                if e.votes[0] > s.votes[0] { inv += 1.0; }
                stops.push(if e.round > s.round || e.phase == Phase::Ended { "done".into() } else { format!("{:?}", e.phase) });
                for p in 0..n {
                    tr[p] += (0..5).map(|f| e.players[p].trophies[f]).sum::<i32>() as f64 / k as f64;
                    st[p] += (0..5).map(|f| e.players[p].standing[f]).sum::<i32>() as f64 / k as f64;
                }
            }
            quick_rounds.push(QuickRound { round: s.round, seat: pid, p_invaders: inv / k as f64, trophies: tr, standing: st,
                start_trophies: (0..n).map(|p| s.players[p].trophies.iter().sum()).collect(), start_standing: (0..n).map(|p| s.players[p].standing.iter().sum()).collect(), stops });
        }
        let quick_all: Vec<Option<crate::types::Move>> = if fid {
            let pid = s.turn as Pid;
            let extra = QUICK_VARIANTS.lock().unwrap().clone();
            std::iter::once(String::new()).chain(extra).map(|v| {
                let mut x: u64 = 0x9e37 ^ moves as u64;
                let mut rng = move || { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 11) as f64 / (1u64 << 53) as f64 };
                let mut mem = memory[pid as usize].clone();
                let base = &seats[pid as usize];
                let profile = if v.is_empty() { base.clone() } else if base.contains(':') { format!("{base},{v}") } else { format!("{base}:{v}") };
                crate::bots::quick_move(&s, pid, &mut rng, &profile, Some(&mut mem))
            }).collect()
        } else { Vec::new() };
        let quick: Option<crate::types::Move> = quick_all.first().cloned().flatten();
        let fid_state = if fid { Some(s.clone()) } else { None };
        let state_before = if tie_check.is_empty() && !fid { None } else { Some(s.clone()) };
        if !tie_check.is_empty() || fid || cards_on {
            crate::bots::take_considered();
            crate::bots::take_draft_worth();
        }
        let mut chosen: Option<crate::types::Move> = None;
        let mut considered: Vec<(crate::types::Move, f64, Option<f64>)> = Vec::new();
        if s.phase == Phase::Play && round_first.is_none_or(|_| false) {
            round_first = s.first;
            let table = Seats { profiles: Some(profiles.clone()), memories: Some(memory.iter().enumerate().map(|(i, m)| (i as Pid, m.clone())).collect()), ..Default::default() };
            let mut r = seeded(seed * 13 + g as i64 * 101 + s.round as i64);
            let (a, t) = crate::bots::flow_ahead(&s, s.turn as Pid, &mut r, Some(&memory[s.turn]), &table, 8);
            round_open = (crate::board::total_presence(&s), crate::bots::win_chances(&s, 0).projected, a, t);
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
        if positions_on && s.phase == Phase::Play {
            for pid in 0..n as Pid {
                positions.push(crate::judge::position_row(&s, pid));
            }
        }
        if probe_rate > 0 && s.phase == Phase::Play && !s.players[s.turn].hand.is_empty() && probe_rng() * 1000.0 < probe_rate as f64 {
            let pid = s.turn as Pid;
            let table = Seats { profiles: Some(profiles.clone()), memories: Some(memory.iter().enumerate().map(|(i, m)| (i as Pid, m.clone())).collect()), ..Default::default() };
            let k = PROBE_SAMPLE.load(std::sync::atomic::Ordering::Relaxed);
            let np = PROBE_PLAYOUTS.load(std::sync::atomic::Ordering::Relaxed).max(1);
            let base_seed = (probe_rng() * 2_147_483_648.0) as i64;
            let seeds: Vec<i64> = (0..np as i64).map(|i| base_seed + 7919 * i).collect();
            // A sample of the deck (or of the focus cards), each card at most once.
            let focus = PROBE_CARDS.read().map(|f| f.clone()).unwrap_or_default();
            let mut pool: Vec<crate::types::CardIx> = if focus.is_empty() { (0..crate::bots::all_cards() as crate::types::CardIx).collect() } else { focus };
            let mut picked: Vec<crate::types::CardIx> = Vec::new();
            while picked.len() < k.min(pool.len()) {
                let i = ((probe_rng() * pool.len() as f64) as usize).min(pool.len() - 1);
                picked.push(pool.swap_remove(i));
            }
            let mut without: HashMap<Vec<crate::types::CardIx>, f64> = HashMap::new();
            let goal = goal_name(&memory[pid as usize]);
            for card in picked {
                let hand: Vec<crate::types::CardIx> = s.players[pid as usize].hand.to_vec();
                let held = hand.contains(&card);
                let rest: Vec<crate::types::CardIx> = hand.iter().copied().filter(|&c| c != card).collect();
                // Without the card: the hand less it (an empty hand can't decide, so that side is not measured).
                let w = if rest.is_empty() { f64::NAN } else {
                    *without.entry(rest.clone()).or_insert_with(|| {
                        let mut x = s.clone();
                        x.players[pid as usize].hand = crate::types::Hand::from_slice(&rest);
                        probe_value(&x, pid, &seats[pid as usize], &memory[pid as usize], &table, base_seed, &seeds).0
                    })
                };
                let mut x = s.clone();
                let mut with = rest.clone();
                with.push(card);
                if with.len() > 8 { continue; }
                x.players[pid as usize].hand = crate::types::Hand::from_slice(&with);
                let (v, m) = probe_value(&x, pid, &seats[pid as usize], &memory[pid as usize], &table, base_seed, &seeds);
                let used = matches!(m, Some(crate::types::Move::Play { card: c, .. }) if c == card);
                if !v.is_nan() && !w.is_nan() {
                    probes.push(ProbeLog { mv: moves, round: s.round, seat: pid, goal, card: spec().cards[card as usize].id.clone(), held, benefit: v - w, used });
                }
            }
            // The probe's decisions leave their notes behind; the real decision's must start clean.
            crate::bots::take_considered();
            crate::bots::take_decision();
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
                let weighed = if cards_on { Some(crate::bots::take_considered()) } else { None };
                if pid == tie_seat && state_before.is_some() {
                    considered = weighed.clone().unwrap_or_else(crate::bots::take_considered);
                    chosen = Some(m.clone());
                }
                if let Some(weighed) = weighed {
                    let names = |h: &[crate::types::CardIx]| h.iter().map(|&c| spec().cards[c as usize].id.clone()).collect::<Vec<_>>();
                    let me = &s.players[pid as usize];
                    if s.phase == Phase::Play && !me.hand.is_empty() {
                        let mv_json = |x: &crate::types::Move| crate::json::move_to_value(&s.factions, x);
                        card_turns.push(CardTurn {
                            mv: moves, round: s.round, seat: pid, goal: goal_name(&memory[pid as usize]), hand: names(&me.hand),
                            acts: me.hand.iter().map(|&c| crate::choice::list_targets(&s, pid, c, 40, false).0.len()).collect(),
                            instinct: weighed.is_empty(),
                            options: weighed.iter().map(|(x, q, v)| (mv_json(x), *q, *v)).collect(),
                            chosen: mv_json(&m),
                        });
                    }
                    if s.phase == Phase::Draft {
                        if let crate::types::Move::Pick { keep } = &m {
                            let worth = crate::bots::take_draft_worth();
                            let picked = keep.iter().find(|c| !me.kept.contains(c)).map(|&c| spec().cards[c as usize].id.clone()).unwrap_or_default();
                            draft_picks.push(DraftPick { round: s.round, seat: pid, kept: names(&me.kept), offered: names(&me.batch),
                                worth: worth.iter().map(|&(c, w)| (spec().cards[c as usize].id.clone(), w)).collect(), picked });
                        }
                    }
                }
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
                                    placed: on_board(&next, pid) - board0, moved: shifted, closed: !closes.is_empty(), goal: goal_name(&memory[pid as usize]), p_invaders: p_inv, mv: moves,
                                });
                            }
                            fights_seen.extend(closes);
                            let (lost, grown) = note(&mut flow, round_now, before, crate::board::total_presence(&next), true);
                            plays.push((pid, crate::board::total_presence(&next) - before + lost - grown, waited));
                            s = next;
                            moved = true;
                            mover = pid;
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
                mover = pid;
                break;
            }
        }
        assert!(moved, "game {g}: nobody can move in {:?}", s.phase);
        {
            // Sway changes this move: at a fought location, compare with its sway just before the fight.
            let mut fought = crate::game::take_fight_log();
            let mut after = grid(&s);
            for f in fought.iter_mut() {
                f.mv = moves;
                after[f.loc as usize] = f.sway;
            }
            if let (Some(q), Some(st0)) = (quick.as_ref(), fid_state.as_ref()) {
                if mover == tie_seat {
                    if let Some(real) = chosen.as_ref() {
                        let card_of = |m: &crate::types::Move| if let crate::types::Move::Play { card, .. } = m { Some(*card) } else { None };
                        let score = |m: &crate::types::Move| considered.iter().find(|c| &c.0 == m).map(|c| (c.1, c.2));
                        let mut noise_rows = Vec::new();
                        if moves % 4 == 0 {
                            let short: Vec<&(crate::types::Move, f64, Option<f64>)> = considered.iter().filter(|c| c.2.is_some()).collect();
                            if short.len() >= 2 {
                                let ms: Vec<crate::types::Move> = short.iter().map(|c| c.0.clone()).collect();
                                let table = Seats { profiles: Some(profiles.clone()), memories: Some(memory.iter().enumerate().map(|(i, m)| (i as Pid, m.clone())).collect()), ..Default::default() };
                                let seeds = |base: i64, k: usize| (0..k as i64).map(|i| base + 7919 * i + 104_729 * moves as i64).collect::<Vec<i64>>();
                                let mem = Some(&memory[tie_seat as usize]);
                                let prof = &seats[tie_seat as usize];
                                let a = crate::bots::playout_values(st0, tie_seat, prof, mem, &table, &ms, &seeds(11, 6));
                                let b = crate::bots::playout_values(st0, tie_seat, prof, mem, &table, &ms, &seeds(23, 6));
                                let t = crate::bots::playout_values(st0, tie_seat, prof, mem, &table, &ms, &seeds(37, 48));
                                for (i, c) in short.iter().enumerate() {
                                    noise_rows.push((c.1, c.2.unwrap(), a[i], b[i], t[i], &c.0 == real));
                                }
                            }
                        }
                        let (rt, rb) = tie_actions(st0, tie_seat, real);
                        let (qt, qb) = tie_actions(st0, tie_seat, q);
                        let second = crate::game::fights_due(st0).into_iter().any(|l| {
                            let sw = &st0.board[l as usize].sway;
                            let me = sw.get(tie_seat);
                            let best = (0..st0.n() as u8).filter(|&o| o != tie_seat).map(|o| sw.get(o)).max().unwrap_or(0);
                            best > 0 && me < best
                        });
                        quick_turns.push(QuickTurn { mv: moves, round: round_before, seat: tie_seat, same: real == q, same_card: card_of(real).is_some() && card_of(real) == card_of(q),
                            real_pass: matches!(real, crate::types::Move::Pass), quick_pass: matches!(q, crate::types::Move::Pass),
                            quick_score: score(q), real_score: score(real), real_tie: rt, quick_tie: qt, real_break: rb, quick_break: qb, second,
                            noise: noise_rows,
                            variants: quick_all.iter().skip(1).map(|v| match v { Some(v) => (v == real, card_of(real).is_some() && card_of(real) == card_of(v), score(v)), None => (false, false, None) }).collect() });
                    }
                }
            }
            for &(l, could, size) in &tie_check {
                let did = mover == tie_seat && first_at(&after[l as usize], tie_seat, s.n());
                let (mut listed, mut rank, mut played_out, mut break_value, mut chosen_value) = (0, None, false, None, None);
                let (mut break_quick, mut chosen_quick) = (None, None);
                if could && !did && !considered.is_empty() {
                    listed = considered.len();
                    let pick = chosen.as_ref().and_then(|m| considered.iter().find(|c| &c.0 == m));
                    chosen_value = pick.and_then(|c| c.2);
                    chosen_quick = pick.map(|c| c.1);
                    // The best breaking play in the bot's list: shortlisted ones first (best play-out), else the best-ranked.
                    let breaking: Vec<usize> = (0..considered.len()).filter(|&i| breaks(state_before.as_ref().unwrap(), tie_seat, &considered[i].0, &[l])[0]).collect();
                    let best = breaking.iter().copied().filter(|&i| considered[i].2.is_some()).max_by(|&a, &b| considered[a].2.partial_cmp(&considered[b].2).unwrap_or(std::cmp::Ordering::Equal)).or(breaking.first().copied());
                    if let Some(i) = best {
                        rank = Some(i);
                        played_out = considered[i].2.is_some();
                        break_value = considered[i].2;
                        break_quick = Some(considered[i].1);
                    }
                }
                tie_turns.push(TieTurn { mv: moves, round: round_before, seat: tie_seat, loc: l, size, could, did, listed, rank, played_out, break_value, chosen_value, break_quick, chosen_quick, goal: goal_name(&memory[tie_seat as usize]).map(String::from) });
            }
            if in_play {
                for (l, (a, b)) in sway_before.iter().zip(&after).enumerate() {
                    if a != b {
                        sway_log.push(SwayChange { mv: moves, round: round_before, loc: l as u8, mover, before: *a, after: *b });
                    }
                }
            }
            fight_log.extend(fought);
            night_log.extend(crate::game::take_night_log());
        }
        moves += 1;
        if s.votes != last_votes {
            votes.push(s.votes[0] > last_votes[0]);
            last_votes = s.votes;
        }
        if s.round != round || s.phase == Phase::Ended {
            let (bf, af, nf) = fights_seen.last().copied().unwrap_or(([0; 5], [0; 5], 0));
            fights_seen.clear();
            // A round whose vote counts nothing (firstVote 0) leaves no mark on the count: log the side it fell to.
            if s.options.round_votes && s.options.vote_weight(round) == 0 && votes.len() < round as usize {
                votes.push(af.iter().sum::<i32>() > s.options.threshold);
            }
            rounds.push(RoundLog { round, before_fights: bf, after_fights: af, end: by_faction(&s), seats: (0..n).map(|p| seat_log(&s, p as Pid, &memory[p])).collect(), first: round_first, fights: nf, occupied: (0..s.board.len() as u8).filter(|&l| crate::board::count_at(&s, l) >= 1).count(), opening: round_open.0, read: round_open.1, end_read: round_open.2, end_trend: round_open.3 });
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
        fight_log,
        night_log,
        sway_log,
        tie_turns,
        quick_turns,
        quick_rounds,
        card_turns,
        draft_picks,
        probes,
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
        positions,
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
