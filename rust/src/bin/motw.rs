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
//!   motw time profile=bot:lean=0.3 [seed=9] [decisions=5]
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
        Some("fit") => fit(&args[1..]),
        Some("fitimit") => fit_imit(&args[1..]),
        _ => eprintln!("usage: motw fingerprint games=20 seed=1 profiles=a;b;... | motw time profile=bot:lean=0.3"),
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
    let profiles: Vec<String> = kv.get("profiles").cloned().unwrap_or_else(|| "bot:lean=0.3,sim=0;bot:lean=0.3,sim=0;bot:lean=-0.3,sim=0;bot:lean=-0.3,sim=0;bot:lean=-0.3,sim=0".into()).split(';').map(|s| s.to_string()).collect();
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
    let profile = kv.get("profile").cloned().unwrap_or_else(|| "bot:lean=0.3".into());
    let seed: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(9);
    let decisions: usize = kv.get("decisions").map(|x| x.parse().unwrap()).unwrap_or(5);
    let names: Vec<String> = (1..=5).map(|i| format!("P{i}")).collect();
    let mut s = create_game(seed, &names, &options).expect("game");
    let mut memory = vec![BotMemory::default(); 5];
    let mut x: u64 = seed as u64 * 2654435761 + 1;
    let mut rng = move || { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 11) as f64 / (1u64 << 53) as f64 };
    let quick = fast("bot:lean=-0.3");
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

/// Fits the learned judge (judge.rs) from games logged with positions=1: `fit in=a.jsonl,b.jsonl out=data/judge.json`.
/// Every fifth game is held out first, to compare the learned judge with the hand formula on games it never saw;
/// then it is fitted on all of them and written, with the comparison.
/// The imitation fit (rust/src/imit.rs): in=logs from `fidelity=1` runs, out=weights JSON. Reports, held out by
/// game in five folds, how often the fitted score's top candidate is the full bot's choice, against the one-step score.
fn fit_imit(args: &[String]) {
    use motw::imit::*;
    let (kv, _) = opts(args);
    let files: Vec<String> = kv.get("in").map(|x| x.split(',').map(|s| s.to_string()).collect()).unwrap_or_default();
    let ridge: f64 = kv.get("ridge").and_then(|x| x.parse().ok()).unwrap_or(1.0);
    let mut ds: Vec<(usize, Decision)> = Vec::new();
    for (fi, f) in files.iter().enumerate() {
        let text = std::fs::read_to_string(f).unwrap_or_default();
        for line in text.lines() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let g = v["g"].as_u64().unwrap_or(0) as usize + 1000 * fi;
            for d in v["imit"].as_array().into_iter().flatten() {
                let x: Vec<Vec<f64>> = d["x"].as_array().into_iter().flatten().map(|r| r.as_array().into_iter().flatten().filter_map(|y| y.as_f64()).collect()).collect();
                let chosen = d["c"].as_u64().unwrap_or(0) as usize;
                let vals: Vec<Option<f64>> = d["v"].as_array().map(|a| a.iter().map(|y| y.as_f64()).collect()).unwrap_or_else(|| vec![None; x.len()]);
                if x.len() > 1 && chosen < x.len() && vals.len() == x.len() {
                    ds.push((g, Decision { x, chosen, v: vals }));
                }
            }
        }
    }
    let k = ds.first().map_or(0, |d| d.1.x[0].len());
    let (mut fitted, mut plain) = ((0.0, 0.0), (0.0, 0.0));
    for fold in 0..5 {
        let train: Vec<&Decision> = ds.iter().filter(|d| d.0 % 5 != fold).map(|d| &d.1).collect();
        let test: Vec<&Decision> = ds.iter().filter(|d| d.0 % 5 == fold).map(|d| &d.1).collect();
        let w = fit(&train, ridge);
        let a = accuracy(&test, &|x| x.iter().zip(&w).map(|(p, q)| p * q).sum());
        let b = accuracy(&test, &|x| x[k - 1] * 10.0);
        let n = test.len() as f64 / ds.len().max(1) as f64;
        fitted = (fitted.0 + a.0 * n, fitted.1 + a.1 * n);
        plain = (plain.0 + b.0 * n, plain.1 + b.1 * n);
    }
    let cands = ds.iter().map(|d| d.1.x.len()).sum::<usize>() as f64 / ds.len().max(1) as f64;
    let value = kv.get("mode").is_some_and(|m| m == "value");
    if value {
        // Rank correlation with the play-out values, held out: the value fit against the one-step score.
        let (mut a, mut b) = (0.0, 0.0);
        for fold in 0..5 {
            let train: Vec<&Decision> = ds.iter().filter(|d| d.0 % 5 != fold).map(|d| &d.1).collect();
            let test: Vec<&Decision> = ds.iter().filter(|d| d.0 % 5 == fold).map(|d| &d.1).collect();
            let w = fit_value(&train, ridge);
            a += rank_corr(&test, &|x| x.iter().zip(&w).map(|(p, q)| p * q).sum()) / 5.0;
            b += rank_corr(&test, &|x| x[k - 1]) / 5.0;
        }
        println!("held out, five folds ({} decisions): rank correlation with the play-out values {a:.3} value fit vs {b:.3} one-step score", ds.len());
        if let Some(out) = kv.get("out") {
            let all: Vec<&Decision> = ds.iter().map(|d| &d.1).collect();
            let w = fit_value(&all, ridge);
            std::fs::write(out, serde_json::json!({ "w": w, "decisions": ds.len(), "about": "imitation weights (motw fitimit mode=value): ridge regression of the play-out values" }).to_string()).unwrap();
            println!("wrote {out}");
        }
        return;
    }
    println!("held out, five folds ({} decisions, {cands:.1} candidates each): the full bot's choice ranked first {:.0}% fitted vs {:.0}% one-step score (chance {:.0}%); log-likelihood {:.3} vs {:.3}",
        ds.len(), fitted.0 * 100.0, plain.0 * 100.0, 100.0 / cands, fitted.1, plain.1);
    if let Some(out) = kv.get("out") {
        let all: Vec<&Decision> = ds.iter().map(|d| &d.1).collect();
        let w = fit(&all, ridge);
        std::fs::write(out, serde_json::json!({ "w": w, "decisions": ds.len(), "about": "imitation weights (motw fitimit): conditional logit over the full bots' choices" }).to_string()).unwrap();
        println!("wrote {out}");
    }
}

fn fit(args: &[String]) {
    use motw::judge::*;
    let (kv, _) = opts(args);
    let files: Vec<String> = kv.get("in").map(|x| x.split(',').map(|s| s.to_string()).collect()).unwrap_or_default();
    let out = kv.get("out").cloned();
    // (game index, seats, invaders?, winners, rows)
    let mut games: Vec<(usize, usize, bool, Vec<usize>, Vec<Vec<f64>>)> = Vec::new();
    for f in &files {
        let text = std::fs::read_to_string(f).unwrap_or_default();
        for line in text.lines() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let Some(pos) = v["positions"].as_array() else { continue };
            if pos.is_empty() { continue; }
            let seats = v["seats"].as_object().map_or(0, |m| m.len());
            let inv = v["side"] == "invaders";
            let winners: Vec<usize> = v["winners"].as_array().map(|a| a.iter().filter_map(|w| w.as_str()?.trim_start_matches('P').parse::<usize>().ok().map(|i| i - 1)).collect()).unwrap_or_default();
            let rows: Vec<Vec<f64>> = pos.iter().map(|r| r.as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default()).collect();
            // Held out by the game's own number, not the line's: the log is in finishing order, which varies with
            // timing (2026-11-03: the held-out set had changed from run to run).
            let i = v["g"].as_u64().map_or(games.len(), |g| g as usize);
            games.push((i, seats, inv, winners, rows));
        }
    }
    let (v0, i0, s0) = (3, 3 + VOTE_N, 3 + VOTE_N + WIN_N);
    let old = s0 + WIN_N;
    type Rows = Vec<(Vec<f64>, f64, f64)>;
    let sets = |keep: &dyn Fn(usize) -> bool| -> (Rows, Rows, Rows) {
        let (mut vote, mut inv, mut isl) = (Vec::new(), Vec::new(), Vec::new());
        for (i, n, side, win, rows) in &games {
            if !keep(*i) { continue; }
            for r in rows {
                let won = if win.contains(&(r[0] as usize)) { 1.0 } else { 0.0 };
                if r[2] < 0.0 { vote.push((r[v0..i0].to_vec(), if *side { 1.0 } else { 0.0 }, 1.0 / *n as f64)); }
                if *side { inv.push((r[i0..s0].to_vec(), won, 1.0)); } else { isl.push((r[s0..old].to_vec(), won, 1.0)); }
            }
        }
        (vote, inv, isl)
    };
    let ridge = 0.5;
    // Five folds (2026-11-03): each game is judged once by weights fitted without it, so every game counts.
    let (mut e_new, mut e_old, mut w_new, mut w_old, mut w_base) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for fold in 0..5 {
    let (tv, ti, ts) = sets(&|i| i % 5 != fold);
    let w = Weights { vote: fit_logistic(&tv, ridge), inv: fit_logistic(&ti, ridge), isl: fit_logistic(&ts, ridge) };
    // Held out: the ending, then the winner, learned against the hand formula (and a coin: 1/seats to win).
    for (i, n, side, win, rows) in &games {
        if i % 5 != fold { continue; }
        for r in rows {
            let y = if *side { 1.0 } else { 0.0 };
            let won = if win.contains(&(r[0] as usize)) { 1.0 } else { 0.0 };
            let p = if r[2] >= 0.0 { r[2] } else { sigmoid(r[v0..i0].iter().zip(&w.vote).map(|(a, b)| a * b).sum()) };
            if r[2] < 0.0 {
                e_new.push((p, y, 1.0 / *n as f64));
                e_old.push((r[old], y, 1.0 / *n as f64));
            }
            let wi = sigmoid(r[i0..s0].iter().zip(&w.inv).map(|(a, b)| a * b).sum());
            let ws = sigmoid(r[s0..old].iter().zip(&w.isl).map(|(a, b)| a * b).sum());
            w_new.push((p * wi + (1.0 - p) * ws, won, 1.0));
            let po = if r[2] >= 0.0 { r[2] } else { r[old] };
            // The hand formula's win reading, scaled to the seats (its as_* are relative scores, not probabilities).
            let raw = po * r[old + 1] + (1.0 - po) * r[old + 2];
            w_old.push(((raw * 2.0 / *n as f64).min(0.99), won, 1.0));
            w_base.push((1.0 / *n as f64, won, 1.0));
        }
    }
    }
    let report = format!("held out, five folds ({} games): the ending's log loss {:.3} learned vs {:.3} hand formula; the winner's {:.3} learned vs {:.3} hand formula vs {:.3} a coin",
        games.len(), log_loss(&e_new), log_loss(&e_old), log_loss(&w_new), log_loss(&w_old), log_loss(&w_base));
    println!("{report}");
    let (av, ai, as_) = sets(&|_| true);
    let all = Weights { vote: fit_logistic(&av, ridge), inv: fit_logistic(&ai, ridge), isl: fit_logistic(&as_, ridge) };
    if let Some(out) = out {
        let json = serde_json::json!({
            "about": format!("The learned judge's weights (judge.rs), written by `motw fit` from {} games; {report}.", games.len()),
            "vote": all.vote, "inv": all.inv, "isl": all.isl,
        });
        std::fs::write(&out, serde_json::to_string_pretty(&json).unwrap() + "\n").expect("write");
        println!("wrote {out}");
    }
}

fn tournament(args: &[String]) {
    use std::io::Write;
    let (kv, options) = opts(args);
    let games: usize = kv.get("games").map(|x| x.parse().unwrap()).unwrap_or(20);
    let seed: i64 = kv.get("seed").map(|x| x.parse().unwrap()).unwrap_or(1);
    let list: Vec<String> = kv.get("profiles").cloned().unwrap_or_else(|| "bot:lean=0.3;bot:lean=0.3;bot:lean=-0.3;bot:lean=-0.3;bot:lean=-0.3".into()).split(';').map(|s| s.to_string()).collect();
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
                "g": x.g, "seed": seed, "lastVote": options.iter().find(|(k, _)| k == "lastVote").and_then(|(_, v)| v.parse::<i64>().ok()).unwrap_or(1), "side": if x.island { "island" } else { "invaders" },
                "seats": names.iter().cloned().zip(x.seats.iter().map(|p| serde_json::Value::from(p.as_str()))).collect::<serde_json::Map<String, serde_json::Value>>(),
                "groups": names.iter().cloned().zip(x.groups.iter().map(|p| serde_json::Value::from(p.as_str()))).collect::<serde_json::Map<String, serde_json::Value>>(),
                "winners": x.winners.iter().map(id).collect::<Vec<_>>(), "placings": x.placings.iter().map(id).collect::<Vec<_>>(),
                "presence": x.presence, "votes": x.votes.iter().map(|&v| if v { "invaders" } else { "island" }).collect::<Vec<_>>(), "factions": x.factions, "wonBy": x.won_by, "scores": x.scores,
                "rounds": x.rounds.iter().map(|r| serde_json::json!({
                    "r": r.round, "beforeFights": r.before_fights, "afterFights": r.after_fights, "end": r.end, "first": r.first.map(|p| id(&p)), "fights": r.fights, "occupied": r.occupied,
                    "seats": r.seats.iter().map(|q| serde_json::json!({ "standing": q.standing, "trophies": q.trophies, "supply": q.supply, "onBoard": q.on_board, "goal": q.goal, "pInvaders": (q.p_invaders * 1000.0).round() / 1000.0, "broke": q.broke, "early": q.early, "nerve": q.nerve, "pForecast": (q.p_forecast * 1000.0).round() / 1000.0 })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
                "plays": x.playlog.iter().map(|p| serde_json::json!({
                    "r": p.round, "seat": id(&p.seat), "card": p.card, "use": p.use_, "dPresence": p.d_presence, "dStanding": p.d_standing,
                    "dTrophies": p.d_trophies, "placed": p.placed, "moved": p.moved, "closed": p.closed, "goal": p.goal, "pInvaders": (p.p_invaders * 1000.0).round() / 1000.0,
                })).collect::<Vec<_>>(),
                "positions": x.positions,
                "fightLog": x.fight_log.iter().map(|f| serde_json::json!({
                    "r": f.round, "loc": f.loc, "sway": &f.sway[..x.seats.len()], "piles": f.piles.iter().map(|p| serde_json::json!([p.0, p.1])).collect::<Vec<_>>(), "wiped": f.scorched,
                    "supply": &f.supply[..x.seats.len()], "hand": &f.hand[..x.seats.len()], "mv": f.mv, "left": &f.left[..x.seats.len()],
                })).collect::<Vec<_>>(),
                "nightLog": x.night_log.iter().map(|n| serde_json::json!({ "r": n.round, "loc": n.loc, "n": n.n, "sway": &n.sway[..x.seats.len()] })).collect::<Vec<_>>(),
                "tieTurns": x.tie_turns.iter().map(|t| serde_json::json!({ "mv": t.mv, "r": t.round, "seat": t.seat, "loc": t.loc, "size": t.size, "could": t.could, "did": t.did, "listed": t.listed, "rank": t.rank, "playedOut": t.played_out, "breakValue": t.break_value, "chosenValue": t.chosen_value, "breakQuick": t.break_quick, "chosenQuick": t.chosen_quick, "goal": t.goal })).collect::<Vec<_>>(),
                "quickTurns": x.quick_turns.iter().map(|q| serde_json::json!({ "mv": q.mv, "r": q.round, "seat": q.seat, "same": q.same, "sameCard": q.same_card, "realPass": q.real_pass, "quickPass": q.quick_pass,
                    "quickScore": q.quick_score, "realScore": q.real_score, "realTie": q.real_tie, "quickTie": q.quick_tie, "realBreak": q.real_break, "quickBreak": q.quick_break, "second": q.second, "variants": q.variants, "noise": q.noise.iter().map(|r| serde_json::json!([r.0, r.1, r.2, r.3, r.4, r.5])).collect::<Vec<_>>() })).collect::<Vec<_>>(),
                "imit": x.imit.iter().map(|d| serde_json::json!({ "c": d.chosen, "v": d.v.iter().map(|v| v.map(|y| (y * 1e3).round() / 1e3)).collect::<Vec<_>>(), "x": d.x.iter().map(|r| r.iter().map(|v| (v * 1e4).round() / 1e4).collect::<Vec<_>>()).collect::<Vec<_>>() })).collect::<Vec<_>>(),
                "quickRounds": x.quick_rounds.iter().map(|q| serde_json::json!({ "r": q.round, "seat": q.seat, "pInvaders": q.p_invaders, "trophies": q.trophies, "standing": q.standing, "startTrophies": q.start_trophies, "startStanding": q.start_standing, "stops": q.stops })).collect::<Vec<_>>(),
                "swayLog": x.sway_log.iter().map(|c| serde_json::json!({
                    "mv": c.mv, "r": c.round, "loc": c.loc, "seat": c.mover, "before": &c.before[..x.seats.len()], "after": &c.after[..x.seats.len()],
                })).collect::<Vec<_>>(),
                "swings": x.swings.iter().map(|w| serde_json::json!({
                    "r": w.round, "seat": id(&w.seat), "presence": w.presence, "groups": w.groups, "maxGroup": w.max_group, "groups4": w.groups4,
                    "best": w.best, "bestFree": w.best_free, "cards": w.cards.iter().map(|c| serde_json::json!([c.0, c.1, c.2])).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
                "moves": x.moves, "seconds": (x.seconds * 10.0).round() / 10.0,
            });
            writeln!(f.lock().unwrap(), "{line}").unwrap();
        }
    };
    let board = kv.get("board").is_some_and(|x| x == "1");
    // stopAfter=1: the opening study; each game stops after that round (board=1 and boardRound follow it).
    if kv.get("swing").is_some_and(|x| x == "1") { motw::tournament::SWING.store(true, std::sync::atomic::Ordering::Relaxed); }
    if let Some(v) = kv.get("quickvars") { *motw::tournament::QUICK_VARIANTS.lock().unwrap() = v.split('|').map(String::from).collect(); }
    if kv.get("fidelity").is_some_and(|x| x == "1") { motw::tournament::FIDELITY.store(true, std::sync::atomic::Ordering::Relaxed); motw::bots::KEEP_CONSIDERED.store(true, std::sync::atomic::Ordering::Relaxed); }
    if kv.get("ties").is_some_and(|x| x == "1") { motw::tournament::TIES.store(true, std::sync::atomic::Ordering::Relaxed); motw::bots::KEEP_CONSIDERED.store(true, std::sync::atomic::Ordering::Relaxed); }
    if kv.get("positions").is_some_and(|x| x == "1") { motw::tournament::POSITIONS.store(true, std::sync::atomic::Ordering::Relaxed); }
    if let Some(n) = kv.get("stopAfter").and_then(|x| x.parse::<i32>().ok()) { motw::tournament::STOP_AFTER.store(n, std::sync::atomic::Ordering::Relaxed); }
    let played = motw::tournament::run_with(seed, games, &list, &options, duplicate, workers, board, &done);
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
    // Where the tokens came from and went, round by round (a game's average).
    {
        let g = played.len().max(1) as f64;
        println!("{:<7} {:>10} {:>11} {:>11} {:>9}", "round", "cards in", "cards out", "fights out", "growth");
        for r in 1..=5 {
            let rows: Vec<_> = played.iter().flat_map(|x| x.flow.iter().filter(move |f| f.round == r)).collect();
            let sum = |k: fn(&motw::tournament::Flow) -> i32| rows.iter().map(|f| k(f) as f64).sum::<f64>() / g;
            println!("{:<7} {:>10.1} {:>11.1} {:>11.1} {:>9.1}", r, sum(|f| f.cards_in), sum(|f| f.cards_out), sum(|f| f.fights), sum(|f| f.growth));
        }
    }
    // board=1: how much is happening on the board, and how many options the hand to act has, turn by turn.
    let turns: Vec<&motw::tournament::Turn> = played.iter().flat_map(|x| x.turns.iter()).collect();
    if !turns.is_empty() {
        println!("turns of play: {}", turns.len());
        println!("{:<7} {:>9} {:>9} {:>9} {:>10} {:>12} {:>13}", "round", "occupied", "contested", "presence", "hand", "with action", "targets/card");
        for r in 1..=5 {
            let t: Vec<_> = turns.iter().filter(|x| x.round == r).collect();
            if t.is_empty() { continue; }
            let n = t.len() as f64;
            let hand: f64 = t.iter().map(|x| x.cards.len() as f64).sum::<f64>() / n;
            let acting: f64 = t.iter().map(|x| x.cards.iter().filter(|c| c.1 > 0).count() as f64).sum::<f64>() / n;
            let all: Vec<f64> = t.iter().flat_map(|x| x.cards.iter().filter(|c| c.1 > 0).map(|c| c.1 as f64)).collect();
            println!("{:<7} {:>9.1} {:>9.1} {:>9.1} {:>10.1} {:>12.1} {:>13.1}", r, t.iter().map(|x| x.occupied as f64).sum::<f64>() / n, t.iter().map(|x| x.contested as f64).sum::<f64>() / n, t.iter().map(|x| x.presence as f64).sum::<f64>() / n, hand, acting, all.iter().sum::<f64>() / all.len().max(1) as f64);
        }
        // boardRound=N: the per-card tables for that round only (e.g. 1, the opening).
        let only: Option<i32> = kv.get("boardRound").and_then(|x| x.parse().ok());
        let turns: Vec<&motw::tournament::Turn> = turns.into_iter().filter(|t| only.is_none_or(|r| t.round == r)).collect();
        if let Some(r) = only {
            let (mut held, mut ok, mut cost, mut board) = (0usize, 0usize, 0usize, 0usize);
            for t in &turns {
                held += t.cards.len();
                ok += t.cards.iter().filter(|c| c.1 > 0).count();
                for (_, why) in &t.blocked {
                    if why.contains("cost:") { cost += 1 } else if why.contains("board:") { board += 1 }
                }
            }
            let readings = (cost + board).max(1) as f64;
            println!("round {r}: {} turns; cards held with an action {:.0}%; blocked readings: no standing to pay {:.0}%, nothing on the board fits {:.0}%",
                turns.len(), 100.0 * ok as f64 / held.max(1) as f64, 100.0 * cost as f64 / readings, 100.0 * board as f64 / readings);
        }
        // Per card: how often it had a legal action when held on a turn, and how many targets then.
        let mut per: std::collections::BTreeMap<String, (usize, usize, usize)> = Default::default();
        for t in &turns {
            for c in &t.cards {
                let e = per.entry(motw::spec::spec().cards[c.0 as usize].name.clone()).or_default();
                e.0 += 1;
                if c.1 > 0 { e.1 += 1; e.2 += c.1; }
            }
        }
        let mut rows: Vec<_> = per.into_iter().collect();
        rows.sort_by(|a, b| ((a.1).1 as f64 / (a.1).0 as f64).partial_cmp(&((b.1).1 as f64 / (b.1).0 as f64)).unwrap());
        println!("{:<28} {:>7} {:>12} {:>13}", "card (fewest options first)", "held", "has action", "targets when");
        for (name, (held, ok, sum)) in rows {
            println!("{:<28} {:>7} {:>11.0}% {:>13.1}", name, held, 100.0 * ok as f64 / held as f64, sum as f64 / ok.max(1) as f64);
        }
        // What stops a card when it has no legal action: per reading, the most common blockers.
        let mut why: std::collections::BTreeMap<String, std::collections::BTreeMap<String, usize>> = Default::default();
        for t in &turns {
            for (c, reason) in &t.blocked {
                *why.entry(motw::spec::spec().cards[*c as usize].name.clone()).or_default().entry(reason.clone()).or_default() += 1;
            }
        }
        println!("what blocks a card with no legal action (share of its blocked readings):");
        for (name, reasons) in why {
            let total: usize = reasons.values().sum();
            let mut v: Vec<_> = reasons.into_iter().collect();
            v.sort_by(|a, b| b.1.cmp(&a.1));
            let top: Vec<String> = v.iter().take(3).map(|(r, n)| format!("{:.0}% {r}", 100.0 * *n as f64 / total as f64)).collect();
            println!("  {name}: {}", top.join(" · "));
        }
    }
    // The pass study: every pass made while holding cards, with the passing bot's own play-out estimates.
    let passes: Vec<(&motw::tournament::Game, &motw::tournament::Pass)> = played.iter().flat_map(|x| x.passes.iter().map(move |p| (x, p))).collect();
    if !passes.is_empty() {
        let rounds = (games * 5) as f64;
        let later = passes.iter().filter(|(_, p)| p.played_later).count();
        let margins: Vec<f64> = {
            let mut v: Vec<f64> = passes.iter().filter_map(|(_, p)| p.decision.and_then(|d| Some(d.pass? - d.best_play?))).collect();
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v
        };
        let q = |f: f64| margins.get(((margins.len() as f64 - 1.0) * f).round() as usize).copied().unwrap_or(f64::NAN);
        let share = |t: &dyn Fn(f64) -> bool| 100.0 * margins.iter().filter(|&&m| t(m)).count() as f64 / margins.len().max(1) as f64;
        println!("passes with cards in hand: {} ({:.1} a round); played a card later that round {:.0}% (deferrals), held to the round's end {:.0}%",
            passes.len(), passes.len() as f64 / rounds, 100.0 * later as f64 / passes.len() as f64, 100.0 * (passes.len() - later) as f64 / passes.len() as f64);
        println!("  pass over best play, by the bot's play-outs (value points; ~10 = the whole game): median {:+.3}, quartiles {:+.3} / {:+.3}; under 0.05 (a coin flip) {:.0}%, over 0.3 (clearly better) {:.0}%",
            q(0.5), q(0.25), q(0.75), share(&|m| m.abs() < 0.05), share(&|m| m > 0.3));
        // Deferrals (played later: waiting for the last word) against passes held to the end (nothing worth playing).
        let median = |later: bool| {
            let mut v: Vec<f64> = passes.iter().filter(|(_, p)| p.played_later == later).filter_map(|(_, p)| p.decision.and_then(|d| Some(d.pass? - d.best_play?))).collect();
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v.get(v.len() / 2).copied().unwrap_or(f64::NAN)
        };
        println!("  median margin: deferrals {:+.3}, held to the end {:+.3}", median(true), median(false));
        // By profile: how often each passes, how often it comes back, and what its plays after waiting do to presence.
        for p in &profiles {
            let seats_p = list.iter().filter(|x| *x == p).count() as f64;
            let mine: Vec<_> = passes.iter().filter(|(g, x)| g.seats[x.seat as usize] == *p).collect();
            let later = mine.iter().filter(|(_, x)| x.played_later).count();
            let plays: Vec<(i32, bool)> = played.iter().flat_map(|g| g.plays.iter().filter(move |x| g.seats[x.0 as usize] == *p).map(|x| (x.1, x.2))).collect();
            let mean = |w: bool| { let v: Vec<i32> = plays.iter().filter(|x| x.1 == w).map(|x| x.0).collect(); (v.iter().sum::<i32>() as f64 / v.len().max(1) as f64, v.len()) };
            let (after, n_after) = mean(true);
            let (other, n_other) = mean(false);
            println!("  {p}: {:.1} passes a seat-round, {:.0}% played later; presence change a play: after waiting {after:+.2} ({n_after}), otherwise {other:+.2} ({n_other})",
                mine.len() as f64 / (rounds * seats_p).max(1.0), 100.0 * later as f64 / mine.len().max(1) as f64);
        }
        let by_round: Vec<String> = (1..=5).map(|r| format!("r{r} {}", passes.iter().filter(|(_, p)| p.round == r).count())).collect();
        let early = passes.iter().filter(|(_, p)| p.played_before < 5).count();
        println!("  by round: {}; before 5 cards were played in the round: {:.0}%", by_round.join(" "), 100.0 * early as f64 / passes.len() as f64);
    }
}
