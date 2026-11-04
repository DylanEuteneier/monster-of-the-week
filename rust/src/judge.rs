//! The learned judge (2026-11-02, the designer: a better judge of positions, learned from games, its values inserted
//! by a script, `npm run judge`): the chance a seat wins, as
//! P(invaders) · P(win | invaders) + (1 − P(invaders)) · P(win | island),
//! each part a logistic model over features measured relative to the rules (presence against the bar, votes needed
//! out of votes left, leads over the best rival), so most of it carries across rule changes. The weights are fitted
//! by `motw fit` from games logged with `positions=1` and live in `rust/data/judge.json`; a bot uses them with the
//! persona switch `judge=1`. Not rules: a bot's knowledge.

use crate::board::total_presence;
use crate::bots::{win_chances, Chances};
use crate::spec::spec;
use crate::types::*;

/// Fitted weights, one list per part (empty: not fitted yet).
#[derive(Clone, Debug, Default)]
pub struct Weights {
    pub vote: Vec<f64>,
    pub inv: Vec<f64>,
    pub isl: Vec<f64>,
}

pub fn weights() -> Option<&'static Weights> {
    static W: std::sync::OnceLock<Option<Weights>> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(include_str!("../data/judge.json")).ok()?;
        let list = |k: &str| -> Vec<f64> { v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default() };
        let w = Weights { vote: list("vote"), inv: list("inv"), isl: list("isl") };
        if w.vote.len() == VOTE_N && w.inv.len() == WIN_N && w.isl.len() == WIN_N { Some(w) } else { None }
    })
    .as_ref()
}

pub const VOTE_N: usize = 9;
pub const WIN_N: usize = 11 + EXTRA_N;
const EXTRA_N: usize = 12;

/// How much of the round's play is left (1 outside Play: the coming round is all ahead).
pub fn round_left(s: &GameState) -> f64 {
    if s.phase != Phase::Play {
        return 1.0;
    }
    let full = (spec().hand_size[s.n()] * s.n()) as f64;
    let held: usize = s.players.iter().map(|p| p.hand.len()).sum();
    if full > 0.0 { (held as f64 / full).min(1.0) } else { 0.0 }
}

/// Votes still to cast (weighted) and what each side still needs (the invaders strictly more; a tie is the island's).
pub fn votes_needed(s: &GameState) -> (f64, f64, f64) {
    let total = s.options.votes_total();
    let cast = s.votes[0] + s.votes[1];
    let need_inv = total / 2 + 1 - s.votes[0];
    let need_isl = (total - total / 2) - s.votes[1];
    ((total - cast).max(0) as f64, need_inv as f64, need_isl as f64)
}

/// Already decided by the votes: Some(true) the invaders', Some(false) the island's.
pub fn decided(s: &GameState) -> Option<bool> {
    if !s.options.round_votes {
        return if s.phase == Phase::Ended { Some(s.votes[0] > s.votes[1]) } else { None };
    }
    let (_, need_inv, need_isl) = votes_needed(s);
    if need_inv <= 0.0 {
        Some(true)
    } else if need_isl <= 0.0 {
        Some(false)
    } else {
        None
    }
}

/// P(invaders) features: the board against the bar now and after the fights already set, how much of the round is
/// left to make more, and the votes each side still needs out of those left.
pub fn vote_features(s: &GameState, c: &Chances) -> [f64; VOTE_N] {
    let bar = s.options.threshold as f64;
    let after = c.projected - bar;
    let now = total_presence(s) as f64 - bar;
    let frac = round_left(s);
    let (left, need_inv, need_isl) = votes_needed(s);
    let l = left.max(1.0);
    [1.0, after / 5.0, now / 5.0 * frac, after / 5.0 * (1.0 - frac), need_inv / l, need_isl / l, (need_isl - need_inv) / l, c.rounds_left / 4.0, frac]
}

/// P(win | an ending) features: the seat count's base rate, the hand formula's own reading, and the leads it is
/// built from (invaders: standing net of trophies over the best rival, weighted by presence; island: the weakest
/// colours over the best rival's), with the rounds left to change them.
///
/// A bank of the same reading at several settings, for the fit to weigh (2026-11-03): invaders, the chance a faction
/// ends strongest (presence softmax, sharp or loose) times the chance this seat leads it (a sigmoid of the lead, sharp,
/// middling or loose); island, the weakest-colour margin over the best rival at three sharpnesses.
pub fn win_features(s: &GameState, c: &Chances, invaders: bool) -> [f64; WIN_N] {
    let base = -((s.n() as f64 - 1.0).max(1.0)).ln();
    let pid = c_pid(s, c);
    let left = c.rounds_left / 4.0;
    if invaders {
        let x = crate::bots::projected(s);
        let pres: Vec<f64> = (0..5).map(|f| crate::board::presence_of(&x, f as Fac) as f64).collect();
        let top = pres.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let net = |i: usize, f: usize| (x.players[i].standing[f] - x.players[i].trophies[f]) as f64;
        let lead: Vec<f64> = (0..5).map(|f| net(pid, f) - (0..x.n()).filter(|&o| o != pid).map(|o| net(o, f)).fold(f64::NEG_INFINITY, f64::max)).collect();
        let bank = |temp: f64, spread: f64| {
            let w: Vec<f64> = pres.iter().map(|&p| ((p - top) / temp).exp()).collect();
            let sum: f64 = w.iter().sum();
            (0..5).map(|f| w[f] / sum * sigmoid(lead[f] / spread)).sum::<f64>()
        };
        let (a, b) = (1.0 + 1.5 * c.rounds_left, 3.0 + 3.0 * c.rounds_left);
        let mut order: Vec<usize> = (0..5).collect();
        order.sort_by(|&a, &b| pres[b].partial_cmp(&pres[a]).unwrap_or(std::cmp::Ordering::Equal));
        let own = [lead[order[0]] / 3.0, lead[order[1]] / 3.0, (pres[order[0]] - pres[order[1]]) / 5.0];
        let head = [1.0, base, logit(bank(a, 0.5)), logit(bank(a, 1.5)), logit(bank(a, 3.0)), logit(bank(b, 0.5)), logit(bank(b, 1.5)), logit(bank(b, 3.0)), c.rival_invaders, left, c.margin_invaders / 3.0 * left];
        join(head, extras(s, pid, own))
    } else {
        let m = c.margin_island;
        // The weakest colour: mine against the best rival's.
        let weakest = |i: usize| (0..5).map(|f| s.players[i].trophies[f]).min().unwrap_or(0) as f64;
        let rival = (0..s.n()).filter(|&o| o != pid).map(weakest).fold(f64::NEG_INFINITY, f64::max);
        let own = [(weakest(pid) - rival) / 2.0, weakest(pid) / 3.0, 0.0];
        let head = [1.0, base, logit(sigmoid(m / 0.3)), logit(sigmoid(m / 1.0)), logit(sigmoid(m / 3.0)), c.linear_island / 3.0, logit(c.as_island), m / 3.0, m.max(0.0) / 3.0, left, m / 3.0 * left];
        join(head, extras(s, pid, own))
    }
}

/// What both endings' winner models also see (2026-11-03): the fights already set where this seat holds the most
/// sway and the second most (trophies and standing come from fights), its cards, supply and sway on the board against
/// the table's mean, and three ending-specific readings (`own`).
fn extras(s: &GameState, pid: usize, own: [f64; 3]) -> [f64; EXTRA_N] {
    let (mut first, mut second) = (0.0, 0.0);
    for l in crate::game::fights_due(s) {
        let sway = &s.board[l as usize].sway;
        let mine = sway.get(pid as u8);
        if mine <= 0 {
            continue;
        }
        let above = (0..s.n()).filter(|&o| o != pid && sway.get(o as u8) > mine).count();
        if above == 0 {
            first += 1.0;
        } else if above == 1 {
            second += 1.0;
        }
    }
    let n = s.n() as f64;
    let mean = |f: &dyn Fn(usize) -> f64| (0..s.n()).map(f).sum::<f64>() / n;
    let hand = |i: usize| s.players[i].hand.len() as f64;
    let supply = |i: usize| s.players[i].supply as f64;
    let board = |i: usize| s.board.iter().map(|p| p.sway.get(i as u8)).sum::<i32>() as f64;
    // Where the trophies are (designer, 2026-11-03): the fights already set, played out — the trophies each seat is
    // set to gain, mine in my weakest colour, and what is within reach (each fight's tokens, weighted by how close I am
    // to the most sway there).
    let x = crate::bots::projected(s);
    let gain = |i: usize| (0..5).map(|f| x.players[i].trophies[f] - s.players[i].trophies[f]).sum::<i32>() as f64;
    let rival_gain = (0..s.n()).filter(|&o| o != pid).map(gain).fold(0.0, f64::max);
    let low = |g: &GameState| (0..5).map(|f| g.players[pid].trophies[f]).min().unwrap_or(0) as f64;
    let mut reach = 0.0;
    for l in crate::game::fights_due(s) {
        let at = &s.board[l as usize];
        let size: i32 = at.tokens.iter().map(|e| e.1).sum();
        let mine = at.sway.get(pid as u8) as f64;
        let best = (0..s.n()).filter(|&o| o != pid).map(|o| at.sway.get(o as u8)).max().unwrap_or(0) as f64;
        reach += size as f64 * sigmoid(mine - best + 0.5);
    }
    [
        first / 2.0, second / 2.0, hand(pid) - mean(&hand), (supply(pid) - mean(&supply)) / 3.0, (board(pid) - mean(&board)) / 3.0, own[0], own[1], own[2],
        gain(pid) / 3.0, rival_gain / 3.0, low(&x) - low(s), reach / 8.0,
    ]
}

fn join(a: [f64; 11], b: [f64; EXTRA_N]) -> [f64; WIN_N] {
    let mut out = [0.0; WIN_N];
    out[..11].copy_from_slice(&a);
    out[11..].copy_from_slice(&b);
    out
}

/// The seat a Chances was read for (the judge rows carry it; Chances doesn't).
fn c_pid(_s: &GameState, c: &Chances) -> usize {
    c.pid as usize
}

fn logit(p: f64) -> f64 {
    let p = p.clamp(1e-4, 1.0 - 1e-4);
    (p / (1.0 - p)).ln()
}

pub fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

fn dot(w: &[f64], x: &[f64]) -> f64 {
    w.iter().zip(x).map(|(a, b)| a * b).sum()
}

/// The learned reading of a position for `pid`: (P(invaders), P(win | invaders), P(win | island)); None unfitted.
pub fn judge(s: &GameState, pid: Pid) -> Option<(f64, f64, f64)> {
    let w = weights()?;
    let c = win_chances(s, pid);
    Some(judge_with(s, &c, w))
}

pub fn judge_with(s: &GameState, c: &Chances, w: &Weights) -> (f64, f64, f64) {
    let p_inv = match decided(s) {
        Some(true) => 1.0,
        Some(false) => 0.0,
        None => sigmoid(dot(&w.vote, &vote_features(s, c))),
    };
    (p_inv, sigmoid(dot(&w.inv, &win_features(s, c, true))), sigmoid(dot(&w.isl, &win_features(s, c, false))))
}

/// One logged position: every feature list and the hand formula's own estimates, for fitting and for comparing.
pub fn position_row(s: &GameState, pid: Pid) -> Vec<f64> {
    let c = win_chances(s, pid);
    let mut row = vec![pid as f64, s.round as f64, decided(s).map_or(-1.0, |d| if d { 1.0 } else { 0.0 })];
    row.extend(vote_features(s, &c));
    row.extend(win_features(s, &c, true));
    row.extend(win_features(s, &c, false));
    row.push(c.p_invaders);
    row.push(c.as_invaders);
    row.push(c.as_island);
    row
}

/// Logistic regression by Newton's method with a small ridge: rows (features, label 0..1, weight).
pub fn fit_logistic(rows: &[(Vec<f64>, f64, f64)], ridge: f64) -> Vec<f64> {
    let k = rows.first().map_or(0, |r| r.0.len());
    let mut w = vec![0.0; k];
    for _ in 0..30 {
        let mut g = vec![0.0; k];
        let mut h = vec![vec![0.0; k]; k];
        for (x, y, wt) in rows {
            let p = sigmoid(dot(&w, x));
            let d = p * (1.0 - p) * wt;
            for i in 0..k {
                g[i] += (p - y) * x[i] * wt;
                for j in 0..k {
                    h[i][j] += d * x[i] * x[j];
                }
            }
        }
        for i in 0..k {
            g[i] += ridge * w[i];
            h[i][i] += ridge;
        }
        let step = solve(h, g);
        let mut moved = 0.0;
        for i in 0..k {
            w[i] -= step[i];
            moved += step[i].abs();
        }
        if moved < 1e-7 {
            break;
        }
    }
    w
}

/// Solves h · x = g by Gaussian elimination with partial pivoting.
/// Solves h·x = g (for the imitation fit).
pub fn solve_pub(h: Vec<Vec<f64>>, g: Vec<f64>) -> Vec<f64> {
    solve(h, g)
}

fn solve(mut h: Vec<Vec<f64>>, mut g: Vec<f64>) -> Vec<f64> {
    let n = g.len();
    for c in 0..n {
        let piv = (c..n).max_by(|&a, &b| h[a][c].abs().partial_cmp(&h[b][c].abs()).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(c);
        h.swap(c, piv);
        g.swap(c, piv);
        let d = h[c][c];
        if d.abs() < 1e-12 {
            continue;
        }
        for r in c + 1..n {
            let f = h[r][c] / d;
            for j in c..n {
                h[r][j] -= f * h[c][j];
            }
            g[r] -= f * g[c];
        }
    }
    let mut x = vec![0.0; n];
    for c in (0..n).rev() {
        let s: f64 = (c + 1..n).map(|j| h[c][j] * x[j]).sum();
        x[c] = if h[c][c].abs() < 1e-12 { 0.0 } else { (g[c] - s) / h[c][c] };
    }
    x
}

/// Mean log loss of predictions (p, label, weight).
pub fn log_loss(xs: &[(f64, f64, f64)]) -> f64 {
    let (mut sum, mut wsum) = (0.0, 0.0);
    for &(p, y, wt) in xs {
        let p = p.clamp(1e-6, 1.0 - 1e-6);
        sum -= wt * (y * p.ln() + (1.0 - y) * (1.0 - p).ln());
        wsum += wt;
    }
    sum / wsum.max(1e-9)
}
