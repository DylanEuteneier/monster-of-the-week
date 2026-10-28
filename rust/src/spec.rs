//! The game's content and numbers, read once from `public/spec.json` (the same file the table reads).

use serde_json::Value;
use std::sync::OnceLock;

/// A card's turn action (the 21 core cards; spec.json `action`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Invite,
    Gate,
    Threat,
    Herd,
    Well,
    Burst,
    Chase,
    Rejoin,
    Plough,
    Split,
    Raise,
    Control,
    Terror,
    Study,
    Altar,
    Favours,
    Stakes,
    Exit,
    Showdown,
    Switch,
    Playbook,
}

impl Action {
    fn parse(s: &str) -> Action {
        match s {
            "invite" => Action::Invite,
            "gate" => Action::Gate,
            "threat" => Action::Threat,
            "herd" => Action::Herd,
            "well" => Action::Well,
            "burst" => Action::Burst,
            "chase" => Action::Chase,
            "rejoin" => Action::Rejoin,
            "plough" => Action::Plough,
            "split" => Action::Split,
            "raise" => Action::Raise,
            "control" => Action::Control,
            "terror" => Action::Terror,
            "study" => Action::Study,
            "altar" => Action::Altar,
            "favours" => Action::Favours,
            "stakes" => Action::Stakes,
            "exit" => Action::Exit,
            "showdown" => Action::Showdown,
            "switch" => Action::Switch,
            "playbook" => Action::Playbook,
            other => panic!("unknown action {other}"),
        }
    }
}

/// An unsuited card's uses (spec.json `uses`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Use {
    Sway,
    Standing,
    Tokens,
    Theirs,
    Yours,
}

impl Use {
    pub fn parse(s: &str) -> Option<Use> {
        Some(match s {
            "sway" => Use::Sway,
            "standing" => Use::Standing,
            "tokens" => Use::Tokens,
            "theirs" => Use::Theirs,
            "yours" => Use::Yours,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Use::Sway => "sway",
            Use::Standing => "standing",
            Use::Tokens => "tokens",
            Use::Theirs => "theirs",
            Use::Yours => "yours",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    Strike,
    Shift,
    Signature,
    Extra,
}

pub struct Card {
    pub id: String,
    pub name: String,
    /// The suit's archetype index.
    pub suit: Option<usize>,
    pub slot: Slot,
    pub sway: i32,
    pub action: Action,
    pub uses: Vec<Use>,
    pub marked: Option<char>,
    pub text: String,
}

pub struct Archetype {
    pub id: String,
    pub name: String,
}

pub struct Faction {
    pub id: String,
    pub name: String,
    pub archetype: usize,
}

pub struct Location {
    pub id: String,
    pub name: String,
    pub archetype: usize,
    pub adjacent: Vec<u8>,
}

pub struct SlayerGroup {
    pub id: String,
    pub archetype: usize,
}

pub struct Variant {
    pub id: String,
    pub default: String,
    pub choices: Vec<String>,
}

pub struct Spec {
    pub version: String,
    pub min_players: usize,
    pub max_players: usize,
    pub archetypes: Vec<Archetype>,
    pub factions: Vec<Faction>,
    pub locations: Vec<Location>,
    pub slayer_groups: Vec<SlayerGroup>,
    pub cards: Vec<Card>,
    pub variants: Vec<Variant>,
    /// Hand size by player count (index = players).
    pub hand_size: [usize; 6],
    pub seeding_two: i32,
    pub seeding_even: i32,
    pub seeding_home: i32,
    pub seeding_other: i32,
    pub raw: Value,
}

const SPEC_JSON: &str = include_str!("../../public/spec.json");

static SPEC: OnceLock<Spec> = OnceLock::new();

/// The spec, parsed on first use.
pub fn spec() -> &'static Spec {
    SPEC.get_or_init(|| parse(SPEC_JSON))
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn parse(text: &str) -> Spec {
    let raw: Value = serde_json::from_str(text).expect("spec.json");
    let archetypes: Vec<Archetype> = raw["archetypes"].as_array().unwrap().iter().map(|a| Archetype { id: s(&a["id"]), name: s(&a["name"]) }).collect();
    let arch = |id: &str| archetypes.iter().position(|a| a.id == id).unwrap_or_else(|| panic!("unknown archetype {id}"));
    let factions = raw["factions"].as_array().unwrap().iter().map(|f| Faction { id: s(&f["id"]), name: s(&f["name"]), archetype: arch(f["archetype"].as_str().unwrap()) }).collect();
    let loc_ids: Vec<String> = raw["locations"].as_array().unwrap().iter().map(|l| s(&l["id"])).collect();
    let loc_ix = |id: &str| loc_ids.iter().position(|l| l == id).unwrap_or_else(|| panic!("unknown location {id}")) as u8;
    let map = &raw["map"]["locations"];
    let locations = raw["locations"].as_array().unwrap().iter().map(|l| {
        let id = s(&l["id"]);
        let adjacent = map[&id]["adjacent"].as_array().unwrap().iter().map(|a| loc_ix(a.as_str().unwrap())).collect();
        Location { name: s(&l["name"]), archetype: arch(l["archetype"].as_str().unwrap()), adjacent, id }
    }).collect();
    let slayer_groups = raw["slayerGroups"].as_array().unwrap().iter().map(|g| SlayerGroup { id: s(&g["id"]), archetype: arch(g["archetype"].as_str().unwrap()) }).collect();
    let cards = raw["cards"].as_array().unwrap().iter().map(|c| Card {
        id: s(&c["id"]),
        name: s(&c["name"]),
        suit: c["suit"].as_str().map(|x| arch(x)),
        slot: match c["slot"].as_str().unwrap() {
            "strike" => Slot::Strike,
            "shift" => Slot::Shift,
            "signature" => Slot::Signature,
            _ => Slot::Extra,
        },
        sway: c["sway"].as_i64().unwrap_or(0) as i32,
        action: Action::parse(c["action"].as_str().unwrap()),
        uses: c["uses"].as_array().map(|u| u.iter().map(|x| Use::parse(x.as_str().unwrap()).unwrap()).collect()).unwrap_or_default(),
        marked: c["marked"].as_str().and_then(|m| m.chars().next()),
        text: s(&c["text"]),
    }).collect();
    let variants = raw["variants"].as_array().unwrap().iter().map(|v| Variant {
        id: s(&v["id"]),
        default: s(&v["default"]),
        choices: v["choices"].as_array().unwrap().iter().map(|c| s(&c["id"])).collect(),
    }).collect();
    let c = &raw["constants"];
    let mut hand_size = [0usize; 6];
    for (k, v) in c["handSize"].as_object().unwrap() {
        hand_size[k.parse::<usize>().unwrap()] = v.as_u64().unwrap() as usize;
    }
    let seed = |k: &str| c["seeding"][k].as_i64().unwrap() as i32;
    Spec {
        version: s(&raw["meta"]["version"]),
        min_players: raw["meta"]["players"]["min"].as_u64().unwrap() as usize,
        max_players: raw["meta"]["players"]["max"].as_u64().unwrap() as usize,
        archetypes,
        factions,
        locations,
        slayer_groups,
        cards,
        variants,
        hand_size,
        seeding_two: seed("two"),
        seeding_even: seed("even"),
        seeding_home: seed("home"),
        seeding_other: seed("other"),
        raw,
    }
}

impl Spec {
    pub fn card_ix(&self, id: &str) -> Option<u8> {
        self.cards.iter().position(|c| c.id == id).map(|i| i as u8)
    }
    pub fn loc_ix(&self, id: &str) -> Option<u8> {
        self.locations.iter().position(|c| c.id == id).map(|i| i as u8)
    }
    pub fn fac_ix(&self, id: &str) -> Option<u8> {
        self.factions.iter().position(|c| c.id == id).map(|i| i as u8)
    }
    pub fn arch_ix(&self, id: &str) -> Option<usize> {
        self.archetypes.iter().position(|c| c.id == id)
    }
}
