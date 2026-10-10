# Case studies of AI agents for modern board and card games (drafting, hidden information, alliances, multiple victory paths)

Scope note: written for a hand-coded JavaScript heuristic + shallow play-out search bot (8 cores, ~13 min per game per core) for a 5-player draft / area-control game with bluff tokens, secret faction backing and two endings. Facts carry inline sources. Where I could only reach an abstract or press coverage, it says so.

## 1. Drafting AI: how do published drafting bots value a pick (pick strength vs deck fit, denial, signals)?

### Takeaway
The best-documented draft bot, Draftsim's expert-tuned bot, scores each card as raw strength plus a colour-commitment bonus. The bonus is small and speculative early and becomes a large on-colour bonus once the bot commits. This simple two-phase heuristic matched human picks about as well as a Naive Bayes model and only ~4 points worse than a neural net. Published MCTS work on 7 Wonders finds that standard MCTS lessons carry over to drafting games, which are hard to hand-evaluate because card value depends on game stage and opponents' choices.

### Cited Findings
- Draftsim's expert-tuned "DraftsimBot" scores rating(c) = strength(c) + colorbias(c), with strength a 0–5 human-assigned score. Each card's "pull" = max(0, strength − 2.0), so weak cards add nothing to colour commitment. Commitment per colour = sum of the pull of pool cards of that colour — [Ward et al., "AI solutions for drafting in Magic: the Gathering" (ar5iv)](https://ar5iv.labs.arxiv.org/html/2009.00655)
- Speculation phase (before commitment): one-colour cards get a bonus of about 0.257 × colour commitment, capped at 0.9 (the paper's equation writes max, the text says "capped", so the form is ambiguous). Two- to three-colour cards get the on-colour minus off-colour bonuses, minus a 0.6 multicolour penalty. The phase ends when the bot is committed to 2+ colours, or by pick 4 of pack 2. A colour counts as committed when its commitment exceeds 3.5. After that, on-colour cards get +2.0 and off-colour cards −1.0 per extra off-colour symbol — [Ward et al. (ar5iv)](https://ar5iv.labs.arxiv.org/html/2009.00655)
- Top-1 agreement with human picks over 21,590 test drafts: RandomBot 22.15%, RaredraftBot 30.53%, DraftsimBot 44.54%, BayesBot 43.35%, NNetBot 48.67% (all differences significant). The paper also gives ~64.7% NNetBot test accuracy in its methods section, which conflicts with the table — [Ward et al. (ar5iv)](https://ar5iv.labs.arxiv.org/html/2009.00655)
- Training data: over 100,000 anonymised human drafts from Draftsim.com — [Ward et al. arXiv abstract](https://arxiv.org/abs/2009.00655)
- All bots predicted early picks in each pack better than mid-pack picks. The authors describe a goal shift: early picks follow strength or rarity, middle picks follow synergy with the existing pool. They frame drafting as "stochastic movement toward synergistic deck configurations", not taking the objectively best card — [Ward et al. (ar5iv)](https://ar5iv.labs.arxiv.org/html/2009.00655)
- Ryan Saxe's MTG draft bot (built with Draftsim, ~100,000 drafts) clusters drafts into archetypes and learns a pick order per cluster. Its outputs were used for early pick-order rankings for Theros Beyond Death — [Draftsim: Ryan Saxe bot model](https://draftsim.com/ryan-saxe-bot-model/); code at [GitHub RyanSaxe/MagicDraftBot](https://github.com/RyanSaxe/MagicDraftBot)
- Robilliard, Fonlupt and Teytaud (CGW 2014) applied MCTS with UCB to 7 Wonders, a game with hidden information, multiple players and randomness. Card values depend strongly on game stage and opponents' choices, so a strong hand-written evaluation is hard to build. They conclude that many known MCTS results still carry over — [Springer CCIS 504](https://link.springer.com/doi/10.1007/978-3-319-14923-3_5); [HAL preprint hal-01406496](https://hal.archives-ouvertes.fr/hal-01406496) (full text blocked by bot protection when fetched)
- A later Charles University thesis applies MCTS to 7 Wonders and tests search depth, iteration count and UCB constant against rule-based and random opponents — [CUNI thesis PDF](https://dspace.cuni.cz/bitstream/20.500.11956/200807/1/130422920.pdf)
- The TAG (Tabletop Games) framework includes Sushi Go! and gives a common agent API (MCTS, RHEA, rule-based) for modern designer games, plus logging of branching factor and hidden information — [TAG design paper](https://arxiv.org/pdf/2009.12065); [TAG project page](https://diego-perez.net/projects/tag/); [PyTAG](https://arxiv.org/html/2405.18123v1)
- Goodman and Lucas (2020), TAG line of work: with an unknown opponent and a low compute budget, RHEA did better without any explicit opponent model, and MCTS did better modelling opponents' actions inside the tree — [search summary of Goodman & Lucas work via paperswithcode author page](https://cs.paperswithcode.com/author/james-goodman)

### Inferences
- The two-phase DraftsimBot formula is a direct template for a set-collector draft. Use card strength plus a commitment bonus toward the colours already held, and keep that bonus small while uncommitted. Ours would need a twist, because weakest-colour scoring rewards spreading across colours, the opposite of Magic's concentration. The bonus should go to the colour that most raises the minimum, not the one held most. The phase switch (a commitment threshold or a fixed pick number) is a cheap tunable to put in spec variants.
- Accuracy is lowest mid-pack, where synergy dominates. Hand-aware deck-fit terms matter most in the middle picks of each draft round. Early picks can lean on raw card value.
- None of the sources I reached quantify hate-drafting (denial) or signal reading. In a 5-player pick-and-pass game, denial is diluted, because a denied card hurts one neighbour and helps the other three. Treat a denial term as a variant to measure, not a default.

### Gaps
- No source reached measured the value of hate-drafting or reading neighbours' signals. 17lands' own blog or bot write-ups were not reached.
- Robilliard et al.'s determinization method, simulation counts and win rates against rule-based bots were not retrieved (HAL blocked).
- No direct Sushi Go MCTS vs RHEA numbers were found.

## 2. Hidden information and bluffing: how do agents infer hidden state, and when does it pay?

### Takeaway
Strong agents in hidden-role and hidden-card games track a belief over hidden state that is updated from opponents' actions. DeepRole uses hard deduction (rule out worlds inconsistent with observed outcomes) combined with CFR. Skat programs bias sampled worlds toward hands consistent with the bidding and play. Hanabi SPARTA updates beliefs assuming others follow a known blueprint policy. Plain determinized sampling (PIMC) is cheap and works well in trick-taking games, but has the known flaw of "strategy fusion".

### Cited Findings
- DeepRole (Serrino, Kleiman-Weiner, Parkes, Tenenbaum, NeurIPS 2019) combines counterfactual regret minimization with deep value networks trained by self-play. It adds deductive reasoning to vector-form CFR to track joint beliefs over roles and infer partially observable actions (e.g., who failed a mission) — [arXiv 1906.02330](https://arxiv.org/abs/1906.02330)
- The deduction is based on consistency with observed outcomes. In 5-player Avalon DeepRole beat other hand-crafted and learned agents, and in online play it outperformed humans "as both a cooperator and a competitor" — [NeurIPS poster](https://neurips.cc/virtual/2019/poster/14491); [CBMM page](https://cbmm.mit.edu/publications/finding-friend-and-foe-multi-agent-games)
- Hanabi SPARTA (Lerer, Hu, Foerster, Brown, AAAI 2020): single-agent search assumes all other agents follow a known shared "blueprint" policy and searches only for itself. Multi-agent search has every agent run the same search when feasible and fall back otherwise. The authors prove search at least preserves the blueprint's performance, up to bounded error. Search raised the score of every agent tested, from 24.08 to 24.61/25 on an RL blueprint — [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/6208); [arXiv 1912.02318](https://arxiv.org/abs/1912.02318v1)
- SPARTA's search treats the blueprint as part of the environment and updates beliefs about hidden cards from others' actions — [GamesBeat](https://gamesbeat.com/facebooks-hanabi-playing-ai-achieves-state-of-the-art-results/)
- PIMC (perfect-information Monte Carlo: sample hidden worlds, solve each as perfect information, aggregate) suffers from "strategy fusion". It assumes it can play differently in each sampled world even when they are indistinguishable, an error that more samples do not fix (Frank and Basin 1998). Long et al. (2010) analysed why PIMC still succeeds in trick-taking games. αµ and Extended PIMC (EPIMC, 2024) target strategy fusion for Bridge and Skat — [Arjonilla, Saffidine, Cazenave, "PIMC with Postponing Reasoning"](https://arxiv.org/pdf/2408.02380); [Long thesis, U. Alberta](https://era.library.ualberta.ca/files/3t945r31n/jeff-thesis.pdf)
- Skat (Buro, Long, Furtak, Sturtevant): state evaluations are learned from human game data and used for inference on opponents' unseen hands. Later work biases world samples to be consistent with opponents' observed actions, using an opponent model to weight hidden-card hypotheses — [Sturtevant Skat paper](https://cs.du.edu/~sturtevant/papers/skat.pdf); [arXiv 1903.09604](https://arxiv.org/pdf/1903.09604.pdf)
- DeepNash (DeepMind, Stratego, Science 2022) uses Regularized Nash Dynamics (R-NaD), model-free RL that steers self-play toward a Nash equilibrium. It does no MCTS because the tree is too big, and trained on ~5.5 billion games. It won 97% against existing Stratego bots and 84% on the human Gravon server (top 3). It bluffs, e.g. chasing with a weak Scout as if it were a 10, and randomises setups so they cannot be read — [DeepMind blog](https://deepmind.google/discover/blog/mastering-stratego-the-classic-game-of-imperfect-information/); [The Decoder](https://the-decoder.com/deepminds-new-game-ai-is-set-to-be-a-game-changer-in-the-real-world-too/)
- Temple Gates' Race for the Galaxy AI pairs its evaluation net with a separate "Opponent Action Prediction" network that guesses opponents' moves, used to simulate states more accurately — [Engelstein/Duringer, "Big Brain, Small Phone"](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- For face-down plays with bluff tokens, the cheap transferable pieces are (a) a belief over each face-down card (which card or bluff), seeded from what is unseen in the 21-card deck and the draft history, and (b) determinized play-outs that sample from that belief instead of uniformly (PIMC with biased sampling, as in Skat).
- Pass-and-pick drafting leaks information: each bot knows exactly which cards it passed to whom. That is deductive constraint of the DeepRole kind (hard elimination of impossible worlds), and it costs almost nothing to compute.
- SPARTA's result suggests a cheap, guaranteed-safe recipe. Use the existing heuristic profiles as the "blueprint" for the other players inside play-outs, and search only for the acting bot. Its gains rely on the blueprint matching how others actually play, which holds in bot-vs-bot tuning but may not hold against humans.
- DeepNash shows the value of unpredictability. A bot that never bluffs, or always bluffs in the same spot, is readable. A small randomised bluff rate is a variant worth testing once other bots infer.
- Strategy fusion bites hardest when the right move depends on what is hidden and the bot will learn it later. Shallow play-outs make it less costly.

### Gaps
- No ablation numbers were retrieved for how much DeepRole's deduction adds over no belief tracking (only the abstract was reached), nor its compute.
- No case found for Coup or Liar's Dice agents.
- No source directly measured "belief tracking vs ignoring it" in a game with our structure.

## 3. Negotiation, alliances and multiplayer politics: Diplomacy, Catan, kingmaking, cooperate vs compete

### Takeaway
The strongest no-press Diplomacy agents combine a policy imitating humans with one-step equilibrium search (regret minimization) over a small set of candidate actions. Regularizing toward human-like play mattered, because pure self-play found equilibria incompatible with humans. Cicero added dialogue on top. Catan MCTS with some domain knowledge was competitive with hand-crafted JSettlers bots but weak against humans.

### Cited Findings
- Gray, Lerer, Bakhtin, Brown (ICLR 2021): supervised learning on human games plus one-step lookahead search based on regret minimization. It greatly outperforms earlier no-press bots, was not exploitable by expert humans, and ranks top 2% on a popular Diplomacy site. Regret minimization had not before been shown to work in large games involving cooperation — [arXiv 2010.02923](https://arxiv.org/abs/2010.02923v1); [ar5iv](https://ar5iv.labs.arxiv.org/html/2010.02923)
- DORA ("No-Press Diplomacy from Scratch", NeurIPS 2021) reached superhuman play in a two-player variant without human data. The authors report evidence of multiple equilibria in Diplomacy and that self-play alone may not suffice for strong play against humans — [DeepAI listing](https://api.deepai.org/publication/no-press-diplomacy-from-scratch)
- DiL-piKL (2022) regularizes a reward-maximizing policy toward a human-imitation policy — [ICLR/NeurIPS session pages via search](https://nips.cc/virtual/2021/poster/26758)
- Cicero (Meta, Science 2022, DOI 10.1126/science.ade9097) pairs a dialogue model with a strategic reasoning module. Over 40 online games on webDiplomacy.net it averaged 25.8% against 12.4% for its 82 opponents and placed in the top 10% of players with 2+ games. Opponents mostly did not know it was a bot. Experts rated ~10% of its messages inconsistent with its plan or the game state — [MIT Technology Review](https://www.technologyreview.com/2022/11/23/1063648/metas-game-playing-ai-can-make-and-break-alliances-like-a-human/); [Popular Science](https://www.popsci.com/technology/meta-ai-bot-diplomacy/); [TechXplore](https://techxplore.com/news/2022-11-meta-team-ai-plays-diplomacy.amp)
- A 2024 ACL study found Cicero wins most games but has not mastered persuasion and deception, and does not keep its communication consistent with its actions — [arXiv 2406.04643](https://arxiv.org/pdf/2406.04643)
- Catan MCTS (Szita, Chaslot, Spronck, 2010) was tested as 1 MCTS player with some domain knowledge vs 3 JSettlers hand-crafted agents. It was described as weak compared with humans — [Klassert slides, Heidelberg](https://graphmod.iwr.uni-heidelberg.de/system/files/private/downloads/1617646103/robert_klassert-monte_carlo_tree_search.pdf); [Sciworthy summary](https://sciworthy.com/can-a-computer-learn-to-play-settlers-of-catan/)
- A 2016 TU Crete thesis extended Catan MCTS with no domain knowledge, adding bandit and value-of-perfect-information methods — [TUC repository](https://sndbx.library.tuc.gr/view/66891?locale=en)

### Inferences
- The Diplomacy pattern (a heuristic policy proposes a few candidate moves per player, then a shallow search or regret-matching step over those candidates) scales down well. A JS bot can enumerate the top-k heuristic moves per opponent and evaluate joint outcomes by play-out. This is "one-step lookahead with a policy prior", and it handles the simultaneous draft naturally.
- Our cooperate/compete switch is close to no-press Diplomacy: alliances are implicit and must be read from moves. Inferring who backs which faction can reuse the hidden-information machinery (Section 2): a belief per player over factions, updated by how their plays help each faction's presence.
- The multiple-equilibria finding warns that bots tuned only against each other can settle into conventions (e.g., everyone backs the same faction) that humans won't follow. Include some diversity (both profiles, noise) when tuning.

### Gaps
- No source reached measured leader-bashing or kingmaking behaviour or remedies in bots. Risk agents were not covered.
- Cicero's planning internals (intent model, piKL details) came only from press summaries. The Science paper itself was not fetched.
- No numeric win rates for the Catan MCTS vs JSettlers were retrieved.

## 4. Multiple victory paths and strategy archetypes: choosing and switching strategies

### Takeaway
Two contrasting proven designs. Provincial (Dominion) evolves a fixed, parameterised "buy menu" per setup with switch thresholds, which is a strategy archetype with tunable knobs. Keldon Jones' Race for the Galaxy AI learns one evaluation net by TD self-play that picks the path implicitly, with only one-turn lookahead. Provincial found most setups have a single dominant strategy, and that buy (acquisition) decisions matter far more than play decisions.

### Cited Findings
- Provincial (Mark Fisher): a strategy is an ordered buy menu of (card, count) pairs, buying the left-most affordable entry, plus thresholds (Provinces remaining) for when to switch to buying victory cards. Menus are seeded from a Big Money template. Unconstrained menus performed nearly identically — [Fisher, Provincial](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- Coevolution: each generation, ~100 candidate strategies play ~5 leaders, and the best become the next leaders. Mutations swap cards, change counts, reorder entries, shift thresholds and adjust per-card play parameters. The default is 32 generations, with some kingdoms converging in ~20 and others still improving past 100 — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- Compute: ~40,000 games/second on an eight-core machine (C++), hundreds of thousands of games per generation, a few minutes per kingdom, and 10,000 games per matchup on leaderboards — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- Findings: most kingdoms are "simple" (one strategy beats all others). Only ~5 in 1,000 were "complex" with cyclic, non-dominating strategies. Buy decisions matter far more than play decisions, and play uses only a shallow look-ahead heuristic — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- The AI must be retrained for each kingdom. Untrained, it plays essentially at random — [AIIDE 2023 paper summary](https://ojs.aaai.org/index.php/AIIDE/article/download/27518/27291/31569); [arXiv 2405.06846](https://www.arxiv.org/pdf/2405.06846)
- Race for the Galaxy (Keldon Jones, later shipped by Temple Gates): a three-layer net. Its inputs (scaled 0–1) describe game state, and it has one output per player giving win likelihood. It plays by one-turn lookahead, simulating each candidate move and picking the state the net rates highest. Training was "knowledge-free" TD self-play (adapted from TD-Gammon) over 30,000+ games with updates at each step. A 97% win rate is quoted (against what is not stated). It needed 24 separate nets (per expansion set and player count) and a separate opponent-action-prediction net — [Engelstein/Duringer](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion); [GDC Vault talk](https://gdcvault.com/play/1025226/-Race-for-the-Galaxy)
- Jones' AI began as a research project on neural networks around 2009, and he also built the Roll for the Galaxy AI — [Tabletop Gaming](https://www.tabletopgaming.co.uk/News/race-for-the-galaxy-will-settle-the-mobile-planets-of-ios-and-android); [TouchArcade](https://toucharcade.com/2020/05/28/roll-for-the-galaxy-beta/)
- Temple Gates' Dominion AI: one-turn lookahead was insufficient for Dominion's long-term strategy, so they used AlphaZero-style search with the net both evaluating and proposing branches ("one thousand steps" on phones). Cards are represented by learned embeddings (~10 nodes) rather than one input each, letting one net cover ~500 cards. It is quoted at an "over eighty percent" win rate. They rejected scripted utility AI as hard to scale and debug, and hand-authored pruning as limited by developer skill. Difficulty levels add noise to move scores — [Engelstein/Duringer](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- Provincial maps well onto our two profiles. Express each profile as a small parameter vector (priorities plus switch thresholds, e.g. "switch to racing for faction standing once presence is safe"), then evolve or grid-tune it against the current leaders. Our ~13 min/game is about 10^7 times slower than Provincial's throughput, so we cannot run its population sizes. Only a handful of parameters with small-sample screening is feasible (≈8 cores × ~4.6 games/hour ≈ 37 games/hour).
- "Acquisition dominates play" suggests checking whether our draft decisions or our play decisions drive most of the win-rate variance before spending search budget. In Dominion the answer was acquisition.
- Keldon's one-turn lookahead on a good evaluator was strong in RftG, but Temple Gates found it inadequate in Dominion's longer-horizon game. Whether our shallow play-out suffices likely depends on how far ahead the endings are determined.
- An explicit switch threshold (like Provincial's "Provinces remaining") is the simplest, most tunable way to model switching between the island and invaders endings.

### Gaps
- No primary Keldon Jones write-up (BGG post or source README) was reached. The architecture details come via Temple Gates' account. Hidden-node counts and training time were not found.
- Geronimoo's Dominion simulator and Terraforming Mars bots were not covered.

## 5. Game balancing with AI: measuring card and strategy balance, designers using bots

### Takeaway
Simulation-based balance work measures usage rates under optimised play (Provincial), win-rate gaps between restricted and unrestricted agents (Jaffe's restricted play), and statistically significant pairwise matchups. Even 10,000 games per matchup leave noticeable noise, which matters a lot for small-sample testing.

### Cited Findings
- Restricted play (Jaffe et al., AIIDE 2013): measure balance by pitting a deliberately restricted agent (e.g. one barred from a card or strategy) against a standard agent. The win-rate gap shows how much that element matters. They applied it to an educational card game — [AAAI AIIDE](https://ojs.aaai.org/index.php/AIIDE/article/view/12513); [Jaffe dissertation](https://digital.lib.washington.edu/researchworks/handle/1773/22797)
- Restricted play needs expert knowledge, an AI and potentially expensive simulations. Jaffe's tool targeted perfect-information games — [arXiv 1603.03795](https://arxiv.org/pdf/1603.03795); [arXiv 2409.07340](https://arxiv.org/pdf/2409.07340)
- Provincial as a balance tool: Wharf was chosen in 28/30 random kingdoms at cost 5 (18/30 at cost 6). Plunder was chosen in 3/30 as printed, and in 10/30 after a +1 coin change. Fisher's criterion: a card is well designed if it forces non-trivial buy decisions, so always bought means too strong and never bought means too weak — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- Noise: a strategy playing itself over 10,000 games showed −2.3% instead of 0%. Fisher greys out non-significant matchup cells, and progression plots (each generation's leader vs all earlier leaders) separate real improvement from metagame cycling — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- Hearthstone's developers say card changes follow large-scale data collection and target non-interactivity and variety — [Hearthstone balance philosophy](https://playhearthstone.com/en-gb/blog/12383909). A 2019 paper proposes a balance model for Hearthstone deck measurement (only metadata retrieved) — [Springer Professional](https://www.springerprofessional.de/en/proposed-balance-model-for-card-deck-measurement-in-hearthstone/16201844)

### Inferences
- Restricted play transfers directly. To see whether the invaders ending or the bluff tokens matter, run the standard bot against a copy forbidden to back factions or to bluff, and look at the gap. Each comparison needs many games, though.
- Fisher's usage-rate test (how often optimised bots take a card) is cheap with our draft logs. Pick rate and win rate when taken, per card, flags always-take and never-take cards without extra games.
- Small samples: with ~10 games per variant and 5 seats, a 20% per-seat baseline has a standard error near ±13 percentage points per seat over 10 games (binomial). Only large effects are visible. Fisher's −2.3% self-play gap at 10,000 games shows how big noise remains even there.

### Gaps
- The de Mesentier Silva et al. Hearthstone balance papers were not found by search. Their methods and numbers are not in these notes.
- Ludii balance measures, and the bots of Slay the Spire, Root/Leder Games and Wingspan Automa, were not researched within the budget.

## 6. Keldon's RftG AI and other strong hobbyist bots: architecture, budget, what generalized

### Takeaway
Hobbyist-scale successes (Keldon's RftG, Provincial) both relied on very cheap evaluation repeated many times: a small net with one-ply lookahead, or a fast C++ simulator with tens of thousands of games per second. Most of their strength came from tuning acquisition or evaluation by massive self-play, not from deep search.

### Cited Findings
- RftG: a three-layer net, one-ply lookahead, TD self-play over 30,000+ games. Specialised nets per expansion and player count (24 total) were needed and later became a download-size problem. The follow-on Dominion AI used card embeddings so it generalises to new cards with known mechanics, though new mechanics still need encoding — [Engelstein/Duringer](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Weight sharing across player-specific inputs and treating duplicate cards identically cut training cost — [Engelstein/Duringer](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Provincial: 8-core machine, ~40k games/s. It does not generalise across kingdoms without retraining — [Fisher](https://graphics.stanford.edu/~mdfisher/DominionAI.html); [AIIDE 2023](https://ojs.aaai.org/index.php/AIIDE/article/download/27518/27291/31569)

### Inferences
- Our bots run at minutes per game, far slower than either hobbyist project. TD training or evolutionary search is impractical unless a fast "rollout mode" (a cheaper profile with no inner search) is used for training while the full bot is used only for evaluation. Making play-outs cheaper buys more than making them deeper.
- Noise-on-scores difficulty (Temple Gates) gives easy/medium bots almost for free, if wanted for human playtests.

### Gaps
- No primary-source figures for Keldon's hidden-layer size, training wall-clock or how player count affected the nets. The 97% win-rate baseline opponent is unspecified.
