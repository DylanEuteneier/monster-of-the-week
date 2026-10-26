# Bots on digital board game platforms and in commercial adaptations

Scope note: about 25 tool calls across two sessions (the first was cut off by a server overload). Coverage is uneven. The best public material is the Temple Gates write-ups (Race for the Galaxy, Dominion), the BGA Studio wiki, and the Ludii and OpenSpiel docs. For most of the requested commercial titles (Root, Twilight Struggle, Terraforming Mars, Through the Ages, and others) I found no public technical write-up. Those are listed under Gaps rather than guessed at.

## 1. Board Game Arena (BGA): which games have bots and how they are built

### Takeaway
BGA has no bot framework. Every bot is custom server-side code (PHP) running inside the game's state machine as "fake players", and the official wiki says the existing bot modes are scripted Automa solo rules, not real AI. BGA is a poor source of AI technique. Its lesson is about constraints: bots must run in the server request cycle, with no persistent AI process.

### Cited Findings
- The wiki says: "There is no framework support (now) for AI/Bots, so it is all custom stuff." — [BGA wiki: Bots and Artificial Intelligence](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- Games with bot modes include Conspiracy, Glow, The Crew, The Crew: Deep Sea and Tapestry. The wiki says none of them is a real AI: "Usually its implementation of 'Automa' rules of the games, so you can play solo game." — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- Can't Stop is the only game whose AI was a separate registered player. Admins "won't reveal how it is done nor that is feasible to implement in other games". That bot was reportedly discontinued after the game moved to premium. — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence) (the discontinuation is per a forum reply quoted on the wiki or in search results; I did not verify it independently)
- The wiki lists four approaches:
  1. A JS "testing bot" that presses buttons in Studio. It is for testing only.
  2. JS AI. Not feasible, because it needs a real connected player and a browser.
  3. A server bot as a registered player. Ideal, but only Can't Stop has it.
  4. A server bot as a game-state action. Fake players are simulated inside the game states, and the wiki calls this the only feasible production approach.

  — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- Implementation details for fake players:
  - Reserve nonexistent player IDs (1–6).
  - Keep bots in a separate `playerextra` table (color, order, score, AI flag).
  - Write action functions that take `$player_id` instead of the active player.
  - Separate AJAX handlers from the functional code so a bot can call the same code.
  - Use `addAutomataPlayerPanel` for the player panel.
  - Bots must appear in `getAllDatas()` players.

  — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- The wiki page does not mention CPU or time limits for bot computation. — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence)
- A separate BGA wiki page (Apr 2026) says no AI model can yet code a meaningful BGA game end to end. It recommends narrower uses such as boilerplate and unit tests. — [BGA wiki: Using AI for BGA game development](https://en.doc.boardgamearena.com/Using_AI_for_BGA_game_development)

### Inferences
- BGA's practical "bots" are rule-scripted Automa decks or flowcharts, because:
  - PHP runs per request, with no long-running process.
  - There is no framework for simulation.
  - Search-based bots would need a copy of the rules engine that can run detached from the database.
- A pure JS engine like ours (rules in one pure module) is already in a better position than a typical BGA implementation for simulation-based bots.

### Gaps
- I found no BGA developer forum post describing a search-based (MCTS or Monte Carlo) bot in production, and no stated server time budget.
- I did not check which other BGA games have added bots since the wiki page was written.

## 2. Other platforms: Ludii, OpenSpiel, Yucata, boardgamecore, Tabletop Simulator

### Takeaway
The general game systems ship generic search: flat Monte Carlo, UCT/MCTS variants, and alpha-beta with paranoid/MaxN for more than two players. OpenSpiel adds hidden-information search (IS-MCTS, PIMC) and the CFR family, but marks IS-MCTS and PIMC only "lightly tested". Neither is a drop-in for a 5-player hidden-hand game with hundreds of targets per card.

### Cited Findings
- Ludii's AI repository provides:
  - Random.
  - Flat Monte Carlo search.
  - MCTS with standard UCT, a PUCT selection phase ("AlphaZero-like but without a value head"), GRAVE, tree reuse and other options.
  - Alpha-beta with iterative deepening and selectable heuristics.
  - A meta-agent, "Ludii AI", that reads hints in each game file's metadata and picks the "best" of these per game and options.

  — [LudiiAI on GitHub](https://github.com/Ludeme/LudiiAI)
- For more than two players, Ludii's alpha-beta "uses a paranoid search". If time remains after a completed paranoid search, it restarts with MaxN. — [LudiiAI on GitHub](https://github.com/Ludeme/LudiiAI)
- Ludii's user-guide appendix on AIs was written for v0.2.0 and is out of date (it predates alpha-beta). — [Ludii forum](https://ludii.games/forums/showthread.php?tid=33)
- Research on MCTS performance across Ludii games compares UCB1, UCB1-GRAVE, Progressive History and UCB1-Tuned, with exploration constants 0.1, 0.6 and √2. Ludii maps results to [-1, 1]. — [Towards a Characterisation of MCTS Performance in Different Games (arXiv 2406.09242)](https://arxiv.org/pdf/2406.09242)
- OpenSpiel lists these search methods, with a testing status for each:
  - Information Set MCTS [lightly tested]
  - Max^n [lightly tested]
  - Minimax/alpha-beta [thoroughly tested]
  - MCTS [thoroughly tested]
  - Perfect Information Monte Carlo, i.e. determinization [lightly tested]

  — [OpenSpiel algorithms.md](https://raw.githubusercontent.com/deepmind/open_spiel/master/docs/algorithms.md)
- OpenSpiel's other families:
  - CFR: CFR, CFR-BR, external- and outcome-sampling MCCFR, Deep CFR, RCFR.
  - Multi-agent RL: AlphaZero, NFSP, PSRO and others.
  - RL: DQN, A2C, PPO.

  — [OpenSpiel algorithms.md](https://raw.githubusercontent.com/deepmind/open_spiel/master/docs/algorithms.md)
- The framework covers n-player zero-sum, cooperative and general-sum games, including imperfect-information ones. The paper's algorithm tables have not been updated since Oct 2019, and the docs page is the maintained list. — [OpenSpiel paper (arXiv 1908.09453)](https://arxiv.org/pdf/1908.09453)

### Inferences
- In the academic platforms, the cheap default for multiplayer hidden information is determinization (PIMC) plus MCTS or flat Monte Carlo. ISMCTS is the next step up. CFR-style methods aim at equilibrium in small or abstracted games and do not obviously scale to 5 players with large per-card target lists. This last point is my judgement, not a claim from the sources.
- Ludii's design pattern is a menu of agents, selected per game from offline experiments. It mirrors "measure, then pick the profile", which matches our existing practice.

### Gaps
- Yucata.de, boardgamecore.net and Tabletop Simulator: I found no sources on bots for these. My understanding is that these platforms are mostly human-vs-human, but I could not confirm it, so treat it as unverified.
- Not covered: Ludii's handling of hidden information (it has some support for hidden-information games, but I found no documentation of the agents' approach), and OpenSpiel's n-player support per algorithm.

## 3. Commercial adaptations: what is publicly documented

### Takeaway
The only deeply documented commercial board game AIs are Temple Gates':
- **Race for the Galaxy:** Keldon Jones' TD-learned neural network with shallow lookahead and a learned opponent-action predictor.
- **Dominion:** AlphaZero-style network-guided MCTS.

For the other titles I found no technical write-ups, only reviews (Root "shrewd"; Terraforming Mars AI widely called weak). Tabletop Automa designs (Root Clockwork, Scythe Automa) are rule-scripted bots.

### Cited Findings

**Race for the Galaxy (Keldon Jones; Temple Gates app, 2017)**
- The network is a temporal-difference MLP (multilayer perceptron) with about 800 input nodes, trained from zero by self-play.
  - The network predicts at each turn who is winning and adjusts weights to shrink the change between consecutive predictions.
  - "The AI only needs to know the rules of the game."
  - Training took about 30,000 games, roughly a million time steps.
  - Tactics such as "piggy-backing" emerged within the first thousand games.

  — [Temple Gates: Race for the Galaxy AI](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
- The app ships 12 models, one per expansion set and player count. Each has two network types, giving 24 networks: `Eval_Board` scores a state from -1 to 1, and `Eval_Role` predicts what a player will choose.
  - "The NNs are one quarter our download size."
  - The team avoided splitting further because of diminishing returns, complexity and size.

  — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
- Move selection: "Right now with Race we do a full 2 ply lookahead." Each candidate move is simulated forward and scored with `Eval_Board`, and opponents' choices in simulation come from `Eval_Role`. — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
  - Conflicting description: a later Dominion-focused article says the Race AI "simulates each legal move one turn ahead" and calls one-turn lookahead sufficient for Race. — [GameTek: Big Brain, Small Phone](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
  - Both describe shallow lookahead. "2-ply" probably means own move plus opponents' predicted responses within the simultaneous-role turn, but that is my inference.
- Cost: the Brink of War expansion "can require over 500,000 network evaluations to advance one turn". The workaround is to heuristically discard low-probability branches, and the team was considering AlphaGo Zero-style pruning for phones. For Roll for the Galaxy, the higher branching factor "may be too much for phones". — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
- Difficulty: easier levels add noise to the network's scores. "Increasing the noise will make the AI choose the 2nd or 3rd best options."
  - The medium AI targets about a 25% win rate against hard.
  - "You can nerf an AI to be easier pretty simply", whereas making it harder is difficult.

  — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/); also [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Hidden information:
  - The evaluation is computed from each player's own point of view, because cards in hand are private.
  - A separate role network predicts opponents' choices.
  - No determinization or belief tracking is described.

  — [Benny Cheung: Game Architecture for Card Game AI, Part 3](https://bennycheung.github.io/game-architecture-card-ai-3) (secondary; summarises Keldon's code and his 2009 BGG thread)
- Network sizes in Keldon's code:
  - The eval network `rftg.eval.0.2.net` has 704 inputs, 50 hidden nodes and 2 outputs.
  - The role network has 605 inputs, 50 hidden nodes and 7 outputs, one per role choice.
  - Inputs range from about 700 (2 players) to about 1,800 (5 players with expansions).

  — [Benny Cheung](https://bennycheung.github.io/game-architecture-card-ai-3)
- Lineage: the open-source code was developed by Keldon Jones and later improved by B. Nordli and J.-R. Reinhard. — [bnordli/rftg on GitHub](https://github.com/bnordli/rftg)
- A 97% win rate is reported after about 30,000 training games. The article does not say against what opponent. — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Temple Gates' stated lessons and limits:
  - Heuristic AIs built from expert knowledge eventually lose to strong humans (Ascension's AI is cited).
  - The method needs a definitive game end for reward to propagate.
  - Games where small arrangement changes swing outcomes drastically suit smooth function approximators badly.
  - Inputs must be fixed-size, so each expansion needs new networks.
  - Late-game play tends to be weaker.

  — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
- The GDC 2018 talk "'Race for the Galaxy': A Neural Network in Production" was given by Theresa Duringer of Temple Gates. — [GDC Vault](https://www.gdcvault.com/play/1025226/-Race-for-the-Galaxy)
- The earlier utility AI used hand-scripted conditional rules and was "hard to scale, slow when complex, often needs rewriting with each expansion". — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Player anecdotes:
  - The Race AI is strong on hard but beatable by experts.
  - A simple k-NN case-based agent (SCOUT, Univ. of Auckland) was "nearly as good" as Keldon's AI, but played less strategically than humans.

  — [Steam discussion](https://steamcommunity.com/app/579940/discussions/0/2293968408155372581); [ICCBR 2017 poster](https://research.idi.ntnu.no/cbr/iccbr2017/posters/WatsonEtAl.pdf) (poster not read in full; the claim comes from the search summary)

**Dominion (Temple Gates app)**
- The AI uses AlphaZero-style techniques: the network outputs a value per player plus a weight per choice to guide which branches the tree search explores. For example, a Workshop with six eligible cards gets six branch weights. — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- The article says the system can "simulate one thousand steps into the future on current phones". — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Card embedding: cards are represented by shared learned features (cost, VP, actions, buys), which "compresses thousands of input nodes... down to ten".
  - Two networks cover everything: one for 2 players and one for 3+.
  - Player-specific inputs share weights.
  - The same AI scaled from about 200 to about 500 cards at the same skill level.
  - The AI plays reasonably with new cards before retraining.
  - Reported win rate is "over eighty percent", opponent unspecified.

  — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- Pitfalls named in the same article:
  - One-turn lookahead is too short for Dominion.
  - Random MCTS hides strong low-weighted branches, so skilled players can beat it.
  - Hand-authored pruning does not scale to expansions and is capped by the developer's own skill.

  — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- A 2021 outside account adds:
  - The network is Transformer-based, with value and policy heads, and takes only the current state (adding previous buys "gave little improvement").
  - Self-play MCTS rollouts reach "a few turns ahead" under the compute budget.
  - There are no hardcoded play rules.
  - Training restarts from scratch when an expansion is added.
  - Keldon is helping on the project.
  - Risks: heavy randomness makes win-rate targets noisy, and the bot may get stuck in money-strategy local optima.

  — [Alex Irpan, "A New Online Dominion Client Approaches" (2021)](https://www.alexirpan.com/2021/05/23/dominion-temple.html)
- Hidden information in Dominion (deck order, opponents' hands): neither source explains how the commercial AI handles it. — [Alex Irpan](https://www.alexirpan.com/2021/05/23/dominion-temple.html); [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

**Twilight Struggle (Playdek)**
- Before release, CTO Gary Weis said Playdek would implement several AI approaches and compare them, and that "there's a good chance more than one of them will be included in the released game". The interviewer called the game "a beast to try and write an AI for". — [Pocket Gamer interview](https://www.pocketgamer.com/twilight-struggle/talking-twilight-struggle-the-best-board-game-youve-never-heard-of/)
- Playdek wraps its rules engine, network architecture and AI systems into a plugin for Unity. — [The Players' Aid: interview with Gary Weis (2019)](https://theplayersaid.com/2019/05/08/interview-with-gary-weis-chief-technology-officer-with-playdek/)

**Root (Dire Wolf digital; Leder Games Clockwork)**
- Reviews say the digital game offers 1–3 AI opponents at several difficulty levels and describe "some very shrewd AI bots". — [Board Game Quest review](https://www.boardgamequest.com/root-digital-board-game-review/); [The Sixth Axis](https://www.thesixthaxis.com/2020/09/03/root-is-a-cute-but-deadly-version-of-an-incredible-modern-board-game/)
- The tabletop Clockwork bots come from Benjamin Schmauss's fan "Better Bot Project". Leder's developer work was mainly simplifying how players operate the bots. Clockwork 2 bots have four difficulty levels plus trait cards that give special powers and quirks. The first Mechanical Marquise was considered lackluster, which led to "Mechanical Marquise 2.0". — [Leder Games: Clockwork 2 developer diary](https://ledergames.com/blogs/news/root-the-clockwork-expansion-2-developer-diary); [Geeks Under Grace review](https://www.geeksundergrace.com/tabletop/review-root-the-clockwork-expansion-2/)

**Terraforming Mars (Asmodee Digital)**
- Steam players (2018) said "Hard AI is really easy to beat" and that it makes poor choices, such as using card actions early. A 2020 review still found the AI easy. — [Steam discussion](https://steamcommunity.com/app/800270/discussions/0/2243301553207313114); [Board Game Quest](https://www.boardgamequest.com/quick-thoughts-on-terraforming-mars-for-ios/)
- I found no developer statement on the AI method.

**Through the Ages (CGE Digital)**
- The app has three levels of AI opponents. A reviewer calls the AI "brutal". — [Through the Ages press page](https://press.throughtheages.com/); search-result summary of a TouchArcade thread
- I found no method write-up.

### Inferences
- Across these sources, two practical routes recur:
  - A hand-built evaluation with very shallow lookahead (Race: learned evaluation, 1–2 ply, opponents modelled by a predictor rather than searched). Cheap and strong enough for a commercial product.
  - Search guided by a policy prior (Dominion: AlphaZero-style). Needed when long-horizon planning matters, and costly to train.
- Our bots (hand evaluation, candidate listing, flat Monte Carlo play-outs) sit between these. The direct lesson from Temple Gates is to use a prior over choices to focus effort, whether that is pruning low-probability branches or policy weights per target, instead of spending equally on every candidate. This matters when a card has 1–400 targets.
- Difficulty by adding noise to the evaluation is the documented cheap method for weaker bots. Only the strongest bot needs engineering.
- Opponent modelling without determinization (Race's role predictor) is one documented way to handle hidden simultaneous choices. I found no commercial source that explicitly describes either determinization ("cheating" sampling) or an AI that openly reads hidden hands.

### Gaps
- No public AI write-ups found for: Root (digital), Spirit Island (Handelabra), Wingspan (Monster Couch), Dune: Imperium (Dire Wolf), Gloomhaven, Splendor, Ticket to Ride, Small World, El Grande, Inis, Blood Rage, or Scythe digital. I did not search each one individually, given the tool-call budget, so "none found" is weak evidence that none exists.
- Scythe Automa / Automa Factory (Morten Monrad Pedersen) design principles: my search returned nothing relevant. Better targets are the Stonemaier blog and BGG Automa Factory posts.
- Keldon Jones' original 2009 BGG thread and the Auckland dissertation PDF (which compares against Keldon's AI) were not readable here. The PDF could not be text-extracted locally.
- I found no first-hand developer report of an "exploitable bot", "slow turns" or "determinization cheating" incident beyond the Temple Gates and GameTek pitfalls above and the Terraforming Mars player complaints.

## 4. What practitioners say about strong vs fast vs fun, and failures

### Takeaway
The documented practice: make the strongest bot affordable by pruning or prioritising branches, then derive easier bots by injecting noise. Hand-scripted utility AIs are reported to be brittle across expansions and beatable by experts. Learned evaluations need fixed-size inputs and a definite game end.

### Cited Findings
- On cost, Race's lookahead needed over 500,000 evaluations per turn with one expansion, and pruning low-probability branches was the fix. — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
- On playing strength:
  - Expert-knowledge heuristic AIs eventually lose to strong humans. — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
  - Random MCTS and hand pruning both leave strong moves unexplored, so skilled players can exploit the bot. — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)
- On difficulty levels:
  - Easy levels add noise, and the medium bot is calibrated to win about 25% of games against hard. — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
  - BGA and tabletop bots are Automa rule-scripts, which serve solo play rather than strength. — [BGA wiki](https://en.doc.boardgamearena.com/Bots_and_Artificial_Intelligence); [Leder Games](https://ledergames.com/blogs/news/root-the-clockwork-expansion-2-developer-diary)
- On learned AIs:
  - The Temple Gates Dominion team had to restart training from scratch per expansion. — [Alex Irpan](https://www.alexirpan.com/2021/05/23/dominion-temple.html)
  - Race needed 24 separate networks for fixed-size inputs. — [Temple Gates](http://www.templegatesgames.com/race-for-the-galaxy-ai/)
  - Dominion's shared card embedding was the fix that let one network scale from about 200 to about 500 cards. — [GameTek](https://gametek.substack.com/p/big-brain-small-phone-ai-for-dominion)

### Inferences
- For a JS engine with a 22-second, 5-player game budget, the documented low-cost improvements are:
  - Prune or prioritise the candidate targets before play-outs.
  - Model opponents' likely choices with a cheap policy rather than searching them.
  - Keep a single strongest bot and get weaker ones through noise.

  These are inferences from the cited cases, not reports from games like ours.

### Gaps
- I found no published measurement of bot think-time budgets in commercial board game apps.
- I found no practitioner write-up specific to area-control or betting games with drafting.
