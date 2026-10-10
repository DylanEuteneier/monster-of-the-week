# Statistics for bot-vs-bot experiments and card-strength measurement with few, noisy games

Scope: variance reduction, sequential testing, multiplayer win-share statistics, card-strength metrics and calibration, applied to Monster of the Week (5 players, random 21-card deck per game, random deals, hidden information, about 13 core-minutes per game, 8 cores, typical runs of 10 to 50 games).

Note on sourcing: everything under "Cited Findings" carries a source. Arithmetic I did myself (sample sizes, standard errors for MotW's numbers) is under "Inferences" and is marked as my own calculation. Standard textbook formulas (binomial standard error, the normal-approximation sample-size formula) are used without a source and are flagged as such.

---

## 1. Common random numbers, paired seeds, duplicate formats and seat rotation

### Takeaway
Replaying the same deals with the seats swapped (duplicate) is the standard first-line variance reduction in computer poker and chess engine testing. Analysing the results per pair or block, not per game, is what turns the correlation into fewer games: chess testing reports about 20% fewer games from pentanomial (pair) statistics alone. For MotW the analogue is a "duplicate block": one seed played 5 times with the challenger rotated through every seat, scored as one observation.

### Cited Findings
- Duplicate poker is "a simple variance reduction technique that attempts to mitigate the effects of luck" and is "widely used in the Annual Computer Poker Competitions." Agents play a block of hands, swap seats, and replay the same deals. — [OpenHoldem benchmark paper (arXiv 2012.06168)](https://arxiv.org/pdf/2012.06168)
- University of Alberta's competition paper describes a match pair in which the same card sequence is dealt with the seats reversed. A bot's performance over a duplicate match pair can have lower variance than over two independent matches. Bots were reset after each match so they could not remember the deals. — [AAMAS13 baseline paper, U. Alberta](https://www.cs.ualberta.ca/~games/poker/publications/AAMAS13-baseline.pdf); see also [Zinkevich, competition paper](https://www.martin.zinkevich.org/publications/competition.pdf)
- Replaying the same deals requires agents that cannot learn or predict the chance events across replays, which is a problem with human players. — [OpenHoldem (arXiv 2012.06168)](https://arxiv.org/pdf/2012.06168)
- In human duplicate poker, a seat rotation had to be developed so that players move to different seats against different opponents between rounds, and each player is scored relative to others who held the same cards. — [MatchPoker / B.J. Altshuler](https://matchpoker.com/?p=1486)
- One commentator suspects that even duplicate poker "has a huge variance in outcomes over such a short time horizon," though without calculations. This is opinion, not measurement. — [Freakonomics blog](https://freakonomics.com/2008/07/14/overreacting-to-a-computer-beating-poker-pros/)
- In chess, engines play game pairs from the same opening with colours reversed. The independent-games (trinomial) model "is not correct for paired games with reversed colors and unbalanced openings" because the paired outcomes are correlated, so it overestimates variance and the number of games needed. The suggested replacement is a 5-outcome model of pair scores (0, 0.5, 1, 1.5, 2) with probabilities estimated from pair frequencies. A non-parametric jackknife can check the variance. — [Chess Programming Wiki, Match Statistics](https://www.chessprogramming.org/Match_Statistics)
- Van den Bergh's simulator: "the trinomial model overestimates elo confidence intervals." The gap comes from opening-book bias (both its average and its variation). In one setting (elo = 10, elo1 = 10, draw_elo = 327) the trinomial SPRT passed 0.968 and needed 2191 expected games, against 0.950 and 1809 games for the pentanomial, so the trinomial version takes about 20% longer. — [vdbergh/pentanomial (GitHub)](https://github.com/vdbergh/pentanomial)
- Fishtest data records the pentanomial counts of game pairs as (LL, LD, DD, WD, WW). — [Reckless wiki, Progress Tracking](https://github.com/codedeliveryservice/Reckless/wiki/Progress-Tracking)

### Inferences
- **Recipe: the 5-seat duplicate block (my design, adapted from the poker and chess practice above).** For each seed s, play 5 games. In game j the challenger sits in seat j, the standard bot fills the other 4 seats, and deck, deals and every other random draw are identical. The block score is B_s = (number of the 5 games the challenger won) / 5, or the mean of its rank scores. Compare with the expected share of 0.2 for one challenger seat. Treat the B_s values as i.i.d. observations and use their sample standard deviation (the pentanomial idea generalised: the block, not the game, is the unit). The same rule as chess applies: a per-game binomial standard error overstates the noise for this design, and per-block is correct.
- **What it removes.** Seat-order advantage and deck or deal luck that favours one seat cancel within a block. Luck that comes from the random 21-card deck matters too. If some decks favour the challenger's style, that is real signal and is averaged over seeds, not removed. Because MotW bots search with randomness, the same seed does not guarantee the same game once any decision differs. Common random numbers pay off most when the RNG streams are split by purpose (deck build, round deals, bot search), so a different decision does not shift every later deal. This is the standard advice for common random numbers. I did not find a game-specific source.
- **Baseline block.** Also play the seed with 5 standard bots (or use the standard bot's results on the same seeds) and score the challenger's block against the standard bot's results in the same seats. This is the "scored relative to others who held the same cards" rule from duplicate poker, and it removes seat effects even when 20% per seat is not the true baseline (for example, when the invaders' ending removes some wins from all seats).
- **Cost.** A block costs 5 games, about 65 core-minutes, so 8 cores run about 7.4 blocks an hour (my arithmetic: 8 × 60 / 65). The gain depends on how much of the variance is seat or deal luck. That has to be measured: run about 10 blocks and compare the variance of B_s with the binomial variance p(1-p)/5 that independent games would give. The ratio is the effective sample-size multiplier.
- **Existing MotW challenger runs.** Putting a variant "in some seats" with the same seeds across variants is already common random numbers across variants. The variance reduction is only realised if the analysis pairs results by seed (difference per seed, then the standard deviation of the differences), not if it compares two pooled win rates.

### Gaps
- I found no published figure for how much variance duplicate or seat rotation removes in 3+ player games or in board games. The poker sources give it qualitatively for heads-up play. The only number found is about 20% fewer games for pentanomial over trinomial in chess. MotW must measure its own ratio.
- I did not retrieve the current ACPC rulebook's exact multi-player duplicate rotation (ACPC also ran 3-player Kuhn and Limit). The details are unverified.

---

## 2. Control variates and baselines (CUPED, DIVAT, MIVAT, AIVAT, luck adjustment)

### Takeaway
Subtract a zero-mean "luck" term built from a value estimate. A pre-treatment covariate (CUPED) cuts variance by a factor of (1 - ρ²). AIVAT-style corrections at chance nodes (and at decision nodes whose strategy is known) are provably unbiased however bad the value function is, and cut standard deviation by about 68% in heads-up no-limit hold'em, about 10x fewer games. The bots' own predicted win chance can serve as the value function, and its over-confidence then costs only efficiency, not bias.

### Cited Findings
- **CUPED / regression control variate.** Adjusted outcome Y_adj = Y − θ(X − X̄), with optimal θ = Cov(Y, X)/Var(X) (the OLS slope). The variance becomes Var(Y)(1 − ρ²), where ρ is the correlation between X and Y. — [r-statistics.co CUPED lesson](https://r-statistics.co/Variance-Reduction-with-CUPED.html); [Statsig CUPED docs](https://docs.statsig.com/statsig-warehouse-native/features/statistics/methodologies/cuped)
- Estimate θ on pooled data or on the control arm, not separately per arm. Fitting it per arm adds a small bias proportional to the treatment-induced difference in covariate means. — [r-statistics.co CUPED lesson](https://r-statistics.co/Variance-Reduction-with-CUPED.html)
- Statsig notes that a θ pooled across groups does not always reduce variance for every group, though in most cases it does. — [Statsig CUPED docs](https://docs.statsig.com/statsig-warehouse-native/features/statistics/methodologies/cuped)
- **AIVAT estimator** (Burch, Schmid, Moravčík, Morrill, Bowling, AAAI 2018): AIVAT(z) = Base(z) + Σ_H k_H(z). For each chance or known-strategy decision point H that the game passed through, k_H is the probability-weighted average of the value estimates u_h(a) over all actions or outcomes, minus the value of the action that actually occurred. Each k_H has expectation zero, so the estimator is unbiased for any value function u. A bad u only raises variance. The known-strategy set must include the chance player. — [AIVAT, arXiv 1612.06915 (ar5iv)](https://ar5iv.arxiv.org/html/1612.06915); [AAAI version](https://ojs.aaai.org/index.php/AAAI/article/view/11481)
- **Lineage:** DIVAT (Zinkevich et al. 2006) uses value estimates as control variates for chance events and needs every player's strategy. MIVAT (White and Bowling 2009) generalises it to arbitrary value functions but corrects only chance events. AIVAT adds corrections for actions by players with known strategies and an "imaginary observations" average over private information. — [AIVAT (ar5iv)](https://ar5iv.arxiv.org/html/1612.06915)
- **Measured reductions, heads-up no-limit hold'em (1M games), standard deviation in chips → estimator:** self-play 25.96 → MIVAT 21.29 → MIVAT+imaginary observations 16.07 → AIVAT 8.10. Dissimilar agents: 26.31 → AIVAT 8.30. That is about a 68–69% cut in standard deviation, more than 10x fewer games. — [AIVAT (ar5iv)](https://ar5iv.arxiv.org/html/1612.06915)
- **Leduc hold'em:** self-play standard deviation 3.513 → AIVAT 0.0038–0.0064 (about 99.8%). For dissimilar agents, 5.761 → 1.437–2.983 (48–75%). MIVAT alone gave 25–34%. — [AIVAT (ar5iv)](https://ar5iv.arxiv.org/html/1612.06915)
- In the AAAI version, AIVAT cut the standard deviation of a human-vs-machine no-limit match by 85%, about 44x fewer games. That figure is specific to that match. — [AAAI 2018 paper](https://ojs.aaai.org/index.php/AAAI/article/view/11481)

### Inferences
- **Recipe A, CUPED on a pre-treatment covariate (simplest, works today).** For each (game, challenger seat), let X = the standard bot's predicted win chance for that seat right after the deck and first deal, computed before any variant decision (so the treatment cannot affect it). Let Y = 1 if that seat won, else 0. Fit θ = Cov(Y, X)/Var(X) on all seat-games pooled over both arms, and analyse Y − θ(X − X̄). If the opening prediction correlates ρ = 0.3 with the result, variance falls by 9%; at ρ = 0.5 it falls by 25% (my arithmetic from 1 − ρ²). The opening position in a 5-player game probably predicts the result only weakly, so expect modest gains. Measure ρ first.
- **Recipe B, AIVAT-lite at chance nodes (larger gains, more engineering).** At each chance event c (deck build, each round's deal, each random draw), with V the standard evaluator's predicted win chance for the challenger seat, add k_c = E_outcome[V(after c)] − V(after observed outcome). Estimate the expectation by re-sampling a few outcomes of c from the same pre-event state, without playing them out. The sum over chance events is the "luck" the challenger received, and subtracting it is unbiased by the AIVAT lemma, even though V is over-confident in late rounds. The cost is about (number of chance events) × (samples) evaluator calls, not full playouts. Hidden information: V must be computed from information that does not depend on the variant's own choices, or from a fixed reference evaluator, to stay inside the AIVAT conditions.
- **Decision-node corrections** need an explicit strategy (action probabilities). MotW's search bots are not given as explicit mixed strategies, so the action terms probably apply only to the standard (non-challenger) seats, if their search can output action probabilities. This is optional. Chance-node correction alone is the MIVAT part, which gave 18–34% standard deviation cuts in poker.
- **Advantage form for the card probes:** the probe's "play card vs skip" difference on shared seeds is already a paired, common-random-numbers advantage estimate. Adding a chance-node luck correction to each rollout would cut the rollout noise further.

### Gaps
- I found no published application of AIVAT or MIVAT to multiplayer (more than 2 players) board games, nor numbers for the variance cut there.
- Whether the bots' predicted win chance correlates well enough with outcomes to give a useful ρ is an empirical MotW question.

---

## 3. Sequential testing: SPRT, pentanomial, early stopping, Bayesian A/B, racing

### Takeaway
The chess engine SPRT is a direct recipe: pick two hypotheses (no gain vs a gain worth having), update a log-likelihood ratio after every game pair, and stop at a bound fixed by α and β. For picking the best of several variants with few games, racing (F-race, Hoeffding races) or successive halving drops clear losers early and spends the games on close contenders.

### Cited Findings
- **SPRT LLR, normal (GSPRT) approximation, as in the Chess Programming Wiki code.** N = W + D + L, s = (W + D/2)/N, m2 = (W + D/4)/N, var = m2 − s², var_s = var/N. With s0, s1 the expected scores under H0 and H1: LLR = (s1 − s0)(2s − s0 − s1)/(2·var_s). Bounds: lower = ln(β/(1−α)), upper = ln((1−β)/α). Accept H1 if LLR > upper, accept H0 if LLR < lower, otherwise keep playing. — [Chess Programming Wiki, Match Statistics](https://www.chessprogramming.org/Match_Statistics)
- **LOS (likelihood of superiority)** = Φ((W − L)/√(W + L)). Draws drop out. — [Chess Programming Wiki, Match Statistics](https://www.chessprogramming.org/Match_Statistics)
- Typical fishtest-style bounds: gainer tests use elo0 = 0, elo1 = 5 (also [0, 2], [0.5, 2.5], [0, 10]). Non-regression tests use [−5, 0] or similar. Bounds are looser for weaker engines. Set a very large game cap so the test stops on the bound, not on the cap. — [Chess Programming Wiki, SPRT](https://www.chessprogramming.org/Sequential_Probability_Ratio_Test)
- Fishtest's SPRT is a generalized SPRT with a discrete-time overshoot correction (Siegmund). The pentanomial version is about 20% faster than the trinomial one and holds the nominal error rate, where the trinomial version overshoots (0.968 vs 0.95). — [vdbergh/pentanomial](https://github.com/vdbergh/pentanomial)
- "Normalized Elo" removes the draw rate: in the simple case nElo = Elo/√(1 − draw_rate). It is meant to make test bounds comparable across draw rates. — [Reckless wiki](https://github.com/codedeliveryservice/Reckless/wiki/Progress-Tracking)
- **F-Race:** run all surviving configurations on the same sampled instances (blocking). After each round, a Friedman (rank-based) test checks for differences, and inferior configurations are dropped by pairwise tests. Implemented in irace (Iterated F-Race). — [F-race and iterated F-race overview](https://impact.ornl.gov/en/publications/f-race-and-iterated-f-race-an-overview/); [arXiv 2204.09353](https://arxiv.org/pdf/2204.09353)
- **Hoeffding races** (Maron and Moore): each new test point is evaluated by every remaining model. A model is dropped when its confidence interval lies wholly below a better model's. Paired t-tests are a tighter variant. — [Fast Cross-Validation via Sequential Testing, arXiv 1206.2248](https://arxiv.org/pdf/1206.2248)
- **Successive halving** also counts the resources spent per configuration. Hyperband runs several successive-halving brackets with different starting budgets. — [arXiv 2204.09353](https://arxiv.org/pdf/2204.09353); [Hyperband overview](https://api.emergentmind.com/topics/hyperband)

### Inferences
- **Recipe: SPRT for a MotW challenger (my adaptation).** Unit = one 5-seat duplicate block (section 1) with score B in [0, 1], baseline 0.2. H0: mean B = 0.20 (no gain). H1: mean B = 0.25 (a 5-point gain worth adopting). Use the normal GSPRT form with the block variance: LLR = (μ1 − μ0)(2·B̄ − μ0 − μ1)·n/(2·σ̂²), where σ̂² is the sample variance of the block scores. This is the wiki formula with var_s = σ̂²/n. With α = β = 0.1 the bounds are ±ln(9) ≈ ±2.20. With α = β = 0.05 they are ±2.94. Re-evaluate after each block. Run 8 blocks in parallel and check only after whole batches, which slightly lowers the error rates. Use a minimum of about 5 blocks before trusting σ̂.
- **Expected length (my rough calculation).** For a normal SPRT, the expected sample size near H0 or H1 is about 2·ln((1−β)/α)·σ²/(μ1−μ0)². With per-block σ² ≈ 0.2·0.8/5 = 0.032 (independent-game worst case), δ = 0.05 and α = β = 0.1: about 2·2.2·0.032/0.0025 ≈ 56 blocks ≈ 280 games. Any variance cut from duplicate or control variates shrinks this proportionally. A fixed-sample test of the same power needs more on average. That SPRT is roughly half the fixed-sample cost is a textbook result, not from a source above.
- **Non-regression mode.** When a change is meant to simplify, not improve, use H0: −5 points vs H1: 0, as fishtest does for simplifications.
- **Bayesian alternative (textbook, no source retrieved).** Put a Beta(a, b) prior on the challenger's per-seat win rate. Update with wins and losses per seat-game, and report P(p > 0.2). This is easy, but it treats seat-games as independent and ignores the pairing, so prefer a normal posterior on block-level differences.
- **Choosing among k variants:** race them. Every surviving variant plays the same seeds in duplicate blocks. After every batch of, say, 8 blocks, rank the variants within each seed (the Friedman test), drop those clearly worse, and continue. With few games, a frequentist cut-off is weak, so drop a variant only when it is behind on paired differences by more than about 2 standard errors. This fits the "remove any profile that measures clearly worse" practice.

### Gaps
- I did not retrieve Van den Bergh's random_walks.pdf formulas for the expected duration of the pentanomial GSPRT. The expected-length estimate above is my normal approximation.
- I found no source on SPRT for multiplayer win share specifically.

---

## 4. Statistics for more than 2 players: win share, ranks, Plackett–Luce, TrueSkill, confidence intervals, sample sizes

### Takeaway
The per-seat win share is a binomial proportion with a large standard error at 20%. Detecting 20% → 25% with independent seat-games needs on the order of 500 challenger seat-games against a known 20% baseline, and about 1,100 per arm for two estimated rates. MotW's observed 18% vs 8% swings are about what this noise predicts. Rank or score-based outcomes and Plackett–Luce use more information per game than win-or-lose.

### Cited Findings
- Logistic (Elo) win probability for n players: E_i = 10^(R_i)/Σ_j 10^(R_j) (ratings on a log10 scale). For two players, E = 1/(1 + 10^(−Δ/400)). — [Chess Programming Wiki, Match Statistics](https://www.chessprogramming.org/Match_Statistics)
- Plackett–Luce extends Bradley–Terry from pairwise to multi-entity rankings. It has been applied to multiplayer board and card games. — [Yeung, Kaiser, Radicchi, Phys. Rev. E 112, 014305 (2025)](https://homes.luddy.indiana.edu/filiradi/Mypapers/PhysRevE112_014305.pdf); [arXiv 2501.16565](https://arxiv.org/pdf/2501.16565)
- OpenSkill (a Bayesian multiplayer rating library) makes Plackett–Luce the default for 3 or more teams because it scales best. Its authors say full-pairing Bradley–Terry and Thurstone–Mosteller need costly (k−1)-dimensional integration, and claim accuracy on par with TrueSkill (developer claim). — [OpenSkill README](https://cdn.jsdelivr.net/npm/openskill@4.1.1/README.md); [OpenSkill JOSS paper](https://joss.theoj.org/papers/10.21105/joss.05901.pdf)
- Janzert's Halite report compared TrueSkill with a Plackett–Luce model fitted by minorization–maximization on about 95,000 free-for-all games of 2 to 6 players. I did not retrieve which predicted better. — [Halite rating report](https://janzert.com/halite/rating-report)

### Inferences (my calculations; standard formulas)
- **Standard error of a seat's win share:** SE = √(p(1−p)/n), with n = challenger seat-games. At p = 0.2: n = 40 → SE 6.3 points; n = 48 → 5.8; n = 200 → 2.8. An 18% result (40 games) against an 8% result (48 games), if each is one seat per game, differ by 10 points with an SE of the difference of about √(0.18·0.82/40 + 0.08·0.92/48) ≈ 7.2 points. That is about 1.4 SE, consistent with noise. If the challenger fills several seats per game, the seat-games within a game are negatively correlated (only one seat can win). Pool them per game: (wins by challenger seats)/(challenger seats).
- **Interval:** use the Wilson interval for small n. A 95% interval for 8 wins in 40 seat-games (20%) is roughly 10%–35%.
- **Sample size to detect +5 points (normal approximation, α = 0.05 two-sided, power 0.8, z-sum = 2.80).**
  - Against the known 20% baseline (one-sample): n ≈ (1.96·√0.16 + 0.84·√0.1875)²/0.05² ≈ 527 challenger seat-games.
  - Two estimated arms (unpaired): n ≈ 2.80²·(0.16 + 0.1875)/0.0025 ≈ 1,090 seat-games per arm.
  - With the challenger in 2 seats per game: about 260 games for the one-sample case, about 9 hours on 8 cores at 13 minutes a game. A 10-point effect needs about a quarter of that (n scales with 1/δ²).
  - So 10–50 game runs detect only effects of about 10–15 points or more unless variance reduction (sections 1–2) or a denser outcome (below) is used.
- **Denser outcomes:** a rank score (for example, 1st = 1, 2nd = 0.75, ..., 5th = 0) or a final-standing margin carries more information per game than win/lose and usually has a lower relative variance. It is valid only if rank tracks what the designer means by "strength". In a game with one winner, the bot plays to win, not to place, so ranks below 1st may reflect the bot's own priorities. A Plackett–Luce fit over finishing orders across variants (one "player" per bot profile) gives all-variant strength estimates with standard errors from the same games.
- **TrueSkill / OpenSkill** are built for tracking changing skill online. For a fixed set of bot variants, a single batch Plackett–Luce or Bradley–Terry maximum-likelihood fit with bootstrapped confidence intervals (resampling whole seeds/blocks) is simpler and better suited.

### Gaps
- No source found giving empirical variance of rank scores versus win share in multiplayer board games.
- Halite TrueSkill vs Plackett–Luce comparison results were not retrieved.

---

## 5. Measuring card or component strength

### Takeaway
Observational "win rate when drawn" metrics (17Lands GIH WR, IWD) are confounded by game length and by selection. The 17Lands team itself warns that IWD overvalues late-game cards. Counterfactual interventions (add or force a card, compare to a matched control on shared seeds), which MotW's probes already do, are the clean estimand. Restricted-play balance measures (Jaffe et al.) are the formal version of "how much does an agent gain from using X versus being barred from it."

### Cited Findings
- **17Lands definitions (via secondary sources):** GIH WR = win rate of games where a copy was drawn into hand (opening hand or later). GNS WR = win rate of games where the card was in the deck but never seen. Improvement In Hand / IWD = GIH WR − GNS WR. — [arXiv 2604.18314, "Embarrassingly Causal"](https://arxiv.org/pdf/2604.18314); [Star City Games, Using 17Lands](https://articles.starcitygames.com/magic-the-gathering/select/using-17lands-com-as-a-resource-to-improve-at-limited/)
- GIH WR slightly favours cards that are good in long games, especially expensive cards, because long games give more draws. Opening-hand WR gives every card an equal chance to appear regardless of game length, but has its own bias. — [Star City Games](https://articles.starcitygames.com/magic-the-gathering/select/using-17lands-com-as-a-resource-to-improve-at-limited/)
- 17Lands is quoted (via a secondary site) as saying the metric does not weight by the number of games in each situation, which may overvalue powerful late-game cards. — [MTG Rocks](https://mtgrocks.com/best-and-worst-cards-to-draft-in-one-according-to-data/) (secondary; unverified against 17lands.com)
- An academic analysis of 17Lands data names "confounding, selection effects, and post treatment conditioning" as the hazards of causal reading of these metrics. It proposes an "embarrassingly causal" criterion for when the exposure→outcome edge is uncontroversial. — [arXiv 2604.18314](https://arxiv.org/abs/2604.18314)
- **Restricted play** (Jaffe, Miller, Andersen, Liu, Karlin, Popović, AIIDE 2012): balance is measured as the win rate of a deliberately restricted agent (for example, one that is barred from a card or strategy) against a standard agent. Critics note it needs an AI, expert knowledge, potentially expensive simulations, and was built for perfect-information games. — [AIIDE paper](https://ojs.aaai.org/index.php/AIIDE/article/view/12513); [Jaffe dissertation](https://digital.lib.washington.edu/researchworks/handle/1773/22797); [arXiv 2409.07340](https://arxiv.org/pdf/2409.07340)
- **Hearthstone** (de Mesentier Silva et al., CoG 2019): compares decks' simulated win rates across match-ups before and after card changes, and uses an evolutionary algorithm to search for card-attribute changes that push decks toward 50%. A multi-objective version minimises the number of changes. It also proposes heuristics for choosing which cards to target. — [Evolving the Hearthstone Meta, arXiv 1907.01623](https://arxiv.org/abs/1907.01623v1)

### Inferences
- **Bias map for MotW-style metrics (my analysis, following the cited caveats):**
  - "Win rate of games where card X was played": confounded by game length (more turns, more plays), by the bot choosing to play X when already ahead (post-treatment selection), and by deck composition. Biased toward cards that winners can afford to play.
  - "Win rate when X is in the random 21-card deck": randomised by the deck draw, so causal for "presence in the deck", but diluted. Most of the time X is not drawn or played, so the signal is small and many games are needed. A regression of seat outcome on deck-composition indicators (one per card, plus seat) estimates all cards at once from ordinary games. It is unbiased because the decks are random, but with 21 of a larger pool and binary 1-in-5 outcomes, expect wide intervals at tens of games.
  - **Probes (MotW's current method):** a randomised intervention with a paired control on shared seeds, the restricted-play idea applied at the decision level. Main biases: (a) the outcome is the bot's predicted win chance, which is over-confident late (section 6), so late-round probes overstate magnitudes; (b) the insertion state (a random moment, a card added to the hand) is off the natural distribution of when the card would be held, which is the game-length effect of GIH, reversed; (c) only "the rest of the round" is played out, so effects that pay off in later rounds come only through the evaluator's prediction.
- **Probe variance budget (standard nested-variance result).** Var(mean effect) ≈ σ²_state/n + σ²_rollout/(n·r), with n probes and r rollouts per arm. If between-state variance dominates, more probes with r = 1 beats fewer probes with r = 2 at the same cost. Estimate both components from the existing r = 2 data: the within-probe difference between the two rollouts gives σ²_rollout. A card with 16 probes has an SE about 2.5x larger than one with 98 (√(98/16) ≈ 2.5), so give wider intervals or shrink the low-n cards toward the pool mean (empirical Bayes) before ranking.
- **Shapley-style attribution:** no source retrieved. For MotW, the regression on deck composition (with interaction terms only where suspected) is the practical stand-in.

### Gaps
- The 17lands.com metrics page did not render (JavaScript). The definitions come from secondary sources.
- The full text of arXiv 2604.18314 could not be extracted (PDF only), so its specific bias quantifications are not recorded here.
- I found no Dominion-specific (Mahlmann et al.) card-strength methodology in this pass. I did not retrieve HSReplay methodology.

---

## 6. Calibration of the bots' predicted win chance; predicted values vs final outcomes as the response

### Takeaway
Measure calibration with the Brier score and its reliability/resolution decomposition on held-out games, binned by round, because over-confidence differs by round. Fix it with Platt scaling (logistic) or isotonic regression per round. For effect estimation, final outcomes are unbiased but noisy. Predicted values are low-variance but inherit the predictor's bias, unless they are used AIVAT-style as a zero-mean correction, which keeps the outcome unbiased.

### Cited Findings
- Brier = reliability − resolution + uncertainty. Reliability = calibration error, resolution = discrimination, and uncertainty = ō(1−ō) depends only on the base rate. Reliability and resolution are computed by binning, so they depend on the bins (quantile or uniform). — [MetricGate Brier decomposition](https://metricgate.com/docs/brier-score-decomposition/); [nestkit calibration docs](https://nestkit.readthedocs.io/en/stable/api/calibration.html)
- Platt scaling fits a logistic regression on the raw score on held-out data and suits sigmoidal miscalibration (over- or under-confidence). Isotonic regression (pool-adjacent-violators) is a monotone non-parametric map, more flexible but needs more data. Recalibration mainly lowers the reliability term and largely keeps resolution. Fit on held-out data. — [MetricGate, Brier vs log loss vs calibration](https://metricgate.com/blogs/brier-score-vs-log-loss-vs-calibration/); [MetricGate isotonic docs](https://metricgate.com/docs/isotonic-regression-calibration/)
- The decomposition traces to Murphy (1973) and Bröcker (2009). Platt scaling is attributed to Platt (1999). — [arXiv 2603.15232](https://arxiv.org/html/2603.15232v2)
- AIVAT stays unbiased with an arbitrary value function. Miscalibration of the value estimate raises variance but adds no bias. — [AIVAT (ar5iv)](https://ar5iv.arxiv.org/html/1612.06915)

### Inferences
- **Recipe: calibration check.** Log (round r, seat, predicted win chance q, eventual win 0/1) for every seat at every round end across all games. That is already 5 × rounds data points per game, so 50 games give hundreds per round. For each round compute the Brier score and a reliability table (5 quantile bins: mean q vs observed win rate). Over-confidence shows as bins with q > observed at the top and q < observed at the bottom.
- **Fix:** a per-round Platt fit, logit(p_cal) = a_r + b_r·logit(q). Over-confidence gives b_r < 1. That is only 2 parameters per round, so it is stable with tens of games, and it keeps the ordering of q. Use isotonic only once there are hundreds of games per round. Keep the five seats' calibrated values summing to about 1, by renormalising (my suggestion; this matters for a one-winner game). Validate on games not used for fitting.
- **Response choice for the probes:** Δq (prediction difference after the rest of the round) is low-variance, but its scale is biased where q is miscalibrated, about by the factor b_r in logit space. Options, in order of rigour: (1) apply the per-round calibration map to both arms before differencing (cheap, removes most scale bias); (2) play some probes to the end of the game and compare the final outcome difference with Δq on the same probes, to estimate the bias directly; (3) use final outcomes with an AIVAT-style chance correction built from q, which is unbiased and gets most of the variance benefit. Mixed designs (many short Δq probes plus a few full playouts to correct the bias) are a standard bias–variance compromise. I found no game-specific source for this.
- **For bot comparisons:** use final wins as the primary response and q only as a control variate (CUPED or AIVAT), so over-confidence cannot flip a conclusion.

### Gaps
- No source found quantifying calibration of search-bot win predictions in multiplayer board games.
- No retrieved source formally analyses "predicted value vs final outcome" response choice in game balancing. The trade-off above is my reasoning plus the AIVAT unbiasedness result.
