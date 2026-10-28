//! Monster of the Week: the rules engine and the bots, the only place the rules live. Native for the scripts' tools
//! (`motw`) and the tests; WebAssembly for the Worker and the table (`npm run wasm`, public/rules.js, src/wasm.rs).
//! Ported from the JavaScript engine (retired 2026-10-28) and checked game by game against it; the recorded games
//! (tests/fixtures/fingerprints.json) keep play from changing unless a decision means it to.

pub mod board;
pub mod bots;
pub mod cards;
pub mod fingerprint;
pub mod choice;
pub mod game;
pub mod json;
pub mod setup;
pub mod small;
pub mod spec;
pub mod types;
pub mod view;
pub mod wasm;
