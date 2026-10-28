//! Command line tools for the Rust engine.
//!
//!   motw replay <fingerprint.jsonl> players=5 seed=1 [o.variant=choice ...]
//!     Replays the moves a JavaScript fingerprint recorded (scripts/fingerprint.mjs) on the Rust engine, checking the
//!     state's hash after every move.

use motw::game::apply_move;
use motw::json::{game_hash, move_from_value};
use motw::setup::create_game;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("replay") => replay(&args[1..]),
        _ => eprintln!("usage: motw replay <file.jsonl> players=5 seed=1 [o.variant=choice ...]"),
    }
}

fn opts(args: &[String]) -> (BTreeMap<String, String>, Vec<(String, String)>) {
    let mut kv = BTreeMap::new();
    let mut options = Vec::new();
    for a in args {
        if let Some((k, v)) = a.split_once('=') {
            if let Some(o) = k.strip_prefix("o.") {
                options.push((o.to_string(), v.to_string()));
            } else {
                kv.insert(k.to_string(), v.to_string());
            }
        }
    }
    (kv, options)
}

fn replay(args: &[String]) {
    let file = &args[0];
    let (kv, options) = opts(&args[1..]);
    let players: usize = kv.get("players").map(|x| x.parse().unwrap()).unwrap_or(5);
    let seed0: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(1);
    let names: Vec<String> = (1..=players).map(|i| format!("P{i}")).collect();
    let text = std::fs::read_to_string(file).expect("read");
    let mut games: BTreeMap<i64, Vec<serde_json::Value>> = BTreeMap::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        games.entry(v["g"].as_i64().unwrap()).or_default().push(v);
    }
    let (mut good, mut bad, mut moves) = (0, 0, 0);
    let t0 = std::time::Instant::now();
    for (g, lines) in &games {
        let mut s = create_game(seed0 + g, &names, &options).expect("game");
        let mut ok = true;
        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                let pid = s.pid_of(line["pid"].as_str().unwrap()).unwrap();
                let m = move_from_value(&s.factions, &line["move"]).expect("move");
                match apply_move(&s, pid, &m) {
                    Ok(next) => s = next,
                    Err(e) => {
                        println!("game {g}: move {i} refused: {e} ({})", line["move"]);
                        ok = false;
                        break;
                    }
                }
                moves += 1;
            }
            let h = game_hash(&s);
            if h != line["hash"].as_str().unwrap() {
                println!("game {g}: state differs after move {i} ({})", line["move"]);
                ok = false;
                break;
            }
        }
        if ok { good += 1 } else { bad += 1 }
    }
    println!("{} games, {moves} moves replayed in {:?}: {good} match, {bad} differ", games.len(), t0.elapsed());
}
