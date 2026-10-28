//! The engine and bots for JavaScript (public/rules.js): one entry point that takes a call as JSON, `{ "fn": name,
//! "args": [...] }`, and answers `{ "ok": value }` or `{ "err": message }` (`"illegal": true` for a refused move). Every
//! value is the shape the table already uses: game states, views, moves and targets as JSON with string ids.
//!
//! Built for wasm32 (`npm run wasm`); `call` runs natively too, for tests. A bot's randomness comes from the host
//! (`env.random`, the caller's rng); natively, from a fixed sequence.

use crate::board::*;
use crate::bots::{self, BotMemory, Goal, Seats};
use crate::cards::{check_target, flee_options, return_room};
use crate::choice::{list_targets, next_choice, sample_target};
use crate::game::*;
use crate::json::*;
use crate::setup::*;
use crate::spec::spec;
use crate::types::*;
use crate::view::{describe_target, player_view, preview_value};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Answers one call, as JSON text.
pub fn call_json(request: &str) -> String {
    let out = match serde_json::from_str::<Value>(request) {
        Ok(v) => {
            let name = v["fn"].as_str().unwrap_or("");
            let args = v["args"].as_array().cloned().unwrap_or_default();
            match call(name, &args) {
                Ok(x) => json!({ "ok": x }),
                Err(Fail::Illegal(reason)) => json!({ "err": reason, "illegal": true }),
                Err(Fail::Error(e)) => json!({ "err": e }),
            }
        }
        Err(e) => json!({ "err": format!("bad request: {e}") }),
    };
    out.to_string()
}

pub enum Fail {
    /// A refused move (IllegalMoveError).
    Illegal(String),
    Error(String),
}

impl From<String> for Fail {
    fn from(e: String) -> Self {
        Fail::Error(e)
    }
}

impl From<&str> for Fail {
    fn from(e: &str) -> Self {
        Fail::Error(e.to_string())
    }
}

type Out = Result<Value, Fail>;

/// One call by name: the JavaScript engine's and bots' exports.
pub fn call(name: &str, a: &[Value]) -> Out {
    let arg = |i: usize| a.get(i).unwrap_or(&Value::Null);
    match name {
        "createGame" => {
            let input = arg(0);
            let seed = input["seed"].as_f64().ok_or("createGame needs a seed")? as i64;
            let players: Vec<String> = input["players"].as_array().ok_or("createGame needs players")?.iter().map(|p| p.as_str().unwrap_or("").to_string()).collect();
            let options = raw_options(&input["options"]);
            resolve_options(&options)?;
            Ok(state_to_value(&create_game(seed, &players, &options)?))
        }
        "resolveOptions" => {
            let options = raw_options(arg(0));
            resolve_options(&options)?;
            Ok(Value::Object(spec().variants.iter().map(|v| (v.id.clone(), Value::from(options.iter().find(|o| o.0 == v.id).map(|o| o.1.clone()).unwrap_or_else(|| v.default.clone())))).collect()))
        }
        "validate" => {
            let s = state(arg(0))?;
            Ok(match submission(&s, arg(1)) {
                Ok(_) => json!({ "ok": true }),
                Err(reason) => json!({ "ok": false, "reason": reason }),
            })
        }
        "applyMove" => {
            let s = state(arg(0))?;
            let (pid, m) = submission(&s, arg(1)).map_err(Fail::Illegal)?;
            Ok(state_to_value(&apply_legal(&s, pid, &m)))
        }
        "playerView" => {
            let s = state(arg(0))?;
            Ok(player_view(&s, seat(&s, arg(1))?))
        }
        "waitingOn" => {
            let s = state(arg(0))?;
            Ok(json!(waiting_on(&s).iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>()))
        }
        "nextChoice" => {
            let s = state(arg(0))?;
            let (pid, ci, t) = (seat(&s, arg(1))?, card_of(arg(2))?, target(&s, arg(3)).unwrap_or_default());
            Ok(choice_to_value(&s.factions, &next_choice(&s, pid, ci, &t)))
        }
        "checkTarget" => {
            let s = state(arg(0))?;
            let (pid, ci) = (seat(&s, arg(1))?, card_of(arg(2))?);
            let t = target(&s, arg(3));
            Ok(check_target(&s, pid, ci, t.as_ref()).map(Value::from).unwrap_or(Value::Null))
        }
        "previewTarget" => {
            let s = state(arg(0))?;
            let (pid, ci) = (seat(&s, arg(1))?, card_of(arg(2))?);
            let t = target(&s, arg(3)).unwrap_or_default();
            Ok(preview_value(&s, pid, ci, &t))
        }
        "describeTarget" => {
            let ci = card_of(arg(0))?;
            let factions = factions_named(arg(1));
            let t = if arg(1).is_null() { None } else { target_from_value(&factions, arg(1)) };
            Ok(Value::from(describe_target(&factions, ci, t.as_ref())))
        }
        "listTargets" => {
            let s = state(arg(0))?;
            let (pid, ci) = (seat(&s, arg(1))?, card_of(arg(2))?);
            let (ts, complete) = list_targets(&s, pid, ci, arg(3).as_u64().unwrap_or(40) as usize, arg(4).as_bool().unwrap_or(false));
            Ok(json!({ "targets": ts.iter().map(|t| target_to_value(&s.factions, t)).collect::<Vec<_>>(), "complete": complete }))
        }
        "sampleTarget" => {
            let s = state(arg(0))?;
            let (pid, ci) = (seat(&s, arg(1))?, card_of(arg(2))?);
            let mut rng = host_rng();
            Ok(sample_target(&s, pid, ci, &mut rng).map(|t| target_to_value(&s.factions, &t)).unwrap_or(Value::Null))
        }
        "returnRoom" => {
            let s = state(arg(0))?;
            let (pid, ci) = (seat(&s, arg(1))?, card_of(arg(2))?);
            let (spots, max, f) = return_room(&s, pid, ci);
            Ok(json!({ "spots": spots.iter().map(|&l| loc_id(l)).collect::<Vec<_>>(), "max": max, "faction": f.map(|f| fac_id(&s, f)).unwrap_or("") }))
        }
        "fleeOptions" => {
            let s = state(arg(0))?;
            let l = loc_of(arg(1))?;
            Ok(json!(flee_options(&s, l).iter().map(|(f, to)| json!({ "faction": fac_id(&s, *f), "to": to.iter().map(|&l| loc_id(l)).collect::<Vec<_>>() })).collect::<Vec<_>>()))
        }
        "resolveFight" => {
            let mut s = state(arg(0))?;
            fight_at(&mut s, loc_of(arg(1))?);
            Ok(state_to_value(&s))
        }
        "resolveFights" => {
            let mut s = state(arg(0))?;
            let locs = arg(1).as_array().ok_or("resolveFights needs locations")?.iter().map(loc_of).collect::<Result<Vec<_>, _>>()?;
            resolve_fights(&mut s, &locs);
            Ok(state_to_value(&s))
        }
        "fightsDue" => {
            let s = state(arg(0))?;
            Ok(json!(fights_due(&s).iter().map(|&l| loc_id(l)).collect::<Vec<_>>()))
        }
        "growthDue" => {
            let s = state(arg(0))?;
            let f = fac_of(&s, arg(1))?;
            Ok(Value::Object(growth_due(&s, f).iter().map(|(l, n)| (loc_id(l).to_string(), Value::from(n))).collect()))
        }
        "controllerOf" => {
            let s = state(arg(0))?;
            Ok(controller_of(&s, loc_of(arg(1))?).map(|f| Value::from(fac_id(&s, f))).unwrap_or(Value::Null))
        }
        "presenceOf" => {
            let s = state(arg(0))?;
            Ok(Value::from(presence_of(&s, fac_of(&s, arg(1))?)))
        }
        "totalPresence" => Ok(Value::from(total_presence(&state(arg(0))?))),
        "swayFor" => {
            let s = state(arg(0))?;
            Ok(Value::from(sway_for(&s, seat(&s, arg(1))?, card_of(arg(2))?)))
        }
        "nextRandom" => {
            let (value, next) = next_random(arg(0).as_f64().unwrap_or(0.0) as i64 as i32);
            Ok(json!({ "value": value, "state": next }))
        }
        "shuffle" => {
            let items = arg(0).as_array().cloned().unwrap_or_default();
            let (out, next) = shuffle(&items, arg(1).as_f64().unwrap_or(0.0) as i64 as i32);
            Ok(json!({ "items": out, "rngState": next }))
        }
        // The bots.
        "profiles" => Ok(json!(["trophy", "backer"])),
        "fast" => Ok(Value::from(bots::fast(arg(0).as_str().unwrap_or("")))),
        "personaOf" => Ok(bots::persona_of(arg(0).as_str().unwrap_or("")).map(|p| persona_value(&p)).unwrap_or(Value::Null)),
        "botMove" => {
            let s = state(arg(0))?;
            let input = arg(1);
            let Some(pid) = input["playerId"].as_str().and_then(|id| s.pid_of(id)) else { return Ok(json!({ "move": null })) };
            if s.phase == Phase::Ended {
                return Ok(json!({ "move": null }));
            }
            let profile = input["profile"].as_str().unwrap_or("trophy");
            let mut memory = input.get("memory").filter(|m| m.is_object()).map(memory_from);
            let seats = Seats {
                profiles: input["table"].as_object().map(|t| t.iter().filter_map(|(id, p)| Some((s.pid_of(id)?, p.as_str()?.to_string()))).collect()),
                memories: input["memories"].as_object().map(|t| t.iter().filter_map(|(id, m)| Some((s.pid_of(id)?, memory_from(m)))).collect::<HashMap<_, _>>()),
                ..Default::default()
            };
            let mut rng = host_rng();
            let m = bots::bot_move(&s, pid, &mut rng, profile, memory.as_mut(), &seats);
            Ok(json!({ "move": m.map(|m| move_to_value(&s.factions, &m)).unwrap_or(Value::Null), "memory": memory.as_ref().map(memory_value).unwrap_or(Value::Null) }))
        }
        "winChances" => {
            let s = state(arg(0))?;
            let pid = seat(&s, arg(1))?;
            let c = bots::win_chances(&s, pid);
            Ok(json!({
                "pInvaders": c.p_invaders, "prior": c.prior, "known": c.known, "backers": c.backers, "linearIsland": c.linear_island,
                "rivalInvaders": c.rival_invaders, "asInvaders": c.as_invaders, "asIsland": c.as_island, "marginInvaders": c.margin_invaders,
                "marginIsland": c.margin_island, "projected": c.projected, "threshold": c.threshold, "spreadP": c.spread_p, "roundsLeft": c.rounds_left,
            }))
        }
        "evaluate" => {
            let s = state(arg(0))?;
            let pid = seat(&s, arg(1))?;
            Ok(json!(bots::evaluate(&s, pid, arg(2).as_str().unwrap_or("trophy"), goal_of(arg(3)))))
        }
        "features" => {
            let s = state(arg(0))?;
            let pid = seat(&s, arg(1))?;
            Ok(Value::Object(bots::features(&s, pid).into_iter().map(|(k, v)| (k.to_string(), json!(v))).collect()))
        }
        "rankForHint" => {
            let s = state(arg(0))?;
            let pid = seat(&s, arg(1))?;
            let mut memory = memory_from(arg(2));
            let r = bots::rank_for_hint(&s, pid, &mut memory, arg(3).as_str().unwrap_or("trophy:enum=1"));
            Ok(json!({
                "goal": goal_name(r.goal),
                "moves": r.moves.iter().map(|(m, x, v)| json!({ "move": move_to_value(&s.factions, m), "s": state_to_value(x), "v": v })).collect::<Vec<_>>(),
                "worth": r.worth.iter().map(|(c, v)| json!({ "card": spec().cards[*c as usize].id, "v": v })).collect::<Vec<_>>(),
                "memory": memory_value(&memory),
            }))
        }
        "afterMove" => {
            let s = state(arg(0))?;
            let pid = seat(&s, arg(1))?;
            let m = move_from_value(&s.factions, arg(2))?;
            // As the JavaScript: an illegal move here is a caller's mistake, not a refused move.
            if let Some(reason) = validate(&s, pid, &m) {
                return Err(Fail::Error(reason));
            }
            Ok(state_to_value(&bots::after_move(&s, pid, &m)))
        }
        _ => Err(Fail::Error(format!("unknown call {name}"))),
    }
}

/// A game state, or a seat's view of one (the table builds targets on its view): the view's own hand, kept cards,
/// batch and trophies go back on its seat, and the seat to act becomes the turn. Others' hidden cards stay empty.
fn state(v: &Value) -> Result<GameState, String> {
    if v.get("me").is_none() || v.get("you").is_none() {
        return state_from_value(v);
    }
    let mut v = v.clone();
    let you = v["you"].as_str().unwrap_or("").to_string();
    let me = v["me"].clone();
    if let Some(p) = v["players"].get_mut(&you).and_then(|p| p.as_object_mut()) {
        for k in ["hand", "kept", "batch", "trophies"] {
            p.insert(k.into(), me[k].clone());
        }
    }
    let to_act = v["toAct"].as_str().map(|x| x.to_string());
    if let (Some(id), Some(seating)) = (to_act, v["seating"].as_array()) {
        if let Some(i) = seating.iter().position(|x| x.as_str() == Some(id.as_str())) {
            v["turn"] = Value::from(i);
        }
    }
    state_from_value(&v)
}

/// A submission ({ playerId, move }) checked as validate does: its seat and move, or why it is refused (the seat, then
/// the game being over, then the move's shape, then the rules).
fn submission(s: &GameState, v: &Value) -> Result<(Pid, Move), String> {
    let pid = v["playerId"].as_str().and_then(|id| s.pid_of(id)).ok_or("You are not seated at this table.")?;
    if s.phase == Phase::Ended {
        return Err("The game is over.".into());
    }
    let m = move_from_value(&s.factions, &v["move"])?;
    match validate(s, pid, &m) {
        None => Ok((pid, m)),
        Some(reason) => Err(reason),
    }
}

fn seat(s: &GameState, v: &Value) -> Result<Pid, String> {
    let id = v.as_str().ok_or("expected a player id")?;
    s.pid_of(id).ok_or_else(|| format!("unknown player {id}"))
}

fn card_of(v: &Value) -> Result<CardIx, String> {
    // A card id, or a card from spec.json (checkTarget takes the card itself).
    let id = v.as_str().or_else(|| v["id"].as_str()).ok_or("expected a card id")?;
    spec().card_ix(id).ok_or_else(|| format!("unknown card {id}"))
}

fn loc_of(v: &Value) -> Result<Loc, String> {
    let id = v.as_str().ok_or("expected a location id")?;
    spec().loc_ix(id).ok_or_else(|| format!("unknown location {id}"))
}

fn fac_of(s: &GameState, v: &Value) -> Result<Fac, String> {
    let id = v.as_str().ok_or("expected a faction id")?;
    let f = spec().fac_ix(id).ok_or_else(|| format!("unknown faction {id}"))?;
    s.factions.iter().position(|&x| x == f).map(|x| x as Fac).ok_or_else(|| format!("faction {id} is not in this game"))
}

fn loc_id(l: Loc) -> &'static str {
    &spec().locations[l as usize].id
}

fn fac_id(s: &GameState, f: Fac) -> &'static str {
    &spec().factions[s.factions[f as usize] as usize].id
}

fn target(s: &GameState, v: &Value) -> Option<Target> {
    if v.is_null() {
        None
    } else {
        target_from_value(&s.factions, v)
    }
}

/// The factions a target names, in the order it names them, as a game's factions (describeTarget has no state).
fn factions_named(v: &Value) -> [u8; 5] {
    fn walk(v: &Value, out: &mut Vec<u8>) {
        match v {
            Value::String(x) => {
                if let Some(f) = spec().fac_ix(x) {
                    if !out.contains(&f) {
                        out.push(f);
                    }
                }
            }
            Value::Array(xs) => xs.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o.values().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    let mut named = Vec::new();
    walk(v, &mut named);
    let mut out = [0u8; 5];
    for (i, f) in named.into_iter().take(5).enumerate() {
        out[i] = f;
    }
    out
}

fn raw_options(v: &Value) -> Vec<(String, String)> {
    v.as_object().map(|o| o.iter().map(|(k, x)| (k.clone(), x.as_str().map(|s| s.to_string()).unwrap_or_else(|| x.to_string()))).collect()).unwrap_or_default()
}

/// Every option must be a variant in spec.json, with one of its choices (resolveOptions).
fn resolve_options(raw: &[(String, String)]) -> Result<(), String> {
    for (id, choice) in raw {
        let v = spec().variants.iter().find(|v| &v.id == id).ok_or_else(|| format!("unknown option {id}"))?;
        if !v.choices.contains(choice) {
            return Err(format!("unknown choice {choice} for {id}"));
        }
    }
    Ok(())
}

fn goal_of(v: &Value) -> Option<Goal> {
    match v.as_str() {
        Some("island") => Some(Goal::Island),
        Some("invaders") => Some(Goal::Invaders),
        _ => None,
    }
}

fn goal_name(g: Goal) -> &'static str {
    match g {
        Goal::Island => "island",
        Goal::Invaders => "invaders",
    }
}

fn memory_from(v: &Value) -> BotMemory {
    BotMemory { goal: goal_of(&v["goal"]), jitter: v["jitter"].as_f64() }
}

fn memory_value(m: &BotMemory) -> Value {
    let mut o = Map::new();
    if let Some(g) = m.goal {
        o.insert("goal".into(), Value::from(goal_name(g)));
    }
    if let Some(j) = m.jitter {
        o.insert("jitter".into(), json!(j));
    }
    Value::Object(o)
}

/// A persona as the JavaScript writes it (its keys; unset numbers left out).
fn persona_value(p: &bots::Persona) -> Value {
    let mut o = Map::new();
    let mut put = |k: &str, x: Option<f64>| {
        if let Some(x) = x {
            o.insert(k.into(), json!(x));
        }
    };
    put("lean", Some(p.lean));
    put("jitter", Some(p.jitter));
    put("hold", Some(p.hold));
    put("push", Some(p.push));
    put("margin", Some(p.margin));
    put("linear", Some(p.linear));
    put("threat", Some(p.threat));
    put("enum", Some(p.enumerate));
    put("sim", Some(p.sim));
    put("combo", Some(p.combo));
    put("sets", Some(p.sets));
    put("table", Some(p.table));
    put("commit", Some(p.commit));
    put("protect", Some(p.protect));
    put("top", Some(p.top));
    put("race", Some(p.race));
    put("even", Some(p.even));
    put("plan", Some(p.plan));
    put("steer", Some(p.steer));
    Value::Object(o)
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    /// The caller's rng (Math.random, or a seeded one).
    fn random() -> f64;
    /// A panic's message, handed over before the module traps.
    fn panicked(ptr: *const u8, len: usize);
}

#[cfg(target_arch = "wasm32")]
fn host_rng() -> impl FnMut() -> f64 {
    || unsafe { random() }
}

/// Natively (tests): a fixed sequence.
#[cfg(not(target_arch = "wasm32"))]
fn host_rng() -> impl FnMut() -> f64 {
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    move || {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (x >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[cfg(target_arch = "wasm32")]
mod exports {
    use std::cell::RefCell;

    thread_local! {
        static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    /// Room for a request of `len` bytes; the caller writes it there and hands it to motw_call.
    #[no_mangle]
    pub extern "C" fn motw_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len.max(1));
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// Answers the request at `ptr` (freed here); the answer stays until the next call (motw_out_len bytes).
    #[no_mangle]
    pub extern "C" fn motw_call(ptr: *mut u8, len: usize) -> *const u8 {
        static HOOK: std::sync::Once = std::sync::Once::new();
        HOOK.call_once(|| {
            std::panic::set_hook(Box::new(|info| {
                let msg = info.to_string();
                unsafe { super::panicked(msg.as_ptr(), msg.len()) };
            }))
        });
        let bytes = unsafe { Vec::from_raw_parts(ptr, len, len.max(1)) };
        let request = String::from_utf8_lossy(&bytes).into_owned();
        drop(bytes);
        let answer = super::call_json(&request).into_bytes();
        OUT.with(|o| {
            *o.borrow_mut() = answer;
            o.borrow().as_ptr()
        })
    }

    #[no_mangle]
    pub extern "C" fn motw_out_len() -> usize {
        OUT.with(|o| o.borrow().len())
    }
}
