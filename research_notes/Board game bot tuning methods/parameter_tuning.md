# Tuning and learning heuristic bot parameters under noisy, expensive game evaluation

Context assumed: about 15 persona weights per profile, 5-player game, about 13 core-minutes per game, 8 cores (about 37 games per hour), and 50-300 games per experiment. Win share per seat swings from 8% to 18% between runs. Bots' late-round win-chance predictions are over-confident.

## Noisy black-box optimisation: SPSA, CMA-ES, (1+1)-ES, NTBEA, BO/SMAC, CLOP, racing

### Takeaway
The game budgets reported for SPSA and CLOP in chess are 30,000-100,000+ games, two to three orders of magnitude beyond 300. NTBEA is the method with direct game-AI evidence at our scale. In Planet Wars it found top settings in about 300 single-game evaluations over a discretised space of 5-8 parameters. It also returns a model of which parameter values and pairs matter. Every method needs a final, separate, high-sample re-evaluation of the recommended setting (the winner's curse).

### Cited Findings
**SPSA**
- SPSA perturbs all parameters at once with a random ±1 vector. It evaluates θ+cΔ against θ−cΔ, so it needs 2 measurements per iteration regardless of dimension (finite differences need p+1). Gains are a_k = a/(k+1+A)^α and c_k = c/(k+1)^γ, with Spall's α = 0.602 and γ = 0.101. The choice of a, A and c is "critical" — [CPW: SPSA](https://www.chessprogramming.org/SPSA)
- In Stockfish, one iteration is a pair of games, θ+ against θ−, and the match function returns a value in ±2 — [CPW: SPSA](https://www.chessprogramming.org/SPSA)
- RSPSA (Kocsis, Szepesvári, Winands 2005) added common random numbers, antithetic variates, RPROP and sample reuse, and was applied to poker and Lines of Action — [CPW: SPSA](https://www.chessprogramming.org/SPSA)
- Fishtest SPSA inputs per parameter are start, min, max, final c_k and final r_k, where r_k = a_k/c_k². One iteration is 2 games, and the total number of games fixes the schedule.
  - Use the broadest feasible ranges, because narrow ranges cause clipping. If values barely move after a few thousand games, c is likely too low, so stop.
  - Tuning many values at once adds noise, and rarely used values move slowly — [Fishtest wiki](https://github.com/official-stockfish/fishtest/wiki/Creating-my-first-test)
- Kiiski's original 2011 Stockfish method (a precursor to SPSA):
  - Tuned 7-35 variables at once with 30,000-100,000 super-fast games per session, using an apply factor of 0.002. Delta was chosen to give a 1-3 Elo difference between the two engines.
  - It improved Stockfish by about 40-70 Elo. It "does not converge": important variables approach their optima while unimportant ones random-walk, so the run must be stopped at a good moment.
  - Advice: tune table values through shared bias and amplitude knobs, not entry by entry — [CPW: Stockfish's Tuning Method](https://chessprogramming.org/Stockfish%27s_Tuning_Method)
- A 2024 fishtest SPSA time-management tune used 35k games and was validated by SPRT tests at about +3.0 and +1.9 Elo — [open-chess.org](https://open-chess.org/viewtopic.php?p=34292)
- Example fishtest non-regression SPRT bounds are elo0 = −1.75 and elo1 = 0.25, with LLR bounds of ±2.94 — [Fishtest wiki](https://github.com/official-stockfish/fishtest/wiki/Creating-my-first-test)

**CLOP**
- CLOP (Coulom, ACG 2011) fits local quadratic regression of win rate and discards samples that are confidently worse than average. The author reports it beat all other tested algorithms on smooth functions, and says it has no tricky meta-parameters — [HAL: CLOP](https://hal.archives-ouvertes.fr/hal-00750326); [CLOP slides](https://www.remi-coulom.fr/CLOP/CLOPSlides.pdf)
- CPW notes that verifying CLOP results takes many games, and the cost grows polynomially with the number of parameters. Stockfish moved from CLOP to SPSA in 2014 ("Goodbye CLOP, hello SPSA") — [CPW: CLOP](https://chessprogramming.org/CLOP). The only performance evidence is the author's own.

**NTBEA**
- NTBEA combines evolutionary search with multi-armed bandits over a discretised parameter space. It is robust to noise and yields a statistical model of the landscape. In the IEEE CEC 2018 paper it significantly outperformed grid search and an EDA on two game-tuning problems — [QMUL Game AI](https://gameai.eecs.qmul.ac.uk/2018/06/15/lucas2018ntbea/); [arXiv 1705.01080](https://ar5iv.arxiv.org/html/1705.01080)
- Algorithm details from Goodman and Lucas 2020:
  - Play one game with the current θ and update the N-tuple model. The model holds all 1-tuples, all 2-tuples and one full d-tuple, and its prediction is the mean of the matching tuples.
  - Generate 50 neighbours, mutating each parameter with probability 1/d and always at least one.
  - Pick the neighbour with the highest UCB, f̂ + k·√(log N/(n+0.5)), with k = 1 for win/loss fitness.
  - Report the best setting by model mean — [arXiv 2003.10378](https://ar5iv.labs.arxiv.org/html/2003.10378)
- Budgets and results from the same paper:
  - Planet Wars, 5 parameters, 228 settings, 288 evaluations: mean true win rate 0.655, and 60% of runs recommended a top-6 setting. Ground truth was 1,000 games per setting.
  - Planet Wars, 8 parameters, 23,520 settings, 1k evaluations: mean 0.707 (worst run 0.616, best 0.772).
  - Several short runs, with the rest of the budget spent re-evaluating each recommendation (1,000 games each) and picking the best, beat one long run.
  - Vanilla NTBEA was best at small budgets. Weighted variants gave better value estimates but were not better optimisers, and the linear variant over-estimated through a winner's-curse effect — [arXiv 2003.10378](https://ar5iv.labs.arxiv.org/html/2003.10378)
- NTBEA was reported as "competitive" against SMAC and other optimisers when tuning rolling-horizon agents in Planet Wars — [arXiv 1901.00723](https://arxiv.org/abs/1901.00723)
- It was used to tune MCTS parameters across the 8 TAG tabletop games, and those optimised parameters were the most interpretable way of characterising the games — [Visualising Multiplayer Game Spaces](https://ar5iv.arxiv.org/html/2202.05773). It also tuned agents across 20 GVGAI games — [arXiv 2003.12331](https://arxiv.org/pdf/2003.12331v1)
- In self-adaptive MCTS for general game playing, NTBEA was the best-performing online allocation strategy for tuning parameters — [Maastricht](https://cris.maastrichtuniversity.nl/en/publications/self-adaptive-monte-carlo-tree-search-in-general-game-playing/)

**CMA-ES and ES under noise**
- CMA-ES noise handling uses re-evaluation (averaging repeated evaluations, the most common approach), larger or adaptive population size, and learning-rate adaptation. Recent work adapts the number of re-evaluations: AR-CMA-ES and RA-CMA-ES — [arXiv 2409.16757](https://arxiv.org/html/2409.16757v3); [arXiv 2405.11471](https://ar5iv.labs.arxiv.org/html/2405.11471)
- I found no game-AI budget numbers for CMA-ES.

**Racing (irace / F-Race)**
- irace samples many configurations and runs races, eliminating candidates once a statistical test (Friedman or t-test) shows a significant difference.
  - --first-test defaults to 5 instances before the first elimination, and --each-test defaults to 1.
  - It supports non-deterministic targets — [irace docs](https://search.r-project.org/CRAN/refmans/irace/html/irace.cmdline.html)
- A 2022 study found no universal winner between Friedman and t-test races under undersampling, and Friedman races performed poorly on some functions — [arXiv 2204.09353](https://arxiv.org/pdf/2204.09353)

### Inferences
- **Noise arithmetic (my calculation).** A binomial standard error at p = 0.15 is √(0.15·0.85/n).
  - With n = 40 seat-games that is about 0.056, a 95% CI of about ±11 percentage points. The 18% versus 8% swing is therefore consistent with pure noise.
  - Detecting a 3-point change in win share needs on the order of 500-1,000+ seat-games per arm.
  - One-at-a-time 10-game challengers cannot resolve the effects most weight tweaks produce.
- **Recommended setup at 50-300 games:**
  - Discretise each weight to 3-5 values.
  - Run NTBEA with one game per evaluation and k ≈ 1. Reward each tuned seat with win = 1, loss = 0. A finer reward such as rank, or margin to the winner, gives lower variance.
  - Use 2-3 short runs of about 100 games each, then spend about 100+ games re-evaluating the 2-3 recommended settings against the standard table.
  - This is cheap to implement in JS: roughly 150 lines with a Map keyed by tuple-index strings.
- **Variance reduction to use regardless of optimiser:**
  - Seat all candidate variants in the same game. With 5 seats, one game evaluates several variants at once.
  - Use common random numbers: the same seeds for the deck shuffle and other random draws across compared arms.
  - Rotate seats.
  - Use a finer reward than win/loss.
  - These are the RSPSA ideas (common random numbers, antithetic variates), and in a 5-player game they can multiply the effective sample size.
- **SPSA is a poor fit here.** It is dimension-free, but each iteration's signal at 2 games is tiny. Chess runs use tens of thousands of games, so with 300 games it would mostly random-walk.
- **Other methods:**
  - CLOP is similar in cost to SPSA.
  - Bayesian optimisation or SMAC with a heteroscedastic GP is plausible with about 15 dimensions and 300 noisy points, but is harder in JS.
  - A (1+1)-ES with re-evaluation is essentially our current challenger method, and suffers the same noise.

### Gaps
- No source gave CMA-ES or Bayesian-optimisation game counts for game-bot tuning at our dimensionality. The full text of 1901.00723, which compares SMAC and other optimisers, was not read.
- No source found on NTBEA with 15 parameters at a 300-game budget. The largest documented case is 8 parameters with 1k-20k evaluations.

## Learning the evaluation from logs (Texel tuning, TD learning, logistic win probability, calibration)

### Takeaway
Our logs already support Texel-style tuning. Fit a logistic or softmax model from state features to final outcome over all logged positions, without playing new games. Then recalibrate the bots' win-chance predictions with temperature, Platt or isotonic scaling fitted on held-out games. Expect correlation-not-causation artefacts, and validate any new evaluation by actual play.

### Cited Findings
- **Texel's method:**
  - It minimises the mean squared error between game result R ∈ {0, ½, 1} and sigmoid(K·q), where q is the quiescence score. K is fitted once (K = 1.13 then) and fixed.
  - Data: about 64,000 fast games, about 8.8M positions (about 140 per game). Opening-book and mate-score positions were excluded.
  - Optimiser: local search adjusting one integer ±1 at a time, about 400 parameters. Gauss-Newton or conjugate gradient also work.
  - Gain: about +99.6 Elo cumulative, measured over 32,000 games.
  - The largest single gain (+39.4) came from changing which positions were included.
  - Pitfalls: correlation is not causation; the engine cannot learn what it cannot already exploit; values can be unintuitive; positions within a game are not independent; the evaluation must be deterministic — [CPW: Texel's Tuning Method](https://www.chessprogramming.org/Texel%27s_Tuning_Method)
- TD-Gammon learned a neural-net evaluation from self-play outcomes with TD(λ), with no expert labels. The top version (2.1) used about 1.5M self-play games to reach near top-human level — [Tesauro 1995](https://www.ece.uvic.ca/~bctill/papers/learning/Tesauro_1995.pdf); [Wikipedia](https://Www.wikipedia.org/wiki/TD-Gammon)
- Pollack and Blair (1996) showed that simple hill-climbing on a similar network was also competitive. They argued backgammon's dice-driven self-play dynamics explain much of TD-Gammon's success — [Pollack & Blair NIPS](https://cgi.cse.unsw.edu.au/~blair/pubs/1997PollackBlairNIPS.pdf)
- Guo et al. (ICML 2017) found modern neural nets poorly calibrated. Temperature scaling, a one-parameter version of Platt scaling fitted by likelihood on held-out data, was often the most effective fix. ECE is the standard metric — [Guo et al.](https://proceedings.mlr.press/v70/guo17a.html)
- ECE estimators can be strongly biased, and many variants exist — [arXiv 2106.07998](https://arxiv.org/pdf/2106.07998)

### Inferences
- **Calibration fix (cheap in JS).** Fit predicted win chances to outcomes on held-out games with multinomial logistic regression over 5 seats, or with one temperature parameter T applied as p_i ∝ exp(logit_i/T).
  - Fit T per round bucket, since the over-confidence is late-round specific.
  - Isotonic regression needs more data; at around 100s of games, temperature or Platt is safer.
  - Check with reliability diagrams and Brier score or log-loss per round.
  - My caveat: over-confidence from shallow play-outs may also mean the rollout policy is too deterministic, so the play-outs undersample opponents' good replies.
- **Texel-style fit for persona weights.** From roughly a few hundred games × 5 seats × rounds × decisions, regress final outcome (win, or rank) on evaluation features.
  - This sets eval weights. It does not set behavioural persona weights such as jitter or commit, which only play can tune.
  - Positions within a game are correlated, so split train and test by game.
  - The largest Texel gain came from data selection, which suggests careful choice of which rounds to include.
- **Not worth it at our scale.** TD learning and small neural nets need far more games than we can play: TD-Gammon used 1.5M. A linear or logistic model is the realistic choice.

### Gaps
- No source compared Platt and isotonic scaling specifically for game win-probability models, or for multiplayer outcomes.

## Self-play pitfalls in multiplayer games and evaluating against mixtures (non-transitivity, leagues, PSRO, Nash averaging, ratings)

### Takeaway
Tuning against the current standard table overfits to it. Each profile "wins" by exploiting that field, as our backers/trophy see-saw shows. The established remedies are:
- evaluate against a pool or mixture of past and current opponent profiles (an AlphaStar-style league, with prioritised sampling of opponents the candidate struggles against);
- add dedicated exploiter variants that hunt weaknesses;
- rate with Nash averaging or TrueSkill rather than win share against one field.

### Cited Findings
- AlphaStar league:
  - Main agents train against themselves and the whole league via prioritised fictitious self-play (PFSP), which weights opponents by how often they beat the agent.
  - Main exploiters train only against current main agents to expose weaknesses. They are added to the pool and reset.
  - League exploiters find blind spots of the whole league.
  - PFSP alone was insufficient for robust strategies, which is why the exploiters were needed. The extra agent types greatly increased compute — [DeepMind blog](https://deepmind.google/discover/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/); [Self-play survey arXiv 2408.01072](https://arxiv.org/pdf/2408.01072); [TStarBot-X](https://arxiv.org/pdf/2011.13729)
- Nash averaging (Balduzzi, Tuyls, Perolat, Graepel, NeurIPS 2018) evaluates agents against the Nash-equilibrium mixture of the agent-vs-agent payoff matrix. It is invariant to redundancy: adding copies of weak agents or easy tasks does not bias the result, so it encourages maximally inclusive evaluation. The paper also proposes multidimensional Elo (mElo) for non-transitive cases — [NeurIPS paper](https://papers.nips.cc/paper/7588-re-evaluating-evaluation); [arXiv 1806.02643](https://ar5iv.labs.arxiv.org/html/1806.02643)
- TrueSkill handles any number of players and teams via message passing on a factor graph. Microsoft's table gives minimum games per player to identify skill: 5 for 4-player free-for-all, 3 for 8- or 16-player, and 12 for 1v1. Real requirements can be up to 3× higher with high per-game variance — [Wikipedia: TrueSkill](https://en.wikipedia.org/wiki/TrueSkill); [MS Research](https://www.microsoft.com/en-us/research/publication/trueskilltm-a-bayesian-skill-rating-system/)
- In Hearthstone deck-space evolution, decks evolved against first-generation evolved decks still did well, which suggested some transitivity in that space — [NJIT: Exploring the Hearthstone deck space](https://researchwith.njit.edu/en/publications/exploring-the-hearthstone-deck-space/)

### Inferences
- **A cheap league for us:**
  - Keep a pool of frozen profile versions (old standards plus the best variants of each tuning pass).
  - Seat each candidate in games where the other 4 seats are sampled from the pool. Weight the sampling toward pool members that beat the candidate (PFSP).
  - Accept a change only if it gains against the pool, not just against the current table.
  - Payoffs: for N profiles, a matrix of win share per seat (head-to-head or by table composition). Nash averaging is a small LP, or a replicator-dynamics loop in JS.
- **Ratings.** TrueSkill implementations exist in JS (e.g. the npm "ts-trueskill"; unverified). With 5 seats per game, ratings settle in tens of games per profile, but cannot capture cycles. mElo or Nash averaging can.
- **Detecting overfitting.** Cyclic results, where A > B > C > A across table compositions, are the signal that the standard-table tuning is overfitting.

### Gaps
- I did not fetch Lanctot et al.'s PSRO paper directly. PSRO generalises the league idea: iteratively add best responses to a meta-strategy mixture over the population. Details and budgets are unverified here.
- No source found quantifying non-transitivity specifically in 5-player Euro or area-control board games.

## Opponent modelling (inferring other players' goals/types) in multiplayer games

### Takeaway
Bayesian inference over a small set of opponent types has shown gains in multiplayer imperfect-information games. In Prob-maxn, the bot keeps a posterior over opponent models and plugs it into n-player search; in Spades it beat maxn and soft-maxn against unknown opponents. Ganzfried et al. beat real opponents and Nash strategies in 3-player Kuhn poker. For us, the types map naturally to which ending each opponent pursues (trophy versus backer of faction X).

### Cited Findings
- Prob-maxn adds probabilistic opponent models to n-player maxn search and learns them during play via Bayesian inference. In Spades it outperformed maxn and soft-maxn against unknown opponents — [Sturtevant et al., Prob-Maxn](https://webdocs.cs.ualberta.ca/~nathanst/papers/probmaxn.pdf)
- Ganzfried et al. build Bayesian opponent models from repeated observations, for any number of opponents. In 3-player Kuhn poker their agent beat a range of real opponents and exact Nash strategies. An earlier two-player Bayesian best response over Dirichlet priors performed best among the response methods it was compared with — [arXiv 2212.06027](https://arxiv.org/pdf/2212.06027); [arXiv 1207.1411](https://arxiv.org/abs/1207.1411)
- A 2024 paper models opponents as types with Bayesian beliefs, samples types from the posterior inside CFR, and updates the posterior from play — [arXiv 2405.14122](https://arxiv.org/pdf/2405.14122)

### Inferences
- **A cheap version for us.** Maintain P(type | observed moves) for each opponent over {trophy, backer-faction-1..k}. Use likelihoods from logged move frequencies per type; our logs already label profiles, so this is a simple naive-Bayes count table.
  - Use the posterior in play-outs (sample opponent profiles) and in threat or protect decisions.
  - Measure the effect with the same mixed-seat evaluation. Bluffing means the likelihood model should be fitted against bots that bluff.

### Gaps
- No source measured the gain from opponent-type inference in a 5-player area-control or drafting game specifically.

## Balancing two very different strategies so both are played near their optimum

### Takeaway
The balancing literature (mostly Hearthstone) first makes each archetype strong with search, then compares win rates. A balance judgement is only meaningful if each archetype bot is near its best response. Tune each profile against a diverse field, including the other archetype's strongest versions, and re-check with exploiters. Do not alternate one-sided tweaks against a single standard table.

### Cited Findings
- Evolving the Hearthstone Meta (de Mesentier Silva et al. 2019) measures matchup win rates for decks played by different strategy agents. It then evolves card-attribute changes that bring matchups toward 50%, favouring minimal disruption — [NJIT](https://researchwith.njit.edu/en/publications/evolving-the-hearthstone-meta/)
- Treating balance as full optimisation is likely intractable in large deck spaces. A practical alternative: search for strong decks using a proposed new card, and nerf the card if the best deck is too strong. This is a best-response check — [The Many AI Challenges of Hearthstone](https://arxiv.org/pdf/1907.06562)
- Jaffe et al. assess balance by comparing standard agents with restricted agents, for example ones forbidden a strategy, which helped balance an educational card game — [Hearthstone deck-space search results summary; Jaffe et al. cited via](https://arxiv.org/pdf/1907.06562)
- MAP-Elites has been used to map the Hearthstone deck space across strategy dimensions, keeping a diverse set of strong decks per niche — [arXiv 1904.10656](https://arxiv.org/pdf/1904.10656)

### Inferences
- **Procedure for us:**
  - For each profile, run its own NTBEA with the other seats sampled from a pool containing strong versions of both profiles.
  - Then run a "best-response check": a short NTBEA for each profile against the newly tuned other. If either gains a lot, the balance reading was not at equilibrium.
  - Report win share per seat with confidence intervals (see the noise arithmetic in section 1). With about 200 games, a 95% CI is about ±5 percentage points, so "even at 20%" claims from 40 games are not distinguishable from a 10-point gap.
- **A restricted-agent test.** Compare a profile allowed both endings with one restricted to a single ending. This tests whether each ending is viable, following Jaffe's restricted-agent idea.

### Gaps
- I did not verify the Jaffe et al. original (cited only via the Hearthstone challenges paper). No source found on two-archetype balancing in multiplayer board games with alternative victory conditions.

## Practical recipes from chess, poker, and the TAG framework

### Takeaway
Chess's workflow is the clearest recipe: tune with SPSA, then gate every change with an SPRT match. Its budgets do not transfer to our scale. The TAG/QMUL tabletop work transfers better, with NTBEA plus final re-evaluation. Poker bots add variance reduction (RSPSA) and opponent modelling.

### Cited Findings
- Fishtest workflow:
  - SPSA tunes over a fixed total number of games.
  - Results are validated by SPRT tests at short and long time controls, e.g. 35k-game tunes validated at +1.9 to +3 Elo.
  - Non-regression bounds are [−1.75, 0.25] Elo — [Fishtest wiki](https://github.com/official-stockfish/fishtest/wiki/Creating-my-first-test); [open-chess.org](https://open-chess.org/viewtopic.php?p=34292)
- Kiiski: choosing which variables to tune is critical, and shared bias and amplitude knobs beat per-entry tuning — [CPW](https://chessprogramming.org/Stockfish%27s_Tuning_Method)
- TAG: NTBEA-optimised MCTS parameters across 8 tabletop games — [arXiv 2202.05773](https://ar5iv.arxiv.org/html/2202.05773). The PyTAG MCTS baseline is untuned per game — [PyTAG](https://arxiv.org/pdf/2405.18123)
- RSPSA for poker and LOA: common random numbers plus antithetic variates — [CPW: SPSA](https://www.chessprogramming.org/SPSA)

### Inferences
- **Concrete budget plan for one profile (about 300 games, about 8 hours on 8 cores):**
  1. About 30 games of baseline, with seeds fixed, to estimate variance.
  2. 2 NTBEA runs × 80 games, with 3-4 levels per weight. Tune only the 5-8 weights most likely to matter, freezing the rest, as Kiiski advises.
  3. About 100 games re-evaluating the top 2-3 recommendations plus the standard, all seated together, against a pool field.
  4. Adopt a change only if its CI excludes the standard. Otherwise keep it as a candidate.
- **SPRT is cheap in JS:** a likelihood-ratio sum over wins and losses. It suits accept/reject gating, but at our effect sizes it will often run to the cap without deciding.

### Gaps
- I did not obtain fishtest's standard SPRT gainer bounds (they are shown only as images on the wiki), or typical current SPSA game counts beyond the cited 35k example.
- No Hearthstone AI competition parameter-tuning papers were reviewed in detail.
