//! The play fingerprint: bot games on fixed seeds, every state hashed after every move, so a change that should not
//! change play (a speed-up, a clean-up) can be checked game by game (`motw fingerprint`, tests/fingerprints.rs). The
//! seeds and the random sequence are the ones the JavaScript recording used (scripts/fingerprint.mjs, retired with
//! the JavaScript engine), so the fixtures recorded there still hold. A checking tool, not a rule.

use crate::bots::{bot_move, BotMemory, Seats};
use crate::game::{apply_move, waiting_on};
use crate::json::game_hash;
use crate::setup::create_game;
use crate::types::{Move, Phase, Pid};

/// One bot game: every move (seat and move) and the state's hash after it, the start's hash first.
pub fn play(seed: i64, profiles: &[String], options: &[(String, String)]) -> Vec<(Option<(Pid, Move)>, String)> {
    let names: Vec<String> = (1..=profiles.len()).map(|i| format!("P{i}")).collect();
    let mut s = create_game(seed, &names, options).expect("game");
    let mut memory: Vec<BotMemory> = vec![BotMemory::default(); names.len()];
    // The fingerprint's random sequence, in doubles as JavaScript computes it.
    let mut r: f64 = (seed * 7919 + 1) as f64;
    let mut rng = move || {
        r = (r * 1103515245.0 + 12345.0) % 2147483648.0;
        r / 2147483648.0
    };
    let mut out = vec![(None, game_hash(&s))];
    while s.phase != Phase::Ended && out.len() < 5000 {
        let pid = waiting_on(&s)[0];
        let m = bot_move(&s, pid, &mut rng, &profiles[pid as usize], Some(&mut memory[pid as usize]), &Seats::default()).expect("a move");
        s = apply_move(&s, pid, &m).expect("legal");
        out.push((Some((pid, m)), game_hash(&s)));
    }
    out
}

/// A game's digest: its state hashes in order, hashed (16 hex digits).
pub fn digest<'a>(hashes: impl IntoIterator<Item = &'a str>) -> String {
    let mut h = sha1_smol::Sha1::new();
    for (i, x) in hashes.into_iter().enumerate() {
        if i > 0 {
            h.update(b"\n");
        }
        h.update(x.as_bytes());
    }
    h.digest().to_string()[..16].to_string()
}
