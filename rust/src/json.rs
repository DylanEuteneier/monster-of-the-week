//! JSON in the JavaScript engine's shapes: game states, player views, moves, targets and choices; and the play
//! fingerprint's hash (scripts/fingerprint.mjs gameOf).

use crate::choice::{Choice, FacKey, GroupKey, Kind, LocKey, Opt, UseKey};
use crate::spec::{spec, Use};
use crate::types::*;
use serde_json::{json, Map, Value};
use std::rc::Rc;

type F5 = [u8; 5];

fn fid(factions: &F5, f: Fac) -> Value {
    Value::from(spec().factions[factions[f as usize] as usize].id.as_str())
}
fn lid(l: Loc) -> Value {
    Value::from(spec().locations[l as usize].id.as_str())
}
fn cid(c: CardIx) -> Value {
    Value::from(spec().cards[c as usize].id.as_str())
}
fn ids(factions: &F5, xs: &[Id]) -> Value {
    Value::Array(xs.iter().map(|x| Value::from(x.str(factions))).collect())
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

pub fn target_to_value(factions: &F5, t: &Target) -> Value {
    let mut m = Map::new();
    for k in &t.order {
        let (name, v) = match k {
            Key::Mode => ("mode", t.mode.map(|x| Value::from(x.name()))),
            Key::Location => ("location", t.location.map(|x| Value::from(x.str(factions)))),
            Key::Faction => ("faction", t.faction.map(|x| Value::from(x.str(factions)))),
            Key::From => ("from", t.from.as_ref().map(|v| ids(factions, v))),
            Key::To => ("to", t.to.map(|x| Value::from(x.str(factions)))),
            Key::Path => ("path", t.path.as_ref().map(|v| ids(factions, v))),
            Key::Split => ("split", t.split.as_ref().map(|v| Value::Object(v.iter().map(|(l, n)| (l.str(factions).to_string(), Value::from(*n))).collect()))),
            Key::Moves => ("moves", t.moves.as_ref().map(|v| Value::Array(v.iter().map(|g| json!({ "location": g.location.str(factions), "faction": g.faction.str(factions), "to": g.to.str(factions) })).collect()))),
            Key::Payer => ("payer", t.payer.map(|x| Value::from(x.str(factions)))),
            Key::Payers => ("payers", t.payers.as_ref().map(|v| ids(factions, v))),
            Key::Use => ("use", t.use_.map(|u| Value::from(u.name()))),
            Key::Back => ("back", t.back.map(|x| Value::from(x.str(factions)))),
            Key::Losses => ("losses", t.losses.map(|x| Value::from(x.str(factions)))),
        };
        if let Some(v) = v {
            m.insert(name.to_string(), v);
        }
    }
    Value::Object(m)
}

/// A key equal for two targets exactly when JSON.stringify gives them the same text (fields in their order).
pub fn target_key(t: &Target) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let id = |x: &Id| format!("{x:?}");
    for k in &t.order {
        let _ = match k {
            Key::Mode => write!(out, "m{:?};", t.mode),
            Key::Location => write!(out, "l{:?};", t.location),
            Key::Faction => write!(out, "f{:?};", t.faction),
            Key::From => write!(out, "F{};", t.from.as_deref().unwrap_or(&[]).iter().map(id).collect::<Vec<_>>().join(",")),
            Key::To => write!(out, "t{:?};", t.to),
            Key::Path => write!(out, "P{};", t.path.as_deref().unwrap_or(&[]).iter().map(id).collect::<Vec<_>>().join(",")),
            Key::Split => write!(out, "S{:?};", t.split),
            Key::Moves => write!(out, "M{:?};", t.moves),
            Key::Payer => write!(out, "y{:?};", t.payer),
            Key::Payers => write!(out, "Y{};", t.payers.as_deref().unwrap_or(&[]).iter().map(id).collect::<Vec<_>>().join(",")),
            Key::Use => write!(out, "u{:?};", t.use_),
            Key::Back => write!(out, "b{:?};", t.back),
            Key::Losses => write!(out, "L{:?};", t.losses),
        };
    }
    out
}

fn id_of(factions: &F5, v: &Value) -> Option<Id> {
    Id::parse(v.as_str()?, factions)
}
fn ids_of(factions: &F5, v: &Value) -> Option<Vec<Id>> {
    v.as_array()?.iter().map(|x| id_of(factions, x)).collect()
}

/// A target from JSON (fields in their JSON order). None: not a target of this game's content.
pub fn target_from_value(factions: &F5, v: &Value) -> Option<Target> {
    let o = v.as_object()?;
    let mut t = Target::default();
    for (k, v) in o {
        if v.is_null() {
            continue;
        }
        match k.as_str() {
            "mode" => t.set_mode(match v.as_str()? { "location" => Mode::Location, "faction" => Mode::Faction, _ => return None }),
            "location" => t.set_location(id_of(factions, v)?),
            "faction" => t.set_faction(id_of(factions, v)?),
            "from" => t.set_from(ids_of(factions, v)?),
            "to" => t.set_to(id_of(factions, v)?),
            "path" => t.set_path(ids_of(factions, v)?),
            "split" => t.set_split(v.as_object()?.iter().map(|(l, n)| Some((Id::parse(l, factions)?, n.as_i64()? as i32))).collect::<Option<Vec<_>>>()?),
            "moves" => t.set_moves(v.as_array()?.iter().map(|g| Some(GroupMove { location: id_of(factions, &g["location"])?, faction: id_of(factions, &g["faction"])?, to: id_of(factions, &g["to"]).unwrap_or(Id::Empty) })).collect::<Option<Vec<_>>>()?),
            "payer" => t.set_payer(id_of(factions, v)?),
            "payers" => t.set_payers(ids_of(factions, v)?),
            "use" => t.set_use(Use::parse(v.as_str()?)?),
            "back" => t.set_back(id_of(factions, v)?),
            "losses" => t.set_losses(id_of(factions, v)?),
            _ => {}
        }
    }
    Some(t)
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

pub fn move_to_value(factions: &F5, m: &Move) -> Value {
    match m {
        Move::Pick { keep } => json!({ "type": "pick", "keep": keep.iter().map(|&c| cid(c)).collect::<Vec<_>>() }),
        Move::Pass => json!({ "type": "pass" }),
        Move::Grow { location } => json!({ "type": "grow", "location": lid(*location) }),
        Move::Flee { location, faction, to, follow } => {
            let mut o = Map::new();
            o.insert("type".into(), Value::from("flee"));
            o.insert("location".into(), lid(*location));
            if let Some(f) = faction {
                o.insert("faction".into(), fid(factions, *f));
            }
            if let Some(t) = to {
                o.insert("to".into(), lid(*t));
            }
            if let Some(x) = follow {
                o.insert("follow".into(), Value::from(*x));
            }
            Value::Object(o)
        }
        Move::Play { card, use_, target, places } => {
            let mut o = Map::new();
            o.insert("type".into(), Value::from("play"));
            o.insert("card".into(), cid(*card));
            o.insert("use".into(), Value::from(use_.name()));
            if let Some(t) = target {
                o.insert("target".into(), t.as_ref().map(|t| target_to_value(factions, t)).unwrap_or(Value::Null));
            }
            if let Some(p) = places {
                o.insert("places".into(), Value::Array(p.iter().map(|&l| lid(l)).collect()));
            }
            Value::Object(o)
        }
    }
}

/// A move from JSON. Err: the reason it isn't one (as the engine would refuse it).
pub fn move_from_value(factions: &F5, v: &Value) -> Result<Move, String> {
    let sp = spec();
    let bad = || "That is not a move.".to_string();
    let o = v.as_object().ok_or_else(bad)?;
    let card = |x: &Value| x.as_str().and_then(|c| sp.card_ix(c));
    let loc = |x: &Value| x.as_str().and_then(|c| sp.loc_ix(c));
    Ok(match o.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "pick" => Move::Pick {
            keep: o.get("keep").and_then(|k| k.as_array()).map(|k| k.iter().map(|c| card(c).unwrap_or(u8::MAX)).collect()).unwrap_or_default(),
        },
        "pass" => Move::Pass,
        "grow" => Move::Grow { location: o.get("location").and_then(loc).unwrap_or(u8::MAX) },
        "flee" => Move::Flee {
            location: o.get("location").and_then(loc).unwrap_or(u8::MAX),
            faction: o.get("faction").and_then(|f| id_of(factions, f)).and_then(|i| i.fac()),
            to: o.get("to").and_then(loc),
            follow: o.get("follow").and_then(|x| x.as_bool()),
        },
        "play" => {
            let use_ = match o.get("use").and_then(|u| u.as_str()) {
                Some("action") => PlayUse::Action,
                Some("sway") => PlayUse::Sway,
                Some("return") => PlayUse::Return,
                _ => return Err("Choose the action or the sway.".into()),
            };
            Move::Play {
                card: o.get("card").and_then(card).ok_or_else(|| "That card is not in your hand.".to_string())?,
                use_,
                target: o.get("target").map(|t| if t.is_null() { None } else { target_from_value(factions, t) }),
                places: o.get("places").and_then(|p| p.as_array()).map(|p| p.iter().map(|l| loc(l).unwrap_or(u8::MAX)).collect()),
            }
        }
        "" => return Err(bad()),
        _ => return Err("That move does not belong in this phase.".into()),
    })
}

// ---------------------------------------------------------------------------
// Game states
// ---------------------------------------------------------------------------

fn omap_fac(factions: &F5, m: &OMap) -> Value {
    Value::Object(m.iter().map(|(f, n)| (spec().factions[factions[f as usize] as usize].id.clone(), Value::from(n))).collect())
}
fn omap_pid(seating: &[String], m: &OMap) -> Value {
    Value::Object(m.iter().map(|(p, n)| (seating[p as usize].clone(), Value::from(n))).collect())
}
fn omap_loc(m: &OMap) -> Value {
    Value::Object(m.iter().map(|(l, n)| (spec().locations[l as usize].id.clone(), Value::from(n))).collect())
}
fn by_fac(factions: &F5, v: &[i32; 5]) -> Value {
    Value::Object((0..5).map(|f| (spec().factions[factions[f] as usize].id.clone(), Value::from(v[f]))).collect())
}
fn cards(v: &[CardIx]) -> Value {
    Value::Array(v.iter().map(|&c| cid(c)).collect())
}

fn place_value(s: &GameState, p: &Place) -> Value {
    let mut o = Map::new();
    o.insert("tokens".into(), omap_fac(&s.factions, &p.tokens));
    o.insert("sway".into(), omap_pid(&s.seating, &p.sway));
    o.insert("scorched".into(), Value::from(p.scorched));
    if let Some(g) = p.gate {
        o.insert("gate".into(), lid(g));
        o.insert("gateLoss".into(), p.gate_loss.map(lid).unwrap_or(Value::Null));
    }
    if p.altar {
        o.insert("altar".into(), Value::from(true));
    }
    if let Some(x) = p.study {
        o.insert("study".into(), Value::from(s.seating[x as usize].as_str()));
    }
    if let Some(x) = p.terror {
        o.insert("terror".into(), Value::from(s.seating[x as usize].as_str()));
    }
    Value::Object(o)
}

fn board_value(s: &GameState) -> Value {
    Value::Object(s.board.iter().enumerate().map(|(l, p)| (spec().locations[l].id.clone(), place_value(s, p))).collect())
}

fn growing_value(s: &GameState) -> Value {
    match &s.growing {
        None => Value::Null,
        Some(g) => json!({ "faction": fid(&s.factions, g.faction), "left": g.left, "leaders": g.leaders.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>(), "next": g.next, "due": omap_loc(&g.due) }),
    }
}
fn night_value(s: &GameState) -> Value {
    match &s.night {
        None => Value::Null,
        Some(n) => json!({ "player": s.seating[n.player as usize], "left": n.left.iter().map(|&l| lid(l)).collect::<Vec<_>>() }),
    }
}
fn result_value(s: &GameState) -> Value {
    match &s.result {
        None => Value::Null,
        Some(r) => json!({
            "side": if r.island { "island" } else { "invaders" },
            "factions": r.factions.iter().map(|&f| fid(&s.factions, f)).collect::<Vec<_>>(),
            "players": r.players.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>(),
            "scores": Value::Object(s.seating.iter().enumerate().map(|(i, p)| (p.clone(), Value::from(r.scores[i]))).collect()),
            "placings": r.placings.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>(),
        }),
    }
}
fn plays_value(s: &GameState) -> Value {
    Value::Array(s.round_plays.iter().map(|x| json!({ "pid": s.seating[x.pid as usize], "card": cid(x.card), "use": x.use_.name() })).collect())
}
fn log_value(s: &GameState) -> Value {
    Value::Array(s.log.iter().map(|e| json!({ "round": e.round, "events": e.events })).collect())
}
fn options_value(s: &GameState) -> Value {
    Value::Object(s.options.raw.iter().map(|(k, v)| (k.clone(), Value::from(v.as_str()))).collect())
}

/// A game state as the JavaScript engine stores it.
pub fn state_to_value(s: &GameState) -> Value {
    let players = Value::Object(s.seating.iter().enumerate().map(|(i, id)| {
        let p = &s.players[i];
        (id.clone(), json!({
            "group": spec().slayer_groups[p.group as usize].id, "supply": p.supply, "standing": by_fac(&s.factions, &p.standing),
            "trophies": by_fac(&s.factions, &p.trophies), "hand": cards(&p.hand), "kept": cards(&p.kept), "batch": cards(&p.batch), "picked": p.picked,
        }))
    }).collect());
    let mut o = Map::new();
    o.insert("version".into(), Value::from(&*s.version));
    o.insert("options".into(), options_value(s));
    o.insert("rngState".into(), Value::from(s.rng_state));
    o.insert("phase".into(), Value::from(s.phase.name()));
    o.insert("round".into(), Value::from(s.round));
    o.insert("seating".into(), json!(*s.seating));
    o.insert("players".into(), players);
    o.insert("factions".into(), Value::Array((0..5).map(|f| fid(&s.factions, f)).collect()));
    o.insert("board".into(), board_value(s));
    o.insert("supply".into(), by_fac(&s.factions, &s.supply));
    o.insert("leftOut".into(), cards(&s.left_out));
    o.insert("pass".into(), Value::from(s.pass));
    o.insert("first".into(), s.first.map(|p| Value::from(s.seating[p as usize].as_str())).unwrap_or(Value::Null));
    o.insert("turn".into(), Value::from(s.turn));
    o.insert("passesInRow".into(), Value::from(s.passes_in_row));
    o.insert("opened".into(), Value::from(s.opened));
    o.insert("growing".into(), growing_value(s));
    o.insert("night".into(), night_value(s));
    o.insert("log".into(), log_value(s));
    o.insert("result".into(), result_value(s));
    o.insert("roundPlays".into(), plays_value(s));
    Value::Object(o)
}

fn omap_from(v: &Value, key: impl Fn(&str) -> Option<u8>) -> Result<OMap, String> {
    let mut m = OMap::new();
    for (k, n) in v.as_object().ok_or("expected an object")? {
        m.0.push((key(k).ok_or_else(|| format!("unknown id {k}"))?, n.as_i64().unwrap_or(0) as i32));
    }
    Ok(m)
}

/// A game state saved by either engine. Fields from before the old decks were removed (bluffs, hidden tokens, the deck
/// and printed sway, responses) are ignored.
pub fn state_from_value(v: &Value) -> Result<GameState, String> {
    let sp = spec();
    let seating: Vec<String> = v["seating"].as_array().ok_or("no seating")?.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect();
    let mut factions = [0u8; 5];
    for (i, f) in v["factions"].as_array().ok_or("no factions")?.iter().enumerate().take(5) {
        factions[i] = sp.fac_ix(f.as_str().unwrap_or("")).ok_or("unknown faction")?;
    }
    let slot = |id: &str| sp.fac_ix(id).and_then(|f| factions.iter().position(|&x| x == f)).map(|x| x as u8);
    let pid = |id: &str| seating.iter().position(|x| x == id).map(|x| x as u8);
    let card = |x: &Value| x.as_str().and_then(|c| sp.card_ix(c));
    let cardv = |x: &Value| -> Vec<CardIx> { x.as_array().map(|a| a.iter().filter_map(card).collect()).unwrap_or_default() };
    let by_fac = |x: &Value| -> [i32; 5] { let mut out = [0; 5]; if let Some(o) = x.as_object() { for (k, n) in o { if let Some(f) = slot(k) { out[f as usize] = n.as_i64().unwrap_or(0) as i32; } } } out };
    let options = Options::from_raw(v["options"].as_object().map(|o| o.iter().map(|(k, x)| (k.clone(), x.as_str().map(|s| s.to_string()).unwrap_or_else(|| x.to_string()))).collect()).unwrap_or_default());
    let mut players = Vec::new();
    for id in &seating {
        let p = &v["players"][id];
        players.push(Player {
            group: sp.slayer_groups.iter().position(|g| g.id == p["group"].as_str().unwrap_or("")).unwrap_or(0) as u8,
            supply: p["supply"].as_i64().unwrap_or(0) as i32,
            standing: by_fac(&p["standing"]),
            trophies: by_fac(&p["trophies"]),
            hand: cardv(&p["hand"]),
            kept: cardv(&p["kept"]),
            batch: cardv(&p["batch"]),
            picked: p["picked"].as_bool().unwrap_or(false),
        });
    }
    let mut board = Vec::new();
    for l in &sp.locations {
        let p = &v["board"][&l.id];
        let sway = p.get("sway").or_else(|| p.get("influence")).cloned().unwrap_or(json!({}));
        board.push(Place {
            tokens: omap_from(&p["tokens"], |k| slot(k))?,
            sway: omap_from(&sway, |k| pid(k))?,
            scorched: p["scorched"].as_bool().unwrap_or(false),
            gate: p["gate"].as_str().and_then(|x| sp.loc_ix(x)),
            gate_loss: p["gateLoss"].as_str().and_then(|x| sp.loc_ix(x)),
            altar: p["altar"].as_bool().unwrap_or(false),
            study: p["study"].as_str().and_then(pid),
            terror: p["terror"].as_str().and_then(pid),
        });
    }
    let growing = match &v["growing"] {
        Value::Object(g) => Some(Growing {
            faction: slot(g["faction"].as_str().unwrap_or("")).ok_or("unknown faction")?,
            left: g["left"].as_i64().unwrap_or(0) as i32,
            leaders: g["leaders"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().and_then(pid)).collect()).unwrap_or_default(),
            next: g["next"].as_i64().unwrap_or(0) as i32,
            due: omap_from(&g["due"], |k| sp.loc_ix(k))?,
        }),
        _ => None,
    };
    let night = match &v["night"] {
        Value::Object(n) => Some(Night { player: n["player"].as_str().and_then(pid).ok_or("unknown player")?, left: n["left"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().and_then(|l| sp.loc_ix(l))).collect()).unwrap_or_default() }),
        _ => None,
    };
    let result = match &v["result"] {
        Value::Object(r) => Some(GameResult {
            island: r["side"].as_str() == Some("island"),
            factions: r["factions"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().and_then(slot)).collect()).unwrap_or_default(),
            players: r["players"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().and_then(pid)).collect()).unwrap_or_default(),
            scores: seating.iter().map(|p| r["scores"][p].as_i64().unwrap_or(0) as i32).collect(),
            placings: r["placings"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().and_then(pid)).collect()).unwrap_or_default(),
        }),
        _ => None,
    };
    let round_plays = v["roundPlays"].as_array().map(|a| a.iter().filter_map(|x| Some(RoundPlay {
        pid: x["pid"].as_str().and_then(pid)?,
        card: card(&x["card"])?,
        use_: match x["use"].as_str()? { "sway" => PlayUse::Sway, "return" => PlayUse::Return, _ => PlayUse::Action },
    })).collect()).unwrap_or_default();
    let log = v["log"].as_array().map(|a| a.iter().map(|e| Rc::new(RoundLog { round: e["round"].as_i64().unwrap_or(0) as i32, events: e["events"].as_array().map(|x| x.iter().map(|l| l.as_str().unwrap_or("").to_string()).collect()).unwrap_or_default() })).collect()).unwrap_or_default();
    let phase = match v["phase"].as_str().unwrap_or("draft") {
        "play" => Phase::Play,
        "night" => Phase::Night,
        "growth" => Phase::Growth,
        "ended" => Phase::Ended,
        _ => Phase::Draft,
    };
    Ok(GameState {
        version: Rc::from(v["version"].as_str().unwrap_or("")),
        options: Rc::new(options),
        rng_state: v["rngState"].as_i64().unwrap_or(0) as i32,
        phase,
        round: v["round"].as_i64().unwrap_or(1) as i32,
        seating: Rc::new(seating.clone()),
        players,
        factions,
        board,
        supply: by_fac(&v["supply"]),
        left_out: cardv(&v["leftOut"]),
        pass: v["pass"].as_i64().unwrap_or(1) as i32,
        first: v["first"].as_str().and_then(pid),
        turn: v["turn"].as_u64().unwrap_or(0) as usize,
        passes_in_row: v["passesInRow"].as_i64().unwrap_or(0) as i32,
        opened: v["opened"].as_bool().unwrap_or(false),
        round_plays,
        growing,
        night,
        log,
        result,
        quiet: false,
    })
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

pub fn choice_to_value(factions: &F5, c: &Choice) -> Value {
    let mut o = Map::new();
    let (kind, key): (&str, Option<&str>) = match c.kind {
        Kind::Mode => ("mode", None),
        Kind::Done => ("done", None),
        Kind::Split => ("split", None),
        Kind::Location(k) => ("location", Some(match k { LocKey::Location => "location", LocKey::To => "to", LocKey::Path => "path", LocKey::From => "from", LocKey::Losses => "losses" })),
        Kind::Group(k) => ("group", Some(match k { GroupKey::Group => "group", GroupKey::Move => "move" })),
        Kind::Faction(k) => ("faction", k.map(|k| match k { FacKey::Faction => "faction", FacKey::To => "to", FacKey::Payer => "payer", FacKey::Payers => "payers" })),
        Kind::Use(k) => ("use", Some(match k { UseKey::Use => "use", UseKey::Back => "back" })),
    };
    o.insert("kind".into(), Value::from(kind));
    if let Some(k) = key {
        o.insert("key".into(), Value::from(k));
    }
    if c.has_options() {
        o.insert("options".into(), Value::Array(c.options.iter().map(|x| match *x {
            Opt::Loc(l) => lid(l),
            Opt::Fac(f) => fid(factions, f),
            Opt::Group(l, f) => json!({ "location": lid(l), "faction": fid(factions, f) }),
            Opt::Use(u) => Value::from(u.name()),
            Opt::Card(c) => cid(c),
        }).collect()));
    }
    if let Some(x) = c.optional {
        o.insert("optional".into(), Value::from(x));
    }
    if let Some(x) = c.left {
        o.insert("left".into(), Value::from(x));
    }
    Value::Object(o)
}

// ---------------------------------------------------------------------------
// The play fingerprint (scripts/fingerprint.mjs)
// ---------------------------------------------------------------------------

/// Canonical JSON: keys sorted, as the fingerprint script writes it.
pub fn canon(v: &Value) -> String {
    match v {
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys.iter().map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canon(&o[*k]))).collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(canon).collect::<Vec<_>>().join(",")),
        _ => serde_json::to_string(v).unwrap(),
    }
}

/// The parts of a state the fingerprint compares (gameOf).
pub fn game_of(s: &GameState) -> Value {
    let v = state_to_value(s);
    let board = Value::Object(s.board.iter().enumerate().map(|(l, p)| {
        let pv = place_value(s, p);
        let mut o = Map::new();
        for k in ["tokens", "sway", "scorched", "gate", "gateLoss", "altar", "study", "terror"] {
            if let Some(x) = pv.get(k) {
                o.insert(k.into(), x.clone());
            }
        }
        (spec().locations[l].id.clone(), Value::Object(o))
    }).collect());
    let players = Value::Object(s.seating.iter().map(|id| {
        let p = &v["players"][id];
        (id.clone(), json!({ "group": p["group"], "supply": p["supply"], "standing": p["standing"], "trophies": p["trophies"], "hand": p["hand"], "kept": p["kept"], "batch": p["batch"], "picked": p["picked"] }))
    }).collect());
    json!({
        "phase": v["phase"], "round": v["round"], "rngState": v["rngState"], "seating": v["seating"], "factions": v["factions"], "supply": v["supply"],
        "pass": v["pass"], "first": v["first"], "turn": v["turn"], "passesInRow": v["passesInRow"], "opened": v["opened"],
        "board": board, "players": players, "growing": v["growing"], "night": v["night"], "roundPlays": v["roundPlays"], "result": v["result"], "log": v["log"],
    })
}

/// The fingerprint hash of a state: sha1 of the canonical gameOf, first 16 hex digits.
pub fn game_hash(s: &GameState) -> String {
    let text = canon(&game_of(s));
    let mut h = sha1_smol::Sha1::new();
    h.update(text.as_bytes());
    h.digest().to_string()[..16].to_string()
}
