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

pub use crate::small::{List, Small};

/// The factions at a location (at most three; room for five).
pub type Facs = Small<5>;
/// A list of locations (a location's neighbours, a path).
pub type Locs = Small<16>;
/// A hand, a batch, kept cards.
pub type Hand = Small<8>;

/// The number of locations on the board.
pub const NLOC: usize = 15;

/// A small map that keeps insertion order, as a JavaScript object with string keys does: setting a present key keeps
/// its place, a new key goes last, and removing a key forgets its place. Inline (no heap): copying it is a memory copy.
#[derive(Clone, Copy)]
pub struct OMap<const N: usize = 5> {
    len: u8,
    keys: [u8; N],
    vals: [i32; N],
}

impl<const N: usize> Default for OMap<N> {
    fn default() -> Self {
        OMap { len: 0, keys: [0; N], vals: [0; N] }
    }
}

// Equality and hashing look at the live entries only, in order (slots past the end may hold stale values).
impl<const N: usize> PartialEq for OMap<N> {
    #[inline]
    fn eq(&self, o: &Self) -> bool {
        let n = self.len as usize;
        n == o.len as usize && self.keys[..n] == o.keys[..n] && self.vals[..n] == o.vals[..n]
    }
}
impl<const N: usize> Eq for OMap<N> {}
impl<const N: usize> std::hash::Hash for OMap<N> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, h: &mut H) {
        let n = self.len as usize;
        self.keys[..n].hash(h);
        self.vals[..n].hash(h);
    }
}

impl<const N: usize> std::fmt::Debug for OMap<N> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

impl<const N: usize> OMap<N> {
    pub fn new() -> Self {
        Self::default()
    }
    #[inline]
    fn find(&self, k: u8) -> Option<usize> {
        (0..self.len as usize).find(|&i| self.keys[i] == k)
    }
    /// The value, or None when the key is absent (`x[k]` is undefined).
    #[inline]
    pub fn opt(&self, k: u8) -> Option<i32> {
        self.find(k).map(|i| self.vals[i])
    }
    /// `x[k] ?? 0`.
    #[inline]
    pub fn get(&self, k: u8) -> i32 {
        self.opt(k).unwrap_or(0)
    }
    #[inline]
    pub fn has(&self, k: u8) -> bool {
        self.find(k).is_some()
    }
    /// `x[k] = v`.
    #[inline]
    pub fn set(&mut self, k: u8, v: i32) {
        match self.find(k) {
            Some(i) => self.vals[i] = v,
            None => {
                let n = self.len as usize;
                self.keys[n] = k;
                self.vals[n] = v;
                self.len += 1;
            }
        }
    }
    /// `x[k] = (x[k] ?? 0) + d`.
    #[inline]
    pub fn add(&mut self, k: u8, d: i32) {
        match self.find(k) {
            Some(i) => self.vals[i] += d,
            None => self.set(k, d),
        }
    }
    /// `delete x[k]`.
    #[inline]
    pub fn remove(&mut self, k: u8) {
        if let Some(i) = self.find(k) {
            let n = self.len as usize;
            self.keys.copy_within(i + 1..n, i);
            self.vals.copy_within(i + 1..n, i);
            self.len -= 1;
        }
    }
    #[inline]
    pub fn iter(&self) -> impl Iterator<Item = (u8, i32)> + '_ {
        (0..self.len as usize).map(move |i| (self.keys[i], self.vals[i]))
    }
    #[inline]
    pub fn keys(&self) -> impl Iterator<Item = u8> + '_ {
        self.keys[..self.len as usize].iter().copied()
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn len(&self) -> usize {
        self.len as usize
    }
    /// Append an entry (reading a saved map in its order).
    pub fn push(&mut self, k: u8, v: i32) {
        self.set(k, v);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Draft,
    Play,
    Night,
    Ended,
}

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Phase::Draft => "draft",
            Phase::Play => "play",
            Phase::Night => "night",
            Phase::Ended => "ended",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seeding {
    Two,
    Even,
    Home,
    /// 5 on one, 2 on each of the others (designer's seed, 2026-11-02).
    HomeTwo,
}

/// The variants chosen for a game (spec.json `variants`), resolved, with their raw choices in the spec's order.

/// A faction's pool when unlimited (D46): more than any game can take.
pub const UNLIMITED: i32 = 999;

#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    pub raw: Vec<(String, String)>,
    pub rounds: i32,
    pub threshold: i32,
    /// Whether the last round's close brings nightfall tokens and growth (off by default since 2026-10-31).
    pub last_growth: bool,
    /// Rounds as votes (designer trying it, 2026-10-31): each round's close, after the fights, is a vote; the majority wins.
    pub round_votes: bool,
    /// ...and the game ends as soon as one side holds a majority of the rounds (designer, 2026-10-31: a variant).
    pub votes_early: bool,
    /// The last round's vote counts this many (designer's seed, 2026-11-01; variant lastVote, 1 or 3).
    pub last_vote: i32,
    /// The first round's vote counts this many (designer's seed, 2026-11-05; variant firstVote, 1 or 0).
    pub first_vote: i32,
    pub faction_tokens: i32,
    pub player_cubes: i32,
    pub start_sway: i32,
    pub start_others: i32,
    pub start_board: i32,
    pub groups_random: bool,
    pub sway_per_move: i32,
    /// Card movement range (moveRange, designer testing 2026-11-01): how many steps a card's monster move may cover.
    pub move_range: i32,
    /// Unsuited cards' sway with any one faction (unsuitedSway, designer testing 2026-11-01): 0 none, -1 the hand size.
    pub unsuited_sway: i32,
    /// IC1 (D15): a move's sway must be paid. Always so in a game; off only in checkTarget's comparison copy (unpaid).
    pub sway_required: bool,
    /// Nightfall tokens (D38: GR6, the only way tokens arrive). Off only in the engine tests, which stage boards
    /// without them (key `nightfall`, not a variant).
    pub nightfall: bool,
    pub way_back: bool,
    /// Passing while holding cards (TU1; variant passing, designer 2026-10-28: a switch).
    pub passing: bool,
    /// Added to each strike's and shift's printed sway (variant cardSway; designer 2026-10-29, amount being measured).
    pub card_sway: i32,
    /// Light of the Cross as the designer's new draft (variant cross=plant, 2026-11-08), not the split.
    pub cross_plant: bool,
    pub seeding: Seeding,
    /// The same options with sway not required (checkTarget's comparison), made once.
    pub unpaid: std::cell::OnceCell<Rc<Options>>,
}

impl Options {
    /// Rounds as votes: every round's vote counts 1 but the last's, which counts `last_vote`, and the first's,
    /// which counts `first_vote`.
    pub fn vote_weight(&self, round: i32) -> i32 {
        if round >= self.rounds { self.last_vote } else if round <= 1 { self.first_vote } else { 1 }
    }
    /// All the votes in a game (five rounds, the last worth 3: 7).
    pub fn votes_total(&self) -> i32 {
        (1..=self.rounds).map(|r| self.vote_weight(r)).sum()
    }
    /// Rounds whose vote is cast, from the weighted votes cast so far (`cast`) and the round now being played: a
    /// first round worth nothing leaves no mark on the count, so it is closed once round 2 has begun.
    pub fn rounds_closed(&self, cast: i32, round: i32) -> i32 {
        let skipped = if self.first_vote == 0 && round >= 2 { 1 } else { 0 };
        (cast + skipped).min(self.rounds)
    }
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
        let mut raw: Vec<(String, String)> = sp.variants.iter().map(|v| (v.id.clone(), given.iter().find(|(k, _)| k == &v.id).map(|(_, c)| c.clone()).unwrap_or_else(|| v.default.clone()))).collect();
        let nightfall = !given.iter().any(|(k, v)| k == "nightfall" && v == "off");
        if !nightfall {
            raw.push(("nightfall".into(), "off".into()));
        }
        let get = |id: &str| raw.iter().find(|(k, _)| k == id).map(|(_, c)| c.as_str()).unwrap_or("");
        let num = |id: &str| get(id).parse::<i32>().unwrap_or(0);
        Options {
            rounds: num("rounds"),
            threshold: num("threshold"),
            last_growth: get("lastGrowth") == "on",
            round_votes: matches!(get("roundVotes"), "on" | "early"),
            votes_early: get("roundVotes") == "early",
            last_vote: num("lastVote").max(1),
            first_vote: num("firstVote").clamp(0, 1),
            // Unlimited (D46): a pool too big to run dry.
            faction_tokens: if get("factionTokens") == "unlimited" { UNLIMITED } else { num("factionTokens") },
            player_cubes: num("playerCubes"),
            start_sway: num("startSway"),
            start_others: num("startOthers"),
            start_board: num("startBoard"),
            groups_random: get("groups") == "random",
            sway_per_move: num("swayPerMove"),
            move_range: num("moveRange").max(1),
            unsuited_sway: match get("unsuitedSway") { "off" | "" => 0, "hand" => -1, x => x.parse().unwrap_or(0) },
            sway_required: true,
            nightfall,
            way_back: get("wayBack") != "off",
            passing: get("passing") != "off",
            card_sway: num("cardSway"),
            cross_plant: get("cross") == "plant",
            seeding: match get("seeding") {
                "even" => Seeding::Even,
                "home" => Seeding::Home,
                "home2" => Seeding::HomeTwo,
                _ => Seeding::Two,
            },
            unpaid: std::cell::OnceCell::new(),
            raw,
        }
    }
    /// These options with sway not required, shared.
    pub fn unpaid(&self) -> Rc<Options> {
        self.unpaid.get_or_init(|| Rc::new(self.with_sway_required(false))).clone()
    }
    /// A copy with the sway requirement set.
    pub fn with_sway_required(&self, on: bool) -> Options {
        let mut o = self.clone();
        o.unpaid = std::cell::OnceCell::new();
        o.sway_required = on;
        o
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
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
    /// Light of the Cross, planted (variant cross=plant; the designer's draft, 2026-11-08): the factions (bits by slot)
    /// no card may move in here until nightfall, this being in a cross's reach.
    pub cross: u8,
    /// The cross itself stands here (until nightfall).
    pub cross_at: bool,
    /// The factions (bits by slot) hiding here from a cross: no card moves them until nightfall.
    pub hidden: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Player {
    pub group: u8,
    pub supply: i32,
    /// by faction slot
    pub standing: [i32; 5],
    pub trophies: [i32; 5],
    pub hand: Hand,
    pub kept: Hand,
    pub batch: Hand,
    pub picked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Night {
    pub player: Pid,
    pub left: Locs,
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
    pub board: [Place; NLOC],
    /// by faction slot
    pub supply: [i32; 5],
    pub left_out: Small<21>,
    pub pass: i32,
    pub first: Option<Pid>,
    /// D44: the seat that played Steal Their Playbook this round goes first next round.
    pub next_first: Option<Pid>,
    pub turn: usize,
    pub passes_in_row: i32,
    pub opened: bool,
    /// Steal Their Playbook, theirs (D30): the card taken from another player, to be played now as one's own.
    pub copying: Option<CardIx>,
    /// Rounds as votes (variant roundVotes): rounds closed over the bar (the invaders') and at or under it (the island's).
    pub votes: [i32; 2],
    /// The last round close (not a rule; what the game showed, for the bots' reading of votes to come): its round, the
    /// presence before its fights, after them (the vote's), and the nightfall tokens it brought.
    pub last_close: Option<[i32; 4]>,
    pub round_plays: Vec<RoundPlay>,
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Id {
    Loc(Loc),
    Fac(Fac),
    Card(CardIx),
    Stop,
    #[default]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct GroupMove {
    pub location: Id,
    pub faction: Id,
    pub to: Id,
}

/// A target's fields, in the order a JavaScript object would list them (the order they were first set).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Key {
    #[default]
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
/// A target's list of ids (exits, a path, payers), inline. 64: a plough lists one entry per token in the fight, and a
/// crowded location held more than 24 (a crash, 2026-11-05).
pub type Ids = List<Id, 64>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Target {
    pub mode: Option<Mode>,
    pub location: Option<Id>,
    pub faction: Option<Id>,
    pub from: Option<Ids>,
    pub to: Option<Id>,
    pub path: Option<Ids>,
    pub split: Option<List<(Id, i32), 6>>,
    pub moves: Option<List<GroupMove, 16>>,
    pub payer: Option<Id>,
    pub payers: Option<Ids>,
    pub use_: Option<Use>,
    pub back: Option<Id>,
    pub losses: Option<Id>,
    pub order: List<Key, 13>,
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
    pub fn set_from(&mut self, v: impl Into<Ids>) {
        self.from = Some(v.into());
        self.touch(Key::From);
    }
    pub fn set_path(&mut self, v: impl Into<Ids>) {
        self.path = Some(v.into());
        self.touch(Key::Path);
    }
    pub fn set_split(&mut self, v: impl Into<List<(Id, i32), 6>>) {
        self.split = Some(v.into());
        self.touch(Key::Split);
    }
    pub fn set_moves(&mut self, v: impl Into<List<GroupMove, 16>>) {
        self.moves = Some(v.into());
        self.touch(Key::Moves);
    }
    pub fn set_payer(&mut self, f: Id) {
        self.payer = Some(f);
        self.touch(Key::Payer);
    }
    pub fn set_payers(&mut self, v: impl Into<Ids>) {
        self.payers = Some(v.into());
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
    Flee { location: Loc, faction: Option<Fac>, to: Option<Loc>, follow: Option<bool> },
}
