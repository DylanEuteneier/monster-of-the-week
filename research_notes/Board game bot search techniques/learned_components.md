# Cheap learned components and opponent/belief modelling for board game bots

Context: a JavaScript bot for a 3-5 player card-driven area-control/betting game with drafting. It uses a hand-built evaluation, one-step scoring to shortlist 6 moves, then flat Monte Carlo play-outs. It runs about 37 games/hour on 8 cores (~900 games/day) and already logs per-seat feature vectors each round.

Note on method: two key PDFs (Buro et al. 2009 Skat; Ward et al. 2020 MTG drafting) were served as compressed binary that could not be text-extracted here, so only their abstract-level claims are used. Keldon Jones' own RFTG AI documentation could not be found online; RFTG details come from the Temple Gates developer article.

## 1. Fitting evaluation functions from logs (logistic regression, TD, Texel tuning)

### Takeaway
Fitting a hand-featured evaluation to game outcomes (logistic regression with a fixed sigmoid scale, i.e. Texel tuning) is the cheapest proven win. It gave about +100 Elo in a mature chess engine, but it needed tens of thousands of games and millions of positions, and most of the gain came from data-set choices rather than the optimiser. TD self-play works for small networks (TD-Gammon, RFTG), but on the order of 10^4 to 10^6 games.

### Cited Findings
- Texel tuning is "a concrete instance of logistic regression": minimise the mean squared error between game result (0/0.5/1) and sigmoid(K * eval). K is fitted once (K = 1.13) to the current evaluation and then frozen — [Chessprogramming wiki: Texel's Tuning Method](https://www.chessprogramming.org/Texel%27s_Tuning_Method)
- Data: 64,000 fast games (1 s + 0.08 s/move) between current and previous engine versions. These gave ~8.8M positions (~140 per game) after excluding book and mate-score positions. ~400 parameters. One gradient took ~25 min on 16 cores; a local minimum took up to ~6 h. The optimiser was plain coordinate local search (+1, then -2 per integer parameter), and the author says the optimiser choice "is not critical" — [Chessprogramming wiki](https://www.chessprogramming.org/Texel%27s_Tuning_Method)
- Gains were measured with 32,000-game matches: +24.6 Elo from exposing most parameters, then +4.0, +5.8 and +2.8 from exposing more, +12.8 from regenerating the training set from recent games (non-stationarity matters), +39.4 from including positions where quiescence search disagreed with the search score (a data-filtering mistake had been costing strength), and +10.2 from a structural feature change. Total ≈ +99.6 Elo — [Chessprogramming wiki](https://www.chessprogramming.org/Texel%27s_Tuning_Method)
- Pitfalls the author lists: learning features that correlate with winning but do not cause it; making evaluation worse in situations the engine does not understand; multiple positions per game are not independent samples; and odd values that encode opening-specific quirks (e.g. queen on b7 −128 cp from the "poisoned pawn") — [Chessprogramming wiki](https://www.chessprogramming.org/Texel%27s_Tuning_Method)
- Community pitfalls: a wrong sigmoid gave nonsense values (a negative knight value), and results depended on starting values (some parameters never moved). The Arasan developer used Adam, low-depth search to choose training positions, and L2 regularisation — [TalkChess threads via search](https://talkchess.com/viewtopic.php?p=698386), [TalkChess](https://talkchess.com/viewtopic.php?p=767615)
- TD-Gammon 2.1: 198 expert-designed input features, 80 hidden units, one win-probability output. Trained by TD self-play on ~1.5M games, it reached just below top-human level. Sources disagree on 40 vs 80 hidden units for version 2.0 — [Wikipedia: TD-Gammon](https://en.wikipedia.org/wiki/TD-Gammon); [Kaelbling et al. RL survey](https://arxiv.org/pdf/cs/9605103)
- Race for the Galaxy (Keldon Jones' AI, shipped by Temple Gates): a 3-layer network with inputs scaled 0–1 (player count, expansion, opponent points, discard contents) and one win-probability output per player. Training was knowledge-free TD self-play, with weights updated every turn and the final result as the terminal signal, over "thirty thousand games". They shipped 24 separate networks, one per expansion × player-count. Move choice is one-ply: simulate each candidate, score the result with the network, take the max. The reported win rate is 97% for Hard AI (opponent pool not stated) — [Temple Gates: Big Brain, Small Phone](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion); [GDC 2018 talk](https://gdcvault.com/play/1025226/-Race-for-the-Galaxy)
- The RFTG AI "was originally created as a project to test neural networks" by Keldon Jones — [Tabletop Gaming 2017](https://www.tabletopgaming.co.uk/News/race-for-the-galaxy-will-settle-the-mobile-planets-of-ios-and-android)
- Hearthstone AAIA'17 challenge (predict P(player 1 wins) from a state): neural networks topped the ranking, xgboost was popular, and "simple logistic regression did well". The best entry was <2 percentage points above the baseline — [Janusz et al., Helping AI to Play Hearthstone](https://ar5iv.arxiv.org/html/1708.00730)

### Inferences
- The logged per-seat feature vectors are already a Texel-style dataset. A reasonable target is P(this seat wins) = sigmoid(w·features), or a softmax across seats for 3-5 players, fitted with L2 regularisation and grouped by game for validation. Chess used ~64k games for 400 parameters. With ~900 games/day and maybe tens of parameters, a few thousand games (each giving many round snapshots) is plausibly enough for a linear model. This is inferred, not measured for this game.
- The +12.8 Elo from "regenerate data from recent games" is direct evidence of non-stationarity: refit after the bot changes, and fit only on games from the current bot (or a mix of current and previous versions, as Texel did).
- The quiescence lesson transfers. Label positions whose static evaluation is unreliable (e.g. mid-fight, pending resolution) carefully rather than dropping them, or evaluate them after the pending resolution.
- The hand-built evaluation's components (projected-fight win chance, margin vs best rival, goal-path progress) are natural features. Fitting their weights is lower-risk than replacing the evaluation.
- RFTG shows a one-ply search over a learned evaluation can ship as a strong commercial AI in a multiplayer drafting-adjacent card game, at ~30k self-play games. That is ~33 days at 900 games/day unless games are made cheaper (e.g. a faster bot used only for data generation).

### Gaps
- Keldon Jones' original RFTG AI documentation (hidden-unit counts, learning rates, input encoding) was not found.
- No source quantifies how many games a linear or logistic evaluation needs in a multiplayer (3-5 seat) game specifically.
- The previous fitted-evaluation attempt in this project is not covered by external sources.

## 2. Policy priors / move ordering learned from search or play logs (imitation, expert iteration)

### Takeaway
A learned policy used as a prior inside search is the strongest single lever in the literature. In Hex, adding a policy prior to MCTS won 97% against plain MCTS at about 2× cost per iteration, versus 56% for simply doubling the search. Even shallow imitation of the search's own choices (≈50% top-1 accuracy) gave large gains. For a shortlist-then-rollout bot, the cheap analogue is learning to predict which candidates the expensive stage ends up choosing, and using that to rank or prune before play-outs.

### Cited Findings
- Expert Iteration (Anthony, Tian, Barber, NeurIPS 2017): tree search plans and a network imitates the search's move choices. The network then guides the search, and the loop repeats. On 9×9 Hex, the tabula-rasa ExIt agent beat MoHex 1.0 — [arXiv 1705.08439](https://ar5iv.labs.arxiv.org/html/1705.08439)
- Figures: the expert was MCTS with 10,000 simulations/move. The initial imitation set was 100,000 MCTS moves, with top-1 prediction error ~47%. Learning from MCTS visit distributions (TPT) was +50 ± 13 Elo over learning only the chosen move (CAT). DAgger-style data collection added ~120 Elo. The imitation network alone won 87/162 (~54%) against its own MCTS expert — [arXiv 1705.08439](https://ar5iv.labs.arxiv.org/html/1705.08439)
- The policy prior in MCTS (N-MCTS) won 97% against plain MCTS at ~2× the cost per iteration, while doubling plain MCTS iterations won only 56%. Final results vs MoHex 1.0 were 75.3% at 10k iterations and 59.3% at 100k. The value+policy version used ~7.4M further move choices. The authors note AlphaGo Zero used ~100,000× more training compute — [arXiv 1705.08439](https://ar5iv.labs.arxiv.org/html/1705.08439)
- Dominion (Temple Gates): AlphaZero-style search in which the network outputs both per-player values and branch-exploration weights (a policy prior). It reaches ~1,000-step lookahead on phones and an ">80%" win rate. Card embeddings (~10 dimensions) replace 10–20 inputs per card. Two networks were used (2-player, 3+ player), and it generalised from ~200 to 500+ cards without loss of skill — [Temple Gates: Big Brain, Small Phone](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- RFTG also shipped an "Opponent Action Prediction" network alongside the value network, to simulate opponents' moves more accurately — [Temple Gates](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- For this bot: log, per decision, the candidate list, each candidate's features, the one-step score, and which candidate the play-outs finally picked. Then fit a ranker (logistic or pairwise) that predicts the play-out winner. Use it either to choose the 6-candidate shortlist (replacing or reweighting one-step scoring) or to allocate play-outs non-uniformly (more to candidates with a high prior). This is the cheap "ExIt" analogue. It is inferred, not tested in a comparable game.
- The TPT result suggests training on the play-out win-rate distribution across the 6 shortlisted moves rather than only the argmax. It costs nothing extra to log.
- With 1–400 targets per card, the main value of a prior is recall: the shortlist must contain the move the play-outs would have liked. Measure how often the final pick ranks below shortlist position 6 under the current scoring (needs a wider shortlist on a sample of decisions).

### Gaps
- No usable small-budget expert-iteration results were found for Splendor, Catan, 7 Wonders or Hearthstone policy priors. The Splendor paper (Rinascimento) argues opponent prediction matters but does not measure it — [arXiv 1904.01883](https://arxiv.org/pdf/1904.01883)

## 3. Small neural or tree models as evaluators/rankers; inference cost

### Takeaway
Small MLPs (a few hundred hidden units) work as state evaluators in card games and give measurable gains as play-out cut-offs. Logistic regression and gradient-boosted trees are competitive for win-probability prediction from hand-made features. The margin over simple models is small when the features are good.

### Cited Findings
- Hearthstone (Świechowski, Tajmajer, Janusz 2018): a dense value network (256-128-64, tanh) with a 750-element feature vector plus 10-dimensional card embeddings. Its first dataset was 3.5M samples from bot games; the iterative version used 20k+ initial games plus 3k new games per iteration over 64 iterations, with a 1M-sample buffer. Accuracy was ~0.78–0.79. It was used to cut off random rollouts early (≥20 steps), with the network's win probability backed up as the rollout result. At 0.5 s/move over 500 games, first-player win rate rose from 73.5% to 82.0%. As second player, the value net plus a heuristic "board solver" took the win rate from 26.5% to ~56%. The simulator ran ~10k games/s. Network inference time was not reported. Only two decks were tested — [arXiv 1808.04794](https://ar5iv.arxiv.org/html/1808.04794)
- AAIA'17: neural networks best, xgboost common, logistic regression "did well". The winning margin was <2 points over baseline — [ar5iv 1708.00730](https://ar5iv.arxiv.org/html/1708.00730). AAIA'18 winners used an ensemble of two logistic regressions plus one deep model with card-attribute features — [Vu et al.](https://khazna.ku.ac.ae/en/publications/predicting-win-rates-of-hearthstone-decks-models-and-features-tha/)
- Separate networks per deck/seat (Hearthstone) or per expansion × player-count (RFTG, 24 networks) improved accuracy — [arXiv 1808.04794](https://ar5iv.arxiv.org/html/1808.04794); [Temple Gates](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- In JavaScript, a linear model costs on the order of the feature count in multiply-adds, and a 2-layer MLP with ~64 hidden units costs a few thousand. Both are negligible next to a play-out (inferred, not benchmarked). A learned evaluation is therefore cheap enough to score all 1–400 targets, not just the shortlist.
- The Hearthstone result supports using a fitted evaluation to truncate play-outs (play k rounds, then evaluate) to buy more play-outs per decision. That is probably the biggest compute-to-strength trade available if the fitted evaluation is calibrated. Inferred.
- Consider separate weights per player count (3/4/5), following RFTG and Hearthstone.

### Gaps
- No source gave JavaScript or CPU inference timings for small MLPs or GBDTs in a game bot.

## 4. Opponent modelling in multiplayer games (inferring goals/strategies)

### Takeaway
Evidence that explicit opponent modelling improves multiplayer search bots is thin and mixed. MCTS is robust to inaccurate opponent models, and studies find the agent's own action choice matters more than predicting opponents. Learned opponent-action prediction has shipped (RFTG), but its isolated gain was not reported.

### Cited Findings
- Goodman and Lucas (2020): RHEA is much more sensitive to opponent-model accuracy than MCTS. MCTS "generally performs well even with an inaccurate model". With an unknown opponent and a low budget, they recommend no explicit model for RHEA, and modelling opponents inside the MCTS tree instead — [arXiv 2006.08659](https://arxiv.org/abs/2006.08659v1)
- A survey notes that "the agent's own actions often have a significantly greater impact on the final score than appropriate opponent prediction" (citing Baier and Kaisers). Opponent-move abstraction (OMA) beat vanilla MCTS in six 3+ player perfect-information games. MCTS-OMA with progressive widening improved over paranoid and BRS+ in Chinese Checkers, Rolit and Focus — [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931)
- Opponent modelling in multiplayer imperfect-information games has been studied (Ganzfried et al.) — [arXiv 2212.06027](https://arxiv.org/pdf/2212.06027) (not read in full)
- RFTG's shipped AI includes an opponent action-prediction network — [Temple Gates](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- For "which faction does an opponent back" (goal inference), a cheap approach is a per-opponent posterior over their likely victory path, updated from their observed plays with a logistic model fitted on logs (P(play | goal)). Feed it into play-out opponent policies or the "best rival" margin term. Evidence suggests modest gains. Prioritise it below evaluation fitting and policy priors.
- Since the bot's play-out opponents are copies of itself, a cheap "model" is simply making play-out opponents' goal choice consistent with their observed history.

### Gaps
- No measured study of goal/faction inference in an area-control or betting board game was found.

## 5. Belief modelling for hidden hands (drafting/card games)

### Takeaway
Weighting sampled worlds by how likely opponents' observed actions are under a policy model gives large, well-measured gains in Skat. The cost is roughly 5× runtime and some exploitability. In drafting, cards seen while passing give hard constraints for free, which is cheap and the first thing to exploit.

### Cited Findings
- Buro, Long, Furtak, Sturtevant (IJCAI 2009): the first expert-level computer Skat player. They learned state evaluations from human game data and used them to infer opponents' hidden hands, framing move selection and inference as two distinct problems — [IJCAI 2009 abstract](https://www.ijcai.org/Abstract/09/236); [mlanthology](https://mlanthology.org/ijcai/2009/buro2009ijcai-improving) (full numbers not extracted)
- Policy-Based Inference in Skat (Rebstock et al. 2019): a world's weight is the product of the probabilities of the actions in its history. Chance moves are exact, own actions count as 1, and opponents' actions come from learned policy networks trained on human games. Results over 5,000 matches per game type, in tournament points per game: PI beat no-inference by +10.43 (suit), +3.55 (grand) and +6.33 (null). It beat the previous card-location inference (CLI) by +2.32/+0.64 (n.s.)/+1.57, and Kermit's older inference by +5.13/+3.12/+2.37. Sample budgets were 20k–100k card configurations vs CLI's 500k. Runtime is ~5× CLI per move. Inference increases exploitability — [arXiv 1905.10911](https://ar5iv.labs.arxiv.org/html/1905.10911)
- Solinas, Rebstock, Buro (AAAI 2019): supervised learning to estimate the distribution of states within an information set improved state-of-the-art Skat card play — [arXiv 1903.09604](https://ar5iv.arxiv.org/html/1903.09604)
- Hanabi: the Bayesian Action Decoder keeps beliefs ∝ remaining card counts × a hint mask, updated from public actions, sampling ~3,000 hands in training and 20,000 in test — [arXiv 1811.01458](https://arxiv.org/pdf/1811.01458). Fuchs et al. compute exact hand probabilities by sampling without replacement from cards not ruled out, and report agents beating Rainbow — [arXiv 2101.09328](https://arxiv.org/pdf/2101.09328). A learned LSTM belief model reached ~63.6% card-prediction accuracy — [arXiv 2210.05125](https://arxiv.org/pdf/2210.05125)
- Determinization in Magic: The Gathering: ensemble determinization gave significant strength gains over basic MCTS — [Cowling, Ward, Powley](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf). Whitehouse et al. found no significant difference between determinized MCTS and ISMCTS in Dou Di Zhu. Determinization suffers strategy fusion — [Jass survey, arXiv 1906.04439](https://arxiv.org/pdf/1906.04439); [Whitehouse thesis](https://etheses.whiterose.ac.uk/id/eprint/8117/1/Feb%2016%20-%20FINAL.pdf)
- MTG drafting bots (Ward et al. 2020) used >100,000 human drafts to train pick-prediction agents. A deep network imitated human picks best — [arXiv 2009.00655](https://arxiv.org/pdf/2009.00655) (accuracy numbers not extracted). 7 Wonders work so far is data mining of winning patterns and association-rule bots from Board Game Arena data, not belief modelling — [SBGames 2019](https://www.sbgames.org/sbgames2019/files/papers/ComputacaoShort/196631.pdf), [SBGames 2021](https://www.sbgames.org/proceedings2021/ComputacaoFull/216981.pdf)

### Inferences
- Ladder for this game, from cheapest:
  1. Hard constraints from the draft. Cards you passed to a neighbour that are not later seen played are in their hand or passed on, and cards you saw in a pack and did not see return were taken by those between.
  2. Uniform sampling of the remaining hidden cards consistent with the constraints (likely already done in the play-out determinizations; check).
  3. Weighting or rejection of samples by P(observed picks/plays | hand), using the bot's own one-step scorer as the opponent policy (softmax over its scores). This is the Skat PI recipe with no training needed.
  Steps 1–2 are near free. Step 3 costs extra scoring per sample (Skat: ~5×). Ranking inferred from the sources above.
- The Skat no-inference gap (+3.5 to +10.4 TP/G) is the strongest evidence in this whole area that belief modelling pays off when hidden information drives the outcome.

### Gaps
- No measured belief-modelling results for 7 Wonders or similar pass-drafting board games were found.
- Buro et al. 2009 and Ward et al. 2020 numbers could not be extracted (binary PDFs).

## 6. Learned or adaptive rollout policies

### Takeaway
The direct evidence found is that learned evaluators truncating rollouts (Hearthstone) and learned priors (Hex, Dominion) beat plain random or heuristic play-outs. Online adaptive play-out schemes exist (Cazenave's nested rollout policy adaptation family), but no gains comparable to this game were confirmed in sources read.

### Cited Findings
- Hearthstone: the value network as an early rollout cutoff gave +8.5 points of win rate as first player, and roughly doubled the second-player win rate when combined with a heuristic attack solver. Heuristics helped more at lower time limits — [arXiv 1808.04794](https://ar5iv.arxiv.org/html/1808.04794)
- Generalized Nested Rollout Policy Adaptation adapts softmax play-out weights online along the best sequence found — [arXiv 2003.10024](https://arxiv.org/pdf/2003.10024) (results not extracted)
- RFTG used an opponent-action prediction network to make simulated opponents more realistic — [Temple Gates](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- A cheap play-out policy for this bot: the learned ranker from section 2, sampled with a softmax temperature, replacing whatever play-out policy is used now. The risk is play-out cost: if the ranker needs candidate listing at each step, play-outs get slower. Truncating play-outs and evaluating with the fitted model offsets this.
- Ranked shortlist for a JavaScript bot (inferred from the evidence strength above):
  1. Fit the evaluation weights to outcomes from logged features (Texel style; cheapest, proven).
  2. Truncate play-outs with the fitted evaluation, which buys more play-outs.
  3. Learn a candidate ranker from play-out choices (ExIt-lite) for the shortlist and play-out allocation.
  4. Draft-constraint belief tracking, then likelihood-weighted samples.
  5. Opponent goal inference.

### Gaps
- No numbers found for MAST/NST-style or PPA play-out adaptation in multiplayer card games within the sources read.
