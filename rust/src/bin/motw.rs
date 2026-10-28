//! Command line tools for the Rust engine.
//!
//!   motw fingerprint games=20 seed=1 profiles=a;b;... [check=file.jsonl] [out=file.jsonl] [digests=1] [o.variant=choice ...]
//!     Bot games on fixed seeds (the play fingerprint, src/fingerprint.rs), every move and state hashed; out= writes one
//!     line per move, check= compares with such a file move by move (say, one written before a change), digests=1
//!     prints each game's digest as tests/fixtures/fingerprints.json records it.
//!
//!   motw tournament [games=20] [seed=1] profiles=a;b;... [workers=cores] [duplicate=1] [log=file.jsonl] [o.variant=choice ...]
//!     Whole bot games natively, the profiles rotated through the seats (src/tournament.rs): wins by profile and seat,
//!     the endings, and a line per game in log= (the same games scripts/tournament.js plays on the same seed).
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
        Some("tournament") => tournament(&args[1..]),
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

fn tournament(args: &[String]) {
    use std::io::Write;
    let (kv, options) = opts(args);
    let games: usize = kv.get("games").map(|x| x.parse().unwrap()).unwrap_or(20);
    let seed: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(1);
    let list: Vec<String> = kv.get("profiles").cloned().unwrap_or_else(|| "backer;backer;trophy;trophy;trophy".into()).split(';').map(|s| s.to_string()).collect();
    let workers: usize = kv.get("workers").map(|x| x.parse().unwrap()).unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let duplicate = kv.get("duplicate").is_some_and(|x| x == "1");
    let log = kv.get("log").map(|f| std::sync::Mutex::new(std::fs::OpenOptions::new().create(true).append(true).open(f).expect("log")));
    let t0 = std::time::Instant::now();
    let count = std::sync::atomic::AtomicUsize::new(0);
    let names: Vec<String> = (1..=list.len()).map(|i| format!("P{i}")).collect();
    let done = |x: &motw::tournament::Game| {
        let k = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        eprint!("\r{k}/{games} games, {:.0}s", t0.elapsed().as_secs_f64());
        if let Some(f) = &log {
            let id = |p: &u8| names[*p as usize].clone();
            let line = serde_json::json!({
                "g": x.g, "seed": seed, "side": if x.island { "island" } else { "invaders" },
                "seats": names.iter().cloned().zip(x.seats.iter().map(|p| serde_json::Value::from(p.as_str()))).collect::<serde_json::Map<String, serde_json::Value>>(),
                "groups": names.iter().cloned().zip(x.groups.iter().map(|p| serde_json::Value::from(p.as_str()))).collect::<serde_json::Map<String, serde_json::Value>>(),
                "winners": x.winners.iter().map(id).collect::<Vec<_>>(), "placings": x.placings.iter().map(id).collect::<Vec<_>>(),
                "presence": x.presence, "moves": x.moves, "seconds": (x.seconds * 10.0).round() / 10.0,
            });
            writeln!(f.lock().unwrap(), "{line}").unwrap();
        }
    };
    let played = motw::tournament::run(seed, games, &list, &options, duplicate, workers, &done);
    eprintln!();
    let island = played.iter().filter(|x| x.island).count();
    let all_wins: usize = played.iter().map(|x| x.winners.len()).sum();
    println!("{games} games, {} players, {:.0} s on {workers} threads ({:.1} s a game). Island won {island}, invaders {}. An even share a seat is {:.0}%.",
        list.len(), t0.elapsed().as_secs_f64(), played.iter().map(|x| x.seconds).sum::<f64>() / games.max(1) as f64, games - island, 100.0 / list.len() as f64);
    let mut profiles: Vec<String> = Vec::new();
    for p in &list {
        if !profiles.contains(p) {
            profiles.push(p.clone());
        }
    }
    // a seat: wins per seat-game, with its standard error (each seat-game a win or not), to judge what the run can tell.
    println!("{:<40} {:>6} {:>10} {:>15} {:>8} {:>9}", "profile", "seats", "share", "a seat", "island", "invaders");
    for p in &profiles {
        let seats = list.iter().filter(|x| *x == p).count();
        let (mut wins, mut isl, mut inv) = (0, 0, 0);
        for x in &played {
            for &w in &x.winners {
                if x.seats[w as usize] == *p {
                    wins += 1;
                    if x.island { isl += 1 } else { inv += 1 }
                }
            }
        }
        let n = (games * seats).max(1) as f64;
        let rate = wins as f64 / n;
        let se = (rate * (1.0 - rate) / n).sqrt();
        println!("{:<40} {:>6} {:>9.1}% {:>7.1}% ±{:>4.1} {:>8} {:>9}", p, seats, 100.0 * wins as f64 / all_wins.max(1) as f64, 100.0 * rate, 100.0 * se, isl, inv);
    }
    let by_seat: Vec<String> = (0..list.len()).map(|i| format!("P{} {:.0}%", i + 1, 100.0 * played.iter().filter(|x| x.winners.contains(&(i as u8))).count() as f64 / games.max(1) as f64)).collect();
    println!("wins by seat: {}", by_seat.join(" · "));
}
