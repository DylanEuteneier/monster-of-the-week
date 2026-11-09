//! The engine's rules, pinned (a port of test/engine.test.js). States are set up and read as JSON in the engine's
//! shapes, so each test reads as the JavaScript one does.

use motw::bots::{bot_move, fast, BotMemory, Seats};
use motw::cards::check_target;
use motw::choice::next_choice;
use motw::game::{apply_move, fight_at, fights_due, validate, waiting_on};
use motw::json::{choice_to_value, move_from_value, state_from_value, state_to_value, target_from_value};
use motw::setup::{create_game, deck, printed_of, shuffle, sway_for};
use motw::spec::spec;
use motw::types::*;
use motw::view::{player_view, preview_value};
use serde_json::{json, Map, Value};

const PLAYERS: [&str; 5] = ["ann", "bob", "cat", "dan", "eve"];

fn names(players: &[&str]) -> Vec<String> {
    players.iter().map(|s| s.to_string()).collect()
}
fn game(seed: i64) -> GameState {
    create_game(seed, &names(&PLAYERS), &[]).unwrap()
}
fn game_n(seed: i64, players: &[&str]) -> Result<GameState, String> {
    create_game(seed, &names(players), &[])
}
fn game_opts(seed: i64, opts: &[(&str, &str)]) -> GameState {
    create_game(seed, &names(&PLAYERS), &opts.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>()).unwrap()
}
fn v(s: &GameState) -> Value {
    state_to_value(s)
}
fn edit(s: &GameState, f: impl FnOnce(&mut Value)) -> GameState {
    let mut x = v(s);
    f(&mut x);
    state_from_value(&x).unwrap()
}
/// An empty board to stage a fight on, and standing 10 with every faction.
fn clear(s: &GameState) -> GameState {
    edit(s, |x| {
        // The cards alone: no nightfall tokens (nightfall has its own test).
        x["options"]["nightfall"] = json!("off");
        for (_, place) in x["board"].as_object_mut().unwrap() {
            place["tokens"] = json!({});
            place["sway"] = json!({});
            place["scorched"] = json!(false);
        }
        let fs: Vec<String> = x["factions"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect();
        for (_, p) in x["players"].as_object_mut().unwrap() {
            p["standing"] = Value::Object(fs.iter().map(|f| (f.clone(), json!(10))).collect());
        }
    })
}
/// An object from (key, number) pairs, in order (a JavaScript `{ [A]: 6, [B]: 4 }`).
fn obj(kv: &[(&str, i64)]) -> Value {
    Value::Object(kv.iter().map(|(k, n)| (k.to_string(), json!(n))).collect::<Map<_, _>>())
}
fn factions(s: &GameState) -> Vec<String> {
    v(s)["factions"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect()
}
fn of_arch(s: &GameState, arch: &str) -> String {
    let a = spec().arch_ix(arch).unwrap();
    factions(s)[a].clone()
}
fn arch_of_faction(f: &str) -> String {
    let sp = spec();
    sp.archetypes[sp.factions[sp.fac_ix(f).unwrap() as usize].archetype].id.clone()
}
fn locs() -> Vec<(String, String)> {
    let sp = spec();
    sp.locations.iter().map(|l| (l.id.clone(), sp.archetypes[l.archetype].id.clone())).collect()
}
fn adjacent(loc: &str) -> Vec<String> {
    let sp = spec();
    sp.locations[sp.loc_ix(loc).unwrap() as usize].adjacent.iter().map(|&a| sp.locations[a as usize].id.clone()).collect()
}
fn first_loc(arch: &str) -> String {
    locs().into_iter().find(|l| l.1 == arch).unwrap().0
}
fn pid(s: &GameState, name: &str) -> Pid {
    s.pid_of(name).unwrap()
}
fn card(id: &str) -> CardIx {
    spec().card_ix(id).unwrap()
}
fn target(s: &GameState, t: Value) -> Target {
    target_from_value(&s.factions, &t).unwrap()
}
fn check(s: &GameState, who: &str, c: &str, t: Value) -> Option<String> {
    check_target(s, pid(s, who), card(c), Some(&target(s, t)))
}
fn preview(s: &GameState, who: &str, c: &str, t: Value) -> Value {
    preview_value(s, pid(s, who), card(c), &target(s, t))
}
fn choice(s: &GameState, who: &str, c: &str, t: Value) -> Value {
    choice_to_value(&s.factions, &next_choice(s, pid(s, who), card(c), &target(s, t)))
}
fn mv(s: &GameState, m: Value) -> Move {
    move_from_value(&s.factions, &m).unwrap()
}
fn valid(s: &GameState, who: &str, m: Value) -> bool {
    validate(s, pid(s, who), &mv(s, m)).is_none()
}
fn apply(s: &GameState, who: &str, m: Value) -> GameState {
    apply_move(s, pid(s, who), &mv(s, m)).unwrap()
}
/// One location's fight, on a copy.
fn fight(s: &GameState, loc: &str) -> Value {
    let mut x = s.clone();
    fight_at(&mut x, spec().loc_ix(loc).unwrap());
    v(&x)
}
fn draft_all(s: &GameState) -> GameState {
    let mut s = s.clone();
    while s.phase == Phase::Draft {
        for p in 0..s.n() {
            let pl = &s.players[p];
            let keep: Vec<CardIx> = pl.kept.iter().chain(pl.batch.iter()).copied().take(pl.kept.len() + 1).collect();
            s = apply_move(&s, p as Pid, &Move::Pick { keep }).unwrap();
        }
    }
    s
}
fn presence(s: &GameState, f: &str) -> i64 {
    let x = v(s);
    x["board"].as_object().unwrap().values().map(|p| p["tokens"][f].as_i64().unwrap_or(0)).sum()
}
fn total(s: &GameState) -> i64 {
    factions(s).iter().map(|f| presence(s, f)).sum()
}
/// Bots play the rest of the game, every seat a fast trophy bot.
fn play_out(s: &GameState, seed: u64) -> GameState {
    let mut s = s.clone();
    let mut x = seed;
    let mut rng = move || {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (x >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut memory = vec![BotMemory::default(); s.n()];
    for _ in 0..5000 {
        if s.phase == Phase::Ended {
            break;
        }
        let p = waiting_on(&s)[0];
        let m = bot_move(&s, p, &mut rng, &fast("bot:lean=-0.3"), Some(&mut memory[p as usize]), &Seats::default()).unwrap();
        s = apply_move(&s, p, &m).unwrap();
    }
    s
}

// Data ---------------------------------------------------------------------

#[test]
fn spec_holds_five_archetypes_with_three_factions_and_three_locations_each() {
    let sp = spec();
    for a in 0..sp.archetypes.len() {
        assert_eq!(sp.factions.iter().filter(|f| f.archetype == a).count(), 3);
        assert_eq!(sp.locations.iter().filter(|l| l.archetype == a).count(), 3);
    }
}

#[test]
fn content_ids_are_unique_across_every_list_cards_included() {
    let sp = spec();
    let mut ids: Vec<&str> = sp.archetypes.iter().map(|x| x.id.as_str()).collect();
    ids.extend(sp.factions.iter().map(|x| x.id.as_str()));
    ids.extend(sp.locations.iter().map(|x| x.id.as_str()));
    ids.extend(sp.slayer_groups.iter().map(|x| x.id.as_str()));
    ids.extend(sp.cards.iter().map(|x| x.id.as_str()));
    let mut u = ids.clone();
    u.sort();
    u.dedup();
    assert_eq!(u.len(), ids.len());
}

#[test]
fn the_deck_is_the_core_21_five_suits_and_six_unsuited_none_marked() {
    // Enforces D48 (design document, Appendix A).
    let sp = spec();
    assert_eq!(deck().len(), 21);
    assert_eq!(deck().iter().filter(|&&c| sp.cards[c as usize].suit.is_none()).count(), 6);
    for a in 0..sp.archetypes.len() {
        let mut suit: Vec<(String, i32)> = sp.cards.iter().filter(|c| c.suit == Some(a)).map(|c| (format!("{:?}", c.slot), c.sway)).collect();
        suit.sort();
        assert_eq!(suit, vec![("Shift".to_string(), 3), ("Signature".to_string(), 4), ("Strike".to_string(), 2)]);
    }
    // D44: no marked cards.
    assert!(sp.cards.iter().all(|c| c.marked.is_none()));
}

#[test]
fn the_map_is_symmetric_with_five_regions_of_three() {
    // Enforces D48 (design document, Appendix A).
    let raw = &spec().raw["map"]["locations"];
    let map = raw.as_object().unwrap();
    for (loc, x) in map {
        for a in x["adjacent"].as_array().unwrap() {
            assert!(map[a.as_str().unwrap()]["adjacent"].as_array().unwrap().iter().any(|y| y == loc), "{loc}–{a}");
        }
    }
    let regions: Vec<&str> = map.values().map(|x| x["region"].as_str().unwrap()).collect();
    for r in &regions {
        assert_eq!(regions.iter().filter(|x| *x == r).count(), 3);
    }
}

// Setup --------------------------------------------------------------------

#[test]
fn create_game_enforces_3_to_5_seats_and_unique_names() {
    // Enforces D3 (design document, Appendix A).
    assert!(game_n(1, &["a", "b"]).is_err());
    assert!(game_n(1, &["a", "b", "c", "d", "e", "f"]).is_err());
    assert!(game_n(1, &["a", "a", "b"]).is_err());
}

#[test]
fn seeding_home_puts_5_1_1_of_each_faction_on_its_own_locations() {
    let s = game_opts(4, &[("seeding", "home")]);
    assert_eq!(total(&s), 35);
    let x = v(&s);
    for f in factions(&s) {
        assert_eq!(presence(&s, &f), 7);
        assert_eq!(x["supply"][&f], 999 - 7); // unlimited pools (D46)
        for (loc, arch) in locs() {
            if x["board"][&loc]["tokens"][&f].as_i64().unwrap_or(0) > 0 {
                assert_eq!(arch, arch_of_faction(&f));
            }
        }
    }
}

#[test]
fn starting_setup_affinity_standing_others_and_board_sway() {
    // Enforces D5, D43, D47, D49 (design document, Appendix A).
    let s = game(2);
    let x = v(&s);
    let def = |id: &str| -> i64 { spec().variants.iter().find(|v| v.id == id).unwrap().default.parse().unwrap() };
    for who in PLAYERS {
        let p = &x["players"][who];
        let arch = spec().archetypes[spec().slayer_groups.iter().find(|g| g.id == p["group"].as_str().unwrap()).unwrap().archetype].id.clone();
        let linked = factions(&s).into_iter().find(|f| arch_of_faction(f) == arch).unwrap();
        assert_eq!(p["standing"][&linked].as_i64().unwrap(), def("startSway"));
        for f in factions(&s).into_iter().filter(|f| *f != linked) {
            assert_eq!(p["standing"][&f].as_i64().unwrap(), def("startOthers"));
        }
        let mine: Vec<i64> = locs().into_iter().filter(|l| l.1 == arch).map(|l| x["board"][&l.0]["sway"][who].as_i64().unwrap_or(0)).collect();
        assert_eq!(mine, vec![def("startBoard"); 3]);
        assert_eq!(p["supply"].as_i64().unwrap(), def("playerCubes") - def("startSway") - 4 * def("startOthers") - 3 * def("startBoard"));
    }
}

#[test]
fn hands_are_6_5_or_4_and_the_rest_is_left_out() {
    // Enforces D48 (design document, Appendix A).
    for (n, hand, out) in [(3, 6, 3), (4, 5, 1), (5, 4, 1)] {
        let s = game_n(1, &PLAYERS[..n]).unwrap();
        for p in &s.players {
            assert_eq!(p.batch.len(), hand);
        }
        assert_eq!(s.left_out.len(), out);
    }
}

#[test]
fn resolve_options_fills_defaults_and_rejects_unknown_choices() {
    assert_eq!(Options::resolve(&[]).unwrap().rounds, 5);
    assert!(Options::resolve(&[("rounds".into(), "99".into())]).is_err());
    assert!(Options::resolve(&[("nope".into(), "1".into())]).is_err());
}

#[test]
fn shuffle_is_a_seeded_permutation() {
    let (a, sa) = shuffle(&[1, 2, 3, 4, 5], 9);
    let (b, sb) = shuffle(&[1, 2, 3, 4, 5], 9);
    assert_eq!((a.clone(), sa), (b, sb));
    let mut sorted = a;
    sorted.sort();
    assert_eq!(sorted, vec![1, 2, 3, 4, 5]);
}

// The draft ----------------------------------------------------------------

#[test]
fn the_draft_keeps_one_more_card_each_pass_and_ends_with_full_hands() {
    // Enforces D48 (design document, Appendix A).
    let s = game(5);
    assert!(!valid(&s, "ann", json!({ "type": "pick", "keep": [] })));
    let after = draft_all(&s);
    assert_eq!(after.phase, Phase::Play);
    for p in &after.players {
        assert_eq!(p.hand.len(), 4);
    }
}

#[test]
fn round_one_s_first_player_is_random_and_opens_with_any_card() {
    // D44: drawn at random when the game is made (not always the same seat), and any card in hand opens.
    let firsts: std::collections::BTreeSet<Pid> = (1..30).map(|seed| game(seed).first.unwrap()).collect();
    assert!(firsts.len() > 1);
    let s = draft_all(&game(6));
    let first = s.first.unwrap();
    let name = s.seating[first as usize].clone();
    for &c in s.players[first as usize].hand.iter() {
        let c = &spec().cards[c as usize];
        if c.suit.is_some() {
            assert!(valid(&s, &name, json!({ "type": "play", "card": c.id, "use": "sway" })), "{} can open", c.id);
        }
    }
    assert_eq!(waiting_on(&s), vec![first]);
}

#[test]
fn steal_their_playbook_s_player_goes_first_next_round_else_the_first_player_stays() {
    // D44: the seat that played it goes first after the next draft; with nobody, the first player stays.
    let s = game(6);
    let first = s.first.unwrap();
    assert_eq!(draft_all(&s).first, Some(first));
    let other = (first as usize + 1) % s.n();
    let marked = edit(&s, |x| x["nextFirst"] = json!(s.seating[other].clone()));
    let after = draft_all(&marked);
    assert_eq!(after.first, Some(other as Pid));
    assert_eq!(after.next_first, None);
}

// Fights -------------------------------------------------------------------

struct Fx {
    a: String,
    b: String,
    c: String,
    neutral: String,
}
fn fx() -> Fx {
    let s = game(1);
    let f = factions(&s);
    let (a, b) = (f[0].clone(), f[1].clone());
    let neutral = locs().into_iter().find(|l| l.1 != arch_of_faction(&a) && l.1 != arch_of_faction(&b)).unwrap().0;
    Fx { a, b, c: f[2].clone(), neutral }
}

#[test]
fn the_winner_loses_half_the_losers_tokens_rounded_up() {
    // Enforces D25 (design document, Appendix A).
    let Fx { a, b, neutral, .. } = fx();
    let s = edit(&clear(&game(1)), |x| x["board"][&neutral]["tokens"] = obj(&[(&a, 6), (&b, 4)]));
    assert_eq!(fight(&s, &neutral)["board"][&neutral]["tokens"], obj(&[(&a, 4)]));
    let s = edit(&s, |x| x["board"][&neutral]["tokens"] = obj(&[(&a, 3), (&b, 1)]));
    assert_eq!(fight(&s, &neutral)["board"][&neutral]["tokens"], obj(&[(&a, 2)]));
}

#[test]
fn a_true_tie_wipes_both_sides_scorches_and_rewards_no_one() {
    // Enforces D48 (design document, Appendix A).
    let Fx { a, b, c, neutral } = fx();
    let s = edit(&clear(&game(1)), |x| {
        x["board"][&neutral]["tokens"] = obj(&[(&a, 3), (&b, 3)]);
        x["board"][&neutral]["sway"] = obj(&[("ann", 2)]);
    });
    let r = fight(&s, &neutral);
    assert_eq!(r["board"][&neutral]["scorched"], true);
    assert_eq!(r["board"][&neutral]["tokens"], json!({}));
    assert_eq!(r["players"]["ann"]["supply"].as_i64().unwrap(), v(&s)["players"]["ann"]["supply"].as_i64().unwrap() + 2);
    assert_eq!(r["players"]["ann"]["trophies"][&a].as_i64().unwrap() + r["players"]["ann"]["trophies"][&b].as_i64().unwrap(), 0);
    let rs = state_from_value(&r).unwrap();
    assert!(!motw::board::can_enter(&rs, spec().loc_ix(&neutral).unwrap(), factions(&rs).iter().position(|f| *f == c).unwrap() as Fac));
}

#[test]
fn on_aligned_ground_the_aligned_faction_wins_a_tie() {
    // Enforces D48 (design document, Appendix A).
    let Fx { a, b, .. } = fx();
    let home = first_loc(&arch_of_faction(&a));
    let s = edit(&clear(&game(1)), |x| x["board"][&home]["tokens"] = obj(&[(&a, 3), (&b, 3)]));
    let r = fight(&s, &home);
    assert_eq!(r["board"][&home]["tokens"], obj(&[(&a, 1)]));
    assert_eq!(r["board"][&home]["scorched"], false);
}

#[test]
fn trophies_first_claim_takes_bigger_pile_second_claim_smaller_half_its_sway_to_winner() {
    // Enforces D48 (design document, Appendix A).
    let Fx { a, b, neutral, .. } = fx();
    let s = edit(&clear(&game(1)), |x| {
        x["board"][&neutral]["tokens"] = obj(&[(&a, 6), (&b, 4)]);
        x["board"][&neutral]["sway"] = obj(&[("ann", 4), ("bob", 1)]);
    });
    let (r, x) = (fight(&s, &neutral), v(&s));
    assert_eq!(r["players"]["ann"]["trophies"][&b], 4);
    assert_eq!(r["players"]["bob"]["trophies"][&a], 2);
    assert_eq!(r["players"]["ann"]["standing"][&a].as_i64().unwrap(), x["players"]["ann"]["standing"][&a].as_i64().unwrap() + 2);
    assert_eq!(r["players"]["ann"]["supply"].as_i64().unwrap(), x["players"]["ann"]["supply"].as_i64().unwrap() + 2);
    assert_eq!(r["board"][&neutral]["sway"]["bob"], 1);
}

#[test]
fn tied_first_claims_collect_nothing_and_both_piles_go_back_a_lone_player_takes_both() {
    // Enforces D48 (design document, Appendix A).
    let Fx { a, b, neutral, .. } = fx();
    let s = edit(&clear(&game(1)), |x| {
        for p in PLAYERS {
            x["players"][p]["group"] = json!("slayerettes");
        }
        x["board"][&neutral]["tokens"] = obj(&[(&a, 6), (&b, 4)]);
        x["board"][&neutral]["sway"] = obj(&[("ann", 2), ("bob", 2)]);
    });
    let tied = fight(&s, &neutral);
    assert_eq!(tied["players"]["ann"]["trophies"][&b].as_i64().unwrap() + tied["players"]["bob"]["trophies"][&b].as_i64().unwrap(), 0);
    assert_eq!(tied["supply"][&b].as_i64().unwrap(), v(&s)["supply"][&b].as_i64().unwrap() + 4);
    let s = edit(&s, |x| x["board"][&neutral]["sway"] = obj(&[("cat", 1)]));
    let lone = fight(&s, &neutral);
    assert_eq!(lone["players"]["cat"]["trophies"][&b], 4);
    assert_eq!(lone["players"]["cat"]["trophies"][&a], 2);
}

// The end -------------------------------------------------------------------

#[test]
fn bots_play_whole_games_of_legal_moves_at_every_player_count_and_a_winner_is_named() {
    for n in [3usize, 4, 5] {
        let g = game_n(n as i64 * 7, &PLAYERS[..n]).unwrap();
        let end = play_out(&g, n as u64);
        assert_eq!(end.phase, Phase::Ended);
        assert!(end.result.as_ref().is_some_and(|r| !r.players.is_empty()));
    }
}

// Hidden information ---------------------------------------------------------

#[test]
fn views_hide_other_hands_and_trophy_totals() {
    // Enforces D6 (design document, Appendix A).
    let s = draft_all(&game(8));
    let view = player_view(&s, pid(&s, "ann"));
    let x = v(&s);
    assert_eq!(view["me"]["hand"], x["players"]["ann"]["hand"]);
    let bob = x["players"]["bob"]["hand"].to_string();
    assert_eq!(view.to_string().contains(&bob), s.players[1].hand.is_empty());
    assert!(view["players"]["bob"].get("trophies").is_none());
    assert!(!view["players"].to_string().contains("trophy"));
}

#[test]
fn illegal_moves_are_refused_and_leave_the_state_untouched() {
    let s = game(1);
    let before = v(&s);
    assert!(s.pid_of("zed").is_none());
    assert!(apply_move(&s, pid(&s, "ann"), &Move::Pass).is_err());
    assert_eq!(v(&s), before);
}

// Cards -----------------------------------------------------------------------

#[test]
fn light_of_the_cross_splits_a_group_evenly_between_two_adjacent_locations_both_paid() {
    // Enforces D15, D23 (design document, Appendix A).
    let s0 = clear(&game(1));
    let f = of_arch(&s0, "demonic");
    let loc = first_loc("demonic");
    let adj = adjacent(&loc);
    let (p, q) = (adj[0].clone(), adj[1].clone());
    let r = adj.get(2).cloned();
    let s = edit(&s0, |x| x["board"][&loc]["tokens"][&f] = json!(5));
    let base = |split: Value| json!({ "mode": "faction", "location": loc, "faction": f, "split": split });
    assert_eq!(check(&s, "ann", "light-cross", base(obj(&[(&p, 3), (&q, 2)]))), None);
    assert!(check(&s, "ann", "light-cross", base(obj(&[(&p, 4), (&q, 1)]))).is_some());
    if let Some(r) = &r {
        assert!(check(&s, "ann", "light-cross", base(obj(&[(&p, 2), (&q, 2), (r, 1)]))).is_some());
    }
    let c = choice(&s, "ann", "light-cross", base(obj(&[(&p, 3), (&q, 1)])));
    assert_eq!(c["kind"], "split");
    assert_eq!(c["options"], json!([q]));
    let after = preview(&s, "ann", "light-cross", base(obj(&[(&p, 3), (&q, 2)])));
    assert_eq!(
        vec![after["board"][&p]["tokens"][&f].clone(), after["board"][&q]["tokens"][&f].clone(), after["board"][&loc]["tokens"].get(&f).cloned().unwrap_or(Value::Null), after["board"][&p]["sway"]["ann"].clone(), after["board"][&q]["sway"]["ann"].clone()],
        vec![json!(3), json!(2), Value::Null, json!(1), json!(1)]
    );
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(1));
    assert!(check(&poor, "ann", "light-cross", base(obj(&[(&p, 3), (&q, 2)]))).is_some());
    let one = edit(&s, |x| x["board"][&loc]["tokens"][&f] = json!(1));
    assert!(check(&one, "ann", "light-cross", base(obj(&[(&p, 1)]))).is_some());
}

/// Light of the Cross, planted (variant cross=plant; the designer's draft, design document H.0, 2026-11-08).
fn cross_board() -> (GameState, String, String, Vec<String>, Vec<String>) {
    let s0 = clear(&game_opts(1, &[("cross", "plant")]));
    let f = of_arch(&s0, "demonic");
    let loc = first_loc("demonic");
    let mut zone = vec![loc.clone()];
    zone.extend(adjacent(&loc));
    let mut ring: Vec<String> = zone.iter().flat_map(|z| adjacent(z)).filter(|l| !zone.contains(l)).collect();
    ring.sort_by_key(|l| spec().loc_ix(l).unwrap());
    ring.dedup();
    (s0, f, loc, zone, ring)
}

#[test]
fn the_planted_cross_drives_every_group_it_can_pay_for_out_of_its_reach_each_to_a_place_of_its_own() {
    let (s0, f, loc, zone, ring) = cross_board();
    let n1 = zone[1].clone();
    let rival = of_arch(&s0, "scifi");
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"][&f] = json!(3);
        x["board"][&n1]["tokens"][&f] = json!(2);
        x["board"][&ring[0]]["tokens"][&rival] = json!(2);
    });
    let mv = |a: &str, b: &str| json!({ "location": a, "faction": f, "to": b });
    let t = |moves: Value, from: Value| json!({ "mode": "faction", "location": loc, "faction": f, "moves": moves, "from": from });
    let both = t(json!([mv(&loc, &ring[0]), mv(&n1, &ring[1])]), json!([loc, ring[1]]));
    assert_eq!(check(&s, "ann", "light-cross", both.clone()), None);
    // Every group you can pay for and land must go; each lands on a place of its own; the planted group goes first.
    assert!(check(&s, "ann", "light-cross", t(json!([mv(&loc, &ring[0])]), json!([loc]))).is_some());
    assert!(check(&s, "ann", "light-cross", t(json!([mv(&loc, &ring[0]), mv(&n1, &ring[0])]), json!([loc, n1]))).is_some());
    assert!(check(&s, "ann", "light-cross", t(json!([mv(&n1, &ring[1]), mv(&loc, &ring[0])]), json!([n1, loc]))).is_some());
    // Principle 14: on the location reading, any group at a Demon location (the Demons too).
    assert_eq!(check(&s, "ann", "light-cross", json!({ "mode": "location", "location": loc, "faction": f, "moves": [mv(&loc, &ring[0]), mv(&n1, &ring[1])], "from": [loc, ring[1]] })), None);
    let both_t = both.clone();
    let after = preview(&s, "ann", "light-cross", both);
    let b = &after["board"];
    assert_eq!(b[&loc]["tokens"].get(&f), None);
    assert_eq!((b[&ring[0]]["tokens"][&f].clone(), b[&ring[1]]["tokens"][&f].clone()), (json!(3), json!(2)));
    // 1 sway a group, at the end the player chose: where the first left, where the second landed.
    assert_eq!((b[&loc]["sway"]["ann"].clone(), b[&ring[1]]["sway"]["ann"].clone(), b[&ring[0]]["sway"].get("ann").cloned()), (json!(1), json!(1), None));
    assert_eq!(b[&loc]["crossAt"], json!(true));
    for z in &zone {
        assert_eq!(b[z]["cross"], json!([f]), "{z} is in the cross's reach");
    }
    // Until nightfall no card moves the faction into the reach.
    let mut x = s.clone();
    motw::cards::act(&mut x, pid(&s, "ann"), card("light-cross"), &target(&s, both_t));
    let slot = factions(&x).iter().position(|g| g == &f).unwrap() as Fac;
    assert!(!motw::board::can_enter(&x, spec().loc_ix(&loc).unwrap(), slot));
    assert!(motw::board::can_enter_raw(&x, spec().loc_ix(&loc).unwrap(), slot));
}

#[test]
fn groups_the_cross_cannot_pay_for_hide_until_nightfall() {
    let (s0, f, loc, zone, ring) = cross_board();
    let n1 = zone[1].clone();
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"][&f] = json!(3);
        x["board"][&n1]["tokens"][&f] = json!(2);
        x["players"]["ann"]["standing"][&f] = json!(1);
    });
    let mv = |a: &str, b: &str| json!({ "location": a, "faction": f, "to": b });
    let one = json!({ "mode": "faction", "location": loc, "faction": f, "moves": [mv(&loc, &ring[0])], "from": [ring[0]] });
    assert_eq!(check(&s, "ann", "light-cross", one.clone()), None);
    let one_t = one.clone();
    let after = preview(&s, "ann", "light-cross", one);
    assert_eq!(after["board"][&n1]["hidden"], json!([f]));
    let mut x = s.clone();
    motw::cards::act(&mut x, pid(&s, "ann"), card("light-cross"), &target(&s, one_t));
    let slot = factions(&x).iter().position(|g| g == &f).unwrap() as Fac;
    assert_eq!(motw::board::free_of(&x, spec().loc_ix(&n1).unwrap(), slot), 0);
    // With no standing the planted group can't go, so the card can't be played for its action.
    let none = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(0));
    assert!(check(&none, "ann", "light-cross", json!({ "mode": "faction", "location": loc, "faction": f, "moves": [mv(&loc, &ring[0])], "from": [ring[0]] })).is_some());
    // The choices: land the planted group first.
    let c = choice(&s, "ann", "light-cross", json!({ "mode": "faction", "location": loc, "faction": f }));
    assert_eq!((c["kind"].clone(), c["options"].clone()), (json!("group"), json!([{ "location": loc, "faction": f }])));
}

/// Go Loud (variant drawAway=loud; the designer's draft, design document H.0, 2026-11-08).
#[test]
fn go_loud_splits_a_group_evenly_toward_your_sway_within_two_steps_and_half_at_one() {
    let s0 = clear(&game_opts(1, &[("drawAway", "loud")]));
    let f = of_arch(&s0, "undead");
    let loc = first_loc("undead");
    let a = adjacent(&loc)[0].clone();
    let b = adjacent(&a).into_iter().find(|x| x != &loc && !adjacent(&loc).contains(x)).unwrap(); // two steps out
    let far = locs().into_iter().map(|l| l.0).find(|l| l != &loc && !adjacent(&loc).contains(l) && !adjacent(&loc).iter().any(|n| adjacent(n).contains(l))).unwrap();
    let rival = of_arch(&s0, "scifi");
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"][&f] = json!(5);
        x["board"][&loc]["tokens"][&rival] = json!(2); // a fight: the whole group still goes at two or more
        for l in [&a, &b, &far] {
            x["board"][l]["sway"]["ann"] = json!(1);
        }
    });
    let t = |from: Value| json!({ "mode": "location", "location": loc, "faction": f, "from": from });
    assert_eq!(check(&s, "ann", "draw-away", t(json!([a, b]))), None);
    assert!(check(&s, "ann", "draw-away", t(json!([a, far]))).is_some(), "only within 2 steps");
    let bare = adjacent(&loc).into_iter().find(|x| x != &a).unwrap();
    assert!(check(&s, "ann", "draw-away", t(json!([a, bare]))).is_some(), "only where you have sway");
    let two = preview(&s, "ann", "draw-away", t(json!([a, b])));
    assert_eq!((two["board"][&loc]["tokens"].get(&f).cloned(), two["board"][&a]["tokens"][&f].clone(), two["board"][&b]["tokens"][&f].clone()), (None, json!(3), json!(2)));
    assert_eq!((two["board"][&a]["sway"]["ann"].clone(), two["board"][&b]["sway"]["ann"].clone()), (json!(2), json!(2)));
    let one = preview(&s, "ann", "draw-away", t(json!([a])));
    assert_eq!((one["board"][&loc]["tokens"][&f].clone(), one["board"][&a]["tokens"][&f].clone()), (json!(3), json!(2)));
    // All or nothing: 1 sway a landing.
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(1));
    assert!(check(&poor, "ann", "draw-away", t(json!([a, b]))).is_some());
    assert_eq!(check(&poor, "ann", "draw-away", t(json!([a]))), None);
}

#[test]
fn whole_games_with_go_loud_play_to_the_end() {
    for seed in 1..3 {
        assert_eq!(play_out(&game_opts(seed, &[("drawAway", "loud")]), seed as u64).phase, Phase::Ended);
    }
}

/// The Gate with its pull (variant gate=pull; the designer's draft, design document H.0, 2026-11-08).
#[test]
fn the_gate_pulls_into_each_end_one_token_per_sway_on_it_from_its_own_neighbours() {
    let s0 = clear(&game_opts(1, &[("gate", "pull")]));
    let fs = of_arch(&s0, "scifi");
    let r = of_arch(&s0, "nocturnals");
    let ends: Vec<String> = locs().into_iter().filter(|l| l.1 == "scifi").map(|l| l.0).collect();
    let (a, b) = (ends[0].clone(), ends[1].clone());
    let na = adjacent(&a).into_iter().find(|x| x != &b && !adjacent(&b).contains(x) && !ends.contains(x)).unwrap();
    let nb = adjacent(&b).into_iter().find(|x| x != &a && !adjacent(&a).contains(x) && x != &na && !ends.contains(x)).unwrap();
    let s = edit(&s0, |x| {
        x["board"][&a]["tokens"][&fs] = json!(2);
        x["board"][&a]["sway"]["bob"] = json!(2); // everyone's sway counts: a pulls 3
        x["board"][&na]["tokens"][&fs] = json!(4);
        x["board"][&nb]["tokens"][&r] = json!(2);
    });
    let pull = |l: &str, f: &str, e: &str| json!({ "location": l, "faction": f, "to": e });
    let t = |moves: Value| json!({ "mode": "location", "location": a, "to": b, "payer": fs, "losses": a, "moves": moves });
    let full = t(json!([pull(&na, &fs, &a), pull(&na, &fs, &a), pull(&na, &fs, &a), pull(&nb, &r, &b)]));
    assert_eq!(check(&s, "ann", "gate", full.clone()), None);
    assert!(check(&s, "ann", "gate", t(json!([pull(&na, &fs, &a), pull(&nb, &r, &b)]))).is_some(), "as many as can come");
    assert!(check(&s, "ann", "gate", t(json!([pull(&na, &fs, &b), pull(&na, &fs, &a), pull(&na, &fs, &a), pull(&nb, &r, &b)]))).is_some(), "each end from its own neighbours");
    let after = preview(&s, "ann", "gate", full.clone());
    let bd = &after["board"];
    assert_eq!((bd[&a]["tokens"][&fs].clone(), bd[&na]["tokens"][&fs].clone(), bd[&b]["tokens"][&r].clone(), bd[&nb]["tokens"][&r].clone()), (json!(5), json!(1), json!(1), json!(1)));
    assert_eq!((bd[&a]["sway"]["ann"].clone(), bd[&b]["sway"]["ann"].clone()), (json!(1), json!(1)));
    // A pull may make a fight: the rival comes into a Gate that held only the Sci-Fi faction.
    assert_eq!(bd[&b]["tokens"][&r], json!(1));
    // 1 at each end, both needed.
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&fs] = json!(1));
    assert!(check(&poor, "ann", "gate", full).is_some());
    // Mixed readings: a Sci-Fi location joined with a location holding the Sci-Fi faction.
    let other = locs().into_iter().map(|l| l.0).find(|l| !ends.contains(l) && l != &na && l != &nb && !adjacent(&a).contains(l)).unwrap();
    let mixed = edit(&s0, |x| {
        x["board"][&a]["tokens"][&fs] = json!(2);
        x["board"][&other]["tokens"][&fs] = json!(1);
    });
    let pulls_ok = |s: &GameState| { let tt = json!({ "mode": "location", "location": a, "to": other, "payer": fs, "losses": a, "moves": [] }); check(s, "ann", "gate", tt) };
    assert_ne!(pulls_ok(&mixed), Some("Join two Sci-Fi locations.".to_string()));
}

#[test]
fn whole_games_with_the_gate_pulling_play_to_the_end() {
    for seed in 1..3 {
        assert_eq!(play_out(&game_opts(seed, &[("gate", "pull")]), seed as u64).phase, Phase::Ended);
    }
}

#[test]
fn whole_games_with_the_planted_cross_end_with_no_cross_left_on_the_board() {
    for seed in 1..4 {
        let end = play_out(&game_opts(seed, &[("cross", "plant")]), seed as u64);
        assert_eq!(end.phase, Phase::Ended);
        assert!(end.board.iter().all(|p| p.cross == 0 && !p.cross_at && p.hidden == 0));
    }
}

#[test]
fn invite_them_in_two_groups_next_door_into_an_empty_location() {
    let s0 = clear(&game(1));
    let noct = of_arch(&s0, "nocturnals");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != noct).collect();
    let (f, g, h) = (others[0].clone(), others[1].clone(), others[2].clone());
    let to = locs().into_iter().find(|l| l.1 == "nocturnals" && adjacent(&l.0).len() >= 3).unwrap().0;
    let adj = adjacent(&to);
    let (a, b, c) = (adj[0].clone(), adj[1].clone(), adj[2].clone());
    let mut s = edit(&s0, |x| {
        x["board"][&a]["tokens"] = obj(&[(&f, 3)]);
        x["board"][&b]["tokens"] = obj(&[(&g, 4)]);
        x["board"][&c]["tokens"] = obj(&[(&f, 2), (&h, 2)]);
        for x2 in factions(&s0) {
            x["players"]["ann"]["standing"][&x2] = json!(0);
        }
        x["players"]["ann"]["standing"][&f] = json!(2);
        x["players"]["ann"]["standing"][&g] = json!(1);
        x["players"]["ann"]["standing"][&h] = json!(1);
    });
    let offered = choice(&s, "ann", "invite-in", json!({ "mode": "location", "location": to }));
    assert_eq!(offered["kind"], "group");
    assert!(offered["options"].as_array().unwrap().iter().any(|o| o["location"] == c.as_str() && o["faction"] == h.as_str()));
    let half = json!({ "mode": "location", "location": to, "moves": [{ "location": c, "faction": h, "to": "" }, { "location": b, "faction": g, "to": "" }], "payer": g });
    s = edit(&s, |x| { x["players"]["ann"]["standing"][&h] = json!(1); x["players"]["ann"]["standing"][&g] = json!(2); });
    assert_eq!(check(&s, "ann", "invite-in", half.clone()), None);
    let ha = preview(&s, "ann", "invite-in", half);
    assert_eq!((ha["board"][&to]["tokens"][&h].clone(), ha["board"][&c]["tokens"][&h].clone()), (json!(1), json!(1)));
    s = edit(&s, |x| { x["players"]["ann"]["standing"][&h] = json!(0); x["players"]["ann"]["standing"][&g] = json!(1); });
    let t = json!({ "mode": "location", "location": to, "moves": [{ "location": a, "faction": f, "to": "" }, { "location": b, "faction": g, "to": "" }], "payer": f });
    assert_eq!(check(&s, "ann", "invite-in", t.clone()), None);
    let after = preview(&s, "ann", "invite-in", t.clone());
    assert_eq!(after["board"][&to]["tokens"], obj(&[(&f, 3), (&g, 4)]));
    assert_eq!(
        vec![&after["board"][&a]["sway"]["ann"], &after["board"][&b]["sway"]["ann"], &after["board"][&to]["sway"]["ann"], &after["players"]["ann"]["standing"][&f], &after["players"]["ann"]["standing"][&g]],
        vec![&json!(1), &json!(1), &json!(1), &json!(0), &json!(0)]
    );
    let mut t2 = t.clone();
    t2["payer"] = json!(g);
    assert!(check(&s, "ann", "invite-in", t2).is_some());
    let q = edit(&clear(&game(1)), |x| {
        x["board"][&to]["tokens"] = obj(&[(&f, 2)]);
        x["board"][&a]["tokens"] = obj(&[(&noct, 3)]);
        x["players"]["ann"]["standing"][&noct] = json!(2);
    });
    let ft = json!({ "mode": "faction", "location": to, "moves": [{ "location": a, "faction": noct, "to": "" }] });
    assert_eq!(check(&q, "ann", "invite-in", ft.clone()), None);
    let fa = preview(&q, "ann", "invite-in", ft.clone());
    assert_eq!((fa["board"][&to]["tokens"][&noct].clone(), fa["board"][&a]["sway"]["ann"].clone(), fa["board"][&to]["sway"]["ann"].clone()), (json!(3), json!(1), json!(1)));
    let q = edit(&q, |x| x["players"]["ann"]["standing"][&noct] = json!(1));
    assert!(check(&q, "ann", "invite-in", ft).is_some());
}

#[test]
fn the_gate_joins_two_locations_one_location_for_movement_one_fight() {
    let s0 = clear(&game(1));
    let sci = of_arch(&s0, "scifi");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != sci).collect();
    let (f, g, h) = (others[0].clone(), others[1].clone(), others[2].clone());
    let (a, b) = ("military-facility".to_string(), "state-park".to_string());
    let s = edit(&s0, |x| {
        x["board"][&a]["tokens"] = obj(&[(&f, 3)]);
        x["board"][&b]["tokens"] = obj(&[(&g, 2)]);
        for x2 in factions(&s0) {
            x["players"]["ann"]["standing"][&x2] = json!(1);
        }
    });
    let t = json!({ "mode": "location", "location": a, "to": b, "payer": f, "losses": a });
    assert_eq!(check(&s, "ann", "gate", t.clone()), None);
    let three = edit(&s, |x| x["board"][&b]["tokens"] = obj(&[(&g, 2), (&h, 1)]));
    assert!(check(&three, "ann", "gate", t.clone()).is_some());
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(0));
    assert!(check(&poor, "ann", "gate", t.clone()).is_some());
    // D36: the faction reading joins two locations holding the Sci-Fi faction; Sci-Fi pays when it is at either end.
    let fac = json!({ "mode": "faction", "location": a, "to": b, "payer": f, "losses": a });
    assert!(check(&s, "ann", "gate", fac).is_some());
    let with_sci = edit(&s, |x| x["board"][&b]["tokens"] = obj(&[(&sci, 2)]));
    assert!(check(&with_sci, "ann", "gate", t.clone()).is_some());
    let sci_pays = json!({ "mode": "location", "location": a, "to": b, "payer": sci, "losses": a });
    assert_eq!(check(&with_sci, "ann", "gate", sci_pays), None);
    let p = preview(&s, "ann", "gate", t.clone());
    let joined = edit(&s, |x| { x["board"] = p["board"].clone(); x["players"] = p["players"].clone(); });
    let jv = v(&joined);
    assert_eq!(
        vec![jv["board"][&a]["gate"].clone(), jv["board"][&b]["gate"].clone(), jv["board"][&a]["sway"]["ann"].clone(), jv["players"]["ann"]["standing"][&f].clone()],
        vec![json!(b), json!(a), json!(1), json!(0)]
    );
    let mut due: Vec<String> = fights_due(&joined).into_iter().map(|l| spec().locations[l as usize].id.clone()).collect();
    due.sort();
    let mut want = vec![a.clone(), b.clone()];
    want.sort();
    assert_eq!(due, want);
    let joined = edit(&joined, |x| { x["board"][&a]["sway"] = obj(&[("ann", 2)]); x["board"][&b]["sway"] = obj(&[("bob", 1)]); });
    let fought = fight(&joined, &a);
    assert_eq!((fought["board"][&a]["tokens"].clone(), fought["board"][&b]["tokens"].clone()), (obj(&[(&f, 2)]), json!({})));
    assert_eq!((fought["players"]["ann"]["trophies"][&g].clone(), fought["players"]["bob"]["trophies"][&f].clone()), (json!(2), json!(1)));
    assert!(fought["board"][&a]["sway"].get("ann").is_none());
    assert_eq!(fought["board"][&b]["sway"]["bob"], 1);
    assert!(fought["board"][&a].get("gate").is_none());
    let tie = edit(&joined, |x| x["board"][&a]["tokens"] = obj(&[(&f, 2)]));
    let aligned = [&f, &g].iter().any(|x| [&a, &b].iter().any(|l| locs().iter().any(|(id, arch)| id == *l && *arch == arch_of_faction(x))));
    if !aligned {
        let burnt = fight(&tie, &b);
        assert_eq!((burnt["board"][&a]["scorched"].clone(), burnt["board"][&b]["scorched"].clone()), (json!(true), json!(true)));
    }
}

#[test]
fn the_gate_a_group_at_both_ends_moves_as_one_and_next_door_reaches_through_it() {
    // Enforces D36 (design document, Appendix A).
    let s0 = clear(&game(1));
    let sci = of_arch(&s0, "scifi");
    let sen = of_arch(&s0, "sentients");
    let g = factions(&s0).into_iter().find(|x| *x != sci && *x != sen).unwrap();
    let (a, b) = ("military-facility".to_string(), "state-park".to_string());
    let far = locs().into_iter().map(|l| l.0).find(|l| *l != a && *l != b && !adjacent(&a).contains(l)).unwrap();
    let s = edit(&s0, |x| {
        x["board"][&a]["tokens"] = obj(&[(&sen, 3)]);
        x["board"][&b]["tokens"] = obj(&[(&sen, 2)]);
        x["board"][&a]["gate"] = json!(b);
        x["board"][&b]["gate"] = json!(a);
        x["board"][&far]["tokens"] = obj(&[(&sen, 1)]);
    });
    let t = json!({ "mode": "faction", "location": a, "faction": sen, "from": [] });
    assert_eq!(check(&s, "ann", "cut-powerlines", t.clone()), None);
    let cut = preview(&s, "ann", "cut-powerlines", t);
    assert_eq!(cut["board"][&far]["tokens"][&sen], 6);
    assert!(cut["board"][&a]["tokens"].get(&sen).is_none() && cut["board"][&b]["tokens"].get(&sen).is_none());
    let q = edit(&clear(&game(1)), |x| {
        x["board"]["military-facility"]["gate"] = json!(b);
        x["board"][&b]["gate"] = json!("military-facility");
        x["board"][&b]["tokens"] = obj(&[(&g, 2)]);
        x["board"]["junkyard"]["tokens"] = obj(&[(&sen, 1)]);
    });
    let offered = choice(&q, "ann", "invite-in", json!({ "mode": "location", "location": "ski-resort" }));
    assert_eq!(offered["kind"], "group");
    assert!(offered["options"].as_array().unwrap().iter().any(|o| o["faction"] == g.as_str()));
}

#[test]
fn spoof_the_signal_marches_on_the_largest_lone_rival_within_two_locations() {
    let s0 = clear(&game(1));
    let sent = of_arch(&s0, "sentients");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != sent).collect();
    let (f, g, h) = (others[0].clone(), others[1].clone(), others[2].clone());
    let from = first_loc("sentients");
    let one = adjacent(&from)[0].clone();
    let two = adjacent(&one).into_iter().find(|l| *l != from && !adjacent(&from).contains(l)).unwrap();
    let s = edit(&s0, |x| {
        x["board"][&from]["tokens"] = obj(&[(&f, 4)]);
        x["board"][&one]["tokens"] = obj(&[(&g, 3)]);
        x["board"][&two]["tokens"] = obj(&[(&h, 5)]);
        x["players"]["ann"]["standing"][&f] = json!(2);
    });
    let c = choice(&s, "ann", "hack-targeting", json!({ "mode": "location", "location": from, "faction": f }));
    assert_eq!((c["kind"].clone(), c["options"].clone()), (json!("location"), json!([two])));
    let t = json!({ "mode": "location", "location": from, "faction": f, "to": two });
    assert_eq!(check(&s, "ann", "hack-targeting", t.clone()), None);
    let mut t1 = t.clone();
    t1["to"] = json!(one);
    assert!(check(&s, "ann", "hack-targeting", t1).is_some());
    let after = preview(&s, "ann", "hack-targeting", t.clone());
    assert_eq!(after["board"][&two]["tokens"][&f], 4);
    assert!(after["board"][&from]["tokens"].get(&f).is_none());
    assert_eq!((after["board"][&from]["sway"]["ann"].clone(), after["board"][&two]["sway"]["ann"].clone()), (json!(1), json!(1)));
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(1));
    assert!(check(&poor, "ann", "hack-targeting", t).is_some());
}

#[test]
fn bait_the_herd_swells_along_a_trail_and_crashes_into_a_lone_rival() {
    let s0 = clear(&game(1));
    let und = of_arch(&s0, "undead");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != und).collect();
    let (g, h) = (others[1].clone(), others[2].clone());
    let (start, stop, scoop) = ("sawmill".to_string(), "lake-house".to_string(), "mine".to_string());
    let crash = adjacent(&scoop).into_iter().find(|l| *l != start && *l != stop && !adjacent(&start).contains(l) && !adjacent(&stop).contains(l))
        .unwrap_or_else(|| adjacent(&scoop).into_iter().find(|l| *l != start && *l != stop).unwrap());
    let s = edit(&s0, |x| {
        x["board"][&start]["tokens"] = obj(&[(&und, 2)]);
        x["board"][&stop]["tokens"] = obj(&[(&und, 3)]);
        x["board"][&scoop]["tokens"] = obj(&[(&und, 1)]);
        x["board"][&crash]["tokens"] = obj(&[(&h, 2)]);
        x["players"]["ann"]["standing"][&und] = json!(4);
    });
    let t = json!({ "mode": "location", "location": start, "faction": und, "path": [stop, scoop, crash] });
    assert_eq!(check(&s, "ann", "bait-trail", t.clone()), None);
    let after = preview(&s, "ann", "bait-trail", t.clone());
    assert_eq!(after["board"][&crash]["tokens"][&und], 6);
    assert!(after["board"][&start]["tokens"].get(&und).is_none() && after["board"][&stop]["tokens"].get(&und).is_none());
    assert_eq!(after["board"][&scoop]["tokens"], json!({}));
    for l in [&start, &stop, &scoop, &crash] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    let mut short = t.clone();
    short["path"] = json!([stop]);
    let moved = preview(&s, "ann", "bait-trail", short);
    assert_eq!(moved["board"][&stop]["tokens"][&und], 5);
    assert!(moved["board"][&start]["tokens"].get(&und).is_none());
    assert_eq!((moved["board"][&start]["sway"]["ann"].clone(), moved["board"][&stop]["sway"]["ann"].clone()), (json!(1), json!(1)));
    let poor = edit(&s, |x| x["players"]["ann"]["standing"][&und] = json!(3));
    assert!(check(&poor, "ann", "bait-trail", t.clone()).is_some());
    let two = edit(&s, |x| x["board"][&scoop]["tokens"] = obj(&[(&und, 2)]));
    assert_eq!(preview(&two, "ann", "bait-trail", t.clone())["board"][&scoop]["tokens"], json!({}));
    // Half from a fight (D22): a group in a fight is scooped only up to half of it, rounded down.
    let fight = edit(&s, |x| x["board"][&scoop]["tokens"] = obj(&[(&und, 1), (&g, 4)]));
    assert!(check(&fight, "ann", "bait-trail", t.clone()).is_some());
    let fight = edit(&fight, |x| x["board"][&scoop]["tokens"] = obj(&[(&und, 5), (&g, 4)]));
    assert_eq!(check(&fight, "ann", "bait-trail", t.clone()), None);
    assert_eq!(preview(&fight, "ann", "bait-trail", t)["board"][&scoop]["tokens"], obj(&[(&und, 3), (&g, 4)]));
}

#[test]
fn perform_the_ritual_draws_one_faction_from_next_door() {
    let s0 = clear(&game(1));
    let dem = of_arch(&s0, "demonic");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != dem).collect();
    let (f, g, h) = (others[0].clone(), others[1].clone(), others[2].clone());
    let centre = locs().into_iter().find(|l| l.1 == "demonic" && adjacent(&l.0).len() >= 3).unwrap().0;
    let adj = adjacent(&centre);
    let (x, y, z) = (adj[0].clone(), adj[1].clone(), adj[2].clone());
    let s = edit(&s0, |v| {
        v["board"][&x]["tokens"] = obj(&[(&f, 3)]);
        v["board"][&y]["tokens"] = obj(&[(&f, 3), (&g, 2)]);
        v["board"][&z]["tokens"] = obj(&[(&h, 2)]);
        v["players"]["ann"]["standing"][&f] = json!(3);
    });
    let t = json!({ "mode": "location", "location": centre, "faction": f, "from": [y] });
    assert_eq!(check(&s, "ann", "ritual", t.clone()), None);
    let mut t2 = t.clone();
    t2["from"] = json!([y, y]);
    assert!(check(&s, "ann", "ritual", t2).is_some());
    let after = preview(&s, "ann", "ritual", t.clone());
    assert_eq!((after["board"][&centre]["tokens"][&f].clone(), after["board"][&y]["tokens"][&f].clone(), after["board"][&z]["tokens"][&h].clone()), (json!(4), json!(2), json!(2)));
    assert!(after["board"][&x]["tokens"].get(&f).is_none());
    for l in [&x, &y, &centre] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    let poor = edit(&s, |v| v["players"]["ann"]["standing"][&f] = json!(2));
    assert!(check(&poor, "ann", "ritual", t.clone()).is_some());
    let mut t3 = t;
    t3["from"] = json!([]);
    assert_eq!(check(&poor, "ann", "ritual", t3), None);
    let q = edit(&clear(&game(1)), |v| {
        v["board"][&x]["tokens"] = obj(&[(&dem, 2)]);
        v["board"][&centre]["tokens"] = obj(&[(&f, 2)]);
        v["players"]["ann"]["standing"][&dem] = json!(2);
    });
    let fa = preview(&q, "ann", "ritual", json!({ "mode": "faction", "location": centre, "faction": dem }));
    assert_eq!(fa["board"][&centre]["tokens"], obj(&[(&f, 2), (&dem, 2)]));
}

#[test]
fn half_from_a_fight_a_card_moves_at_most_half_a_group() {
    // Enforces D22, D23 (design document, Appendix A).
    let s0 = clear(&game(1));
    let fs = factions(&s0);
    let (f, g) = (fs[0].clone(), fs[1].clone());
    let (from, to) = ("junkyard".to_string(), "graveyard".to_string());
    let s = edit(&s0, |x| { x["board"][&from]["tokens"] = obj(&[(&f, 5), (&g, 2)]); x["board"][&to]["tokens"] = obj(&[(&f, 1)]); });
    let cut = json!({ "mode": "location", "location": from, "faction": f, "from": [] });
    let after = preview(&s, "ann", "cut-powerlines", cut.clone());
    assert_eq!((after["board"][&to]["tokens"][&f].clone(), after["board"][&from]["tokens"][&f].clone()), (json!(3), json!(3)));
    let s = edit(&s, |x| { x["board"][&from]["tokens"] = obj(&[(&f, 5), (&g, 1)]); x["board"][&to]["tokens"] = obj(&[(&g, 1)]); });
    let mut c2 = cut;
    c2["faction"] = json!(g);
    assert!(check(&s, "ann", "cut-powerlines", c2).is_some());
}

#[test]
fn sd1_each_faction_starts_with_2_on_each_aligned_location_even_3() {
    // D33: 2 on each by default (seeding two); seeding even, 3 on each.
    let s = game(3);
    let x = v(&s);
    for f in factions(&s) {
        for (l, arch) in locs() {
            if arch == arch_of_faction(&f) {
                assert_eq!(x["board"][&l]["tokens"][&f], 2);
            }
        }
    }
    assert_eq!(total(&s), 30);
    assert_eq!(total(&game_opts(3, &[("seeding", "even")])), 45);
}

#[test]
fn the_big_chase_leaves_1_token_and_1_sway_at_each_location_passed() {
    let s0 = clear(&game(1));
    let sci = of_arch(&s0, "scifi");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != sci).collect();
    let (f, g, h) = (others[0].clone(), others[1].clone(), others[2].clone());
    let start = "military-facility".to_string();
    let a = adjacent(&start)[0].clone();
    let b = adjacent(&a).into_iter().find(|l| *l != start && !adjacent(&start).contains(l)).unwrap();
    let c = adjacent(&b).into_iter().find(|l| *l != start && *l != a).unwrap();
    let s = edit(&s0, |x| {
        x["board"][&start]["tokens"] = obj(&[(&f, 5)]);
        x["board"][&b]["tokens"] = obj(&[(&g, 2)]);
        x["players"]["ann"]["standing"][&f] = json!(4);
    });
    let t = json!({ "mode": "location", "location": start, "faction": f, "path": [a, b, c] });
    assert_eq!(check(&s, "ann", "big-chase", t.clone()), None);
    let after = preview(&s, "ann", "big-chase", t.clone());
    assert!(after["board"][&start]["tokens"].get(&f).is_none());
    assert_eq!((after["board"][&a]["tokens"][&f].clone(), after["board"][&b]["tokens"].clone(), after["board"][&c]["tokens"][&f].clone()), (json!(1), obj(&[(&g, 2), (&f, 1)]), json!(3)));
    for l in [&start, &a, &b, &c] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    assert!(check(&edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(3)), "ann", "big-chase", t.clone()).is_some());
    let s9 = edit(&s, |x| { x["players"]["ann"]["standing"][&f] = json!(9); x["board"][&start]["tokens"] = obj(&[(&f, 2)]); });
    assert!(check(&s9, "ann", "big-chase", t.clone()).is_some());
    let s9 = edit(&s9, |x| { x["board"][&start]["tokens"] = obj(&[(&f, 5)]); x["board"][&a]["tokens"] = obj(&[(&g, 1), (&h, 1)]); });
    assert!(check(&s9, "ann", "big-chase", t).is_some());
}

#[test]
fn the_big_chase_sets_off_from_a_fight_too_with_half() {
    // Enforces D22 (design document, Appendix A).
    let s0 = clear(&game(1));
    let sci = of_arch(&s0, "scifi");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != sci).collect();
    let (f, g) = (others[0].clone(), others[1].clone());
    let start = "military-facility".to_string();
    let a = adjacent(&start)[0].clone();
    let s = edit(&s0, |x| { x["board"][&start]["tokens"] = obj(&[(&f, 5), (&g, 4)]); x["players"]["ann"]["standing"][&f] = json!(9); });
    let chase = json!({ "mode": "location", "location": start, "faction": f, "path": [a] });
    assert_eq!(check(&s, "ann", "big-chase", chase.clone()), None);
    assert_eq!(preview(&s, "ann", "big-chase", chase.clone())["board"][&start]["tokens"], obj(&[(&f, 3), (&g, 4)]));
    let c = adjacent(&a).into_iter().find(|l| *l != start && !adjacent(&start).contains(l)).unwrap();
    let mut two = chase.clone();
    two["path"] = json!([a, c]);
    assert_eq!(check(&s, "ann", "big-chase", two), None);
    let d = adjacent(&c).into_iter().find(|l| *l != start && *l != a && !adjacent(&start).contains(l)).unwrap();
    let mut three = chase;
    three["path"] = json!([a, c, d]);
    assert!(check(&s, "ann", "big-chase", three).is_some());
    let s = edit(&s, |x| { x["board"][&start]["tokens"] = obj(&[(&sci, 4), (&g, 4)]); x["players"]["ann"]["standing"][&sci] = json!(9); });
    assert_eq!(check(&s, "ann", "big-chase", json!({ "mode": "faction", "location": start, "faction": sci, "path": [a] })), None);
}

#[test]
fn draw_them_away_a_group_bursts_1_token_to_each_chosen_neighbour() {
    let s0 = clear(&game(1));
    let dead = of_arch(&s0, "undead");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != dead).collect();
    let (f, g) = (others[0].clone(), others[1].clone());
    let loc = locs().into_iter().find(|l| l.1 == "undead" && adjacent(&l.0).len() >= 3).unwrap().0;
    let adj = adjacent(&loc);
    let (a, b, c) = (adj[0].clone(), adj[1].clone(), adj[2].clone());
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&f, 4)]);
        x["board"][&c]["tokens"] = obj(&[(&g, 2)]);
        x["players"]["ann"]["standing"][&f] = json!(4);
    });
    let t = json!({ "mode": "location", "location": loc, "faction": f, "from": [a, b, c] });
    assert_eq!(check(&s, "ann", "draw-away", t.clone()), None);
    let after = preview(&s, "ann", "draw-away", t.clone());
    assert_eq!(
        (after["board"][&loc]["tokens"][&f].clone(), after["board"][&a]["tokens"][&f].clone(), after["board"][&b]["tokens"][&f].clone(), after["board"][&c]["tokens"].clone()),
        (json!(1), json!(1), json!(1), obj(&[(&g, 2), (&f, 1)]))
    );
    for l in [&loc, &a, &b, &c] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    let mut one = t.clone();
    one["from"] = json!([a]);
    assert!(check(&s, "ann", "draw-away", one).is_some());
    assert!(check(&edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(3)), "ann", "draw-away", t).is_some());
}

#[test]
fn the_core_deck_prints_each_cards_own_sway_and_a_signatures_is_the_hand() {
    // Enforces D24 (design document, Appendix A).
    assert_eq!((printed_of(card("invite-in")), printed_of(card("plough"))), (2, 3));
    let s = draft_all(&game(1));
    let p = (0..s.n()).find(|&p| !s.players[p].hand.is_empty()).unwrap();
    let hand = &s.players[p].hand;
    assert_eq!(sway_for(&s, p as Pid, card("night-terrors")), hand.len() as i32 + if hand.contains(&card("night-terrors")) { 0 } else { 1 });
}

fn set_hand(x: &mut Value, who: &str, cards: &[&str]) {
    x["players"][who]["hand"] = json!(cards);
}

#[test]
fn take_control_spends_your_sway_at_a_fight_to_cut_down_a_faction_there() {
    // Enforces D26 (design document, Appendix A).
    let s0 = clear(&game(1));
    let sent = of_arch(&s0, "sentients");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != sent).collect();
    let (f, g) = (others[0].clone(), others[1].clone());
    let hub = first_loc("sentients");
    let away = locs().into_iter().find(|l| l.1 != "sentients").unwrap().0;
    let s = edit(&s0, |x| {
        set_hand(x, "ann", &["take-control", "gate", "plough"]);
        x["board"][&away]["tokens"] = obj(&[(&sent, 2), (&f, 5)]);
        x["board"][&away]["sway"] = obj(&[("ann", 4), ("bob", 2)]);
    });
    let t = json!({ "mode": "faction", "location": away, "faction": f, "from": [away, away, away] });
    assert_eq!(check(&s, "ann", "take-control", t.clone()), None);
    let mut four = t.clone();
    four["from"] = json!([away, away, away, away]);
    assert!(check(&s, "ann", "take-control", four).is_some());
    let mut self_hit = t.clone();
    self_hit["faction"] = json!(sent);
    assert!(check(&s, "ann", "take-control", self_hit).is_some());
    let after = preview(&s, "ann", "take-control", t.clone());
    assert_eq!(after["board"][&away]["tokens"], obj(&[(&sent, 2), (&f, 2)]));
    assert_eq!(after["players"]["ann"]["trophies"][&f], 3);
    assert_eq!(after["board"][&away]["sway"]["ann"], 1);
    assert_eq!(after["players"]["ann"]["supply"].as_i64().unwrap(), v(&s)["players"]["ann"]["supply"].as_i64().unwrap() + 3);
    let s2 = edit(&s, |x| x["board"][&away]["tokens"] = obj(&[(&sent, 2), (&f, 2)]));
    let mut two = t;
    two["from"] = json!([away, away]);
    assert_eq!(check(&s2, "ann", "take-control", two), None);
    let s3 = edit(&s2, |x| x["board"][&hub]["tokens"] = obj(&[(&f, 3), (&g, 3)]));
    let loc = json!({ "mode": "location", "location": hub, "faction": g, "from": [hub] });
    assert!(check(&s3, "ann", "take-control", loc.clone()).is_some());
    let s4 = edit(&s3, |x| x["board"][&hub]["sway"] = obj(&[("ann", 1)]));
    assert_eq!(check(&s4, "ann", "take-control", loc.clone()), None);
    let mut elsewhere = loc;
    elsewhere["location"] = json!(away);
    assert!(check(&s4, "ann", "take-control", elsewhere).is_some());
}

#[test]
fn spill_blood_on_the_altar_marks_and_the_winner_loses_as_many_as_the_loser() {
    // Enforces D26 (design document, Appendix A).
    let s0 = clear(&game(1));
    let demon = of_arch(&s0, "demonic");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != demon).collect();
    let (f, g) = (others[0].clone(), others[1].clone());
    let open: Vec<String> = locs().into_iter().filter(|l| l.1 != arch_of_faction(&f) && l.1 != arch_of_faction(&g) && l.1 != "demonic").map(|l| l.0).collect();
    let (x, y, z) = (open[0].clone(), open[1].clone(), open[2].clone());
    let s = edit(&s0, |v| {
        v["board"][&x]["tokens"] = obj(&[(&demon, 5), (&f, 3)]);
        v["board"][&y]["tokens"] = obj(&[(&demon, 2)]);
        v["board"][&z]["tokens"] = obj(&[(&demon, 1)]);
        v["players"]["ann"]["standing"][&demon] = json!(3);
        set_hand(v, "ann", &["spill-blood", "gate"]);
    });
    let t = json!({ "mode": "faction", "moves": [{ "location": x, "faction": demon, "to": "" }, { "location": y, "faction": demon, "to": "" }] });
    assert_eq!(check(&s, "ann", "spill-blood", t.clone()), None);
    let mut t3 = t.clone();
    t3["moves"].as_array_mut().unwrap().push(json!({ "location": z, "faction": demon, "to": "" }));
    assert!(check(&s, "ann", "spill-blood", t3).is_some());
    let p = preview(&s, "ann", "spill-blood", t);
    let after = edit(&s, |v| { v["board"] = p["board"].clone(); v["players"] = p["players"].clone(); });
    let av = v(&after);
    assert_eq!(
        vec![&av["board"][&x]["altar"], &av["board"][&y]["altar"], &av["board"][&x]["sway"]["ann"], &av["board"][&y]["sway"]["ann"], &av["players"]["ann"]["standing"][&demon]],
        vec![&json!(true), &json!(true), &json!(1), &json!(1), &json!(1)]
    );
    assert_eq!(fight(&after, &x)["board"][&x]["tokens"], obj(&[(&demon, 2)]));
    let dl: Vec<String> = locs().into_iter().filter(|l| l.1 == "demonic").map(|l| l.0).collect();
    let (home, other) = (dl[0].clone(), dl[1].clone());
    let q = edit(&clear(&game(1)), |v| {
        v["board"][&other]["tokens"] = obj(&[(&f, 2)]);
        v["players"]["ann"]["standing"][&demon] = json!(1);
        v["players"]["ann"]["standing"][&f] = json!(1);
        set_hand(v, "ann", &["spill-blood", "gate", "ritual"]);
    });
    let lt = json!({ "mode": "location", "moves": [{ "location": other, "faction": f, "to": "" }], "from": [home] });
    assert_eq!(check(&q, "ann", "spill-blood", lt.clone()), None);
    let la = preview(&q, "ann", "spill-blood", lt);
    assert_eq!(
        vec![&la["board"][&home]["altar"], &la["board"][&other]["altar"], &la["players"]["ann"]["standing"][&demon], &la["players"]["ann"]["standing"][&f]],
        vec![&json!(true), &json!(true), &json!(0), &json!(0)]
    );
}

/// Spill Blood with a bigger stake (variant altar=stake; the designer's draft, design document H.0, 2026-11-08).
#[test]
fn spill_blood_with_a_stake_spends_up_to_the_cards_sway_2_or_3_on_each_mark() {
    let s0 = clear(&game_opts(1, &[("altar", "stake")]));
    let demon = of_arch(&s0, "demonic");
    let open: Vec<String> = locs().into_iter().filter(|l| l.1 != "demonic").map(|l| l.0).collect();
    let (x, y, z) = (open[0].clone(), open[1].clone(), open[2].clone());
    let s = edit(&s0, |v| {
        for l in [&x, &y, &z] {
            v["board"][l]["tokens"] = obj(&[(&demon, 2)]);
        }
        v["players"]["ann"]["standing"][&demon] = json!(9);
        set_hand(v, "ann", &["spill-blood", "gate", "ritual", "invite-in", "plough"]);
    });
    let m = |l: &str| json!({ "location": l, "faction": demon, "to": "" });
    let t = |ls: &[&str]| json!({ "mode": "faction", "moves": ls.iter().map(|l| m(l)).collect::<Vec<_>>() });
    assert_eq!(check(&s, "ann", "spill-blood", t(&[&x, &x, &x, &y, &y])), None, "5 cards: a 3 and a 2");
    assert!(check(&s, "ann", "spill-blood", t(&[&x, &x, &x, &x])).is_some(), "at most 3 on a mark");
    assert!(check(&s, "ann", "spill-blood", t(&[&x, &x, &y])).is_some(), "at least 2 on each mark");
    assert!(check(&s, "ann", "spill-blood", t(&[&x, &x, &y, &y, &z, &z])).is_some(), "no more than the card's sway");
    let p = preview(&s, "ann", "spill-blood", t(&[&x, &x, &x, &y, &y]));
    assert_eq!(
        vec![&p["board"][&x]["sway"]["ann"], &p["board"][&y]["sway"]["ann"], &p["board"][&x]["altar"], &p["players"]["ann"]["standing"][&demon]],
        vec![&json!(3), &json!(2), &json!(true), &json!(4)]
    );
    // Mixed readings: a Demon location paid by another faction there, with a location holding the Demons.
    let home = locs().into_iter().find(|l| l.1 == "demonic").unwrap().0;
    let f = factions(&s0).into_iter().find(|x| *x != demon).unwrap();
    let q = edit(&s, |v| {
        v["board"][&home]["tokens"] = obj(&[(&f, 2)]);
        v["players"]["ann"]["standing"][&f] = json!(2);
    });
    let mixed = json!({ "mode": "faction", "moves": [
        { "location": home, "faction": f, "to": "" }, { "location": home, "faction": f, "to": "" }, m(&x), m(&x)] });
    assert_eq!(check(&q, "ann", "spill-blood", mixed), None);
}

#[test]
fn whole_games_with_spill_blood_staked_play_to_the_end() {
    for seed in 1..3 {
        assert_eq!(play_out(&game_opts(seed, &[("altar", "stake")]), seed as u64).phase, Phase::Ended);
    }
}

/// Cut the Powerlines aimed (variant powerlines=pick; the designer's draft, design document H.0, 2026-11-08).
#[test]
fn cut_the_powerlines_aimed_scatters_to_the_groups_you_pick_with_1_sway_at_each_one() {
    let s0 = clear(&game_opts(1, &[("powerlines", "pick")]));
    let fs = of_arch(&s0, "sentients");
    let home = locs().into_iter().find(|l| l.1 == "sentients").unwrap().0;
    let others: Vec<String> = locs().into_iter().map(|l| l.0).filter(|l| l != &home).collect();
    let (a, b, c) = (others[0].clone(), others[1].clone(), others[2].clone());
    let s = edit(&s0, |v| {
        v["board"][&home]["tokens"] = obj(&[(&fs, 5)]);
        for l in [&a, &b, &c] {
            v["board"][l]["tokens"] = obj(&[(&fs, 1)]);
        }
        v["players"]["ann"]["standing"][&fs] = json!(2);
    });
    let t = |picks: &[&str], odd: &[&str]| json!({ "mode": "location", "location": home, "faction": fs, "from": picks, "path": odd });
    assert_eq!(check(&s, "ann", "cut-powerlines", t(&[&a, &b], &[&a])), None);
    assert!(check(&s, "ann", "cut-powerlines", t(&[&a, &b], &[])).is_some(), "the odd token is placed");
    assert!(check(&s, "ann", "cut-powerlines", t(&[&a, &b, &c], &[&a, &b])).is_some(), "1 sway at each group joined");
    let p = preview(&s, "ann", "cut-powerlines", t(&[&a, &b], &[&a]));
    let bd = &p["board"];
    assert_eq!(
        vec![&bd[&a]["tokens"][&fs], &bd[&b]["tokens"][&fs], &bd[&c]["tokens"][&fs], &bd[&a]["sway"]["ann"], &bd[&b]["sway"]["ann"], &p["players"]["ann"]["standing"][&fs]],
        vec![&json!(4), &json!(3), &json!(1), &json!(1), &json!(1), &json!(0)]
    );
    assert!(bd[&home]["sway"]["ann"].is_null(), "no sway where it left");
}

#[test]
fn whole_games_with_cut_the_powerlines_aimed_play_to_the_end() {
    for seed in 1..3 {
        assert_eq!(play_out(&game_opts(seed, &[("powerlines", "pick")]), seed as u64).phase, Phase::Ended);
    }
}

#[test]
fn the_unsuited_cards_x_is_the_hand_and_each_use_does_what_it_says() {
    // Enforces D24 (design document, Appendix A).
    let s0 = clear(&game(1));
    let fs = factions(&s0);
    let (f, g, h) = (fs[0].clone(), fs[1].clone(), fs[2].clone());
    let loc = spec().locations[0].id.clone();
    let adj = adjacent(&loc);
    let (a, b) = (adj[0].clone(), adj[1].clone());
    let with = |s: &GameState, c: &str| edit(s, |x| set_hand(x, "ann", &[c, "gate", "ritual"]));
    let st0 = |s: &GameState, f: &str| v(s)["players"]["ann"]["standing"][f].as_i64().unwrap();
    // A, Call in Favours
    let s = edit(&with(&s0, "favours"), |x| x["players"]["ann"]["supply"] = json!(10));
    let fav = json!({ "use": "standing", "payers": [f, f, f] });
    assert_eq!(check(&s, "ann", "favours", fav.clone()), None);
    assert!(check(&s, "ann", "favours", json!({ "use": "standing", "payers": [f, f, f, f] })).is_some());
    assert!(check(&s, "ann", "favours", json!({ "use": "standing", "payers": [f, g] })).is_some());
    let fa = preview(&s, "ann", "favours", fav);
    assert_eq!((fa["players"]["ann"]["standing"][&f].as_i64().unwrap(), fa["players"]["ann"]["supply"].as_i64().unwrap()), (st0(&s, &f) + 3, 7));
    let s = edit(&s, |x| x["board"][&a]["tokens"] = obj(&[(&f, 2), (&g, 2)]));
    assert_eq!(preview(&s, "ann", "favours", json!({ "use": "sway", "from": [a] }))["board"][&a]["sway"]["ann"], 1);
    assert!(check(&s, "ann", "favours", json!({ "use": "sway", "from": [b] })).is_some());
    // B, Raise the Stakes
    let s = with(&s, "stakes");
    let stv = preview(&s, "ann", "stakes", json!({ "use": "standing", "faction": f, "payers": [g, h] }));
    assert_eq!((stv["players"]["ann"]["standing"][&f].as_i64().unwrap(), stv["players"]["ann"]["standing"][&g].as_i64().unwrap()), (st0(&s, &f) + 2, st0(&s, &g) - 1));
    let s = edit(&s, |x| { x["board"][&a]["tokens"] = obj(&[(&g, 3)]); x["board"][&loc]["sway"] = obj(&[("ann", 1)]); });
    let tk = preview(&s, "ann", "stakes", json!({ "use": "tokens", "location": loc, "faction": g, "from": [a, a] }));
    assert_eq!(
        vec![&tk["board"][&loc]["tokens"][&g], &tk["board"][&a]["tokens"][&g], &tk["board"][&a]["sway"]["ann"], &tk["board"][&loc]["sway"]["ann"]],
        vec![&json!(2), &json!(1), &json!(1), &json!(2)]
    );
    assert!(check(&s, "ann", "stakes", json!({ "use": "tokens", "location": b, "faction": g, "from": [a] })).is_some());
    // C, Cover Every Exit
    let s = edit(&with(&s, "exit"), |x| { x["board"][&a]["tokens"] = json!({}); x["board"][&loc]["tokens"] = obj(&[(&g, 4)]); });
    let ex = preview(&s, "ann", "exit", json!({ "use": "tokens", "location": loc, "faction": g, "from": [a, b] }));
    assert_eq!(vec![&ex["board"][&loc]["tokens"][&g], &ex["board"][&a]["tokens"][&g], &ex["board"][&b]["tokens"][&g]], vec![&json!(2), &json!(1), &json!(1)]);
    // D, Showdown
    let s = edit(&with(&s, "showdown"), |x| x["board"][&loc]["sway"] = obj(&[("ann", 2)]));
    let sd = preview(&s, "ann", "showdown", json!({ "location": loc, "faction": g, "from": [loc, loc] }));
    assert_eq!(
        (sd["board"][&loc]["tokens"][&g].clone(), sd["players"]["ann"]["trophies"][&g].clone(), sd["board"][&loc]["sway"].get("ann").cloned().unwrap_or(json!(0)), sd["players"]["ann"]["supply"].as_i64().unwrap()),
        (json!(2), json!(2), json!(0), v(&s)["players"]["ann"]["supply"].as_i64().unwrap() + 2)
    );
    assert!(check(&s, "ann", "showdown", json!({ "location": loc, "faction": g, "from": [loc, loc, loc] })).is_some());
    let fight_here = edit(&s, |x| x["board"][&loc]["tokens"] = obj(&[(&g, 4), (&h, 1)]));
    assert!(check(&fight_here, "ann", "showdown", json!({ "location": loc, "faction": g, "from": [loc] })).is_some());
    // Switch Allegiance
    let s = with(&fight_here, "switch");
    let sw = preview(&s, "ann", "switch", json!({ "use": "standing", "faction": f, "to": g, "payers": [f, f] }));
    assert_eq!((sw["players"]["ann"]["standing"][&f].as_i64().unwrap(), sw["players"]["ann"]["standing"][&g].as_i64().unwrap()), (st0(&s, &f) - 2, st0(&s, &g) + 2));
    let far = spec().locations.last().unwrap().id.clone();
    let sj = preview(&s, "ann", "switch", json!({ "use": "sway", "location": loc, "to": far, "from": [far, far] }));
    assert_eq!((sj["board"][&loc]["sway"].get("ann").cloned().unwrap_or(json!(0)), sj["board"][&far]["sway"]["ann"].clone()), (json!(0), json!(2)));
}

#[test]
fn steal_their_playbook_takes_a_play_back_into_your_hand() {
    let d = draft_all(&game(1));
    let who = d.seating[d.turn].clone();
    let s = edit(&clear(&d), |x| { x["opened"] = json!(true); set_hand(x, &who, &["playbook", "plough"]); });
    assert!(check(&s, &who, "playbook", json!({ "use": "yours" })).is_some(), "nothing played yet");
    let other = d.seating[(d.turn + 1) % d.n()].clone();
    let s = edit(&s, |x| x["roundPlays"] = json!([{ "pid": who, "card": "gate", "use": "sway" }, { "pid": other, "card": "showdown", "use": "action" }]));
    let c = choice(&s, &who, "playbook", json!({}));
    assert_eq!(c["kind"], "use");
    assert!(c["options"].as_array().unwrap().contains(&json!("yours")));
    let back = apply(&s, &who, json!({ "type": "play", "card": "playbook", "use": "action", "target": { "use": "yours", "back": "gate" } }));
    let bv = v(&back);
    assert!(bv["players"][&who]["hand"].as_array().unwrap().contains(&json!("gate")));
    assert!(!bv["roundPlays"].as_array().unwrap().iter().any(|x| x["card"] == "gate"));
}

#[test]
fn a_way_back_brings_a_faction_back_while_it_has_no_location_with_2_or_more() {
    // Enforces D50 (design document, Appendix A).
    let d = draft_all(&game(1));
    let who = d.seating[d.turn].clone();
    let s0 = clear(&d);
    let noct = of_arch(&s0, "nocturnals");
    let home = first_loc("nocturnals");
    let s = edit(&s0, |x| { x["opened"] = json!(true); set_hand(x, &who, &["invite-in", "gate"]); x["players"][&who]["standing"][&noct] = json!(5); });
    let sv = v(&s);
    let (supply, cubes) = (sv["supply"][&noct].as_i64().unwrap(), sv["players"][&who]["supply"].as_i64().unwrap());
    let play = |places: Value| json!({ "type": "play", "card": "invite-in", "use": "return", "places": places });
    assert!(valid(&s, &who, play(json!([home, home]))));
    assert!(!valid(&s, &who, play(json!([home, home, home]))));
    let after = v(&apply(&s, &who, play(json!([home, home]))));
    assert_eq!(
        vec![after["board"][&home]["tokens"][&noct].as_i64().unwrap(), after["supply"][&noct].as_i64().unwrap(), after["players"][&who]["standing"][&noct].as_i64().unwrap(), after["players"][&who]["supply"].as_i64().unwrap()],
        vec![2, supply - 2, 3, cubes + 2]
    );
    let grows = edit(&s, |x| x["board"][&home]["tokens"] = obj(&[(&noct, 2)]));
    assert!(!valid(&grows, &who, play(json!([home, home]))));
    let off = edit(&s, |x| x["options"]["wayBack"] = json!("off"));
    assert!(!valid(&off, &who, play(json!([home, home]))));
}

#[test]
fn night_terrors_marks_then_at_nightfall_1_token_may_flee_each_mark() {
    // Enforces D26 (design document, Appendix A).
    let d = draft_all(&game(1));
    let who = d.seating[d.turn].clone();
    let s0 = clear(&d);
    let noct = of_arch(&s0, "nocturnals");
    let f = factions(&s0).into_iter().find(|x| *x != noct).unwrap();
    let loc = locs().into_iter().find(|l| l.1 != "nocturnals").unwrap().0;
    let b = adjacent(&loc)[1].clone();
    let hand: Vec<String> = std::iter::once("night-terrors".to_string()).chain(v(&d)["players"][&who]["hand"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).filter(|c| c != "night-terrors")).take(2).collect();
    let s = edit(&s0, |x| {
        x["options"]["passing"] = json!("on"); // the round ends by passing here
        x["opened"] = json!(true);
        x["board"][&loc]["tokens"] = obj(&[(&noct, 3)]);
        x["board"][&b]["tokens"] = obj(&[(&f, 2)]);
        x["players"][&who]["hand"] = json!(hand);
    });
    let t = json!({ "mode": "faction", "moves": [{ "location": loc, "faction": noct, "to": "" }] });
    assert_eq!(check(&s, &who, "night-terrors", t.clone()), None);
    let mut g = apply(&s, &who, json!({ "type": "play", "card": "night-terrors", "use": "action", "target": t }));
    assert_eq!(v(&g)["board"][&loc]["terror"], who.as_str());
    for _ in 0..10 {
        if g.phase != Phase::Play {
            break;
        }
        let p = g.seating[g.turn].clone();
        g = apply(&g, &p, json!({ "type": "pass" }));
    }
    assert_eq!(g.phase, Phase::Night);
    assert_eq!(waiting_on(&g), vec![pid(&g, &who)]);
    assert!(!valid(&g, &who, json!({ "type": "flee", "location": loc, "faction": noct, "to": loc })));
    let night = apply(&g, &who, json!({ "type": "flee", "location": loc, "faction": noct, "to": b, "follow": true }));
    assert_ne!(night.phase, Phase::Night);
    assert!(v(&night)["board"][&loc]["tokens"][&noct].as_i64().unwrap_or(0) >= 2);
    let calm = apply(&g, &who, json!({ "type": "flee", "location": loc }));
    assert_ne!(calm.phase, Phase::Night);
}

#[test]
fn study_the_bodies_first_claim_also_takes_1_from_the_second_claims_pile() {
    // Enforces D26 (design document, Appendix A).
    let s0 = clear(&game(1));
    let sci = of_arch(&s0, "scifi");
    let f = factions(&s0).into_iter().find(|x| *x != sci).unwrap();
    let loc = locs().into_iter().find(|l| l.1 != arch_of_faction(&f) && l.1 != "scifi").unwrap().0;
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&sci, 6), (&f, 4)]);
        x["board"][&loc]["sway"] = obj(&[("ann", 2), ("cat", 2)]);
        x["players"]["ann"]["standing"][&sci] = json!(2);
        set_hand(x, "ann", &["study-bodies", "gate"]);
    });
    let t = json!({ "mode": "faction", "moves": [{ "location": loc, "faction": sci, "to": "" }] });
    assert_eq!(check(&s, "ann", "study-bodies", t.clone()), None);
    let p = preview(&s, "ann", "study-bodies", t);
    let after = edit(&s, |x| { x["board"] = p["board"].clone(); x["players"] = p["players"].clone(); });
    assert_eq!(v(&after)["board"][&loc]["study"], "ann");
    let fought = fight(&after, &loc);
    assert_eq!((fought["players"]["ann"]["trophies"][&f].clone(), fought["players"]["ann"]["trophies"][&sci].clone(), fought["players"]["cat"]["trophies"][&sci].clone()), (json!(4), json!(1), json!(1)));
    let bob = edit(&after, |x| x["board"][&loc]["sway"]["bob"] = json!(5));
    let lost = fight(&bob, &loc);
    assert_eq!((lost["players"]["bob"]["trophies"][&f].clone(), lost["players"]["ann"]["trophies"][&sci].clone()), (json!(4), json!(2)));
    let home = locs().into_iter().find(|l| l.0 == loc).unwrap().1;
    let av = v(&after);
    let pq: Vec<&str> = ["bob", "cat", "dan", "eve"].into_iter().filter(|x| {
        let g = av["players"][*x]["group"].as_str().unwrap();
        spec().archetypes[spec().slayer_groups.iter().find(|s| s.id == g).unwrap().archetype].id != home
    }).collect();
    let (p1, q1) = (pq[0], pq[1]);
    let tie = edit(&after, |x| x["board"][&loc]["sway"] = obj(&[("ann", 3), (p1, 2), (q1, 2)]));
    let tied = fight(&tie, &loc);
    assert_eq!((tied["players"]["ann"]["trophies"][&f].clone(), tied["players"]["ann"]["trophies"][&sci].clone(), tied["players"][p1]["trophies"][&sci].clone()), (json!(4), json!(0), json!(0)));
}

#[test]
fn wake_the_dead_the_dead_rise_as_a_third_side() {
    // Enforces D26 (design document, Appendix A).
    let s0 = clear(&game(1));
    let dead = of_arch(&s0, "undead");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != dead).collect();
    let (f, g) = (others[0].clone(), others[1].clone());
    let loc = first_loc("undead");
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&f, 6), (&g, 3)]);
        x["board"][&loc]["sway"] = obj(&[("bob", 2)]);
        x["players"]["ann"]["standing"][&dead] = json!(3);
        set_hand(x, "ann", &["wake-the-dead", "gate", "plough", "ritual"]);
    });
    let t = json!({ "mode": "location", "location": loc, "from": [loc, loc, loc], "payer": dead });
    assert_eq!(check(&s, "ann", "wake-the-dead", t.clone()), None);
    let s = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(3));
    let mut tf = t.clone();
    tf["payer"] = json!(f);
    assert_eq!(check(&s, "ann", "wake-the-dead", tf), None);
    let elsewhere = factions(&s).into_iter().find(|x| *x != dead && *x != f && *x != g).unwrap();
    let mut te = t.clone();
    te["payer"] = json!(elsewhere);
    assert!(check(&s, "ann", "wake-the-dead", te).is_some());
    let s = edit(&s, |x| x["players"]["ann"]["standing"][&f] = json!(0));
    let mut t4 = t.clone();
    t4["from"] = json!([loc, loc, loc, loc]);
    assert!(check(&s, "ann", "wake-the-dead", t4).is_some());
    let late = edit(&s, |x| set_hand(x, "ann", &["wake-the-dead", "gate"]));
    assert!(check(&late, "ann", "wake-the-dead", t.clone()).is_some());
    let mut t2 = t.clone();
    t2["from"] = json!([loc, loc]);
    assert_eq!(check(&late, "ann", "wake-the-dead", t2), None);
    let p = preview(&s, "ann", "wake-the-dead", t.clone());
    let after = edit(&s, |x| { x["board"] = p["board"].clone(); x["players"] = p["players"].clone(); });
    let av = v(&after);
    assert_eq!(av["board"][&loc]["tokens"], obj(&[(&f, 6), (&g, 3), (&dead, 3)]));
    assert_eq!(av["board"][&loc]["sway"]["ann"], 3);
    assert_eq!(av["players"]["ann"]["standing"][&dead], 0);
    assert!(fights_due(&after).contains(&spec().loc_ix(&loc).unwrap()));
    let fought = fight(&after, &loc);
    assert_eq!(fought["board"][&loc]["tokens"], obj(&[(&f, 4)]));
    assert_eq!(fought["players"]["ann"]["trophies"].as_object().unwrap().values().map(|x| x.as_i64().unwrap()).sum::<i64>(), 6);
    assert_eq!(fought["players"]["bob"]["trophies"][&f], 2);
    let open = locs().into_iter().find(|l| l.1 != arch_of_faction(&f) && l.1 != arch_of_faction(&g) && l.1 != "undead").unwrap().0;
    let tie = edit(&clear(&game(1)), |x| x["board"][&open]["tokens"] = obj(&[(&f, 4), (&g, 4), (&dead, 2)]));
    let burnt = fight(&tie, &open);
    assert_eq!((burnt["board"][&open]["scorched"].clone(), burnt["board"][&open]["tokens"].clone()), (json!(true), json!({})));
    let empty = edit(&s, |x| x["board"][&loc]["tokens"] = json!({}));
    assert_eq!(check(&empty, "ann", "wake-the-dead", t.clone()), None);
    let lone = edit(&s, |x| x["board"][&loc]["tokens"] = obj(&[(&f, 6)]));
    assert_eq!(check(&lone, "ann", "wake-the-dead", t.clone()), None);
    let away = edit(&s, |x| x["board"][&open]["tokens"] = obj(&[(&f, 6), (&g, 3)]));
    let mut ta = t;
    ta["location"] = json!(open);
    ta["from"] = json!([open]);
    assert!(check(&away, "ann", "wake-the-dead", ta).is_some());
    let undead_there = edit(&s, |x| x["board"][&open]["tokens"] = obj(&[(&f, 6), (&dead, 2)]));
    let joined = json!({ "mode": "faction", "location": open, "from": [open, open] });
    assert_eq!(check(&undead_there, "ann", "wake-the-dead", joined.clone()), None);
    assert_eq!(preview(&undead_there, "ann", "wake-the-dead", joined.clone())["board"][&open]["tokens"][&dead], 4);
    let mut tj = joined;
    tj["location"] = json!(loc);
    tj["from"] = json!([loc]);
    assert!(check(&undead_there, "ann", "wake-the-dead", tj).is_some());
}

#[test]
fn plough_through_every_side_leaves_by_half_rounded_up_through_its_own_exits() {
    let s0 = clear(&game(1));
    let noct = of_arch(&s0, "nocturnals");
    let others: Vec<String> = factions(&s0).into_iter().filter(|x| *x != noct).collect();
    let (g, h) = (others[0].clone(), others[1].clone());
    let loc = locs().into_iter().find(|l| l.1 == "nocturnals" && adjacent(&l.0).len() >= 3).unwrap().0;
    let adj = adjacent(&loc);
    let (a, b, c) = (adj[0].clone(), adj[1].clone(), adj[2].clone());
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&noct, 5), (&g, 1)]);
        x["players"]["ann"]["standing"][&noct] = json!(0);
        x["players"]["ann"]["standing"][&g] = json!(4);
    });
    let fs = factions(&s);
    let first = fs.iter().find(|f| **f == noct || **f == g).unwrap().clone();
    let exits = if first == noct { json!([a, a, b, c]) } else { json!([c, a, a, b]) };
    let t = json!({ "mode": "faction", "location": loc, "from": exits, "payers": [g, g, g, g] });
    assert_eq!(check(&s, "ann", "plough", t.clone()), None);
    let after = preview(&s, "ann", "plough", t.clone());
    assert_eq!(
        (after["board"][&loc]["tokens"][&noct].clone(), after["board"][&loc]["tokens"].get(&g).cloned().unwrap_or(json!(0)), after["board"][&a]["tokens"][&noct].clone(), after["board"][&b]["tokens"][&noct].clone(), after["board"][&c]["tokens"][&g].clone()),
        (json!(2), json!(0), json!(2), json!(1), json!(1))
    );
    for l in [&loc, &a, &b, &c] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    assert_eq!(after["players"]["ann"]["standing"][&g], 0);
    assert!(check(&edit(&s, |x| x["players"]["ann"]["standing"][&g] = json!(3)), "ann", "plough", t.clone()).is_some());
    let split = edit(&s, |x| { x["players"]["ann"]["standing"][&noct] = json!(2); x["players"]["ann"]["standing"][&g] = json!(2); });
    let mut tp = t.clone();
    tp["payers"] = json!([noct, g, noct, g]);
    assert_eq!(check(&split, "ann", "plough", tp.clone()), None);
    tp["payers"] = json!([h, g, noct, g]);
    assert!(check(&split, "ann", "plough", tp).is_some());
    let s4 = edit(&split, |x| x["players"]["ann"]["standing"][&g] = json!(4));
    let clash = if first == noct { json!([a, a, b, a]) } else { json!([a, a, a, b]) };
    let mut tc = t.clone();
    tc["from"] = clash;
    assert!(check(&s4, "ann", "plough", tc).is_some());
    let mut ts = t.clone();
    ts["from"] = json!(t["from"].as_array().unwrap()[1..].to_vec());
    assert!(check(&s4, "ann", "plough", ts).is_some());
    let gh = edit(&s4, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&g, 2), (&h, 2)]);
        x["players"]["ann"]["standing"][&g] = json!(0);
        x["players"]["ann"]["standing"][&h] = json!(0);
        x["players"]["ann"]["standing"][&noct] = json!(3);
    });
    let first2 = fs.iter().find(|f| **f == g || **f == h).unwrap().clone();
    let ex2 = if first2 == g { json!([a, b]) } else { json!([b, a]) };
    assert_eq!(check(&gh, "ann", "plough", json!({ "mode": "location", "location": loc, "from": ex2, "payers": [noct, noct, noct] })), None);
    let nofight = edit(&gh, |x| x["board"][&loc]["tokens"] = obj(&[(&noct, 5)]));
    assert!(check(&nofight, "ann", "plough", t).is_some());
}

#[test]
fn cut_the_powerlines_a_group_rejoins_its_kin_1_at_a_time() {
    let s0 = clear(&game(1));
    let sent = of_arch(&s0, "sentients");
    let g = factions(&s0).into_iter().find(|x| *x != sent).unwrap();
    let ls: Vec<String> = locs().into_iter().map(|l| l.0).collect();
    let (loc, a, b, c) = (ls[0].clone(), ls[1].clone(), ls[2].clone(), ls[3].clone());
    let s = edit(&s0, |x| {
        x["board"][&loc]["tokens"] = obj(&[(&sent, 5)]);
        x["board"][&a]["tokens"] = obj(&[(&sent, 1)]);
        x["board"][&b]["tokens"] = obj(&[(&sent, 2), (&g, 2)]);
        x["board"][&c]["tokens"] = obj(&[(&sent, 1)]);
        x["players"]["ann"]["standing"][&sent] = json!(4);
    });
    let t = json!({ "mode": "faction", "location": loc, "faction": sent, "from": [a, c] });
    assert_eq!(check(&s, "ann", "cut-powerlines", t.clone()), None);
    let after = preview(&s, "ann", "cut-powerlines", t.clone());
    let at = |p: &Value, l: &str| p["board"][l]["tokens"].get(&sent).cloned().unwrap_or(json!(0));
    assert_eq!(vec![at(&after, &loc), at(&after, &a), at(&after, &b), at(&after, &c)], vec![json!(0), json!(3), json!(3), json!(3)]);
    for l in [&loc, &a, &b, &c] {
        assert_eq!(after["board"][l]["sway"]["ann"], 1);
    }
    let mut t1 = t.clone();
    t1["from"] = json!([a]);
    assert!(check(&s, "ann", "cut-powerlines", t1).is_some());
    let mut t2 = t.clone();
    t2["from"] = json!([a, a]);
    assert!(check(&s, "ann", "cut-powerlines", t2).is_some());
    assert!(check(&edit(&s, |x| x["players"]["ann"]["standing"][&sent] = json!(3)), "ann", "cut-powerlines", t.clone()).is_some());
    let fought = edit(&s, |x| x["board"][&loc]["tokens"] = obj(&[(&sent, 5), (&g, 1)]));
    let mut tf = t.clone();
    tf["from"] = json!([b, c]);
    assert_eq!(check(&fought, "ann", "cut-powerlines", tf.clone()), None);
    let half = preview(&fought, "ann", "cut-powerlines", tf);
    assert_eq!(vec![at(&half, &loc), at(&half, &a), at(&half, &b), at(&half, &c)], vec![json!(3), json!(1), json!(3), json!(2)]);
    let alone = edit(&fought, |x| for l in [&a, &b, &c] { x["board"][l]["tokens"] = json!({}); });
    let mut t0 = t;
    t0["from"] = json!([]);
    assert!(check(&alone, "ann", "cut-powerlines", t0).is_some());
}

#[test]
fn preview_runs_a_move_with_the_game_options_sway_at_the_destination() {
    let s0 = clear(&game(1));
    let f = of_arch(&s0, "demonic");
    let loc = first_loc("demonic");
    let adj = adjacent(&loc);
    let s = edit(&s0, |x| { x["board"][&loc]["tokens"][&f] = json!(3); x["players"]["ann"]["standing"][&f] = json!(2); });
    let after = preview(&s, "ann", "light-cross", json!({ "mode": "faction", "location": loc, "faction": f, "split": obj(&[(&adj[0], 2), (&adj[1], 1)]) }));
    assert_eq!(after["board"][&adj[0]]["sway"]["ann"], 1);
}

#[test]
fn a_game_saved_before_an_option_existed_plays_on_with_its_default() {
    let s = edit(&game(7), |x| { x["options"].as_object_mut().unwrap().remove("swayPerMove"); });
    let end = play_out(&s, 7);
    assert_eq!(end.phase, Phase::Ended);
}

#[test]
fn ic1_a_card_is_played_only_if_its_sway_can_be_paid() {
    // Enforces D15, D21, D23 (design document, Appendix A).
    let s0 = clear(&game(1));
    let from = locs().into_iter().find(|l| adjacent(&l.0).len() >= 3).unwrap().0;
    let dem = of_arch(&s0, "demonic");
    let adj = adjacent(&from);
    let (p, q) = (adj[0].clone(), adj[1].clone());
    let s = edit(&s0, |x| { x["board"][&from]["tokens"] = obj(&[(&dem, 5)]); x["players"]["ann"]["standing"][&dem] = json!(1); });
    assert!(check(&s, "ann", "light-cross", json!({ "mode": "faction", "location": from, "faction": dem, "split": obj(&[(&p, 2), (&q, 3)]) })).unwrap().contains("both"));
    let sen = of_arch(&s0, "sentients");
    let s = edit(&s, |x| {
        x["board"][&from]["tokens"] = obj(&[(&sen, 5)]);
        x["board"][&q]["tokens"] = obj(&[(&sen, 1)]);
        x["players"]["ann"]["standing"][&sen] = json!(0);
    });
    let cut = json!({ "mode": "faction", "location": from, "faction": sen, "from": [] });
    assert!(check(&s, "ann", "cut-powerlines", cut).is_some());
}

#[test]
fn with_passing_off_every_card_is_played_and_the_last_ends_the_round() {
    // Enforces D29 (design document, Appendix A).
    let mut g = game(1);
    while g.phase == Phase::Draft {
        let p = waiting_on(&g)[0];
        let me = &g.players[p as usize];
        let keep: Vec<Value> = me.kept.iter().chain(me.batch.iter()).take(me.kept.len() + 1).map(|&c| json!(motw::spec::spec().cards[c as usize].id)).collect();
        g = apply_move(&g, p, &mv(&g, json!({ "type": "pick", "keep": keep }))).unwrap();
    }
    assert_eq!(g.phase, Phase::Play);
    let round = g.round;
    let mut plays = 0;
    while g.phase == Phase::Play && g.round == round {
        let p = g.seating[g.turn].clone();
        assert!(!valid(&g, &p, json!({ "type": "pass" })), "no passing while passing is off");
        assert!(!g.players[g.turn].hand.is_empty(), "an empty hand is skipped");
        // Any legal play: the first card in hand, for sway when it has a suit, else for whatever it can do.
        let m = motw::bots::bot_move(&g, pid(&g, &p), &mut || 0.5, "bot:lean=-0.3,sim=0,enum=0,combo=0", None, &Default::default()).unwrap();
        g = apply_move(&g, pid(&g, &p), &m).unwrap();
        plays += 1;
    }
    assert!(g.players.iter().all(|p| p.hand.is_empty()), "the round's play ends when every card is played");
    assert!(plays >= 5 * 4, "five seats, four cards each (more if Steal Their Playbook took one back)");
}

#[test]
fn steal_their_playbook_takes_any_card_played_this_round_and_cant_be_the_last_card() {
    let d = draft_all(&game(1));
    let who = d.seating[d.turn].clone();
    let other = d.seating[(d.turn + 1) % d.n()].clone();
    let s = edit(&clear(&d), |x| {
        x["opened"] = json!(true);
        set_hand(x, &who, &["playbook", "plough"]);
        x["roundPlays"] = json!([
            { "pid": who, "card": "gate", "use": "sway" },
            { "pid": other, "card": "showdown", "use": "action" },
            { "pid": other, "card": "invite-in", "use": "sway" }
        ]);
    });
    // D39: any card played earlier this round, yours or another player's, however played, into your hand to play later.
    let c = choice(&s, &who, "playbook", json!({ "use": "yours" }));
    assert_eq!(c["kind"], "use");
    let opts: Vec<String> = c["options"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
    assert_eq!(opts, vec!["gate".to_string(), "showdown".to_string(), "invite-in".to_string()]);
    assert!(check(&s, &who, "playbook", json!({ "use": "theirs", "back": "invite-in" })).is_some(), "theirs is no longer a use");
    let took = apply(&s, &who, json!({ "type": "play", "card": "playbook", "use": "action", "target": { "use": "yours", "back": "invite-in" } }));
    let tv = v(&took);
    assert!(tv["players"][&who]["hand"].as_array().unwrap().contains(&json!("invite-in")));
    assert_eq!(tv["copying"], Value::Null, "not played now");
    assert_ne!(took.seating[took.turn], who, "the turn moves on");
    assert!(!tv["roundPlays"].as_array().unwrap().iter().any(|x| x["card"] == "invite-in"), "taken from the played cards");
    // As the last card in hand it can't be played, only discarded for no effect.
    let last = edit(&s, |x| set_hand(x, &who, &["playbook"]));
    assert!(check(&last, &who, "playbook", json!({ "use": "yours", "back": "gate" })).is_some());
    let gone = apply(&last, &who, json!({ "type": "play", "card": "playbook", "use": "action", "target": null }));
    assert!(v(&gone)["players"][&who]["hand"].as_array().unwrap().is_empty());
}

#[test]
fn d38_at_nightfall_each_location_without_a_fight_gains_its_own_faction_per_sway_there() {
    // Enforces D38 (design document, Appendix A).
    let d = draft_all(&game(1));
    let s0 = clear(&d);
    // A quiet location with 2 sway (two players) and a fight with sway: only the quiet one gains, 1 per sway.
    let (quiet, arch) = locs().into_iter().next().unwrap();
    let own = of_arch(&s0, &arch);
    let busy = locs().into_iter().find(|l| l.0 != quiet && !adjacent(&quiet).contains(&l.0)).unwrap().0;
    let fs: Vec<String> = factions(&s0).into_iter().filter(|x| *x != own).collect();
    let (ann, bob) = (s0.seating[0].clone(), s0.seating[1].clone());
    let s = edit(&s0, |x| {
        x["options"]["nightfall"] = json!("on");
        x["options"]["passing"] = json!("on"); // the round ends by passing here
        x["opened"] = json!(true);
        x["board"][&quiet]["sway"] = obj(&[(&ann, 1), (&bob, 1)]);
        x["board"][&busy]["tokens"] = obj(&[(&fs[0], 3), (&fs[1], 2)]);
        x["board"][&busy]["sway"] = obj(&[(&ann, 2)]);
    });
    let before = presence(&s, &own);
    let mut g = s.clone();
    for _ in 0..20 {
        if g.phase != Phase::Play || g.round != s.round {
            break;
        }
        let p = g.seating[g.turn].clone();
        g = apply(&g, &p, json!({ "type": "pass" }));
    }
    let gv = v(&g);
    assert_eq!(gv["board"][&quiet]["tokens"][&own], 2);
    assert_eq!(presence(&g, &own), before + 2);
}

#[test]
fn rounds_as_votes_each_close_is_a_vote_and_early_ends_on_a_majority() {
    // Enforces D51 (design document, Appendix A).
    for (mode, early) in [("on", false), ("early", true)] {
        let s0 = game_opts(3, &[("roundVotes", mode), ("thresholdPerPlayer", "off"), ("threshold", "30")]);
        let g = play_out(&s0, 7);
        let gv = v(&g);
        let (inv, isl) = (gv["votes"]["invaders"].as_i64().unwrap(), gv["votes"]["island"].as_i64().unwrap());
        assert_eq!(g.phase, Phase::Ended);
        if early {
            assert_eq!(inv.max(isl), 3, "ends as soon as a side has three");
        } else {
            assert_eq!(inv + isl, 5, "one vote a round");
        }
        let r = gv["result"].clone();
        assert_eq!(r["side"] == "island", isl > inv);
    }
}

// Decisions, pinned ------------------------------------------------------------

#[test]
fn d12_every_suit_prints_the_same_total_sway() {
    // D12: printed sway is split card by card, but every suit's cards print the same total.
    let sp = spec();
    let totals: Vec<i32> = (0..sp.archetypes.len()).map(|a| sp.cards.iter().filter(|c| c.suit == Some(a)).map(|c| c.sway).sum()).collect();
    assert!(totals.iter().all(|t| *t == totals[0] && *t > 0), "suit totals {totals:?}");
}

#[test]
fn in_whole_games_every_turn_plays_a_card_and_never_moves_another_players_sway() {
    // D19: factions move only by cards, so a turn in the play phase is a card played (D29: no passing).
    // D13: no card or rule moves another player's sway: a turn leaves every other seat's standing, supply and board
    // sway as they were (fights, at the round's close, are not a turn).
    for n in [3usize, 4, 5] {
        let mut s = draft_all(&game_n(n as i64 * 11, &PLAYERS[..n]).unwrap());
        let mut x = n as u64;
        let mut rng = move || {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (x >> 11) as f64 / (1u64 << 53) as f64
        };
        let mut memory = vec![BotMemory::default(); s.n()];
        let mut turns = 0;
        for _ in 0..5000 {
            if s.phase == Phase::Ended {
                break;
            }
            let p = waiting_on(&s)[0];
            let m = bot_move(&s, p, &mut rng, &fast("bot:lean=-0.3"), Some(&mut memory[p as usize]), &Seats::default()).unwrap();
            let next = apply_move(&s, p, &m).unwrap();
            if s.phase == Phase::Play {
                assert!(matches!(m, Move::Play { .. }), "a play-phase turn that isn't a card: {m:?}");
                if next.phase == Phase::Play && next.round == s.round {
                    turns += 1;
                    let (a, b) = (v(&s), v(&next));
                    let me = s.seating[p as usize].clone();
                    for who in s.seating.iter().filter(|w| **w != me) {
                        assert_eq!(a["players"][who]["standing"], b["players"][who]["standing"], "{me}'s turn moved {who}'s standing");
                        assert_eq!(a["players"][who]["supply"], b["players"][who]["supply"], "{me}'s turn moved {who}'s supply");
                        for (loc, place) in a["board"].as_object().unwrap() {
                            assert_eq!(place["sway"].get(who), b["board"][loc]["sway"].get(who), "{me}'s turn moved {who}'s sway at {loc}");
                        }
                    }
                }
            }
            s = next;
        }
        assert_eq!(s.phase, Phase::Ended);
        assert!(turns > 20);
    }
}

#[test]
fn d41_d42_the_last_round_ends_after_its_fights_and_more_than_20_is_the_invaders() {
    // Enforces D51 (design document, Appendix A).
    // D41: the last round has no nightfall: the game ends after its fights. D42: the invaders win on more than 20
    // tokens, at every player count.
    for (n, count, invaders) in [(3usize, 20, false), (3, 21, true), (5, 20, false), (5, 21, true)] {
        let s0 = clear(&draft_all(&game_n(5, &PLAYERS[..n]).unwrap()));
        let (quiet, arch) = locs().into_iter().next().unwrap();
        let own = of_arch(&s0, &arch);
        let ann = s0.seating[0].clone();
        let last = v(&s0)["options"]["rounds"].as_str().unwrap().parse::<i64>().unwrap();
        let s = edit(&s0, |x| {
            x["options"]["nightfall"] = json!("on");
            x["options"]["passing"] = json!("on"); // the round ends by passing here
            x["opened"] = json!(true);
            x["round"] = json!(last);
            x["board"][&quiet]["tokens"] = obj(&[(&own, count)]);
            x["board"][&quiet]["sway"] = obj(&[(&ann, 2)]);
        });
        let mut g = s.clone();
        for _ in 0..20 {
            if g.phase != Phase::Play {
                break;
            }
            let p = g.seating[g.turn].clone();
            g = apply(&g, &p, json!({ "type": "pass" }));
        }
        assert_eq!(g.phase, Phase::Ended);
        let gv = v(&g);
        assert_eq!(gv["board"][&quiet]["tokens"][&own], count, "no nightfall in the last round");
        assert_eq!(gv["result"]["side"] == "invaders", invaders, "{count} tokens at {n} players");
    }
}

#[test]
fn d45_an_unsuited_card_gives_2_sway_with_any_faction_and_a_suited_card_its_printed_sway() {
    // D45: an unsuited card may be spent for 2 standing with any one faction, chosen as it's played; a suited card's
    // sway stays as printed, with its own faction.
    let s0 = clear(&draft_all(&game(1)));
    let who = s0.seating[s0.turn].clone();
    let fs = factions(&s0);
    let far = fs.iter().find(|f| **f != of_arch(&s0, "nocturnals")).unwrap().clone();
    let s = edit(&s0, |x| { set_hand(x, &who, &["favours", "invite-in"]); x["players"][&who]["supply"] = json!(10); });
    let before = v(&s)["players"][&who]["standing"][&far].as_i64().unwrap();
    let a = apply(&s, &who, json!({ "type": "play", "card": "favours", "use": "sway", "target": { "faction": far } }));
    assert_eq!(v(&a)["players"][&who]["standing"][&far].as_i64().unwrap(), before + 2);
    assert_eq!(v(&a)["players"][&who]["supply"], 8);
    let noc = of_arch(&s0, "nocturnals");
    let before = v(&s)["players"][&who]["standing"][&noc].as_i64().unwrap();
    let b = apply(&s, &who, json!({ "type": "play", "card": "invite-in", "use": "sway" }));
    assert_eq!(v(&b)["players"][&who]["standing"][&noc].as_i64().unwrap(), before + printed_of(card("invite-in")) as i64);
}
