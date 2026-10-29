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

/// What a card needs of the board for its first pick, in words (the engine's own candidate filter decides it).
fn board_words(a: Action) -> Option<&'static str> {
    Some(match a {
        Action::Burst => "A group of 2 or more that can leave, with 2 or more places to scatter to",
        Action::Rejoin => "A group with its own kind nearby to rejoin",
        Action::Chase => "A group that can leave, with somewhere to chase it",
        Action::Herd => "A group that can leave, with a trail to follow",
        Action::Split => "A group of 2 or more with 2 places next door it can enter",
        Action::Showdown => "A lone group (no fight) where you have sway",
        Action::Control => "A fight where the machines can cut a faction down",
        Action::Raise => "A location with dead to raise",
        Action::Plough => "A fight whose sides can be ploughed out of it",
        Action::Well => "A location that can draw groups in",
        Action::Gate => "An end that can be joined to another",
        Action::Invite => "A location that can take a group in",
        Action::Altar | Action::Study | Action::Terror => "A location to mark",
        _ => return None,
    })
}

/// The first pick's candidates for a reading: as the rules stand, and with the sway requirement off (the board alone).
fn first_picks(s: &GameState, pid: Pid, ci: CardIx, mode: Mode) -> (crate::choice::Choice, crate::choice::Choice) {
    let t = if card(ci).suit.is_some() { Target::with_mode(mode) } else { Target::default() };
    let mut free = crate::cards::imagined(s);
    free.options = s.options.unpaid();
    (crate::choice::next_choice(s, pid, ci, &t), crate::choice::next_choice(&free, pid, ci, &t))
}

/// Is a location (and a faction there) among a first pick's options?
fn offers(c: &crate::choice::Choice, loc: Loc, f: Option<Fac>) -> bool {
    use crate::choice::Opt;
    c.options.iter().any(|o| match *o {
        Opt::Group(l, g) => l == loc && f.is_none_or(|f| g == f),
        Opt::Loc(l) => l == loc,
        _ => false,
    })
}

/// The reading's own condition for a clicked location (and faction), in words.
fn reading_cond(s: &GameState, ci: CardIx, mode: Mode, loc: Loc, f: Option<Fac>) -> Option<Cond> {
    let c = card(ci);
    let sf = c.suit.map(|a| s.factions.iter().position(|&x| spec().factions[x as usize].archetype == a).unwrap_or(0) as Fac)?;
    Some(match mode {
        Mode::Location => cond(format!("At a {} location", suit_icon(ci)), spec().locations[loc as usize].archetype == c.suit.unwrap_or(usize::MAX)),
        Mode::Faction => match f {
            Some(f) => cond(format!("A group of the {}", fname(s, sf)), f == sf),
            None => cond(format!("Where the {} are", fname(s, sf)), factions_at(s, loc).contains(&sf)),
        },
    })
}

/// The conditions on a clicked location (and the faction clicked there, if any) as a card's first pick, under a
/// reading; None for a card not described (the unsuited cards' uses).
pub fn pick_conditions(s: &GameState, pid: Pid, ci: CardIx, mode: Mode, loc: Loc, f: Option<Fac>) -> Option<Vec<Cond>> {
    let c = card(ci);
    let suit_fac = c.suit.map(|a| s.factions.iter().position(|&x| spec().factions[x as usize].archetype == a).unwrap_or(0) as Fac);
    match c.action {
        Action::Threat => {
            let f = f.or_else(|| lone_at(s, loc))?;
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
        a => {
            let words = board_words(a)?;
            let (paid, free) = first_picks(s, pid, ci, mode);
            let fac = if matches!(free.kind, crate::choice::Kind::Group(_)) { f } else { None };
            let mut out: Vec<Cond> = reading_cond(s, ci, mode, loc, fac).into_iter().collect();
            out.push(cond(words, offers(&free, loc, fac)));
            out.push(cond("You have the standing to pay its sway", offers(&paid, loc, fac)));
            Some(out)
        }
    }
}

/// The conditions for a reading as a whole: those of the candidate group that comes closest (the most met); None for a
/// card not yet described.
pub fn reading_conditions(s: &GameState, pid: Pid, ci: CardIx, mode: Mode) -> Option<Vec<Cond>> {
    let c = card(ci);
    match c.action {
        Action::Threat => {
            let best = groups_of(s).into_iter().filter_map(|(l, f)| pick_conditions(s, pid, ci, mode, l, Some(f))).filter(|cs| cs[0].met).max_by_key(|cs| cs.iter().filter(|x| x.met).count());
            Some(best.unwrap_or_else(|| {
                let first = pick_conditions(s, pid, ci, mode, 0, Some(0)).expect("described");
                vec![cond(first[0].label.clone(), false)]
            }))
        }
        a => {
            let words = board_words(a)?;
            let (paid, free) = first_picks(s, pid, ci, mode);
            // The reading itself: any candidate for it on the board at all (the board's filter includes it).
            Some(vec![cond(words, !free.options.is_empty()), cond("You have the standing to pay its sway", !paid.options.is_empty())])
        }
    }
}
