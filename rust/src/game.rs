//! Validation, applying moves, the resolve phase and the end of the game .

use crate::board::*;
use crate::cards::*;
use crate::setup::*;
use crate::spec::spec;
use crate::types::*;
use std::rc::Rc;

/// A move's verdict: None is legal, Some(reason) is not.
pub type Verdict = Option<String>;

fn no(m: &str) -> Verdict {
    Some(m.to_string())
}

fn marked(c: CardIx) -> Option<char> {
    spec().cards[c as usize].marked
}

/// Is a move legal? (validate)
pub fn validate(s: &GameState, pid: Pid, m: &Move) -> Verdict {
    if pid as usize >= s.n() {
        return no("You are not seated at this table.");
    }
    if s.phase == Phase::Ended {
        return no("The game is over.");
    }
    let p = &s.players[pid as usize];
    match s.phase {
        Phase::Draft => {
            let Move::Pick { keep } = m else { return no("Pick cards in the draft.") };
            if p.picked {
                return no("You have already picked from this batch.");
            }
            if keep.len() != p.kept.len() + 1 {
                return Some(format!("Keep {} cards.", p.kept.len() + 1));
            }
            let dup = keep.iter().enumerate().any(|(i, c)| keep[..i].contains(c));
            if dup || keep.iter().any(|c| !p.kept.contains(c) && !p.batch.contains(c)) {
                return no("Keep cards from your kept cards and this batch.");
            }
            None
        }
        Phase::Night => {
            let (Move::Flee { location, faction, to, follow }, Some(n)) = (m, s.night.as_ref()) else { return no("Night has fallen: decide who flees from each mark.") };
            if n.player != pid {
                return no("Another player decides at nightfall.");
            }
            if !n.left.contains(location) {
                return no("Choose one of your marks.");
            }
            let Some(f) = faction else { return None };
            let exits = flee_options(s, *location).into_iter().find(|o| o.0 == *f).map(|o| o.1).unwrap_or_default();
            if !matches!(to, Some(t) if exits.contains(t)) {
                return no("1 token flees to a neighbouring location it can enter (from a fight, half may leave).");
            }
            if follow.unwrap_or(false) && s.board[*location as usize].sway.get(pid) < 1 { no("You have no sway there to follow.") } else { None }
        }
        Phase::Growth => {
            let (Move::Grow { location }, Some(g)) = (m, s.growing.as_ref()) else { return no("Choose where the faction grows.") };
            if g.leaders[g.next as usize % g.leaders.len()] != pid {
                return no("Another sway leader places this token.");
            }
            if g.due.get(*location) > 0 { None } else { no("That location doesn't grow.") }
        }
        Phase::Play => {
            if s.turn != pid as usize {
                return no("It is not your turn.");
            }
            let must_open = !s.opened && Some(pid) == s.first;
            match m {
                Move::Pass => {
                    if must_open && p.hand.iter().any(|&c| marked(c).is_some()) {
                        no("The first player opens with their marked card.")
                    } else if !s.options.passing {
                        no("No passing: play a card.")
                    } else {
                        None
                    }
                }
                Move::Play { card, use_, target, places } => {
                    if !p.hand.contains(card) {
                        return no("That card is not in your hand.");
                    }
                    if must_open {
                        let mut mine: Vec<CardIx> = p.hand.iter().copied().filter(|&c| marked(c).is_some()).collect();
                        mine.sort_by_key(|&c| marked(c));
                        if !mine.is_empty() && *card != mine[0] {
                            return no("The first player opens with their marked card.");
                        }
                    }
                    let c = &spec().cards[*card as usize];
                    match use_ {
                        PlayUse::Sway => {
                            if c.suit.is_none() {
                                return no("Unsuited cards have no sway use.");
                            }
                            if p.supply <= 0 { no("Your supply is empty.") } else { None }
                        }
                        PlayUse::Return => {
                            let (spots, max, _) = return_room(s, pid, *card);
                            let places = places.clone().unwrap_or_default();
                            if max == 0 {
                                return no("Its faction can come back only when it has no location with 2 or more of its tokens, and you need standing with it.");
                            }
                            if !places.is_empty() && places.len() as i32 <= max && places.iter().all(|l| spots.contains(l)) { None } else { Some(format!("Bring back 1 to {max} of its tokens, at its own locations or where it already is.")) }
                        }
                        PlayUse::Action => check_target(s, pid, *card, target.as_ref().and_then(|t| t.as_ref())),
                    }
                }
                _ => no("Play a card or pass."),
            }
        }
        Phase::Ended => no("The game is over."),
    }
}

/// Validates, copies, changes the copy, and runs any automatic steps (applyMove).
pub fn apply_move(s: &GameState, pid: Pid, m: &Move) -> Result<GameState, String> {
    if let Some(reason) = validate(s, pid, m) {
        return Err(reason);
    }
    Ok(apply_legal(s, pid, m))
}

/// Applies a move already known to be legal (a bot's search, which validated it when it made it). Debug builds check.
pub fn apply_legal(s: &GameState, pid: Pid, m: &Move) -> GameState {
    debug_assert!(validate(s, pid, m).is_none(), "apply_legal with an illegal move: {m:?}");
    let mut next = s.clone();
    let me = pid as usize;
    let seating = s.seating.clone();
    let who: &str = &seating[me];
    match m {
        Move::Pick { keep } => {
            let p = &mut next.players[me];
            let pool: Vec<CardIx> = p.kept.iter().chain(p.batch.iter()).copied().collect();
            p.kept = Hand::from_slice(keep);
            p.batch = pool.into_iter().filter(|c| !keep.contains(c)).collect();
            p.picked = true;
            if next.players.iter().all(|p| p.picked) {
                pass_batches(&mut next);
            }
        }
        Move::Grow { location } => grow_one(&mut next, *location),
        Move::Flee { location, faction, to, follow } => {
            let loc = *location;
            if let (Some(f), Some(to)) = (*faction, *to) {
                take_tokens(&mut next, loc, f, 1);
                add_tokens(&mut next, to, f, 1);
                let follow = follow.unwrap_or(false);
                if follow {
                    let sw = &mut next.board[loc as usize].sway;
                    let v = sw.get(pid) - 1;
                    sw.set(pid, v);
                    if v == 0 {
                        sw.remove(pid);
                    }
                    next.board[to as usize].sway.add(pid, 1);
                }
                let fnm = fname(&next, f);
                log_line(&mut next, |_| format!("  Night terrors at {}: 1 {fnm} flees to {}{}.", lname(loc), lname(to), if follow { format!(", {who}'s sway following") } else { String::new() }));
            }
            next.board[loc as usize].terror = None;
            let n = next.night.as_mut().expect("night");
            n.left.retain(|l| l != loc);
            if n.left.is_empty() {
                close_round(&mut next);
            }
        }
        Move::Pass => {
            next.passes_in_row += 1;
            log_line(&mut next, |_| format!("{who} passes."));
            if next.passes_in_row >= next.n() as i32 {
                end_of_play(&mut next);
            } else {
                next.turn = (next.turn + 1) % next.n();
            }
        }
        Move::Play { card, use_, target, places } => {
            let ci = *card;
            next.players[me].hand.retain(|c| c != ci);
            next.round_plays.push(RoundPlay { pid, card: ci, use_: *use_ });
            next.passes_in_row = 0;
            if Some(pid) == next.first {
                next.opened = true;
            }
            let c = &spec().cards[ci as usize];
            match use_ {
                PlayUse::Sway => {
                    let f = c.suit.unwrap() as Fac;
                    let gain = sway_for(s, pid, ci).min(next.players[me].supply);
                    next.players[me].supply -= gain;
                    next.players[me].standing[f as usize] += gain;
                    let fnm = fname(&next, f);
                    log_line(&mut next, |_| format!("{who} plays {} for {gain} sway with {fnm}.", c.name));
                }
                PlayUse::Return => {
                    let (_, _, f) = return_room(s, pid, ci);
                    let f = f.expect("suited");
                    let places = places.clone().unwrap_or_default();
                    for &l in &places {
                        add_tokens(&mut next, l, f, 1);
                    }
                    let k = places.len() as i32;
                    next.supply[f as usize] -= k;
                    next.players[me].standing[f as usize] -= k;
                    next.players[me].supply += k;
                    let mut uniq: Vec<Loc> = Vec::new();
                    for &l in &places {
                        if !uniq.contains(&l) {
                            uniq.push(l);
                        }
                    }
                    let fnm = fname(&next, f);
                    log_line(&mut next, |_| { let names = uniq.iter().map(|&l| lname(l)).collect::<Vec<_>>().join(", "); format!("{who} plays {} to bring {k} {fnm} back, at {names}.", c.name) });
                }
                PlayUse::Action => {
                    log_line(&mut next, |_| format!("{who} plays {}.", c.name));
                    match target {
                        Some(Some(t)) => act(&mut next, pid, ci, t),
                        _ if c.action == crate::spec::Action::Playbook && s.players[me].hand.len() == 1 => log_line(&mut next, |_| format!("{who} discards {}: it can't be the last card played.", c.name)),
                        _ => log_line(&mut next, |_| format!("{} has nothing to act on.", c.name)),
                    }
                }
            }
            next.turn = (next.turn + 1) % next.n();
            if !next.options.passing {
                // No passing: the round's play ends when the last card is played; a seat with an empty hand is skipped.
                if next.players.iter().all(|p| p.hand.is_empty()) {
                    end_of_play(&mut next);
                } else {
                    while next.players[next.turn].hand.is_empty() {
                        next.turn = (next.turn + 1) % next.n();
                    }
                }
            }
        }
    }
    next
}

/// Everyone has picked: pass the rest on; when the batches are empty the draft is over.
fn pass_batches(s: &mut GameState) {
    let n = s.n();
    let batches: Vec<Hand> = s.players.iter().map(|p| p.batch).collect();
    for i in 0..n {
        s.players[i].batch = batches[(i + n - 1) % n];
        s.players[i].picked = false;
    }
    s.pass += 1;
    if s.players.iter().all(|p| p.batch.len() == 1) {
        for p in s.players.iter_mut() {
            let b = std::mem::take(&mut p.batch);
            p.kept.extend(b);
        }
    }
    if s.players.iter().all(|p| p.batch.is_empty()) {
        start_play(s);
    }
}

/// The draft is done: hands are the kept cards; the earliest marked card dealt sets the first player (FP2).
fn start_play(s: &mut GameState) {
    for p in s.players.iter_mut() {
        p.hand = std::mem::take(&mut p.kept);
    }
    let first = ['A', 'B', 'C', 'D']
        .iter()
        .find_map(|&mark| (0..s.n()).find(|&i| s.players[i].hand.iter().any(|&c| marked(c) == Some(mark))))
        .unwrap_or((s.round as usize - 1) % s.n()) as Pid;
    s.first = Some(first);
    s.turn = first as usize;
    s.opened = !s.players[first as usize].hand.iter().any(|&c| marked(c).is_some());
    s.passes_in_row = 0;
    s.phase = Phase::Play;
    let name = s.seating[first as usize].clone();
    log_line(s, |_| format!("Draft done. {name} goes first."));
}

/// The round's play is over: unplayed cards go back; nightfall, or the fights.
fn end_of_play(s: &mut GameState) {
    for p in s.players.iter_mut() {
        p.hand = Hand::new();
    }
    let marks: Vec<Loc> = (0..s.board.len() as Loc).filter(|&l| s.board[l as usize].terror.is_some()).collect();
    if !marks.is_empty() {
        s.phase = Phase::Night;
        s.night = Some(Night { player: s.board[marks[0] as usize].terror.unwrap(), left: Locs::from_slice(&marks) });
        log_line(s, |_| "Everyone passed. Night falls.".to_string());
        return;
    }
    close_round(s);
}

/// The fights, then growth.
fn close_round(s: &mut GameState) {
    s.phase = Phase::Play;
    s.night = None;
    log_line(s, |_| "Fights:".to_string());
    for l in 0..s.board.len() as Loc {
        fight_at(s, l);
    }
    for p in s.board.iter_mut() {
        p.gate = None;
        p.gate_loss = None;
        p.altar = false;
        p.study = None;
        p.terror = None;
    }
    begin_growth(s, 0);
}

/// Several locations' fights in turn (resolveFights).
pub fn resolve_fights(s: &mut GameState, locs: &[Loc]) {
    for &l in locs {
        fight_at(s, l);
    }
}

/// The locations that will fight at round end as things stand.
pub fn fights_due(s: &GameState) -> Vec<Loc> {
    fights_now(s)
}

/// A location's fight: a Gate's two ends fight once, as one.
pub fn fight_at(s: &mut GameState, loc: Loc) {
    if s.board[loc as usize].scorched || count_at(s, loc) < 2 {
        return;
    }
    match gate_of(s, loc) {
        Some(g) => joined_fight(s, loc, g),
        None => fight(s, loc, None),
    }
}

/// `{ ...x }` merged with y's counts (y's new keys after x's).
fn merge(x: &OMap, y: &OMap) -> OMap {
    let mut out = x.clone();
    for (k, n) in y.iter() {
        out.add(k, n);
    }
    out
}

/// The Gate's fight: its two ends fight as one location.
fn joined_fight(s: &mut GameState, a: Loc, b: Loc) {
    let (ai, bi) = (a as usize, b as usize);
    let loss_end = s.board[ai].gate_loss.or(s.board[bi].gate_loss).unwrap_or(a);
    let other = if loss_end == a { b } else { a };
    let before_a = s.board[ai].tokens.clone();
    let before_b = s.board[bi].tokens.clone();
    let sway_a = s.board[ai].sway.clone();
    let sway_b = s.board[bi].sway.clone();
    for i in [ai, bi] {
        s.board[i].gate = None;
        s.board[i].gate_loss = None;
    }
    s.board[ai].tokens = merge(&before_a, &before_b);
    s.board[ai].sway = merge(&sway_a, &sway_b);
    if s.board[bi].altar {
        s.board[ai].altar = true;
    }
    if s.board[bi].study.is_some() && s.board[ai].study.is_none() {
        s.board[ai].study = s.board[bi].study;
    }
    s.board[bi].tokens = OMap::new();
    s.board[bi].sway = OMap::new();
    fight(s, a, Some(b));
    if s.board[ai].scorched {
        s.board[bi].scorched = true;
        return;
    }
    let after = std::mem::take(&mut s.board[ai].tokens);
    s.board[bi].tokens = OMap::new();
    let before_of = |end: Loc, f: Fac| if end == a { before_a.get(f) } else { before_b.get(f) };
    for (f, n) in after.iter() {
        if n <= 0 {
            continue;
        }
        let mut lost = before_a.get(f) + before_b.get(f) - n;
        for end in [loss_end, other] {
            let k = lost.max(0).min(before_of(end, f));
            add_tokens(s, end, f, before_of(end, f) - k);
            lost -= k;
        }
    }
    let kept = std::mem::take(&mut s.board[ai].sway);
    s.board[bi].sway = OMap::new();
    for pid in kept.keys() {
        for (end, sw) in [(a, &sway_a), (b, &sway_b)] {
            let v = sw.get(pid);
            if v != 0 {
                s.board[end as usize].sway.set(pid, v);
            }
        }
    }
}

/// A fight's name in the log: the location, or a Gate's two ends.
fn fight_name(loc: Loc, other: Option<Loc>) -> String {
    match other {
        Some(b) => format!("{} and {}, through the Gate", lname(loc), lname(b)),
        None => lname(loc).to_string(),
    }
}

/// One fight (FR5, TF1, TD1, AF3 adjusted). `joined`: a Gate's fight on the merged location (the other end).
fn fight(s: &mut GameState, loc: Loc, joined: Option<Loc>) {
    let li = loc as usize;
    let sides = factions_at(s, loc);
    let strength = |s: &GameState, f: Fac| s.board[li].tokens.get(f);
    let mut ranked = sides.clone();
    ranked.sort_by(|&x, &y| strength(s, y).cmp(&strength(s, x)));
    let top: Vec<Fac> = ranked.iter().copied().filter(|&f| strength(s, f) == strength(s, ranked[0])).collect();
    let other = joined;
    let aligned = top.iter().copied().find(|&f| f as usize == alignment_of(loc) || other.is_some_and(|o| f as usize == alignment_of(o)));
    if top.len() > 1 && aligned.is_none() {
        // TF1 + TM1: both wiped, the location scorched, nothing rewarded; everything back to its supply.
        for &f in &sides {
            s.supply[f as usize] += s.board[li].tokens.get(f);
        }
        let sway = s.board[li].sway.clone();
        for (p, n) in sway.iter() {
            s.players[p as usize].supply += n;
        }
        s.board[li].tokens = OMap::new();
        s.board[li].sway = OMap::new();
        s.board[li].scorched = true;
        let all = if sides.len() > 2 { "Every side is" } else { "Both sides are" };
        log_line(s, |_| { let name = fight_name(loc, other); format!("  {name}: a true tie. {all} wiped out and {name} is scorched.") });
        return;
    }
    let winner = if top.len() > 1 { aligned.unwrap() } else { ranked[0] };
    let losers: Vec<Fac> = sides.iter().copied().filter(|&f| f != winner).collect();
    let mut by_size = losers.clone();
    by_size.sort_by(|&x, &y| s.board[li].tokens.get(y).cmp(&s.board[li].tokens.get(x)));
    let loser = by_size[0];
    let lost: Vec<(Fac, i32)> = losers.iter().map(|&f| (f, s.board[li].tokens.get(f))).collect();
    let nl = s.board[li].tokens.get(loser);
    // D25: the winner loses half the (larger) loser's number, rounded up.
    let mut winner_loss = (nl + 1).div_euclid(2);
    if s.board[li].altar {
        winner_loss = nl;
    }
    winner_loss = winner_loss.min(s.board[li].tokens.get(winner));
    for &(f, n) in &lost {
        let v = s.board[li].tokens.get(f) - n;
        s.board[li].tokens.set(f, v);
    }
    let v = s.board[li].tokens.get(winner) - winner_loss;
    s.board[li].tokens.set(winner, v);
    for &f in &sides {
        if s.board[li].tokens.get(f) <= 0 {
            s.board[li].tokens.remove(f);
        }
    }
    if !s.quiet {
        let (wn, ln, ls) = (fname(s, winner).to_string(), losers.iter().map(|&f| fname(s, f)).collect::<Vec<_>>().join(" and "), lost.iter().map(|x| x.1.to_string()).collect::<Vec<_>>().join(", "));
        let name = fight_name(loc, other);
        log_line(s, |_| format!("  {name}: {wn} beat {ln}; casualties {ls} and {winner_loss}."));
    }
    // Trophies (TD1): bigger pile to the leader, smaller to the runner-up; with three piles, the leader takes the two larger.
    let mut piles: Vec<(Fac, i32)> = lost.iter().copied().chain(std::iter::once((winner, winner_loss))).filter(|x| x.1 > 0).collect();
    piles.sort_by(|x, y| y.1.cmp(&x.1));
    let place_for = |i: usize, n: usize| if n > 1 && i == n - 1 { 1 } else { 0 };
    let (places, involved, tied_leaders) = rank_at(s, loc);
    if let Some(st) = s.board[li].study {
        if places.first().copied().flatten() == Some(st) && places.get(1).copied().flatten().is_some() && piles.len() > 1 {
            // Study the Bodies: the leader also takes 1 from the runner-up's pile, the smallest.
            let last = piles.len() - 1;
            piles[last].1 -= 1;
            let rf = piles[last].0;
            s.players[st as usize].trophies[rf as usize] += 1;
            let (seating, fnm) = (s.seating.clone(), fname(s, rf));
            log_line(s, |_| format!("  {} studies one of the {fnm} dead.", seating[st as usize]));
            if piles[last].1 == 0 {
                piles.pop();
            }
        }
    }
    let give = |s: &mut GameState, (f, n): (Fac, i32), pid: Option<Pid>| match pid {
        Some(p) => {
            s.players[p as usize].trophies[f as usize] += n;
            let (seating, fnm) = (s.seating.clone(), fname(s, f));
            log_line(s, |_| format!("  {} takes a pile of {n} {fnm}.", seating[p as usize]));
        }
        None => s.supply[f as usize] += n,
    };
    if involved == 1 && places.first().copied().flatten().is_some() {
        for &pile in &piles {
            give(s, pile, places[0]); // UP1
        }
    } else {
        let n = piles.len();
        for (i, &pile) in piles.iter().enumerate() {
            give(s, pile, places.get(place_for(i, n)).copied().flatten());
        }
    }
    // Sway after the fight (AF3 adjusted, AS1).
    if let Some(leader) = places.first().copied().flatten() {
        let n = s.board[li].sway.get(leader);
        let half = n.div_euclid(2);
        s.players[leader as usize].standing[winner as usize] += half;
        s.players[leader as usize].supply += n - half;
        s.board[li].sway.remove(leader);
    }
    for p in tied_leaders {
        let n = s.board[li].sway.get(p);
        s.players[p as usize].supply += n;
        s.board[li].sway.remove(p);
    }
}

/// Rank players by sway at a location (AB1, PT2, ST1): (places: who collects first and second, None where a tie used
/// the place up; how many are involved; tied leaders).
pub fn rank_at(s: &GameState, loc: Loc) -> (List<Option<Pid>, 2>, usize, Small<5>) {
    let sway = &s.board[loc as usize].sway;
    let mut involved = 0;
    // Each amount with the players on it, in first-seen order (a Map by amount).
    let mut by_amount: List<(i32, Small<5>), 5> = List::new();
    for (p, n) in sway.iter() {
        if n <= 0 {
            continue;
        }
        involved += 1;
        match by_amount.iter_mut().find(|e| e.0 == n) {
            Some(e) => e.1.push(p),
            None => by_amount.push((n, Small::from_slice(&[p]))),
        }
    }
    let mut amounts: Small<5> = Small::new();
    let mut vals: [i32; 5] = [0; 5];
    for (k, e) in by_amount.iter().enumerate() {
        vals[k] = e.0;
        amounts.push(k as u8);
    }
    amounts.sort_by(|&x, &y| vals[y as usize].cmp(&vals[x as usize]));
    let mut places: List<Option<Pid>, 2> = List::new();
    let mut tied_leaders: Small<5> = Small::new();
    for k in amounts {
        if places.len() >= 2 {
            break;
        }
        let mut tied = by_amount[k as usize].1;
        if tied.len() > 1 {
            let aff: Small<5> = tied.iter().copied().filter(|&p| affinity_of(s, p) == alignment_of(loc)).collect();
            if aff.len() == 1 {
                places.push(Some(aff[0]));
                tied.retain(|p| p != aff[0]);
                if places.len() >= 2 {
                    break;
                }
                if tied.len() == 1 {
                    places.push(Some(tied[0]));
                    continue;
                }
            }
            if places.is_empty() {
                tied_leaders = tied;
            }
            let mut i = 0;
            while i < tied.len() && places.len() < 2 {
                places.push(None);
                i += 1;
            }
        } else {
            places.push(Some(tied[0]));
        }
    }
    (places, involved, tied_leaders)
}

/// What each growth location is due: 1, plus 1 if the faction is aligned with it (AL3; variant alignedGrowth).
pub fn growth_due(s: &GameState, f: Fac) -> OMap<NLOC> {
    let mut out = OMap::<NLOC>::new();
    for l in 0..s.board.len() as Loc {
        if s.board[l as usize].scorched {
            continue;
        }
        if count_at(s, l) == 1 && tokens_of(s, l, f) >= s.options.growth {
            out.set(l, 1 + if s.options.aligned_growth && alignment_of(l) == f as usize { 1 } else { 0 });
        }
    }
    out
}

/// Each faction's total growth due this round, capped by its supply (for the bots).
pub fn growth_total(s: &GameState) -> i32 {
    let mut due = [0i32; 5];
    for l in 0..s.board.len() as Loc {
        if s.board[l as usize].scorched {
            continue;
        }
        let here = factions_at(s, l);
        if here.len() != 1 {
            continue;
        }
        let f = here[0];
        if tokens_of(s, l, f) < s.options.growth {
            continue;
        }
        due[f as usize] += 1 + if s.options.aligned_growth && alignment_of(l) == f as usize { 1 } else { 0 };
    }
    (0..5).map(|f| s.supply[f].min(due[f])).sum()
}

/// Growth for each faction in turn, from `from`.
fn begin_growth(s: &mut GameState, from: usize) {
    for f in from as Fac..5 {
        let due = growth_due(s, f);
        let wants: i32 = due.iter().map(|e| e.1).sum();
        if wants == 0 {
            continue;
        }
        if wants <= s.supply[f as usize] {
            for (l, n) in due.iter() {
                s.board[l as usize].tokens.add(f, n);
            }
            s.supply[f as usize] -= wants;
            let k = due.len();
            let fnm = fname(s, f);
            log_line(s, |_| format!("{fnm} grows at {k} location{}.", if k == 1 { "" } else { "s" }));
        } else if s.supply[f as usize] > 0 {
            s.growing = Some(Growing { faction: f, left: s.supply[f as usize], leaders: sway_leaders(s, f), next: 0, due });
            s.phase = Phase::Growth;
            return;
        }
    }
    end_round(s);
}

/// One token placed by a sway leader during a short-supply growth.
fn grow_one(s: &mut GameState, loc: Loc) {
    let f = s.growing.as_ref().unwrap().faction;
    s.board[loc as usize].tokens.add(f, 1);
    s.supply[f as usize] -= 1;
    let g = s.growing.as_mut().unwrap();
    let v = g.due.get(loc) - 1;
    g.due.set(loc, v);
    if v <= 0 {
        g.due.remove(loc);
    }
    g.left -= 1;
    g.next += 1;
    if g.left > 0 && s.supply[f as usize] > 0 && !g.due.is_empty() {
        return;
    }
    let fnm = fname(s, f);
    log_line(s, |_| format!("{fnm} grows as far as its supply allows."));
    s.growing = None;
    s.phase = Phase::Play;
    begin_growth(s, f as usize + 1);
}

fn end_round(s: &mut GameState) {
    s.phase = Phase::Play;
    if s.round >= s.options.rounds {
        end_game(s);
        return;
    }
    s.round += 1;
    deal(s);
}

/// The end of the game (G.5): the invaders or the island, the scores and the winners.
fn end_game(s: &mut GameState) {
    s.phase = Phase::Ended;
    let total = total_presence(s);
    let threshold = s.options.threshold;
    let n = s.n();
    if total > threshold {
        // TH1: the invaders win; most presence, then most locations controlled (FX1), else they win together (FX2).
        let mut ranked: Vec<(Fac, i32, usize)> = (0..5u8).map(|f| (f, presence_of(s, f), (0..s.board.len() as Loc).filter(|&l| controller_of(s, l) == Some(f)).count())).collect();
        ranked.sort_by(|x, y| y.1.cmp(&x.1).then(y.2.cmp(&x.2)));
        let top: Vec<Fac> = ranked.iter().filter(|x| x.1 == ranked[0].1 && x.2 == ranked[0].2).map(|x| x.0).collect();
        let scores: Vec<i32> = (0..n).map(|p| top.iter().map(|&f| s.players[p].standing[f as usize] - s.players[p].trophies[f as usize]).sum()).collect();
        let order: Vec<Fac> = ranked.iter().map(|x| x.0).collect();
        let tiebreak = |a: Pid, b: Pid| -> i32 {
            let (pa, pb) = (&s.players[a as usize], &s.players[b as usize]);
            let ta: i32 = top.iter().map(|&f| pa.trophies[f as usize]).sum();
            let tb: i32 = top.iter().map(|&f| pb.trophies[f as usize]).sum();
            if ta != tb {
                return ta - tb;
            }
            let aa = top.iter().any(|&f| f as usize == affinity_of(s, a));
            let ab = top.iter().any(|&f| f as usize == affinity_of(s, b));
            if aa != ab {
                return if aa { -1 } else { 1 };
            }
            for &f in order.iter().filter(|f| !top.contains(f)) {
                let sa = pa.standing[f as usize] - pa.trophies[f as usize];
                let sb = pb.standing[f as usize] - pb.trophies[f as usize];
                if sa != sb {
                    return sb - sa;
                }
            }
            0
        };
        let winners = rank_players(n, &scores, &tiebreak);
        let placings = placings(n, &scores, &winners, &tiebreak);
        let names = top.iter().map(|&f| fname(s, f)).collect::<Vec<_>>().join(" and ");
        let wn = winners.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>().join(", ");
        s.result = Some(GameResult { island: false, factions: top, players: winners, scores, placings });
        log_line(s, |_| format!("Total presence {total} is more than {threshold}: the invaders win. {names} take the island. Winner: {wn}."));
    } else {
        // TS2: the count of the colour held fewest of; WT1 compares the next weakest.
        let sorted = |p: Pid| { let mut v = s.players[p as usize].trophies.to_vec(); v.sort(); v };
        let scores: Vec<i32> = (0..n as Pid).map(|p| sorted(p)[0]).collect();
        let tiebreak = |a: Pid, b: Pid| -> i32 {
            let (sa, sb) = (sorted(a), sorted(b));
            for i in 1..sa.len() {
                if sa[i] != sb[i] {
                    return sb[i] - sa[i];
                }
            }
            0
        };
        let winners = rank_players(n, &scores, &tiebreak);
        let placings = placings(n, &scores, &winners, &tiebreak);
        let wn = winners.iter().map(|&p| s.seating[p as usize].clone()).collect::<Vec<_>>().join(", ");
        s.result = Some(GameResult { island: true, factions: vec![], players: winners, scores, placings });
        log_line(s, |_| format!("Total presence {total} is not more than {threshold}: the island wins. Winner: {wn}."));
    }
}

fn ord(x: i32) -> std::cmp::Ordering {
    x.cmp(&0)
}

/// The best score wins; ties go to the tiebreak; players still tied share it.
fn rank_players(n: usize, scores: &[i32], tiebreak: &dyn Fn(Pid, Pid) -> i32) -> Vec<Pid> {
    let best = *scores.iter().max().unwrap();
    let mut tied: Vec<Pid> = (0..n as Pid).filter(|&p| scores[p as usize] == best).collect();
    tied.sort_by(|&a, &b| ord(tiebreak(a, b)));
    let first = tied[0];
    tied.into_iter().filter(|&p| tiebreak(p, first) == 0).collect()
}

/// Every seat in order, by the same score and tiebreaks as the winners (a measuring aid).
fn placings(n: usize, scores: &[i32], winners: &[Pid], tiebreak: &dyn Fn(Pid, Pid) -> i32) -> Vec<Pid> {
    let mut rest: Vec<Pid> = (0..n as Pid).filter(|p| !winners.contains(p)).collect();
    rest.sort_by(|&a, &b| ord(scores[b as usize] - scores[a as usize]).then(ord(tiebreak(a, b))));
    winners.iter().copied().chain(rest).collect()
}

/// Seats the current phase is waiting on.
pub fn waiting_on(s: &GameState) -> Vec<Pid> {
    match s.phase {
        Phase::Ended => vec![],
        Phase::Draft => (0..s.n() as Pid).filter(|&p| !s.players[p as usize].picked).collect(),
        Phase::Growth => s.growing.as_ref().map(|g| vec![g.leaders[g.next as usize % g.leaders.len()]]).unwrap_or_else(|| vec![s.turn as Pid]),
        Phase::Night => s.night.as_ref().map(|n| vec![n.player]).unwrap_or_else(|| vec![s.turn as Pid]),
        Phase::Play => vec![s.turn as Pid],
    }
}

/// Share the log between copies (a bot's imagined states don't need it).
pub fn drop_log(s: &mut GameState) {
    s.log = Vec::<Rc<RoundLog>>::new();
}
