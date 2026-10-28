//! Monster of the Week: the rules engine (a port of public/engine.js) and, to come, the bots (public/bots.js).
//! The JavaScript engine is the reference while the port is checked game by game against it (scripts/fingerprint.mjs).

pub mod board;
pub mod cards;
pub mod choice;
pub mod game;
pub mod json;
pub mod setup;
pub mod spec;
pub mod types;
pub mod view;
