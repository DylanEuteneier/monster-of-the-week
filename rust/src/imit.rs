//! Imitation (2026-11-04, designer: make the quick bots reflect a real strategy): a quick move score fitted to the
//! full bots' own choices. Each candidate move is described by the learned judge's reading of the position it leads to
//! (for the mover) and its one-step score; a conditional logit over each decision's candidates learns which of them the
//! full bot picks. The quick bot with persona imit=1 scores its candidates with these weights instead of the one-step
//! score. Weights: rust/data/imit.json (`motw fitimit`); none fitted means the one-step score is used unchanged.

use crate::types::{GameState, Pid};
use std::sync::OnceLock;

/// The features of a candidate: the judge's position row of the state after it (less pid, round and decided), and
/// its one-step score scaled.
pub fn move_features(after: &GameState, pid: Pid, quick: f64) -> Vec<f64> {
    let row = crate::judge::position_row(after, pid);
    let mut f: Vec<f64> = row[3..].to_vec();
    f.push(quick / 10.0);
    f
}

fn weights() -> &'static Vec<f64> {
    static W: OnceLock<Vec<f64>> = OnceLock::new();
    W.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(include_str!("../data/imit.json")).unwrap_or_default();
        v["w"].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default()
    })
}

/// The fitted score of a candidate (None when no weights are fitted, or they don't fit these features).
pub fn score(after: &GameState, pid: Pid, quick: f64) -> Option<f64> {
    let w = weights();
    if w.is_empty() {
        return None;
    }
    let f = move_features(after, pid, quick);
    (f.len() == w.len()).then(|| f.iter().zip(w).map(|(a, b)| a * b).sum())
}

/// One decision: its candidates' features and which one was chosen.
#[derive(Clone, Debug)]
pub struct Decision {
    pub x: Vec<Vec<f64>>,
    pub chosen: usize,
    /// Each candidate's play-out value, where the full bot played it out.
    pub v: Vec<Option<f64>>,
}

/// Ridge regression of the play-out value on the features, within each decision (both centred on the decision's
/// played-out candidates): what the quick score should rank by to rank moves as the play-outs do.
pub fn fit_value(ds: &[&Decision], ridge: f64) -> Vec<f64> {
    let k = ds.first().and_then(|d| d.x.first()).map_or(0, |x| x.len());
    let mut h = vec![vec![0.0; k]; k];
    let mut g = vec![0.0; k];
    for d in ds {
        let idx: Vec<usize> = (0..d.x.len()).filter(|&i| d.v[i].is_some()).collect();
        if idx.len() < 2 {
            continue;
        }
        let m = idx.len() as f64;
        let mx: Vec<f64> = (0..k).map(|j| idx.iter().map(|&i| d.x[i][j]).sum::<f64>() / m).collect();
        let mv = idx.iter().map(|&i| d.v[i].unwrap()).sum::<f64>() / m;
        for &i in &idx {
            let dx: Vec<f64> = (0..k).map(|j| d.x[i][j] - mx[j]).collect();
            let dv = d.v[i].unwrap() - mv;
            for a in 0..k {
                g[a] += dx[a] * dv;
                for b in 0..k {
                    h[a][b] += dx[a] * dx[b];
                }
            }
        }
    }
    for j in 0..k {
        h[j][j] += ridge;
    }
    crate::judge::solve_pub(h, g)
}

/// Mean rank correlation (Spearman), within each decision, between a score and the play-out values.
pub fn rank_corr(ds: &[&Decision], score: &dyn Fn(&[f64]) -> f64) -> f64 {
    let rank = |xs: &[f64]| -> Vec<f64> {
        let mut o: Vec<usize> = (0..xs.len()).collect();
        o.sort_by(|&a, &b| xs[a].partial_cmp(&xs[b]).unwrap_or(std::cmp::Ordering::Equal));
        let mut r = vec![0.0; xs.len()];
        for (pos, &i) in o.iter().enumerate() {
            r[i] = pos as f64;
        }
        r
    };
    let (mut sum, mut n): (f64, f64) = (0.0, 0.0);
    for d in ds {
        let idx: Vec<usize> = (0..d.x.len()).filter(|&i| d.v[i].is_some()).collect();
        if idx.len() < 3 {
            continue;
        }
        let a = rank(&idx.iter().map(|&i| score(&d.x[i])).collect::<Vec<_>>());
        let b = rank(&idx.iter().map(|&i| d.v[i].unwrap()).collect::<Vec<_>>());
        let m = a.len() as f64;
        let (ma, mb) = (a.iter().sum::<f64>() / m, b.iter().sum::<f64>() / m);
        let cov: f64 = a.iter().zip(&b).map(|(x, y)| (x - ma) * (y - mb)).sum();
        let va: f64 = a.iter().map(|x| (x - ma).powi(2)).sum();
        let vb: f64 = b.iter().map(|y| (y - mb).powi(2)).sum();
        if va > 0.0 && vb > 0.0 {
            sum += cov / (va * vb).sqrt();
            n += 1.0;
        }
    }
    sum / n.max(1.0)
}

/// Conditional logit by Newton's method with a ridge: P(chosen) = softmax(w·x) over each decision's candidates.
pub fn fit(ds: &[&Decision], ridge: f64) -> Vec<f64> {
    let k = ds.first().and_then(|d| d.x.first()).map_or(0, |x| x.len());
    let mut w = vec![0.0; k];
    for _ in 0..25 {
        let mut g = vec![0.0; k];
        let mut h = vec![vec![0.0; k]; k];
        for d in ds {
            let z: Vec<f64> = d.x.iter().map(|x| dot(&w, x)).collect();
            let top = z.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let e: Vec<f64> = z.iter().map(|v| (v - top).exp()).collect();
            let sum: f64 = e.iter().sum();
            let p: Vec<f64> = e.iter().map(|v| v / sum).collect();
            let mu: Vec<f64> = (0..k).map(|j| d.x.iter().zip(&p).map(|(x, pi)| pi * x[j]).sum()).collect();
            for j in 0..k {
                g[j] += mu[j] - d.x[d.chosen][j];
            }
            for (x, pi) in d.x.iter().zip(&p) {
                for a in 0..k {
                    let da = x[a] - mu[a];
                    if da == 0.0 {
                        continue;
                    }
                    for b in 0..k {
                        h[a][b] += pi * da * (x[b] - mu[b]);
                    }
                }
            }
        }
        for j in 0..k {
            g[j] += ridge * w[j];
            h[j][j] += ridge;
        }
        let step = crate::judge::solve_pub(h, g);
        let mut big = 0.0f64;
        for j in 0..k {
            w[j] -= step[j];
            big = big.max(step[j].abs());
        }
        if big < 1e-7 {
            break;
        }
    }
    w
}

/// Share of decisions where the highest-scored candidate is the chosen one, and the mean log-likelihood.
pub fn accuracy(ds: &[&Decision], score: &dyn Fn(&[f64]) -> f64) -> (f64, f64) {
    let (mut hit, mut ll) = (0.0, 0.0);
    for d in ds {
        let z: Vec<f64> = d.x.iter().map(|x| score(x)).collect();
        let best = (0..z.len()).max_by(|&a, &b| z[a].partial_cmp(&z[b]).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0);
        if best == d.chosen {
            hit += 1.0;
        }
        let top = z.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let sum: f64 = z.iter().map(|v| (v - top).exp()).sum();
        ll += z[d.chosen] - top - sum.ln();
    }
    let n = ds.len().max(1) as f64;
    (hit / n, ll / n)
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
