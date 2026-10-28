//! The bots (a port of test/bots.test.js).

use motw::bots::{bot_move, fast, Seats};
use motw::game::{apply_move, validate};
use motw::setup::{create_game, next_random};
use motw::types::*;

const PLAYERS: [&str; 5] = ["ann", "bob", "cat", "dan", "eve"];

#[test]
fn bots_only_ever_propose_legal_moves_and_play_games_to_the_end() {
    let names: Vec<String> = PLAYERS.iter().map(|s| s.to_string()).collect();
    for g in 0..10 {
        let mut st = 100 + g;
        let mut random = move || { let (v, n) = next_random(st); st = n; v };
        let mut s = create_game(100 + g as i64, &names, &[]).unwrap();
        let profile = fast("trophy");
        let mut moves = 0;
        while s.phase != Phase::Ended && moves < 20000 {
            moves += 1;
            let mut moved = false;
            for p in 0..s.n() as Pid {
                let Some(m) = bot_move(&s, p, &mut random, &profile, None, &Seats::default()) else { continue };
                assert_eq!(validate(&s, p, &m), None, "{m:?}");
                s = apply_move(&s, p, &m).unwrap();
                moved = true;
                break;
            }
            assert!(moved, "stuck in {:?}", s.phase);
        }
        assert_eq!(s.phase, Phase::Ended);
    }
}

#[test]
fn a_seat_that_is_not_at_the_table_gets_no_move() {
    let names: Vec<String> = PLAYERS.iter().map(|s| s.to_string()).collect();
    let s = create_game(1, &names, &[]).unwrap();
    let mut r = || 0.5;
    assert!(bot_move(&s, 9, &mut r, "trophy", None, &Seats::default()).is_none());
}
