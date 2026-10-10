# Game-tree search for multiplayer imperfect-information board and card games (bots for Monster of the Week)

Scope note: about 18 tool calls. Several primary PDFs (TAG design paper, Cowling/Ward/Powley Magic paper) came back as compressed binary and could not be read, so a number of exact figures are missing and are listed under Gaps. Anything not tied to a URL is marked as an inference or background knowledge, not a cited finding.

## 1. ISMCTS, determinization (PIMC), and their failure modes; when PIMC is enough

### Takeaway
Determinization/PIMC (sample a full hidden state, search it as perfect information, average over samples) is the cheap baseline and is state of the art in trick-taking card games despite strategy fusion and non-locality. ISMCTS (one tree over information sets, a fresh determinization each iteration) fixes strategy fusion and is reported to beat determinized UCT, but on Dou Di Zhu the two were not significantly different. Our current bot (a few seeded play-outs per candidate, peeking tolerated) is a form of PIMC with flat Monte Carlo at the root.

### Cited Findings
- ISMCTS (Cowling, Powley & Whitehouse, IEEE TCIAIG 2012, pp. 120–143) searches trees of information sets instead of minimax trees of game states, "more directly analyzing the true structure of the game"; three ISMCTS variants, each for a different source of hidden information/uncertainty, tested on three domains; abstract says they "outperform existing approaches to handling hidden information and uncertainty" — [White Rose eprint 75048](https://eprints.whiterose.ac.uk/id/eprint/75048/); [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931)
- ISMCTS is described as tackling strategy fusion: the false assumption that different moves can be chosen in different states the player cannot tell apart — [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931)
- On Dou Di Zhu, Whitehouse et al. compared determinized MCTS and information-set MCTS and reported no significant performance difference between them — [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931)
- Determinization's two critical problems are named as non-locality and strategy fusion; Whitehouse et al. (2011) are credited with introducing determinization in this MCTS line — [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931)
- Ensemble determinization was applied to Magic: The Gathering (Cowling, Ward, Powley 2012); determinizing there increases the branching factor, so domain-knowledge move pruning and a binary representation of the tree were used — [White Rose eprint 75050](https://eprints.whiterose.ac.uk/id/eprint/75050/); [MCTS review](https://arxiv.org/pdf/2103.04931)
- PIMC defined: sample a world consistent with the infostate, solve it with a perfect-information evaluator (rollouts or minimax), pick the action with best average over samples. Flaws: strategy fusion (Rock-Paper-Scissors example in which PIMC prefers "Play" over the correct "Leave"), non-locality, leaking private information, no guarantees. Determinization methods "considered state-of-the-art in various trick-taking card games", with superhuman play in Skat and Contract Bridge cited — [Perfect Information Monte Carlo with Postponing Reasoning (EPIMC), arXiv 2408.02380](https://ar5iv.labs.arxiv.org/html/2408.02380)
- EPIMC (postpones resolution of hidden info to depth d) beats PIMC: Dark Chess ~80% / 65% / 45% win rate at depths 3/2/1 (100 s vs PIMC at 1 s); in Dark Hex 3x3, a minimax leaf evaluator ~70% vs random rollout ~50%; in games with mostly public observations (a card game, Battleship) depth gave no clear improvement. EPIMC and IS-MCTS were the two best online algorithms tested (vs OOS, IIMC, random); IS-MCTS exploration constant 1 chosen from {0.6, 1, 1.5, 2} — [arXiv 2408.02380](https://ar5iv.labs.arxiv.org/html/2408.02380)
- Long, Sturtevant, Buro & Furtak (AAAI 2010) explain PIMC success with synthetic trees parameterised by leaf correlation (how often sibling leaves share a payoff), bias, and disambiguation factor (how fast a player's information sets split, i.e. how quickly hidden info is revealed); they show these properties can be measured in real games and predict PIMC strength — [AAAI 2010 paper page](https://ojs.aaai.org/index.php/AAAI/article/view/7562); parameter definitions from a secondary source, [Sturtevant lecture slides](https://www.cs.du.edu/~sturtevant/w13-games/Lecture10.pdf)

### Inferences
- MotW has properties that favour PIMC: hidden information is mostly hands and face-down cards that are revealed within a round (high disambiguation), and outcomes are smooth (area-control standing and set collection, high leaf correlation). The EPIMC result that "mostly public observation" games gain little from deeper hidden-info reasoning points the same way. So the expected gain from moving to full ISMCTS is modest; the bigger risk is the peeking itself.
- The cheapest honest step is to replace peeking with determinization: before each play-out, redeal unknown cards (opponent hands, face-down cards, deck) consistent with what the bot has seen (cards it passed in the draft are known to be in a specific neighbour's hand). This is what both PIMC and ISMCTS do per iteration; it removes the information leak and costs only a shuffle.
- Strategy fusion matters most for bluff decisions (face-down cards with bluff tokens): a peeking or determinized searcher will "know" whether a face-down card is a bluff and never value bluffing or calling correctly. If bluffing matters for play strength, those decisions are where SO-ISMCTS (one tree over the acting player's information sets) or a hand-written heuristic is worth more than more play-outs.
- Background knowledge (not verified here): SO-ISMCTS ignores that opponents also act on information sets; MO-ISMCTS keeps one tree per player to model that, at higher cost. For a 5-player game in JavaScript, SO-ISMCTS with determinization per iteration is the practical ceiling.

### Gaps
- Exact ISMCTS vs determinized-UCT win rates on Lord of the Rings: The Confrontation, Phantom (4,4,4) and Dou Di Zhu: the full TCIAIG paper/Whitehouse thesis was not readable in this session ([thesis](https://etheses.whiterose.ac.uk/id/eprint/8117/)).
- Magic ensemble sizes (number of determinizations vs iterations each): PDF returned as binary.
- Specific PIMC results for Skat (Kermit/Buro), Bridge (GIB), Hearts (Sturtevant) were not retrieved.

## 2. Multiplayer search: max^n, paranoid, BRS, MCTS with vector rewards (5 players)

### Takeaway
For alpha-beta-style search in multiplayer games, Best Reply Search is generally the strongest, but inside MCTS the max^n structure (each node maximises the mover's own component of a reward vector) works best. UCT in multiplayer games converges toward mixed strategies and matches or beats max^n and paranoid. For 5 players, plain MCTS with a per-player score vector backed up is the evidence-supported default.

### Cited Findings
- Best-Reply Search (Schadd & Winands, IEEE TCIAIG 3(1), 2011, pp. 57–66): only the single opponent with the strongest counter-move moves between the root player's turns. BRS beat max^n in all three games tested and beat paranoid in Chinese Checkers and Focus, tying in Rolit — [Maastricht PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/BestReplySearch.pdf); [CRIS record](https://cris.maastrichtuniversity.nl/en/publications/best-reply-search-for-multiplayer-games)
- BRS can visit illegal states (it breaks turn order); BRS+ (Esser, Gras, Winands, Schadd, Lanctot) keeps turn order by letting the other opponents play a fixed ordered move, and in Four-Player Chess won 8.3%–11.1% more games against max^n and paranoid than BRS — [BRS+ PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/brsplus.pdf); [CRIS](https://cris.maastrichtuniversity.nl/en/publications/improving-best-reply-search/)
- Nijssen & Winands overview over Chinese Checkers, Focus, Rolit and Blokus: BRS generally the best alpha-beta-based technique; MCTS works best with the max^n tree structure — [Overview PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf); [CGW paper](https://dke.maastrichtuniversity.nl/pim.nijssen/pub/cgw.pdf)
- Nijssen's thesis tested MCTS-max^n, MCTS-paranoid and MCTS-BRS; max^n performed best, because the pruning advantages of paranoid/BRS in minimax do not carry over to MCTS — [Nijssen thesis](https://project.dke.maastrichtuniversity.nl/games/files/phd/Nijssen_thesis.pdf)
- Sturtevant (2008): multiplayer UCT computes a mixed-strategy equilibrium (max^n computes a pure one) and performs as well or better than existing algorithms in several domains; MCTS outperformed max^n and paranoid in Chinese Checkers. He also proposes branching factor and n-ply state variance as predictors of whether UCT enhancements help — [Sturtevant 2008 analysis](https://www.cs.du.edu/~sturtevant/papers/sturtevant2008analysis.html); [CG2008 slides](https://webdocs.cs.ualberta.ca/~nathanst/talks/CG2008.pdf); [Nijssen & Winands cg10](https://dke.maastrichtuniversity.nl/pim.nijssen/pub/cg10.pdf)
- Pre-UCT, paranoid widely outperformed max^n in Chinese Checkers, by less in Hearts, and they were even in Spades — [Sturtevant 2002 comparison](https://www.cs.du.edu/~sturtevant/papers/sturtevant2002comparison.html)
- A 2026 arXiv study restates that BRS can outperform max^n and often paranoid in Chinese Checkers, Focus and Rolit — [arXiv 2604.17378](https://arxiv.org/pdf/2604.17378)
- TAG group (Goodman, Perez-Liebana, Lucas) has tabletop-specific multiplayer MCTS work: "MultiTree MCTS in Tabletop Games" (IEEE CoG 2022, pp. 292–299) and "Following the Leader in Multiplayer Tabletop Games" (FDG 2023) — [dblp](https://dblp1.uni-trier.de/pid/147/0864.html); [QMUL listing](https://researchpublications.qmul.ac.uk/publications/staff/47293.html)

### Inferences
- Our two-ending game is a natural fit for vector rewards: back up each seat's projected win chance (the heuristic evaluation we already have) as a 5-vector and let each seat maximise its own entry. This is max^n-in-MCTS, which is what the evidence favours.
- Paranoid/BRS assumptions ("everyone is against me") fit poorly when win conditions differ by seat (island vs invaders backers) and coalitions shift; they are designed for pruning in alpha-beta, which we are not doing.
- A cheap BRS-like idea for our flat search: when scoring a candidate, let only the strongest-threat opponent search its reply and let other seats play their fast heuristic. This is an inference, not tested.

### Gaps
- Content of "Following the Leader" and "MultiTree MCTS" (exact results, whether leader-targeting helps) not retrieved; worth reading since our bots fight over a standing lead.
- No 5-player-specific comparisons found; most evidence is 3–4 (sometimes 6) players.

## 3. Large or combinatorial action spaces

### Takeaway
Little was retrieved directly in this session. The evidence found is that domain-knowledge move pruning was needed even for Magic, and that multiplayer tabletop MCTS work (MultiTree) exists. Progressive widening/unpruning and move groups are standard, but I could not fetch primary sources.

### Cited Findings
- Magic MCTS used move pruning with domain knowledge and a binary tree representation to tame the branching factor that determinization introduces — [MCTS review, arXiv 2103.04931](https://arxiv.org/pdf/2103.04931); [EnsDet Magic eprint](https://eprints.whiterose.ac.uk/id/eprint/75050/)
- The 2021 MCTS review surveys modifications for high-branching-factor games (its abstract names them as needing problem-specific modifications) — [arXiv 2103.04931](https://arxiv.org/abs/2103.04931)

### Inferences
- Our action is roughly (card) x (action or influence) x (target region / face-down choice). Background knowledge (unverified here): "move groups" / binary decomposition means choosing the card first, then the mode, then the target as separate tree levels, so statistics on "play card X" are shared across targets. The Magic binary tree is one instance of this.
- Our top-k pre-filter by heuristic is a crude form of progressive unpruning (Chaslot): progressive unpruning adds children in heuristic order as the visit count grows, so it becomes the same as ours at low budgets and widens when the budget allows.

### Gaps
- Primary sources for progressive widening (Coulom; Couëtoux/Teytaud), progressive unpruning/bias (Chaslot et al. 2008), and move groups (Childs, Brodeur & Kocsis 2008) were not fetched; their numbers are not cited.

## 4. Play-out policy: heuristic vs random, MAST/NST/PPA, early cutoff with evaluation

### Takeaway
Evidence found: a heuristic leaf evaluator beats random rollouts (Dark Hex ~70% vs ~50%); implicit minimax backups that mix heuristic evaluations into MCTS values improve play; searching inside play-outs improves play-out quality but only pays off with enough thinking time. TAG's default MCTS cuts off rollouts at a fixed depth of 10 and evaluates.

### Cited Findings
- Implicit minimax backups (Lanctot, Winands, Pepels, Sturtevant 2014): store win rates and heuristic evaluations separately, back up heuristic values by minimax, and use a mix of both to guide selection; stronger play in Kalah, Breakthrough and Lines of Action — [arXiv 1406.0486](https://arxiv.org/abs/1406.0486)
- In EPIMC, a minimax leaf evaluator reached ~70% vs ~50% for a random-rollout evaluator (Dark Hex 3x3) — [arXiv 2408.02380](https://ar5iv.labs.arxiv.org/html/2408.02380)
- Playout search (small max^n/paranoid/BRS searches inside MCTS play-outs, Nijssen & Winands): clearly improves play-out quality in Focus and Chinese Checkers but slows play-outs, cancelling the gain at short thinking times; with more time, paranoid playout search gave a significant gain in 4-player Focus and 3-player Chinese Checkers — [CRIS record](https://cris.maastrichtuniversity.nl/en/publications/playout-search-for-monte-carlo-tree-search-in-multi-player-games); [acg11 PDF](https://dke.maastrichtuniversity.nl/pim.nijssen/pub/acg11.pdf)
- TAG's MCTS is closed-loop (stores game states in nodes) and uses a rollout depth of L=10 before evaluating; the default TAG MCTS is not tuned per game — as summarised from the TAG and PyTAG papers — [TAG design, arXiv 2009.12065](https://arxiv.org/pdf/2009.12065); [PyTAG, arXiv 2405.18123](https://arxiv.org/pdf/2405.18123)
- In GVGAI, RHEA with rollouts helped in many games, and seeding RHEA's population helps only at small population/length — [arXiv 1704.06942](https://arxiv.org/pdf/1704.06942)
- MCTS is robust to inaccurate opponent models, whereas RHEA is badly hurt; with an unknown opponent and small budget, MCTS should model opponent actions in its own tree rather than use an explicit model (Goodman & Lucas, CEC 2020, an RTS game) — [arXiv 2006.08659](https://arxiv.org/abs/2006.08659v1)

### Inferences
- Our setup (heuristic bots in play-outs to round end, then the projected-win-chance evaluation) already follows the evidence: informed play-outs plus early cutoff with an evaluation. The Nijssen result is a direct warning for us: making the play-out bots smarter (e.g. giving them their own shallow search) only pays when the budget is large; at our ~13 min/game it probably will not.
- A shorter play-out (cut off after N turns rather than at round end) trades evaluation bias for more samples; the TAG default of 10 actions is a data point, not a rule for us.
- The Goodman & Lucas result supports our "every seat plays its own profile" approach being tolerable even if the profiles are wrong, as long as the root search is MCTS-like.

### Gaps
- MAST, NST and PPA (Cazenave's playout policy adaptation) results were not retrieved; no cited numbers.

## 5. Simultaneous moves (the draft)

### Takeaway
For simultaneous-move games, decoupled UCT (each player runs its own bandit over its own actions at the joint node) performed best overall in a nine-game empirical study despite lacking guarantees; Exp3 and regret matching give convergence to approximate Nash equilibrium in two-player zero-sum settings.

### Cited Findings
- Lisý, Kovařík, Lanctot & Bošanský (NeurIPS 2013): if the selection method is ε-Hannan-consistent in matrix games and explores enough, simultaneous-move MCTS converges to an approximate Nash equilibrium (zero-sum, two-player); experiments with regret matching and Exp3 — [arXiv 1310.8613](https://ar5iv.arxiv.org/html/1310.8613); [NeurIPS](https://proceedings.neurips.cc/paper/2013/hash/1579779b98ce9edb98dd85606f2c119d-Abstract.html)
- Follow-up analysis of Hannan-consistent selection (Exp3, regret matching, Goofspiel among domains) — [arXiv 1509.00149](https://arxiv.org/pdf/1509.00149)
- Maastricht study of nine simultaneous-move games compared Decoupled UCT, Sequential UCT, Exp3 and Regret Matching: Decoupled UCT performed best overall — [CRIS record](https://cris.maastrichtuniversity.nl/portal/en/publications/monte-carlo-tree-search-variants-for-simultaneous-move-games(5e4c8118-4db7-49bf-b12d-d16ee90fe167).html); see also [Tron SM-MCTS](https://dke.maastrichtuniversity.nl/m.winands/documents/sm-tron-bnaic2013.pdf)
- A master's thesis built a Sushi Go! (a pick-and-pass drafting game) AI using DUCT and Exp3 — [Charles University record](https://dspace.cuni.cz/handle/20.500.11956/120975?show=full)

### Inferences
- Our draft pick is simultaneous but the main hidden information is what neighbours hold; with peeking removed, it becomes "choose a card given a determinized set of other hands". Decoupled UCT (each seat its own UCB over its own picks at the joint node) is the simplest fit and has the best empirical record. The convergence guarantees are for 2-player zero-sum only, so they do not apply to 5 players anyway.
- Cheapest version: treat our existing root-only candidate scoring as DUCT at depth 1 (our seat's bandit; opponents' picks by their heuristic profiles).

### Gaps
- Sushi Go thesis results (DUCT vs Exp3 win rates) not retrieved (fetch timed out).

## 6. Budget allocation, transpositions, parallelisation

### Takeaway
Not well covered by sources retrieved here. Our top-k + few play-outs per candidate is flat Monte Carlo at the root; sequential halving and UCB on top-k are the standard ways to spend that budget better, and root parallelisation is the easy multi-core option, but I have no fetched primary results.

### Cited Findings
- No primary sources on sequential halving (Karnin et al.; Pepels et al. H-MCTS/SHOT), root parallelisation (Chaslot et al. 2008) or transpositions were retrieved in this session.

### Inferences
- Sequential halving on our top-k: give all k candidates a few play-outs, drop the worse half, double the play-outs for the rest, repeat. It is a drop-in change to simPick, needs no tree, and targets the decision ("which move is best") rather than estimating every candidate equally. Use common random seeds across candidates within a round (the same determinizations/play-out seeds for every candidate) to reduce variance in comparisons.
- Root parallelisation (independent searches per core, summed visit counts) is the easy way to use 8 cores in Node (worker_threads), but since we already run many games in parallel for testing, parallelising inside a move gives no throughput gain for tuning runs; it only helps latency when a human plays.

### Gaps
- Published numbers for sequential halving vs UCB at the root, and for root vs tree parallelisation, need a follow-up search.

## 7. Published results in board games and TAG; practical JavaScript advice

### Takeaway
The TAG framework uses closed-loop MCTS with depth-10 rollouts as an untuned default opponent, alongside Random, OSLA and RHEA. I could not read its per-game results table. No sourced results were retrieved for Lords of War, Splendor, 7 Wonders, Catan or Kingdomino.

### Cited Findings
- TAG baselines include Random, One Step Look Ahead (try every action with the forward model, pick best by heuristic), MCTS and RHEA; MCTS is closed-loop with depth-10 rollouts — [TAG design, arXiv 2009.12065](https://arxiv.org/pdf/2009.12065); [PyTAG, arXiv 2405.18123](https://arxiv.org/pdf/2405.18123)
- In the Stratega strategy-game framework, MCTS and RHEA, though good at general game playing, "seem to struggle" with the higher complexity of strategy games — [Stratega, arXiv 2009.05643](https://arxiv.org/pdf/2009.05643)
- Online MCTS parameter tuning was comparable to randomising parameters before each simulation in GVGP (Sironi & Winands, JAIR 2021) — [JAIR 72](https://jair.org/index.php/jair/article/download/12065/26735)

### Inferences
- Practical JS points (engineering inference, not sourced): state cloning usually dominates play-out cost, so prefer flat typed arrays or small plain objects with structuredClone avoided in hot loops; an apply/undo move pair or a copy-on-write round state is often several times cheaper. Determinizing per play-out only needs reshuffling the unknown cards, not a full clone.
- Fewer play-outs with a better evaluation usually beats more play-outs with a worse one at small budgets (supported by the playout-search and minimax-evaluator findings above). Given ~13 min per game, the first levers are: sequential halving on top-k, common random seeds across candidates, and shortening play-outs with the existing evaluation, before any tree search.

### Gaps
- TAG per-game agent win rates (the PDF could not be parsed here).
- Published bot results for Lords of War (Dockhorn/ISMCTS work), Splendor, 7 Wonders (Robilliard et al. MCTS), Settlers of Catan (Szita, Chaslot & Spronck MCTS), Kingdomino: not retrieved; names are from background knowledge and need checking.
