//! The game state, moves and targets. Ids are small indexes: a location is its place in spec.locations (0..15), a
//! faction in play is its archetype's slot (0..5: the state's `factions` list), a player is their seat, a card is its
//! place in spec.cards. Maps whose order the rules read (a location's tokens and sway) keep the JavaScript engine's
//! insertion order, so every rule that walks them sees the same order (OMap).

use crate::spec::{spec, Use};
use std::rc::Rc;

pub type Loc = u8;
pub type Fac = u8;
pub type Pid = u8;
pub type CardIx = u8;

/// A small map that keeps insertion order, as a JavaScript object with string keys does: setting a present key keeps
/// its place, a new key goes last, and removing a key forgets its place.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OMap(pub Vec<(u8, i32)>);

impl OMap {
    pub fn new() -> OMap {
        OMap(Vec::new())
    }
    /// The value, or None when the key is absent (`x[k]` is undefined).
    #[inline]
    pub fn opt(&self, k: u8) -> Option<i32> {
        for &(kk, v) in &self.0 {
            if kk == k {
                return Some(v);
            }
        }
        None
    }
    /// `x[k] ?? 0`.
    #[inline]
    pub fn get(&self, k: u8) -> i32 {
        self.opt(k).unwrap_or(0)
    }
    #[inline]
    pub fn has(&self, k: u8) -> bool {
        self.0.iter().any(|&(kk, _)| kk == k)
    }
    /// `x[k] = v`.
    #[inline]
    pub fn set(&mut self, k: u8, v: i32) {
        for e in self.0.iter_mut() {
            if e.0 == k {
                e.1 = v;
                return;
            }
        }
        self.0.push((k, v));
    }
    /// `x[k] = (x[k] ?? 0) + d`.
    #[inline]
    pub fn add(&mut self, k: u8, d: i32) {
        for e in self.0.iter_mut() {
            if e.0 == k {
                e.1 += d;
                return;
            }
        }
        self.0.push((k, d));
    }
    /// `delete x[k]`.
    #[inline]
    pub fn remove(&mut self, k: u8) {
        if let Some(i) = self.0.iter().position(|&(kk, _)| kk == k) {
            self.0.remove(i);
        }
    }
    pub fn iter(&self) -> impl Iterator<Item = (u8, i32)> + '_ {
        self.0.iter().copied()
    }
    pub fn keys(&self) -> impl Iterator<Item = u8> + '_ {
        self.0.iter().map(|e| e.0)
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Draft,
    Play,
    Night,
    Growth,
    Ended,
}

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Phase::Draft => "draft",
            Phase::Play => "play",
            Phase::Night => "night",
            Phase::Growth => "growth",
            Phase::Ended => "ended",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seeding {
    Two,
    Even,
    Home,
}

/// The variants chosen for a game (spec.json `variants`), resolved, with their raw choices in the spec's order.
#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    pub raw: Vec<(String, String)>,
    pub rounds: i32,
    pub threshold: i32,
    pub growth: i32,
    pub faction_tokens: i32,
    pub player_cubes: i32,
    pub start_sway: i32,
    pub start_others: i32,
    pub start_board: i32,
    pub groups_random: bool,
    pub sway_per_move: i32,
    pub sway_required: bool,
    pub winner_loss_down: bool,
    pub fight_half: bool,
    pub aligned_growth: bool,
    pub way_back: bool,
    pub seeding: Seeding,
    pub pay_in_full: bool,
}

impl Options {
    /// Resolves raw choices (unknown variants or choices are an error, as resolveOptions); absent ones take the default.
    pub fn resolve(raw: &[(String, String)]) -> Result<Options, String> {
        let sp = spec();
        for (id, choice) in raw {
            let v = sp.variants.iter().find(|v| &v.id == id).ok_or_else(|| format!("unknown option {id}"))?;
            if !v.choices.iter().any(|c| c == choice) {
                return Err(format!("unknown choice {choice} for {id}"));
            }
        }
        let all: Vec<(String, String)> = sp.variants.iter().map(|v| (v.id.clone(), raw.iter().find(|(k, _)| k == &v.id).map(|(_, c)| c.clone()).unwrap_or_else(|| v.default.clone()))).collect();
        Ok(Options::from_raw(all))
    }
    /// Options from a saved game's choices (anything unknown is ignored; anything missing takes the default).
    pub fn from_raw(given: Vec<(String, String)>) -> Options {
        let sp = spec();
        let raw: Vec<(String, String)> = sp.variants.iter().map(|v| (v.id.clone(), given.iter().find(|(k, _)| k == &v.id).map(|(_, c)| c.clone()).unwrap_or_else(|| v.default.clone()))).collect();
        let get = |id: &str| raw.iter().find(|(k, _)| k == id).map(|(_, c)| c.as_str()).unwrap_or("");
        let num = |id: &str| get(id).parse::<i32>().unwrap_or(0);
        Options {
            rounds: num("rounds"),
            threshold: num("threshold"),
            growth: num("growth"),
            faction_tokens: num("factionTokens"),
            player_cubes: num("playerCubes"),
            start_sway: num("startSway"),
            start_others: num("startOthers"),
            start_board: num("startBoard"),
            groups_random: get("groups") == "random",
            sway_per_move: num("swayPerMove"),
            sway_required: get("swayRequired") != "off",
            winner_loss_down: get("winnerLoss") == "down",
            fight_half: get("fightHalf") != "off",
            aligned_growth: get("alignedGrowth") == "on",
            way_back: get("wayBack") != "off",
            seeding: match get("seeding") {
                "even" => Seeding::Even,
                "home" => Seeding::Home,
                _ => Seeding::Two,
            },
            pay_in_full: get("payInFull") != "off",
            raw,
        }
    }
    /// A copy with swayRequired set.
    pub fn with_sway_required(&self, on: bool) -> Options {
        let mut o = self.clone();
        o.sway_required = on;
        for e in o.raw.iter_mut() {
            if e.0 == "swayRequired" {
                e.1 = (if on { "on" } else { "off" }).to_string();
            }
        }
        o
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Place {
    /// faction slot → tokens
    pub tokens: OMap,
    /// seat → sway
    pub sway: OMap,
    pub scorched: bool,
    pub gate: Option<Loc>,
    pub gate_loss: Option<Loc>,
    pub altar: bool,
    pub study: Option<Pid>,
    pub terror: Option<Pid>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Player {
    pub group: u8,
    pub supply: i32,
    /// by faction slot
    pub standing: [i32; 5],
    pub trophies: [i32; 5],
    pub hand: Vec<CardIx>,
    pub kept: Vec<CardIx>,
    pub batch: Vec<CardIx>,
    pub picked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Growing {
    pub faction: Fac,
    pub left: i32,
    pub leaders: Vec<Pid>,
    pub next: i32,
    /// location → tokens due
    pub due: OMap,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Night {
    pub player: Pid,
    pub left: Vec<Loc>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayUse {
    Action,
    Sway,
    Return,
}

impl PlayUse {
    pub fn name(self) -> &'static str {
        match self {
            PlayUse::Action => "action",
            PlayUse::Sway => "sway",
            PlayUse::Return => "return",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoundPlay {
    pub pid: Pid,
    pub card: CardIx,
    pub use_: PlayUse,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RoundLog {
    pub round: i32,
    pub events: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameResult {
    pub island: bool,
    pub factions: Vec<Fac>,
    pub players: Vec<Pid>,
    /// by seat
    pub scores: Vec<i32>,
    pub placings: Vec<Pid>,
}

#[derive(Clone, Debug)]
pub struct GameState {
    pub version: Rc<str>,
    pub options: Rc<Options>,
    pub rng_state: i32,
    pub phase: Phase,
    pub round: i32,
    pub seating: Rc<Vec<String>>,
    pub players: Vec<Player>,
    /// spec faction index for each slot (archetype order)
    pub factions: [u8; 5],
    pub board: Vec<Place>,
    /// by faction slot
    pub supply: [i32; 5],
    pub left_out: Vec<CardIx>,
    pub pass: i32,
    pub first: Option<Pid>,
    pub turn: usize,
    pub passes_in_row: i32,
    pub opened: bool,
    pub round_plays: Vec<RoundPlay>,
    pub growing: Option<Growing>,
    pub night: Option<Night>,
    pub log: Vec<Rc<RoundLog>>,
    pub result: Option<GameResult>,
    /// Not part of the game: a bot's imagined state writes no log lines (nothing in a search reads them).
    pub quiet: bool,
}

impl GameState {
    pub fn n(&self) -> usize {
        self.seating.len()
    }
    pub fn pid_of(&self, name: &str) -> Option<Pid> {
        self.seating.iter().position(|s| s == name).map(|i| i as Pid)
    }
}

// ---------------------------------------------------------------------------
// Ids in targets: a target's fields hold locations, factions, cards or markers, as the JavaScript strings do.
// ---------------------------------------------------------------------------

/// Any id a target holds: a location, a faction in play (its slot), a card, the stop marker, the empty string, or a
/// faction that isn't in this game (its spec index; no rule accepts it).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Id {
    Loc(Loc),
    Fac(Fac),
    Card(CardIx),
    Stop,
    Empty,
    Absent(u8),
}

impl Id {
    /// The id as the JavaScript engine writes it. `factions`: the game's spec faction for each slot.
    pub fn str(self, factions: &[u8; 5]) -> &'static str {
        let sp = spec();
        match self {
            Id::Loc(l) => &sp.locations[l as usize].id,
            Id::Fac(f) => &sp.factions[factions[f as usize] as usize].id,
            Id::Absent(f) => &sp.factions[f as usize].id,
            Id::Card(c) => &sp.cards[c as usize].id,
            Id::Stop => "__stop",
            Id::Empty => "",
        }
    }
    /// Reads an id. None: not an id of this game's content.
    pub fn parse(s: &str, factions: &[u8; 5]) -> Option<Id> {
        let sp = spec();
        if s == "__stop" {
            return Some(Id::Stop);
        }
        if s.is_empty() {
            return Some(Id::Empty);
        }
        if let Some(l) = sp.loc_ix(s) {
            return Some(Id::Loc(l));
        }
        if let Some(f) = sp.fac_ix(s) {
            return Some(match factions.iter().position(|&x| x == f) { Some(slot) => Id::Fac(slot as Fac), None => Id::Absent(f) });
        }
        sp.card_ix(s).map(Id::Card)
    }
    pub fn loc(self) -> Option<Loc> {
        if let Id::Loc(l) = self { Some(l) } else { None }
    }
    pub fn fac(self) -> Option<Fac> {
        if let Id::Fac(f) = self { Some(f) } else { None }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Location,
    Faction,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Location => "location",
            Mode::Faction => "faction",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GroupMove {
    pub location: Id,
    pub faction: Id,
    pub to: Id,
}

/// A target's fields, in the order a JavaScript object would list them (the order they were first set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Mode,
    Location,
    Faction,
    From,
    To,
    Path,
    Split,
    Moves,
    Payer,
    Payers,
    Use,
    Back,
    Losses,
}

/// What a card's turn action is aimed at (engine Target).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Target {
    pub mode: Option<Mode>,
    pub location: Option<Id>,
    pub faction: Option<Id>,
    pub from: Option<Vec<Id>>,
    pub to: Option<Id>,
    pub path: Option<Vec<Id>>,
    pub split: Option<Vec<(Id, i32)>>,
    pub moves: Option<Vec<GroupMove>>,
    pub payer: Option<Id>,
    pub payers: Option<Vec<Id>>,
    pub use_: Option<Use>,
    pub back: Option<Id>,
    pub losses: Option<Id>,
    pub order: Vec<Key>,
}

impl Target {
    /// Note a field as set (a new key goes last; a present one keeps its place).
    pub fn touch(&mut self, k: Key) {
        if !self.order.contains(&k) {
            self.order.push(k);
        }
    }
    pub fn set_mode(&mut self, m: Mode) {
        self.mode = Some(m);
        self.touch(Key::Mode);
    }
    pub fn set_location(&mut self, l: Id) {
        self.location = Some(l);
        self.touch(Key::Location);
    }
    pub fn set_faction(&mut self, f: Id) {
        self.faction = Some(f);
        self.touch(Key::Faction);
    }
    pub fn set_to(&mut self, x: Id) {
        self.to = Some(x);
        self.touch(Key::To);
    }
    pub fn set_from(&mut self, v: Vec<Id>) {
        self.from = Some(v);
        self.touch(Key::From);
    }
    pub fn set_path(&mut self, v: Vec<Id>) {
        self.path = Some(v);
        self.touch(Key::Path);
    }
    pub fn set_split(&mut self, v: Vec<(Id, i32)>) {
        self.split = Some(v);
        self.touch(Key::Split);
    }
    pub fn set_moves(&mut self, v: Vec<GroupMove>) {
        self.moves = Some(v);
        self.touch(Key::Moves);
    }
    pub fn set_payer(&mut self, f: Id) {
        self.payer = Some(f);
        self.touch(Key::Payer);
    }
    pub fn set_payers(&mut self, v: Vec<Id>) {
        self.payers = Some(v);
        self.touch(Key::Payers);
    }
    pub fn set_use(&mut self, u: Use) {
        self.use_ = Some(u);
        self.touch(Key::Use);
    }
    pub fn set_back(&mut self, c: Id) {
        self.back = Some(c);
        self.touch(Key::Back);
    }
    pub fn set_losses(&mut self, l: Id) {
        self.losses = Some(l);
        self.touch(Key::Losses);
    }
    pub fn with_mode(m: Mode) -> Target {
        let mut t = Target::default();
        t.set_mode(m);
        t
    }
    pub fn with_use(u: Use) -> Target {
        let mut t = Target::default();
        t.set_use(u);
        t
    }
}

/// A move (engine Move).
#[derive(Clone, Debug, PartialEq)]
pub enum Move {
    Pick { keep: Vec<CardIx> },
    /// `target`: None is an absent target (`target` undefined), Some(None) a null one.
    Play { card: CardIx, use_: PlayUse, target: Option<Option<Target>>, places: Option<Vec<Loc>> },
    Pass,
    Grow { location: Loc },
    Flee { location: Loc, faction: Option<Fac>, to: Option<Loc>, follow: Option<bool> },
}
