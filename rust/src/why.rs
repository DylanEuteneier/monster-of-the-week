//! Why an action can't be played, for the table (designer, 2026-10-28): each condition a card's reading or a
//! clicked group must meet, and whether it does. The same conditions checkTarget enforces, put in words. Not every
//! card is described yet; for those the answer is None and the table shows nothing extra.

use crate::board::*;
use crate::cards::{card, threats_of};
use crate::spec::{spec, Action};
use crate::types::*;

/// One condition, and whether it is met.
#[derive(Clone, Debug, PartialEq)]
pub struct Cond {
    pub label: String,
    pub met: bool,
}

fn cond(label: impl Into<String>, met: bool) -> Cond {
    Cond { label: label.into(), met }
}

fn suit_icon(ci: CardIx) -> &'static str {
    match card(ci).suit.map(|a| spec().archetypes[a].id.as_str()) {
        Some("nocturnals") => "◐",
        Some("scifi") => "ↂ",
        Some("sentients") => "⏏",
        Some("undead") => "☾",
        Some("demonic") => "⎈",
        _ => "",
    }
}

/// The conditions on a clicked group as a card's first pick, under a reading; None for a card not yet described.
pub fn pick_conditions(s: &GameState, pid: Pid, ci: CardIx, mode: Mode, loc: Loc, f: Fac) -> Option<Vec<Cond>> {
    let c = card(ci);
    let suit_fac = c.suit.map(|a| s.factions.iter().position(|&x| spec().factions[x as usize].archetype == a).unwrap_or(0) as Fac);
    match c.action {
        Action::Threat => {
            let standing = s.players[pid as usize].standing[f as usize];
            Some(vec![
                match mode {
                    Mode::Location => cond(format!("A group at a {} location", suit_icon(ci)), spec().locations[loc as usize].archetype == c.suit.unwrap_or(usize::MAX)),
                    Mode::Faction => cond(format!("A group of the {}", fname(s, suit_fac.unwrap_or(0))), Some(f) == suit_fac),
                },
                cond("Some of it can leave (half, from a fight)", can_leave(s, loc, f)),
                cond("A lone group of another faction within two locations", !threats_of(s, loc, f).is_empty()),
                cond(format!("2 standing with the {}: 1 where it leaves, 1 at the fight (you have {standing})", fname(s, f)), standing >= 2),
            ])
        }
        _ => None,
    }
}

/// The conditions for a reading as a whole: those of the candidate group that comes closest (the most met); None for a
/// card not yet described.
pub fn reading_conditions(s: &GameState, pid: Pid, ci: CardIx, mode: Mode) -> Option<Vec<Cond>> {
    let c = card(ci);
    match c.action {
        Action::Threat => {
            let best = groups_of(s).into_iter().filter_map(|(l, f)| pick_conditions(s, pid, ci, mode, l, f)).filter(|cs| cs[0].met).max_by_key(|cs| cs.iter().filter(|x| x.met).count());
            Some(best.unwrap_or_else(|| {
                let first = pick_conditions(s, pid, ci, mode, 0, 0).expect("described");
                vec![cond(first[0].label.clone(), false)]
            }))
        }
        _ => None,
    }
}
