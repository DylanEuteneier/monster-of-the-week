//! Randomness, setup and the deal (engine.js "Randomness", "Setup").

use crate::spec::{spec, Slot};
use crate::types::*;
use std::rc::Rc;

/// mulberry32: one step of the generator. Returns (value in [0, 1), next state).
#[inline]
pub fn next_random(state: i32) -> (f64, i32) {
    let next = (state as u32).wrapping_add(0x6d2b_79f5);
    let mut t = next;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    (((t ^ (t >> 14)) as f64) / 4_294_967_296.0, next as i32)
}

/// Fisher–Yates shuffle driven by the seeded generator.
pub fn shuffle<T: Clone>(items: &[T], rng_state: i32) -> (Vec<T>, i32) {
    let mut out = items.to_vec();
    let mut st = rng_state;
    let mut i = out.len();
    while i > 1 {
        i -= 1;
        let (v, next) = next_random(st);
        st = next;
        let j = (v * (i as f64 + 1.0)).floor() as usize;
        out.swap(i, j);
    }
    (out, st)
}

/// Add a line to this round's log (nothing in a quiet, imagined state).
/// The line is built only when the state logs (a bot's imagined states don't), from the state as it now is.
pub fn log_line(s: &mut GameState, line: impl FnOnce(&GameState) -> String) {
    if s.quiet {
        return;
    }
    let round = s.round;
    let text = line(s);
    if let Some(e) = s.log.iter_mut().find(|e| e.round == round) {
        Rc::make_mut(e).events.push(text);
    } else {
        s.log.push(Rc::new(RoundLog { round, events: vec![text] }));
    }
}

/// A new game (createGame). `seed` as JavaScript's `seed | 0`.
pub fn create_game(seed: i64, players: &[String], raw_options: &[(String, String)]) -> Result<GameState, String> {
    let sp = spec();
    if players.len() < sp.min_players || players.len() > sp.max_players {
        return Err(format!("a game seats {}–{} players", sp.min_players, sp.max_players));
    }
    for (i, p) in players.iter().enumerate() {
        if players[..i].contains(p) {
            return Err("player names must be unique".into());
        }
    }
    let options = Options::resolve(raw_options)?;
    let mut rng = seed as i32;
    // One faction picked at random from each archetype (3.4).
    let mut factions = [0u8; 5];
    for (a, slot) in factions.iter_mut().enumerate() {
        let pool: Vec<u8> = (0..sp.factions.len() as u8).filter(|&f| sp.factions[f as usize].archetype == a).collect();
        let (items, st) = shuffle(&pool, rng);
        rng = st;
        *slot = items[0];
    }
    let mut board: Vec<Place> = (0..sp.locations.len()).map(|_| Place::default()).collect();
    let mut supply = [0i32; 5];
    for f in 0..5u8 {
        // SD1: 2 on each of the archetype's three locations (seeding=two); even: 3 on each; home: 5 on one, 1 on the others.
        let locs: Vec<Loc> = (0..sp.locations.len() as Loc).filter(|&l| sp.locations[l as usize].archetype == f as usize).collect();
        let (items, st) = shuffle(&locs, rng);
        rng = st;
        let mut placed = 0;
        for &l in &items {
            let n = match options.seeding {
                Seeding::Two => sp.seeding_two,
                Seeding::Even => sp.seeding_even,
                Seeding::Home => if l == items[0] { sp.seeding_home } else { sp.seeding_other },
            };
            board[l as usize].tokens.set(f, n);
            placed += n;
        }
        supply[f as usize] = options.faction_tokens - placed;
    }
    let mut groups: Vec<u8> = (0..sp.slayer_groups.len() as u8).collect();
    if options.groups_random {
        let (items, st) = shuffle(&groups, rng);
        rng = st;
        groups = items;
    }
    let mut ps = Vec::new();
    for (i, _) in players.iter().enumerate() {
        let group = groups[i];
        let arch = sp.slayer_groups[group as usize].archetype;
        // Starting setup (designer, 2026-10-07): more with the affinity faction, startOthers with every other faction.
        let mut standing = [0i32; 5];
        for (f, st) in standing.iter_mut().enumerate() {
            *st = if f == arch { options.start_sway } else { options.start_others };
        }
        let held: i32 = standing.iter().sum();
        let mut p = Player { group, supply: options.player_cubes - held, standing, trophies: [0; 5], hand: Hand::new(), kept: Hand::new(), batch: Hand::new(), picked: false };
        // Each slayer group starts with sway at each of its affinity locations, from its supply.
        for l in 0..sp.locations.len() {
            if sp.locations[l].archetype != arch {
                continue;
            }
            let n = options.start_board.min(p.supply);
            if n > 0 {
                board[l].sway.add(i as Pid, n);
                p.supply -= n;
            }
        }
        ps.push(p);
    }
    let mut s = GameState {
        version: Rc::from(sp.version.as_str()),
        options: Rc::new(options),
        rng_state: rng,
        phase: Phase::Draft,
        round: 1,
        seating: Rc::new(players.to_vec()),
        players: ps,
        factions,
        board: board.try_into().expect("15 locations"),
        supply,
        left_out: Small::new(),
        pass: 1,
        first: None,
        turn: 0,
        passes_in_row: 0,
        opened: false,
        round_plays: vec![],
        growing: None,
        night: None,
        log: vec![],
        result: None,
        quiet: false,
    };
    deal(&mut s);
    Ok(s)
}

/// The game's cards: the core deck, all 21 (PS1).
pub fn deck() -> Vec<CardIx> {
    (0..spec().cards.len() as CardIx).collect()
}

/// Start a round's draft: shuffle all 21 cards, deal hands, leave the rest out (PS1, DR4, DR5).
pub fn deal(s: &mut GameState) {
    let hand = spec().hand_size[s.n()];
    let (items, st) = shuffle(&deck(), s.rng_state);
    s.rng_state = st;
    for i in 0..s.n() {
        let p = &mut s.players[i];
        p.batch = Hand::from_slice(&items[i * hand..(i + 1) * hand]);
        p.kept = Hand::new();
        p.hand = Hand::new();
        p.picked = false;
    }
    s.left_out = Small::from_slice(&items[s.n() * hand..]);
    s.round_plays = vec![];
    s.phase = Phase::Draft;
    s.pass = 1;
    let (round, out) = (s.round, s.left_out.len());
    log_line(s, |_| format!("Round {round}: cards dealt, {out} left out unseen."));
}

/// A card's printed sway.
pub fn printed_of(card: CardIx) -> i32 {
    spec().cards[card as usize].sway
}

/// The Playbook (Steal Their Playbook).
// PERF: a linear search by id on every call (sway_for, last_action); store the index once.
pub fn playbook() -> CardIx {
    spec().card_ix("playbook").expect("playbook")
}

/// This round's last card played for its action, the Playbook's own plays aside.
pub fn last_action(s: &GameState) -> Option<CardIx> {
    let pb = playbook();
    s.round_plays.iter().rev().find(|x| x.use_ == PlayUse::Action && x.card != pb).map(|x| x.card)
}

/// The cards a player played earlier this round, each once, that the Playbook may take back.
pub fn own_plays(s: &GameState, pid: Pid) -> Vec<CardIx> {
    let pb = playbook();
    let mut out = Vec::new();
    for x in &s.round_plays {
        if x.pid == pid && x.card != pb && !out.contains(&x.card) {
            out.push(x.card);
        }
    }
    out
}

/// A card's sway for a player now (D24): a signature's is the cards in hand, itself included.
pub fn sway_for(s: &GameState, pid: Pid, card: CardIx) -> i32 {
    if spec().cards[card as usize].slot != Slot::Signature {
        return printed_of(card);
    }
    let hand = &s.players[pid as usize].hand;
    let held = hand.contains(&card) || (hand.contains(&playbook()) && last_action(s) == Some(card));
    hand.len() as i32 + if held { 0 } else { 1 }
}

/// The unsuited cards' X: the cards in hand, the one played included.
pub fn hand_x(s: &GameState, pid: Pid, card: CardIx) -> i32 {
    let hand = &s.players[pid as usize].hand;
    hand.len() as i32 + if hand.contains(&card) { 0 } else { 1 }
}
