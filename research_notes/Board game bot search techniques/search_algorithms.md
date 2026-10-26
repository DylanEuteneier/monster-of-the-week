# Search algorithms for multiplayer, imperfect-information board games with large structured action spaces under limited compute

Scope note: these notes cover playing-strength techniques only (not measurement or tuning). Our context, used for the Inferences: 3-5 players, card-driven area control and betting with drafting, hidden hands, multi-step card targets (1-400 legal targets per card), a JavaScript engine, about 22 s per 5-player game. Current bot: hand-built evaluation, candidate listing (40 per card) plus random samples, one-step scoring to a shortlist of 6, then flat Monte Carlo (4 play-outs per move, so about 24 play-outs per decision) to the end of the round, played by simplified fast bots.

Most primary PDFs were read in full text (extracted locally). Numbers below are quoted from the papers' tables or text.

## 1. ISMCTS (SO/MO) vs determinized MCTS / PIMC: strategy fusion, non-locality, results by game

### Takeaway
ISMCTS beats determinized UCT only where deep search or strategy fusion matters (LOTR:C, Phantom 4,4,4). It is roughly equal in Dou Di Zhu, and it costs 2-4x more time per iteration, so at about 1 s it can lose to determinization. In ensemble determinization, the split between number of determinizations and iterations per tree matters a lot. In Hanabi, plain ISMCTS is very poor and only works once the tree's action set is pruned hard by rules. The biggest gains in card games came from restricting or structuring the action space, not from the choice of hidden-information method.

### Cited Findings
- Cowling, Powley and Whitehouse name the two flaws of determinization. **Strategy fusion**: different determinizations can pick different moves from states the agent cannot tell apart. **Non-locality**: some determinizations are vanishingly unlikely because other players can steer play away from them. Long et al. predict when determinization works from three game-tree properties: leaf correlation, bias, and the rate at which hidden information is revealed (disambiguation). — [Cowling, Powley & Whitehouse 2012, IEEE TCIAIG "Information Set MCTS"](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- Same paper, overall verdict. In LOTR:C a deep search is required, so ISMCTS wins by using its budget more efficiently. In Phantom (4,4,4) strategy fusion is especially harmful, so ISMCTS wins again. In Dou Di Zhu neither effect matters much, and the information-set tree has an "orders-of-magnitude larger branching factor", so the two methods are on a par. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- LOTR:C, determinization balance at 10,000 total iterations. Light with 1 determinization × 10,000 iterations beat Light with 40 × 250 by 22.9 points. Against a 40×250 opponent, a 40×10,000 player won 73.2% (Light) and 83.0% (Dark), at about 40x the time. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- LOTR:C round robin at 10,000 iterations: all three ISMCTS variants beat determinized UCT for Dark "by a large margin". For Light, MO-ISMCTS beat determinized UCT by about 4.4 points (significant at 95%). There was no significant difference between SO-ISMCTS, SO-ISMCTS+POM and MO-ISMCTS. 750 trials per pairing. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- Phantom (4,4,4) ranking at 10,000 iterations (all steps significant at 95%): cheating ensemble UCT > cheating UCT > MO-ISMCTS > determinized UCT (40×250) > SO-ISMCTS > SO-ISMCTS+POM. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- Dou Di Zhu, 5,000 deals × 75 plays: determinized UCT 43.6%, ISMCTS 42.3%, cheating UCT 56.5%. Both determinized UCT (40×250) and ISMCTS (10,000 iterations) significantly beat a commercial flat Monte Carlo + heuristic AI (AI Factory). Giving that AI 100x its normal simulations removed the gap. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- Cost per iteration: SO-ISMCTS and MO-ISMCTS are "two to four times slower" than determinized UCT. In Dou Di Zhu and LOTR:C they run about a third as many iterations per second. At equal time in LOTR:C, MO-ISMCTS was slightly worse than determinized UCT at 1 s and significantly better from 3 s up, with the gap growing with CPU time. In Dou Di Zhu at 0.25-8 s there was no significant change, and SO-ISMCTS was slightly weaker below 1 s. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)
- Magic: The Gathering, ensemble determinization at 10,000 total simulations. The best number of determinizations was 20-100, at 100-500 simulations each. At 100,000 simulations the best was still 100-1,000 simulations per tree, so "an increased simulation budget is best used in running additional determinizations rather than searching each determinization more deeply". MCTS over all possible deals (chance nodes in the tree) won only 23% against the expert rules player and 38% against the reduced rules player. — [Cowling, Ward & Powley 2012, "Ensemble Determinization in MCTS for M:TG"](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)
- Magic: without the binary-tree enhancement, raising the budget from 10k to 100k simulations gave "no better and indeed slightly worse" play. The authors say they have seen this in other partial-information games. — [Cowling, Ward & Powley 2012](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)
- Hanabi (4 players). MO-ISMCTS with random simulations scored about 3.9 out of 25 at every budget from 100 ms to 3,000 ms. With the Van den Bergh heuristic simulation policy it scored 11.4 (100 ms) to 18.4 (3,000 ms). The raw heuristic policy alone scores 17.2 at under 1 ms per move. Re-determinizing ISMCTS (RIS-MCTS) fixes the leak of hidden information into opponent models. Once tree actions were limited by rules, RIS-MCTS scored 17.4-18.1 with random simulations (8-11 points above MO-ISMCTS) and up to 19.8 with the heuristic policy. — [Goodman 2019, "Re-determinizing ISMCTS in Hanabi"](https://arxiv.org/pdf/1902.06075)
- Hanabi tree depth without restriction: about 3.2 at 100 ms and 5.2 at 3,000 ms (maximum branching factor 32). With rule restriction: 6.7-11.0. — [Goodman 2019](https://arxiv.org/pdf/1902.06075)
- Hearthstone (Choe & Kim, CoG 2019). The combined approach beat TycheAgent (third place in the CIG'18 competition) 66% and 78% on two decks over 100 games. It used state abstraction (a transposition DAG with a UCD variant), sparse sampling over hidden information and chance, "damped sampling", double progressive widening and 6 root-parallel trees. — [Choe & Kim 2019](https://ieee-cog.org/2020/papers2019/paper_257.pdf)
- Settlers of Catan, 1 MCTS player vs 3 JSettlers bots (25% means equal strength): 1,000 simulations per move won 27%, and 10,000 won 49% (100 games each). — [Szita, Chaslot & Spronck 2010, "MCTS in Settlers of Catan"](https://www.spronck.net/pubs/ACG12Szita.pdf)
- TAG (8 games), NTBEA tuning of MCTS. Open Loop was "vitally important" in Love Letter (30 of 30 runs chose it). Information Set MCTS (redeterminizing each iteration), rollout length and opponent tree policy were the parameters whose optimum changed with player count. — [Goodman et al., "Visualising Multiplayer Game Spaces"](https://arxiv.org/pdf/2202.05773)
- MultiTree paper: PI-MCTS (one random determinization at the root for every iteration) "can work surprisingly well in some games". Per-game best quadrants: IS-MCTS without rollout for Uno and Love Letter; IS-MCTS with 30-action rollout for Colt Express, Dominion, Exploding Kittens, Poker and Diamant; PI-MCTS without rollout for Dots and Boxes and Virus; PI-MCTS with 30-action rollout for TicTacToe and Sushi Go!. — [Goodman, Perez-Liebana & Lucas, "MultiTree MCTS in Tabletop Games" (CoG 2022)](https://diego-perez.net/assets/pdf/papers/MultitreeMCTSTabletop-CoG22.pdf)
- Sequential Halving study: a concern with UCT in partially observable games is that node statistics "become conditioned on a set of determinizations" when each sample uses a new determinization. — [Pepels, Cazenave & Winands, "Sequential Halving for Partially Observable Games"](https://www.lamsade.dauphine.fr/~cazenave/papers/po-hybrid.pdf)

### Inferences
- Our current method, flat Monte Carlo with resampled hidden hands per play-out, is a one-ply PIMC with no tree. Strategy fusion inside the play-outs is limited because the play-out bots are fixed policies, not search. The usual ISMCTS benefit (a single tree, deeper search) needs a budget far above our 24 play-outs per decision. The evidence (ISMCTS 2-4x slower per iteration, worse at 1 s in LOTR:C, equal in Dou Di Zhu) suggests ISMCTS is unlikely to pay off at our budget. This is inference, not tested in a game like ours.
- The Magic and Hanabi results suggest the bigger lever is action-space restriction and decomposition (see section 2), and how hidden hands are sampled (for example, biased "interesting" or plausible deals).
- Non-locality is a reason to sample opponents' hidden hands consistently with what they have shown (cards drafted or passed, bets), rather than uniformly. Cowling et al. list this as a known flaw. None of the sources here measured inference-based sampling in a game like ours: gap.

### Gaps
- 7 Wonders (Robilliard, Fonlupt & Teytaud 2014): the abstract says "many known results still hold" for MCTS, but I could not get its numbers. — [HAL record](https://hal.archives-ouvertes.fr/hal-01406496)
- Spades (Whitehouse et al., AIIDE 2013): confirmed to exist, but I found no full text or numbers. — [Cowling publications list](https://researchpublications.qmul.ac.uk/publications/staff/47686.html)
- I found no head-to-head ISMCTS vs PIMC result for any drafting or area-control game.

## 2. Large or compound actions: progressive widening, decomposition into sub-decisions, abstraction, combinatorial bandits

### Takeaway
Restructuring compound moves into sequential sub-decisions has the strongest direct evidence in card games. In Magic, binary yes/no trees gave large gains and cut CPU time. Hard pruning of the tree's action set was decisive in Hanabi. Naïve sampling (combinatorial bandits) beats ε-greedy and UCB once branching factors become very large and budgets moderate. At very low budgets, ε-greedy flat Monte Carlo was best. Double progressive widening helped in Hearthstone for chance-heavy decks.

### Cited Findings
- Magic, binary tree (BT): each card choice is restructured into a chain of yes/no decisions ordered by descending mana cost. BT, dominated move pruning (MP) and "interesting simulations" (IR) each improved play significantly at the 99% level (multiway ANOVA), and the strongest combination was BT with MP. At 100k rollouts against the expert rules player: (BT,–,–) 52.0% at 3.36 s per move; (BT,MP,IR) 51.2% at 3.21 s; (–,–,–) 37.3% at 6.45 s; (–,MP,IR) 44.3% at 8.38 s. BT "significantly decreases the CPU time per decision" because selection has far fewer branches at each level. — [Cowling, Ward & Powley 2012](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)
- Magic, average time per move at 10k simulations: all possible deals 5.65 s; baseline ensemble 0.75 s; interesting simulations at leaves 9.81 s; binary tree 0.23 s. — [Cowling, Ward & Powley 2012](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)
- Terraforming Mars in TAG: actions are "highly parameterised and implemented using a sequential model, to avoid extremely large combinatorial action spaces". A "Play a card" action is followed by separate decisions on payment and effects, using TAG's IExtendedSequence. The authors note this delays seeing an action's full effect, which adds uncertainty depending on the search horizon. MCTS (rollout depth 10, K=√2, 1,000 forward-model calls) beat OSLA 75% and random 98% head to head in 2-player games. OSLA beat random 91%. — [Gaina, Goodman & Perez-Liebana, "TAG: Terraforming Mars" (AIIDE 2021)](https://cdn.aaai.org/ojs/18902/18902-52-22668-1-2-20211004.pdf)
- Hanabi: limiting tree actions to a handful of rule-generated options (TellMostInformation, TellAnyoneAboutUseful, TellDispensable, CompleteTellUseful, and so on) raised RIS-MCTS from about 4.2 to 17.4 at 100 ms with random simulations. The author compares this to progressive unpruning or widening, but uses hard rules with no unpruning. — [Goodman 2019](https://arxiv.org/pdf/1902.06075)
- Ontañón, combinatorial multi-armed bandits. Naïve sampling assumes action components are independent: local bandits per component and a global bandit over sampled combinations. Ten units with 5 actions each give about 10 million combined actions. On synthetic CMABs, a two-phase naïve sampling variant was clearly best for very large branching factors (about 9.28×10^22). At a branching factor of 10,368 it was slightly worse than standard naïve sampling. Below about 1,000 iterations, two-phase beat standard naïve sampling in all CMABs. — [Ontañón 2017, JAIR "Combinatorial Multi-armed Bandits for RTS Games"](https://arxiv.org/pdf/1710.04805)
- microRTS round robin (Ontañón): "when the computational budget is very low, MC [flat] seems to outperform MCTS, while as the computation budget increases this is reversed". ε-greedy (ε=0.25) was very good at low budgets (about 500 play-outs). Naïve sampling dominated as budget and branching factor grew. At large budgets the sampling strategies converged. UCB1 with first-play urgency did "very poorly", especially on 12x12 maps. — [Ontañón 2017](https://arxiv.org/pdf/1710.04805); original [NaiveMCTS, AIIDE 2013](https://ojs.aaai.org/index.php/AIIDE/article/view/12681)
- Hearthstone: double progressive widening with damped sampling, 100 games against sparse UCT. The best settings gave Warlock up to 67%, Hunter up to 58% and Paladin up to 58%. Results varied with parameters; some settings were below 50%. The authors attribute Warlock's gain to its many card-draw chance nodes. — [Choe & Kim 2019](https://ieee-cog.org/2020/papers2019/paper_257.pdf)
- Hearthstone, a second paper: adding an explicit "end turn" action lets MCTS treat a multi-action turn as a sequence of tree nodes. Determinized bots beat naive UCT, "especially with a binary tree". From a search summary, not read in full. — [Symbolic Reasoning in Hearthstone (preprint)](https://radar.gsa.ac.uk/5286/1/Symbolic%20Reasoning%20in%20Hearthstone-PrePrint.pdf)
- Move groups (Childs, Brodeur & Kocsis, CIG 2008; revisited by Van Eyck & Müller) "greatly reduce the branching factor at the cost of increased search depth". I found no numbers. — [SZTAKI record](https://eprints.sztaki.hu/5549/); [Van Eyck & Müller](https://webdocs.cs.ualberta.ca/%7emmueller/ps/GVanEyck-MoveGroups-Final.pdf)
- GVGAI: macro-actions did not help MCTS on average across games, but some games need them. Option-MCTS beat MCTS in small games and lost in bigger ones. From a search summary. — [GVGAI multi-track paper](https://arxiv.org/pdf/1802.10363)

### Inferences
- Our cards with 1-400 targets are compound actions: card choice, then use, then target. The Magic binary-tree and Terraforming Mars sequential-model evidence supports decomposing at the root: choose the card first (a small set), then targets within it. The budget then goes to "which card" before "which target", instead of sharing 24 play-outs among about 6 shortlisted full moves. This is inference, and decomposition helps most when card-level values differ more than target-level values.
- Ontañón's local bandits estimate components separately. A cheap analogue for us would be to estimate a target's value from play-outs across different cards, or a card's value across targets. This assumes independence, which in our game is likely only rough.
- Our pipeline (candidate listing → one-step scoring → shortlist of 6) is already a form of heuristic hard pruning, as in Hanabi. The Hanabi result says this kind of pruning can be the single largest strength factor. That supports investing in the shortlist (a better one-step score, or a modest widening such as 6 → 8-10 when the budget allows), over changing the search algorithm.

### Gaps
- No published result I found measures action decomposition in a drafting or area-control board game with targets.
- The move-groups and progressive widening (Coulom; Chaslot) original numbers were not retrieved.

## 3. Multiplayer search: maxn, paranoid, BRS and their MCTS forms in 3-5 player games

### Takeaway
In αβ search, BRS beats maxn and usually paranoid in 3-6 player games. In MCTS, the maxn backup (each player maximises their own value) is clearly best, and paranoid and BRS trees are worse. At low budgets in tabletop games, ignoring opponents in the tree (Self-only or MultiTree MCTS) is often as good or better. Its advantage fades as the budget grows, except in simultaneous-move games. With more than 2 players, paranoid opponent models were chosen less often in TAG tuning.

### Cited Findings
- Nijssen & Winands overview, αβ with 250/1,000/5,000 ms. Maxn is "by far the weakest", for example 0.6%, 0.1% and 0.0% in 3-player Chinese Checkers against BRS at 66.8%, 75.0% and 74.1%. In 4-player Chinese Checkers BRS won 88.3%, 75.3% and 76.8%; in 4-player Focus 73.7%, 71.3% and 63.8%; in 4-player Blokus 48.8%, 54.7% and 67.3%. In Rolit, paranoid sometimes beat BRS (3-player at 5,000 ms: paranoid 66.5%, BRS 33.2%). — [Nijssen & Winands, "An Overview of Search Techniques in Multi-Player Games"](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)
- Same paper, MCTS tree structures. MCTS-maxn "clearly performs best" and its lead grows with time: 3-player Chinese Checkers 40.5%, 43.7% and 54.2%, against paranoid 35.5%, 27.5% and 19.0%. In 4-player Rolit, maxn scored 41.6%, 44.9% and 56.6%. Blokus showed no significant difference. MCTS-paranoid beat MCTS-BRS, possibly because BRS reaches illegal positions and play-outs from them are unreliable. — [Nijssen & Winands](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)
- BRS vs MCTS-maxn: no clear winner, and MCTS gains with time. In 6-player Chinese Checkers MCTS-maxn won 35.4%, 66.9% and 90.1% at 250/1,000/5,000 ms. In 4-player Rolit it won 78.7-88.6%. In 3-player Focus BRS won 90.1%, 80.6% and 71.7%. Play-outs per move in Chinese Checkers: about 700-1,166 at 250 ms. — [Nijssen & Winands](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)
- Original BRS (Schadd & Winands): BRS beat maxn in Chinese Checkers, Focus and Rolit, beat paranoid in Chinese Checkers and Focus, and tied in Rolit. BRS+ fixes illegal states by keeping turn order. — [Schadd & Winands, "Best Reply Search for Multiplayer Games"](https://dke.maastrichtuniversity.nl/m.winands/documents/BestReplySearch.pdf); [BRS+ (Esser et al.)](https://dke.maastrichtuniversity.nl/m.winands/documents/brsplus.pdf)
- Background cited by Goodman et al.: paranoid beats maxn in 4-player chess, and BRS and paranoid beat MCTS in several multiplayer games at small budgets. Opponent Move Abstraction shares statistics across nodes with the same own-move sequence. — [Goodman et al., "Visualising Multiplayer Game Spaces"](https://arxiv.org/pdf/2202.05773)
- MultiTree MCTS (one tree per player, each holding only that player's moves) over 11 TAG games at 40/200/1,000 ms. MT is "at least competitive" in most games and the best overall in Poker, Sushi Go! and Diamant. Three groups emerged:
  - No benefit at any budget: TicTacToe, Dots and Boxes, Dominion, Exploding Kittens, Uno.
  - Good at low budgets only, overtaken by MaxN as the budget grows: Poker, Sushi Go!, Virus. With more players the decline is slower.
  - MT or Self always dominant: Colt Express, Diamant, Love Letter.
  - Self-MCTS (opponents random) declines as the budget grows.
  - — [Goodman, Perez-Liebana & Lucas 2022](https://diego-perez.net/assets/pdf/papers/MultitreeMCTSTabletop-CoG22.pdf)
- TAG NTBEA tuning: as player count rises there is "a general pattern of shorter rollout lengths and less use of a Paranoid tree policy for more than 2 players". 24 of 216 Bonferroni-corrected tests showed player-count effects. — [Goodman et al. 2022](https://arxiv.org/pdf/2202.05773)
- Reward signal in multiplayer games, from Following the Leader (10 TAG games, 2-5 players, 40-1,000 ms):
  - Game score is "a much better reward signal than Win rate".
  - Combining score and winning was best in 8 of 10 games.
  - "Leader" (own score minus best opponent's score) was best in tactically interactive games with direct attacks.
  - "Score+" (own score with a ±50% bonus for winning or losing) was best in "multiplayer solitaire" games such as Dominion.
  - The best heuristic was fairly stable over the 25x budget range.
  - — [Goodman, Perez-Liebana & Lucas, "Following the Leader in Multiplayer Tabletop Games" (FDG 2023)](https://diego-perez.net/assets/pdf/papers/FollowingLeader-FDG23.pdf)

### Inferences
- Our play-outs already use maxn-style opponents: fast bots that each play for themselves. The evidence supports keeping that and not switching to paranoid or BRS opponent models in 3-5 players.
- If we ever add a tree, the MultiTree/Self results suggest that at our very low budget, a tree over our own sub-decisions (card, then target), with opponents played by the fast policy, is the most promising shape. A full maxn tree over 5 players is not.
- The evaluation's target matters. In an area-control/betting game with direct conflict, a "Leader"-style relative evaluation (own position minus best opponent) is supported for play-out scoring and leaf values, over raw own score. This could be tried as a variant of our hand-built evaluation, since it changes no rules.

### Gaps
- No 3-5 player result with hidden information and a small budget comparable to ours compares maxn, paranoid and BRS opponent models directly. The Nijssen & Winands games are perfect-information.

## 4. Rollout or play-out policies: MAST, NST, PPA, heuristic or ε-greedy, early termination with evaluation, RAVE/AMAF

### Takeaway
Better play-outs help, but "stronger" is not the same as "better for search". In Magic, simpler reduced-rules play-outs beat expert play-outs by about 10 points. Hand-weighted play-outs made Catan worse, while light rules (avoid obvious blunders) helped a lot in Lost Cities, Breakthrough and Hanabi. Ending play-outs early and scoring with an evaluation helps when a reasonable evaluation exists. Without one, it is a strong predictor of poor play. MAST and NST are cheap, game-independent improvements over random play-outs (about 70% win rate in GGP).

### Cited Findings
- Magic: reduced-rules play-outs "significantly outperform expert rules rollouts (by around 10% in most cases)", even though the reduced-rules player is much weaker. The authors cite the Go finding that stronger play-out policies do not necessarily give stronger MCTS, "probably due in large part to the bias that this may introduce". — [Cowling, Ward & Powley 2012](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)
- Catan: hand-weighted play-out probabilities (for example +10,000 for settlement or city builds) made the agent "dropped significantly" weaker than uniform play-outs. Adding domain knowledge in the tree as "virtual wins" (20 for settlements, 10 for cities, not backpropagated) "increased the playing strength... considerably". — [Szita, Chaslot & Spronck 2010](https://www.spronck.net/pubs/ACG12Szita.pdf)
- Lost Cities: heuristic play-outs that avoid obvious blunders "improve play over a random play-out by up to 40%". — [Pepels, Cazenave & Winands](https://www.lamsade.dauphine.fr/~cazenave/papers/po-hybrid.pdf)
- Breakthrough: a play-out policy that takes one-ply wins, blocks immediate losses and favours captures 4:1 beats uniform random 94.3%. Early-termination play-outs scored by an evaluation (ε-greedy plus dynamic early termination) beat that improved-policy baseline 68.8%. Implicit minimax backups (heuristic values backed up separately, mixed with α≈0.4) won 82.3% against MCTS with the improved policy, and 87.2% when both used fixed early termination at 20 moves. In Lines of Action with node priors, the implicit minimax version won 84.9% against the alternative baseline. — [Lanctot, Winands, Pepels & Sturtevant 2014, "MCTS with Heuristic Evaluations using Implicit Minimax Backups"](https://arxiv.org/pdf/1406.0486)
- Lorentz: even a weak evaluation can compare favourably to a long random play-out. Optimal termination points were found for three games. From a review summary; I did not get numbers. — [MCTS review (Świechowski et al. 2021)](https://arxiv.org/pdf/2103.04931); [Lorentz, Ten Years of MCTS](https://www.uni-trier.de/fileadmin/fb4/prof/BWL/FIN/Veranstaltungen/richard-lorentz.pdf)
- Ludii dataset (268,386 plays, 61 agents, 1,494 games): random play-outs cut off after 0 or 4 moves predict poor performance "irrespective of the game", because no heuristic evaluation was used. — [Soemers et al. 2024](https://arxiv.org/pdf/2406.09242)
- TAG baseline MCTS: removing the rollout entirely (evaluating the expanded node with the game's heuristic) increased performance in initial experiments. With 4,000 forward-model calls in 4-player games, MCTS had the highest win rate in 5 of 6 competitive games (overall 45.5%). Overall averages including Pandemic: MCTS 0.39, OSLA 0.27, RHEA 0.25, random 0.09. — [Gaina et al. 2020, "Design and Implementation of TAG"](https://diego-perez.net/assets/pdf/papers/TAG_Tabletop_Games_Framework.pdf)
- Rollout length in TAG. Full rollouts are advisable when significant points are scored only at game end, long-term planning is needed, or early score is deceptive (Colt Express, Sushi Go!, Dominion). Short rollouts suit games with direct adversarial counter-moves (Dots and Boxes, Virus). For many games, length "is not terribly important". Tuned optima: Dots and Boxes 0-3 (mode 0); Sushi Go! over 50, effectively to game end. — [Goodman et al. FDG 2023](https://diego-perez.net/assets/pdf/papers/FollowingLeader-FDG23.pdf)
- MultiTree paper: running every rollout to game end gave "weaker and sparser reward signals and lower overall playing strength" than scoring by game score with a ±50% win bonus. Pure score can be deceptive, for example Dominion's early VP buying. — [Goodman et al. 2022](https://diego-perez.net/assets/pdf/papers/MultitreeMCTSTabletop-CoG22.pdf)
- Hanabi: a heuristic simulation policy raised MO-ISMCTS from about 3.9 to 11.4-18.4. But under rule-restricted tree actions, the heuristic play-out policy did worse at short budgets with MO-ISMCTS (7.1-9.0, against 9.5-10.7 for random). — [Goodman 2019](https://arxiv.org/pdf/1902.06075)
- MAST, NST and PPA in GGP, 1,000 simulations, two-player games. Against random play-outs: MAST 70.1%, PPA (α=0.32) 66.7%, PPA (α=1) 60.8%, NST 72.3%, N-gram PPA 67.9%. Head to head against MAST, PPA scored 41.6-48.8%. Enhanced PPA is competitive with MAST at small budgets and better at larger ones. — [Sironi, Cazenave & Winands, "Enhancing Playout Policy Adaptation for GGP"](https://dke.maastrichtuniversity.nl/m.winands/documents/EnhancingPPAforGGP.pdf)
- Lord of the Rings: The Card Game (cooperative): expert-knowledge play-outs beat random ones. The best agent mixed expert rules at some decision stages with MCTS at others, winning over 95% of games at medium difficulty. — [Godlewski & Sawicki 2021](https://arxiv.org/pdf/2109.12001)

### Inferences
- Our play-outs use "simplified fast bots" to the end of the round, with an evaluation at the end. This is already early termination with an evaluation, which the evidence supports, given the evaluation is decent.
- The Magic and Catan results warn against making play-out bots smarter by giving them sharp heuristic preferences. Moderate rules plus randomness (avoid blunders, ε-greedy) is the profile that helps.
- MAST-style learning (keeping, within a decision, the average play-out value of each card or target type and biasing later play-outs with ε-greedy) is cheap. But it gets few samples at 24 play-outs per decision. It could be kept across a whole round or game.
- Implicit minimax backups (mixing the evaluation with play-out averages, α about 0.4) is a light, tested way to use our evaluation alongside play-outs at the shortlisted moves. We already have one-step scores, so blending the one-step score with the play-out mean, rather than discarding it, is the flat analogue. This is inference, not tested.

### Gaps
- RAVE/AMAF: I retrieved no numbers in board or card games with hidden information. AMAF assumes a move's value does not depend on when it is played, which is doubtful for targeted card plays.
- No direct measurement of play-out length (end of round vs end of game vs fixed depth) in a betting or area-control game.

## 5. Budget allocation: sequential halving, UCB vs flat at the root, simple regret

### Takeaway
At the root, choosing which candidate to sample is a simple-regret problem. Sequential Halving is parameter-free and matched or beat UCB in all four partially observable card and phantom games tested. In Lost Cities and Phantom Domineering, tree search did not beat flat sampling at 10k-25k play-outs. At very low budgets, flat Monte Carlo beats tree search (microRTS).

### Cited Findings
- Sequential Halving for partially observable games (Go Fish, Lost Cities, Phantom Domineering, Phantom Go; 10,000 and 25,000 play-outs; at least 1,000 games; single-observer ISMCTS):
  - "Only in Go Fish did performing search improve performance over flat Monte-Carlo sampling."
  - At 10k play-outs, H-MCTS (Sequential Halving at the root, UCT below) beat plain MCTS in all games: Go Fish 54.3%, Phantom Domineering 59.9%, Lost Cities 54.1%.
  - Flat SH against flat UCB: Lost Cities 50.1-52.8%; Phantom Domineering up to +8.6 points; Phantom Go up to +7.1 points, and 69.6% at C=0.1.
  - "In all cases... SH or H-MCTS either outperforms MCTS and UCB significantly, or does not negatively impact performance."
  - — [Pepels, Cazenave & Winands, "Sequential Halving for Partially Observable Games"](https://www.lamsade.dauphine.fr/~cazenave/papers/po-hybrid.pdf)
- H-MCTS in two-player perfect-information games: SHOT-style Sequential Halving near the root, UCT deeper. It beat UCT by up to 65.2% in Amazons, AtariGo and Pentalath, and up to 61.3% in Breakthrough with informed play-outs. — [Pepels, Cazenave, Winands & Lanctot 2014, "Minimizing Simple and Cumulative Regret in MCTS"](https://www.lamsade.dauphine.fr/~cazenave/papers/PepelsCGW2014.pdf)
- Sequential Halving with prior "scores" (for example from a heuristic or AMAF) fits outside knowledge into SH's elimination rounds; it is theoretical and experimental work. — [Fabiano & Cazenave, "Sequential Halving Using Scores"](https://www.lamsade.dauphine.fr/~cazenave/papers/SequentialHalvingUsingScores.pdf)
- microRTS: flat MC beats MCTS at very low budgets, and ε-greedy flat MC was best at about 500 play-outs. MCTS overtakes at larger budgets. — [Ontañón 2017](https://arxiv.org/pdf/1710.04805)
- Dou Di Zhu: a commercial AI using flat MC with heuristics drew level with ISMCTS and determinized UCT (10,000 iterations) once given 100x its normal simulations. — [Cowling et al. 2012](https://eprints.whiterose.ac.uk/75048/1/CowlingPowleyWhitehouse2012.pdf)

### Inferences
- With 6 candidates × 4 play-outs, our allocation is uniform. One Sequential Halving step fits the same 24 play-outs, for example 6×2, then the top 3 get 2 more each and the top 2 get 3 more each (exact splits are a design choice, not from the papers). Or SH can run over a wider shortlist: 12 → 6 → 3 → 1 with roughly 1-2 play-outs each per round, using the same total. The SH evidence (parameter-free, never worse than UCB) makes this a low-risk thing to try. Its benefit depends on play-out noise. At 2-4 play-outs per arm, round results are very noisy, which could cancel the gain: inference.
- The flat-MC evidence (Lost Cities, Phantom Domineering, microRTS at low budgets) supports keeping flat play-outs at the root rather than building a tree at our budget.

### Gaps
- No SH results at budgets as small as about 24-100 play-outs per decision.

## 6. TAG (Tabletop Games Framework): agent comparisons and parameters that mattered

### Takeaway
In TAG, default MCTS is the strongest general agent: 4-player overall 0.39 against OSLA 0.27 and RHEA 0.25; in Terraforming Mars it beat OSLA 75% head to head. RHEA trails OSLA in hidden-information, stochastic games. The parameters that matter most are Open Loop vs closed, Information Set vs single determinization, rollout length, and opponent tree policy. Their optima vary by game and player count. Score-based evaluation with a winning bonus, or relative ("Leader") scoring, beats win/loss rewards.

### Cited Findings
- TAG initial study, 4-player, 100 games, 4,000 forward-model calls, game heuristics: MCTS 0.39 overall (best in 5 of 6 competitive games, 45.5%), OSLA 0.27, RHEA 0.25, random 0.09. Love Letter: MCTS 0.44, RHEA 0.32, OSLA 0.24. Virus: 0.42, 0.30, 0.27. In Uno (22-26%) and Colt Express (19-29%) all agents were close, including random. RHEA (sequence length 10, discount 0.9, opponents random) "still falls behind the OSLA agent", attributed to rigid action sequences under uncertainty. MCTS was closed-loop with no rollout, because removing the rollout helped. — [Gaina et al. 2020](https://diego-perez.net/assets/pdf/papers/TAG_Tabletop_Games_Framework.pdf)
- NTBEA over nine MCTS parameters (search space 48,000), 30 runs per game × player count × opponent, 40 ms per decision. Games: Dots and Boxes, Love Letter, Uno, Virus, Exploding Kittens, Colt Express, Dominion, Diamant. Parameters: tree policy {UCB, AlphaZero-style, EXP3, Regret Matching}, opponent tree policy {MaxN, Paranoid, SelfOnly}, rollout {0, 3, 10, 30, 100}, tree depth, Open Loop, redeterminise (IS-MCTS), K, and others. The first principal component separated Open Loop, IS-MCTS and Self-Only (hidden-information games: Love Letter, Exploding Kittens) from Paranoid and Regret Matching (adversarial: Dots and Boxes, 2-player Uno). The second separated games needing deep rollouts (Diamant, Colt Express, Exploding Kittens) from those where a few steps suffice (Dots and Boxes, 2-player Uno, Love Letter, Virus). — [Goodman et al., "Visualising Multiplayer Game Spaces"](https://arxiv.org/pdf/2202.05773)
- Same study: RMHC (Random Mutation Hill Climbing) with horizons 3 and 20 was included. RMHC and random did relatively better in Uno than in other games. Optimal MCTS parameters for Uno differ sharply between 2 players and 3-4 players. — [Goodman et al. 2022](https://arxiv.org/pdf/2202.05773)
- MultiTree and the "Following the Leader" results are in sections 3 and 4. Sushi Go!, a drafting game with simultaneous picks, was one where MultiTree MCTS was the best overall variant at low budgets. The authors note that a single vanilla tree "is incorrect" for simultaneous moves. Sushi Go! also needs rollouts to near game end (tuned length over 50). — [MultiTree 2022](https://diego-perez.net/assets/pdf/papers/MultitreeMCTSTabletop-CoG22.pdf); [Following the Leader 2023](https://diego-perez.net/assets/pdf/papers/FollowingLeader-FDG23.pdf)

### Inferences
- Sushi Go! is the closest TAG analogue to our drafting. If our draft picks are simultaneous, a single tree mixing all players' picks would be modelling them wrongly. Flat evaluation of our own pick with opponents' picks sampled (what we do now) is consistent with the MultiTree finding.
- For area control with betting and direct conflict, the TAG evidence leans toward a relative ("Leader") evaluation and moderate rollout lengths, with end-of-round being reasonable. Points scored only at game end would argue for longer rollouts.
- RHEA's poor showing under hidden information argues against rolling-horizon evolution as a replacement for our flat MC.

### Gaps
- I found no TAG study on an area-control or betting game. TAG contains other games (for example Catan, Stratego, Terraforming Mars, Power Grid in later versions), but I found no agent-comparison numbers for those besides Terraforming Mars.
- I did not retrieve later TAG work on action abstraction or MCTS action groups, if any exists.

## 7. Ludii / OpenSpiel benchmark findings

### Takeaway
I found little Ludii or OpenSpiel evidence specific to this setting. The large Ludii dataset mainly confirms that early play-out cut-off without an evaluation is harmful, and that MCTS variants' strengths vary by game.

### Cited Findings
- Ludii dataset: 268,386 plays, 61 MCTS agents (UCB1, UCB1-Tuned, GRAVE, Progressive History; play-out strategies random, MAST, NST, and random with 0- or 4-move cut-off), 1,494 games. Random play-outs with early cut-off are a strong predictor of poor performance without heuristics. The authors describe their characterisation of which variants suit which games as preliminary. — [Soemers et al. 2024](https://arxiv.org/pdf/2406.09242)
- Optimised play-out implementations for Ludii exist, showing play-out speed is a recognised bottleneck. Not read in full. — [Optimised Playout Implementations for Ludii](https://arxiv.org/pdf/2111.02839)

### Inferences
- Speeding up play-outs would let more of them fit in the same time. Given the "flat MC wins at low budget" and "SH is never worse" results, more play-outs per candidate is likely worth more than a smarter search shape. This is inference.

### Gaps
- No OpenSpiel benchmark results relevant to multiplayer imperfect-information board games were retrieved.

## Cross-cutting ranking evidence (for the report writer)

Each item below is evidence-weighted and labelled as inference.
- **Strongest evidence, likely high value for us:** restricting or structuring the action space: Hanabi 4→17 points; Magic binary tree 37%→52% against expert, and faster. Better candidate generation and a card-then-target split fall here.
- **Solid evidence, low risk:** Sequential Halving at the root over flat MC: never worse than UCB, +7-9 points in phantom games, parameter-free.
- **Solid evidence, needs care:** an evaluation-based leaf or play-out cut-off, blended with play-outs (implicit minimax backups +18-37 points in Breakthrough and LOA). A relative ("Leader") reward for interactive multiplayer games.
- **Mixed evidence:** heuristic play-out policies. They help when they avoid blunders (Lost Cities +40%, Breakthrough 94%). They hurt when sharply opinionated (Catan drop; Magic expert play-outs about 10 points worse than reduced rules).
- **Weak for our budget:** ISMCTS, MO-ISMCTS and full multiplayer trees. They are 2-4x slower per iteration and win only with seconds of compute. Paranoid and BRS opponent models are not supported in MCTS for 3+ players.
