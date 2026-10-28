//! Command line tools for the Rust engine.
//!
//!   motw fingerprint games=20 seed=1 profiles=a;b;... [check=file.jsonl] [out=file.jsonl] [digests=1] [o.variant=choice ...]
//!     Bot games on fixed seeds (the play fingerprint, src/fingerprint.rs), every move and state hashed; out= writes one
//!     line per move, check= compares with such a file move by move (say, one written before a change), digests=1
//!     prints each game's digest as tests/fixtures/fingerprints.json records it.
//!
//!   motw time profile=backer [seed=9] [decisions=5]
//!     Seconds per decision for a profile: from the start of round 2, seat 5's next decisions (others fast bots).

use motw::game::apply_move;
use motw::setup::create_game;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("fingerprint") => fingerprint(&args[1..]),
        Some("time") => time(&args[1..]),
        _ => eprintln!("usage: motw fingerprint games=20 seed=1 profiles=a;b;... | motw time profile=backer"),
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

fn fingerprint(args: &[String]) {
    use motw::fingerprint::{digest, play};
    use motw::json::move_to_value;
    let (kv, options) = opts(args);
    let games: i64 = kv.get("games").map(|x| x.parse().unwrap()).unwrap_or(20);
    let seed0: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(1);
    let profiles: Vec<String> = kv.get("profiles").cloned().unwrap_or_else(|| "backer:sim=0;backer:sim=0;trophy:sim=0;trophy:sim=0;trophy:sim=0".into()).split(';').map(|s| s.to_string()).collect();
    let names: Vec<String> = (1..=profiles.len()).map(|i| format!("P{i}")).collect();
    let want: Option<BTreeMap<i64, Vec<serde_json::Value>>> = kv.get("check").map(|f| {
        let mut m: BTreeMap<i64, Vec<serde_json::Value>> = BTreeMap::new();
        for line in std::fs::read_to_string(f).expect("read").lines().filter(|l| !l.is_empty()) {
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            m.entry(v["g"].as_i64().unwrap()).or_default().push(v);
        }
        m
    });
    let factions = |g: i64| create_game(seed0 + g, &names, &options).expect("game").factions;
    let mut out: Vec<String> = Vec::new();
    let (mut bad, mut moves) = (0, 0);
    let t0 = std::time::Instant::now();
    for g in 0..games {
        let game = play(seed0 + g, &profiles, &options);
        let f = factions(g);
        let lines: Vec<serde_json::Value> = game.iter().enumerate().map(|(i, (m, hash))| match m {
            Some((pid, m)) => serde_json::json!({ "g": g, "i": i, "pid": names[*pid as usize], "move": move_to_value(&f, m), "hash": hash }),
            None => serde_json::json!({ "g": g, "i": i, "pid": null, "move": null, "hash": hash }),
        }).collect();
        moves += game.len() - 1;
        if kv.contains_key("digests") {
            println!("{}", digest(game.iter().map(|x| x.1.as_str())));
        }
        if let Some(w) = &want {
            let refs = w.get(&g).cloned().unwrap_or_default();
            let k = lines.iter().zip(refs.iter()).position(|(a, b)| a["hash"] != b["hash"] || motw::json::canon(&a["move"]) != motw::json::canon(&b["move"]));
            if k.is_some() || refs.len() != lines.len() {
                bad += 1;
                let k = k.unwrap_or(lines.len().min(refs.len()));
                println!("game {g}: differs at move {k}: now {} before {}", lines.get(k).map(|x| x["move"].to_string()).unwrap_or_default(), refs.get(k).map(|x| x["move"].to_string()).unwrap_or_default());
            }
        }
        out.extend(lines.iter().map(|l| l.to_string()));
    }
    if let Some(f) = kv.get("out") {
        std::fs::write(f, out.join("\n") + "\n").expect("write");
    }
    println!("{games} games, {moves} moves, {:?}{}", t0.elapsed(), if want.is_some() { if bad > 0 { format!("; {bad} differ") } else { "; all match".into() } } else { String::new() });
}

fn time(args: &[String]) {
    use motw::bots::{bot_move, fast, BotMemory, Seats};
    use motw::game::waiting_on;
    let (kv, options) = opts(args);
    let profile = kv.get("profile").cloned().unwrap_or_else(|| "backer".into());
    let seed: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(9);
    let decisions: usize = kv.get("decisions").map(|x| x.parse().unwrap()).unwrap_or(5);
    let names: Vec<String> = (1..=5).map(|i| format!("P{i}")).collect();
    let mut s = create_game(seed, &names, &options).expect("game");
    let mut memory = vec![BotMemory::default(); 5];
    let mut x: u64 = seed as u64 * 2654435761 + 1;
    let mut rng = move || { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 11) as f64 / (1u64 << 53) as f64 };
    let quick = fast("trophy");
    let (mut timed, mut total) = (0usize, 0f64);
    let mut worst = 0f64;
    while s.phase != motw::types::Phase::Ended && timed < decisions {
        let pid = waiting_on(&s)[0];
        let mine = pid == 4 && s.round >= 2 && s.phase == motw::types::Phase::Play;
        let t0 = std::time::Instant::now();
        let m = bot_move(&s, pid, &mut rng, if mine { &profile } else { &quick }, Some(&mut memory[pid as usize]), &Seats::default()).expect("move");
        if mine {
            let t = t0.elapsed().as_secs_f64();
            total += t;
            worst = worst.max(t);
            timed += 1;
        }
        s = apply_move(&s, pid, &m).expect("legal");
    }
    println!("{profile}: {timed} decisions, {:.2} s each on average, {:.2} s at most", total / timed.max(1) as f64, worst);
}
