//! For the table: previews, a target in words, and what one seat may see (previewTarget, describeTarget, playerView).

use crate::cards::{act, card, scratch};
use crate::game::waiting_on;
use crate::json::{state_to_value, target_to_value};
use crate::setup::{deck, sway_for};
use crate::spec::{spec, Action, Use};
use crate::types::*;
use serde_json::{json, Map, Value};

/// The state a finished target would leave, without playing it (the board and the players).
pub fn preview_target(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> GameState {
    let mut copy = scratch(s); // no roundPlays, as the JavaScript copy
    act(&mut copy, pid, ci, t);
    copy
}

/// The board and players of a preview, as the JavaScript previewTarget returns them.
pub fn preview_value(s: &GameState, pid: Pid, ci: CardIx, t: &Target) -> Value {
    let v = state_to_value(&preview_target(s, pid, ci, t));
    json!({ "board": v["board"], "players": v["players"] })
}

/// A target in words, for the table.
pub fn describe_target(factions: &[u8; 5], ci: CardIx, t: Option<&Target>) -> String {
    let Some(t) = t else { return "no effect".into() };
    let sp = spec();
    let l = |x: Option<Id>| match x { Some(Id::Loc(l)) => sp.locations[l as usize].name.clone(), _ => "?".into() };
    let f = |x: Option<Id>| match x { Some(Id::Fac(f)) => sp.factions[factions[f as usize] as usize].name.clone(), Some(Id::Absent(f)) => sp.factions[f as usize].name.clone(), _ => "?".into() };
    let real = |xs: &Option<Ids>| -> Vec<Id> { xs.as_deref().unwrap_or(&[]).iter().copied().filter(|&x| x != Id::Stop).collect() };
    let names = |xs: &[Id]| xs.iter().map(|&x| l(Some(x))).collect::<Vec<_>>().join(", ");
    let how = match t.mode { Some(Mode::Faction) => " (faction target)", Some(Mode::Location) => " (location target)", None => "" };
    match card(ci).action {
        Action::Burst => format!("{} at {} scatter to {}{how}", f(t.faction), l(t.location), names(&real(&t.from))),
        Action::Control => format!("{} {} cut down at {}{how}", real(&t.from).len(), f(t.faction), l(t.location)),
        Action::Raise => format!("{} of the dead rise at {}{how}", real(&t.from).len(), l(t.location)),
        Action::Plough => {
            let mut u: Vec<Id> = Vec::new();
            for x in real(&t.from) {
                if !u.contains(&x) {
                    u.push(x);
                }
            }
            format!("the fight at {} scatters to {}{how}", l(t.location), names(&u))
        }
        Action::Rejoin => {
            let x = real(&t.from);
            format!("{} at {} scatter to their own{}{how}", f(t.faction), l(t.location), if x.is_empty() { String::new() } else { format!(", extras to {}", names(&x)) })
        }
        Action::Chase => {
            let p = real(&t.path);
            let via = if p.len() > 1 { format!(" via {}", names(&p[..p.len() - 1])) } else { String::new() };
            format!("{} chased from {} to {}{via}{how}", f(t.faction), l(t.location), l(p.last().copied()))
        }
        Action::Well => {
            let n = real(&t.from).len();
            format!("{} drawn into {}{}{how}", f(t.faction), l(t.location), if n > 0 { format!(", {n} out of fights next door") } else { String::new() })
        }
        Action::Herd => {
            let p = real(&t.path);
            let via = if p.len() > 1 { format!(" via {}", names(&p[..p.len() - 1])) } else { String::new() };
            format!("{} from {}{via} to {}{how}", f(t.faction), l(t.location), l(p.last().copied()))
        }
        Action::Threat => format!("{} at {} march on {}{how}", f(t.faction), l(t.location), l(t.to)),
        Action::Gate => format!(
            "{} and {} joined{}{}",
            l(t.location),
            l(t.to),
            if t.payer.is_some() { format!(", {} paying", f(t.payer)) } else { String::new() },
            if t.losses.is_some() { format!("; the winner's losses come off {} first", l(t.losses)) } else { String::new() }
        ),
        Action::Invite => format!(
            "{} into {}{}",
            t.moves.as_deref().unwrap_or(&[]).iter().map(|g| format!("{} from {}", f(Some(g.faction)), l(Some(g.location)))).collect::<Vec<_>>().join(" and "),
            l(t.location),
            if t.payer.is_some() { format!(", {} paying at the fight", f(t.payer)) } else { String::new() }
        ),
        Action::Favours => {
            if t.use_ == Some(Use::Sway) {
                format!("sway from the supply at {}", names(&real(&t.from)))
            } else {
                let p = real(&t.payers);
                format!("{} standing with {}", p.len(), f(t.payers.as_ref().and_then(|v| v.first().copied())))
            }
        }
        Action::Stakes => match t.use_ {
            Some(Use::Standing) => format!("standing gathered with {}", f(t.faction)),
            Some(Use::Sway) => format!("sway gathered at {}", l(t.location)),
            _ => format!("{} come in to {}", f(t.faction), l(t.location)),
        },
        Action::Exit => match t.use_ {
            Some(Use::Standing) => format!("standing spread from {}", f(t.faction)),
            Some(Use::Sway) => format!("sway spread from {}", l(t.location)),
            _ => format!("{} scatter from {}", f(t.faction), l(t.location)),
        },
        Action::Showdown => format!("{} {} slain at {}", real(&t.from).len(), f(t.faction), l(t.location)),
        Action::Switch => if t.use_ == Some(Use::Standing) { format!("standing from {} to {}", f(t.faction), f(t.to)) } else { format!("sway from {} to {}", l(t.location), l(t.to)) },
        Action::Playbook => if t.use_ == Some(Use::Yours) {
            format!("takes {} back", match t.back { Some(Id::Card(c)) => sp.cards[c as usize].name.clone(), _ => "?".into() })
        } else {
            "plays the last card as their own".into()
        },
        Action::Terror | Action::Study | Action::Altar => {
            let mut at: Vec<Id> = t.moves.as_deref().unwrap_or(&[]).iter().map(|m| m.location).collect();
            at.extend(t.from.as_deref().unwrap_or(&[]).iter().copied());
            let at: Vec<Id> = at.into_iter().filter(|&x| x != Id::Stop).collect();
            match card(ci).action {
                Action::Terror => format!("night terrors at {}{how}", names(&at)),
                Action::Study => format!("bodies studied at {}{how}", names(&at)),
                _ => format!("blood on {}{how}", names(&at)),
            }
        }
        Action::Split => format!(
            "{} at {} split {}{how}",
            f(t.faction),
            l(t.location),
            t.split.as_deref().unwrap_or(&[]).iter().map(|&(x, n)| format!("{n} to {}", l(Some(x)))).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// The copy of the state one seat may see (hands, kept cards, batches, the left-out cards and trophy totals hidden).
pub fn player_view(s: &GameState, pid: Pid) -> Value {
    let v = state_to_value(s);
    let me = &s.players[pid as usize];
    let players = Value::Object(s.seating.iter().enumerate().map(|(i, id)| {
        let p = &v["players"][id];
        let pl = &s.players[i];
        (id.clone(), json!({ "group": p["group"], "standing": p["standing"], "supply": p["supply"], "handSize": if s.phase == Phase::Draft { pl.kept.len() } else { pl.hand.len() }, "picked": p["picked"] }))
    }).collect());
    let printed = Value::Object(deck().into_iter().map(|c| (spec().cards[c as usize].id.clone(), Value::from(sway_for(s, pid, c)))).collect());
    let mut o = Map::new();
    o.insert("you".into(), Value::from(s.seating[pid as usize].as_str()));
    o.insert("options".into(), v["options"].clone());
    o.insert("phase".into(), v["phase"].clone());
    o.insert("round".into(), v["round"].clone());
    o.insert("rounds".into(), Value::from(s.options.rounds));
    o.insert("seating".into(), v["seating"].clone());
    o.insert("players".into(), players);
    o.insert("factions".into(), v["factions"].clone());
    o.insert("board".into(), v["board"].clone());
    o.insert("supply".into(), v["supply"].clone());
    o.insert("deck".into(), Value::Array(deck().into_iter().map(|c| Value::from(spec().cards[c as usize].id.as_str())).collect()));
    o.insert("roundPlays".into(), v["roundPlays"].clone());
    o.insert("printed".into(), printed);
    o.insert("growing".into(), v["growing"].clone());
    o.insert("night".into(), v["night"].clone());
    o.insert("first".into(), v["first"].clone());
    o.insert("opened".into(), v["opened"].clone());
    o.insert("toAct".into(), waiting_on(s).first().map(|&p| Value::from(s.seating[p as usize].as_str())).unwrap_or(Value::Null));
    o.insert("log".into(), v["log"].clone());
    o.insert("result".into(), v["result"].clone());
    let mine = &v["players"][&s.seating[pid as usize]];
    o.insert("me".into(), json!({ "hand": mine["hand"], "kept": mine["kept"], "batch": mine["batch"], "picked": me.picked, "trophies": mine["trophies"] }));
    Value::Object(o)
}

/// A target as JSON (for the table).
pub fn target_value(s: &GameState, t: &Target) -> Value {
    target_to_value(&s.factions, t)
}
