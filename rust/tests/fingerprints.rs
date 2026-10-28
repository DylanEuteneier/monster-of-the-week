//! Play is unchanged: bot games on fixed seeds hash the same, state by state, as the recorded fingerprints
//! (tests/fixtures/fingerprints.json, recorded by the JavaScript engine before it was retired). One test per set, so
//! they run side by side.

use motw::fingerprint::{digest, play};
use serde_json::Value;

fn check(name: &str) {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/fingerprints.json")).unwrap();
    let set = fixtures["sets"].as_array().unwrap().iter().find(|s| s["name"] == name).expect("a set");
    let profiles: Vec<String> = set["profiles"].as_str().unwrap().split(';').map(|s| s.to_string()).collect();
    let options: Vec<(String, String)> = set["options"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
    let seed = set["seed"].as_i64().unwrap();
    let bad: Vec<String> = set["digests"].as_array().unwrap().iter().enumerate().filter_map(|(g, want)| {
        let game = play(seed + g as i64, &profiles, &options);
        (digest(game.iter().map(|x| x.1.as_str())) != want.as_str().unwrap()).then(|| format!("game {g} (seed {})", seed + g as i64))
    }).collect();
    assert!(bad.is_empty(), "set {name}: play changed in {}", bad.join(", "));
}

#[test]
fn five_seats_fast_bots() {
    check("a");
}
#[test]
fn three_seats() {
    check("b");
}
#[test]
fn four_seats_with_variants() {
    check("c");
}
#[test]
fn variants() {
    check("d");
}
#[test]
fn starting_sway_and_seat_groups() {
    check("e");
}
#[test]
fn play_out_search() {
    check("s0");
}
#[test]
fn planning_backers() {
    check("p0");
}
