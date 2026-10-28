//! Command line tools for the Rust engine.
//!
//!   motw replay <fingerprint.jsonl> players=5 seed=1 [o.variant=choice ...]
//!     Replays the moves a JavaScript fingerprint recorded (scripts/fingerprint.mjs) on the Rust engine, checking the
//!     state's hash after every move.
//!
//!   motw fingerprint games=20 seed=1 profiles=a;b;... [check=file.jsonl] [out=file.jsonl] [o.variant=choice ...]
//!     Bot games on fixed seeds, as scripts/fingerprint.mjs plays them (same seeds, same random sequence), every move and
//!     state hashed; with check=, compared move by move with a JavaScript recording.
//!
//!   motw crosscheck <cases.jsonl>
//!     Compares the Rust engine's answers with the JavaScript's on the cases scripts/crosscheck.mjs wrote: listed
//!     targets, sampled targets, the first choice, the reasons broken targets are refused, and previews.

use motw::game::apply_move;
use motw::json::{game_hash, move_from_value};
use motw::setup::create_game;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("replay") => replay(&args[1..]),
        Some("crosscheck") => crosscheck(&args[1]),
        Some("fingerprint") => fingerprint(&args[1..]),
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

/// The bots' play-out random sequence (an LCG), as scripts/crosscheck.mjs makes it.
fn lcg(seed: i64) -> impl FnMut() -> f64 {
    let mut x = seed as i32;
    move || {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        (x as u32) as f64 / 4294967296.0
    }
}

fn crosscheck(file: &str) {
    use motw::cards::check_target;
    use motw::choice::{list_targets, next_choice, sample_target};
    use motw::json::{choice_to_value, state_from_value, target_from_value, target_to_value};
    use motw::types::Target;
    use motw::view::preview_value;
    use serde_json::Value;
    let text = std::fs::read_to_string(file).expect("read");
    let (mut cases, mut bad) = (0, 0);
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let v: Value = serde_json::from_str(line).unwrap();
        let s = state_from_value(&v["state"]).expect("state");
        let pid = s.pid_of(v["pid"].as_str().unwrap()).unwrap();
        let ci = motw::spec::spec().card_ix(v["card"].as_str().unwrap()).unwrap();
        let f = s.factions;
        cases += 1;
        let mut differ = |what: &str, ours: String, theirs: String| {
            if ours != theirs {
                if *kinds.entry(what.to_string()).or_default() < 3 {
                    println!("{} {} {what}:\n  rust {ours}\n  js   {theirs}", v["pid"], v["card"]);
                }
                *kinds.get_mut(what).unwrap() += 1;
                true
            } else {
                false
            }
        };
        let list = |even: bool| { let (t, c) = list_targets(&s, pid, ci, 40, even); serde_json::to_string(&serde_json::json!({ "targets": t.iter().map(|x| target_to_value(&f, x)).collect::<Vec<_>>(), "complete": c })).unwrap() };
        let mut wrong = differ("list", list(false), serde_json::to_string(&v["list"]).unwrap());
        wrong |= differ("even", list(true), serde_json::to_string(&v["even"]).unwrap());
        for (k, seed) in v["sampleSeeds"].as_array().unwrap().iter().enumerate() {
            let mut r = lcg(seed.as_i64().unwrap());
            let got = sample_target(&s, pid, ci, &mut r).map(|t| target_to_value(&f, &t)).unwrap_or(Value::Null);
            wrong |= differ("sample", serde_json::to_string(&got).unwrap(), serde_json::to_string(&v["sampled"][k]).unwrap());
        }
        wrong |= differ("first", serde_json::to_string(&choice_to_value(&f, &next_choice(&s, pid, ci, &Target::default()))).unwrap(), serde_json::to_string(&v["first"]).unwrap());
        for b in v["broken"].as_array().unwrap() {
            let t = target_from_value(&f, &b["t"]).unwrap();
            let got = check_target(&s, pid, ci, Some(&t)).map(Value::from).unwrap_or(Value::Null);
            wrong |= differ("broken", serde_json::to_string(&got).unwrap(), serde_json::to_string(&b["reason"]).unwrap());
        }
        let listed = v["list"]["targets"].as_array().unwrap();
        for (k, p) in v["preview"].as_array().unwrap().iter().enumerate() {
            let t = target_from_value(&f, &listed[k]).unwrap();
            // Key order inside a location's record (which effect was set first) is not compared: no rule reads it.
            wrong |= differ("preview", motw::json::canon(&preview_value(&s, pid, ci, &t)), motw::json::canon(p));
        }
        if let Some(cs) = v.get("cands").and_then(|x| x.as_array()) {
            for (k, steer) in [false, true].iter().enumerate() {
                let mut r = lcg(v["candSeeds"][k].as_i64().unwrap());
                let value = |x: &motw::types::GameState| motw::bots::evaluate(x, pid, "backer", Some(motw::bots::Goal::Invaders));
                let st: Option<&dyn Fn(&motw::types::GameState) -> f64> = if *steer { Some(&value) } else { None };
                let got = motw::bots::candidates(&s, pid, &mut r, 8, true, true, st, None);
                let ours: Vec<String> = got.iter().map(|m| motw::json::move_to_value(&f, m).to_string()).collect();
                let theirs: Vec<String> = cs[k].as_array().unwrap().iter().map(|m| m.to_string()).collect();
                wrong |= differ(if *steer { "cands-steer" } else { "cands" }, ours.join("\n    "), theirs.join("\n    "));
            }
        }
        if let Some(c) = v.get("chances") {
            let o = motw::bots::win_chances(&s, pid, 1.0, &[1.0, 0.35, 0.12, 0.02]);
            for (k, ours) in [("pInvaders", o.p_invaders), ("asInvaders", o.as_invaders), ("asIsland", o.as_island), ("marginInvaders", o.margin_invaders), ("marginIsland", o.margin_island), ("linearIsland", o.linear_island), ("rivalInvaders", o.rival_invaders), ("projected", o.projected), ("prior", o.prior), ("known", o.known)] {
                wrong |= differ(k, format!("{ours:?}"), format!("{:?}", c[k].as_f64().unwrap()));
            }
        }
        if let Some(ev) = v.get("evals").and_then(|x| x.as_array()) {
            let mut k = 0;
            for p in ["trophy", "backer"] {
                for g in [motw::bots::Goal::Island, motw::bots::Goal::Invaders] {
                    let ours = motw::bots::evaluate(&s, pid, p, Some(g));
                    wrong |= differ("eval", format!("{ours:?}"), format!("{:?}", ev[k].as_f64().unwrap()));
                    k += 1;
                }
            }
        }
        if wrong {
            bad += 1;
        }
    }
    println!("{cases} cases, {bad} with differences {kinds:?}");
}

fn fingerprint(args: &[String]) {
    use motw::bots::{bot_move, BotMemory, Seats};
    use motw::game::waiting_on;
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
    let mut out: Vec<String> = Vec::new();
    let (mut bad, mut moves) = (0, 0);
    let t0 = std::time::Instant::now();
    for g in 0..games {
        let mut s = create_game(seed0 + g, &names, &options).expect("game");
        let mut memory: Vec<BotMemory> = vec![BotMemory::default(); names.len()];
        // The fingerprint's random sequence (scripts/fingerprint.mjs), in doubles as JavaScript computes it.
        let mut r: f64 = ((seed0 + g) * 7919 + 1) as f64;
        let mut rng = move || { r = (r * 1103515245.0 + 12345.0) % 2147483648.0; r / 2147483648.0 };
        let mut lines = vec![serde_json::json!({ "g": g, "i": 0, "pid": null, "move": null, "hash": game_hash(&s) })];
        let mut i = 1;
        while s.phase != motw::types::Phase::Ended && i < 5000 {
            let pid = waiting_on(&s)[0];
            let m = bot_move(&s, pid, &mut rng, &profiles[pid as usize], Some(&mut memory[pid as usize]), &Seats::default()).expect("a move");
            s = apply_move(&s, pid, &m).expect("legal");
            lines.push(serde_json::json!({ "g": g, "i": i, "pid": names[pid as usize], "move": move_to_value(&s.factions, &m), "hash": game_hash(&s) }));
            i += 1;
            moves += 1;
        }
        if let Some(w) = &want {
            let refs = w.get(&g).cloned().unwrap_or_default();
            let k = lines.iter().zip(refs.iter()).position(|(a, b)| a["hash"] != b["hash"] || motw::json::canon(&a["move"]) != motw::json::canon(&b["move"]));
            if k.is_some() || refs.len() != lines.len() {
                bad += 1;
                let k = k.unwrap_or(lines.len().min(refs.len()));
                println!("game {g}: differs at move {k}: rust {} js {}", lines.get(k).map(|x| x["move"].to_string()).unwrap_or_default(), refs.get(k).map(|x| x["move"].to_string()).unwrap_or_default());
            }
        }
        out.extend(lines.iter().map(|l| l.to_string()));
    }
    if let Some(f) = kv.get("out") {
        std::fs::write(f, out.join("\n") + "\n").expect("write");
    }
    println!("{games} games, {moves} moves, {:?}{}", t0.elapsed(), if want.is_some() { if bad > 0 { format!("; {bad} differ") } else { "; all match".into() } } else { String::new() });
}
