# Monster of the Week Board Game: Master Design Document

## About this document

The single living document for this project, updated at the end of each session. It lives in the prototype repository at `docs/motw-design.md`, and every change is committed there.

1. **Context:** working style and approach, plus truly ephemeral opinions, inspiration, and ideas that inform the game without direct details.
2. **Game foundation:** the game's core tension, theme, setting, players, content, and genre.
3. **Design decisions:** every core design decision, grouped by the game's architecture. Each decision area is one entry that matures in place, from ideas to decisions to details to rules.

Appendices: A. Decision records and changelog, B. Glossary, C. Reference game research, D. Candidate codes, E. Candidate analysis, F. Prototype architecture and art, G. First draft ruleset, H. Card catalogue, I. Reference card catalogue.

The current focus, below, lists what is being worked on right now; the backlog holds everything else.

---

## Current focus

**Goal:** a first draft of the rules, complete enough to build a playable web app prototype on.

1. **First draft of the rules** *(drafted; Appendix G. What's left comes with the cards or with balancing).* In each decision area, start from the designer's favourite candidate. Where an idea has a close second, record it as that area's first variant. The draft is one ruleset, not a set of samples.
2. **First draft of the cards** *(in progress; principles in 3.7, ideas in Appendix H).* Define the cards the draft ruleset needs, and design player actions (3.7) and hidden actions (`IN1`, 3.11) together with them.
3. **Build the web app prototype.** Restate the rules and cards as an implementation spec (F.16), then build them on the existing scaffold.
4. **Review card action balance** *(opened 2026-10-07; not started).* Playtesting the prototype shows some actions are far stronger than others: Ring the Church Bell can swing presence massively, while others only shift it marginally. Review every card's action for how much presence it can move.
   - *Every current card is temporary (designer, 2026-10-07):* Set v2 and the scaffold extras exist to gather data and test the systems; none is a final card. The balance figures below describe these test cards, not the finished set.
   - *Direction (designer, 2026-10-07):* a spread of power between cards is desirable. A weaker action is balanced in other ways, for example: it does something special, unique and slightly rule-breaking; or it gives more influence when spent for influence.
   - *Strength ranking (designer, 2026-10-07; provisional, from gut, subject to change):* an action is stronger the higher it reaches on this list:
     1. It can alter the outcome of a large, high-trophy battle, whether for the player's own goals or to undo another player's.
     2. It can take influence control of a contested region.
     3. It can move tokens and place lots of influence.
     4. It can move in ways that break the normal rules.
   - *First measurement (2026-10-07, `scripts/balance.js`):* presence change at the next reckoning, best play per state, 200 states from bot games at 5 players. Fights decide almost every swing; growth barely registers. Most cards help the island more than the invaders. Typical best swing: Broadcast 11.0, Beam 8.7, Summoning Circle 8.7, Traffic Lights 7.5, Track 7.3, the Bell 7.2 (largest single swing, 26), Board Up 6.9, Fresh Meat 6.7, Reroute 5.8, the Virus 4.0, Lamps 3.4, Leak 3.2, the hidden tokens 0.4–1.5 (one round ahead only, so undercounted). The unsuited scaffold moves outscore most suit cards.
   - *Second measurement (2026-10-07, `scripts/balance.js`, same setup), on the strength ranking:* mean of each card's best target per state. (1) battles: trophies changing hands at this round's fights plus fights whose winner flips, weighted by the tokens lost; (2) contested locations where the player becomes sole top influence; (3) pieces moved or placed, and influence placed. By suit, printed influence in brackets, as battle / control / moved / influence placed:
     - ◐ Fresh Meat (2) 10.0 / 0.6 / 6.9 / 0.9; Track (3) 11.3 / 1.3 / 4.8 / 3.0; Silver Bullets (4) 1.3 / 0.3 / 1.1 / 1.1.
     - ↂ Broadcast (2) 17.7 / 0.7 / 8.7 / 1.0; Leak (3) 4.9 / 0.4 / 2.3 / 0.5; Beam (4) 13.8 / 0.6 / 5.1 / 0.6.
     - ⏏ Virus (2) 4.6 / 0.6 / 3.1 / 1.9; Reroute (3) 8.1 / 0.5 / 6.3 / 0.9; Traffic Lights (4) 14.5 / 1.1 / 11.0 / 2.0.
     - ☾ the Bell (2) 11.8 / 0.7 / 8.9 / 1.1; Board Up (3) 8.4 / 0.5 / 5.1 / 1.4; Salt and Burn (4) 3.8 / 0.4 / 1.0 / 1.0.
     - ⎈ Summoning Circle (2) 13.6 / 0.7 / 8.1 / 1.0; Lamps (3) 4.7 / 0.2 / 2.3 / 0.4; House on Fire (4) 2.7 / 0.4 / 1.1 / 1.1.
     - Hidden tokens look one round ahead only, so they are undercounted. Rule-breaking (4) is judged from the card text, not measured.
   - *Influence economy (designer, 2026-10-07):* it feels too tight: too few locations become influence contests. Measured (`scripts/economy.js`, 200 games, 5 players, smart bots; at the end of each round's play phase): fights per round fall from 3.6 (round 1) to 1.7 (round 5). Fights with no player influence at them: 94% in round 1, 67% in round 2, 30% in round 3, 19% in round 4, 9% in round 5; fights with two or more players' influence: 1%, 9%, 40%, 59%, 72%. Players hold 10–17 standing each but have only 0.2 (round 1) to 4.4 (round 5) influence on the board: the bottleneck is getting influence onto the board, not earning it. Random bots and 3 players show the same shape.
   - *Levers under test (designer: all three good candidates, 2026-10-07):* variants in `spec.json`, off by default. Fights with no player influence at them, rounds 1 / 2 / 3 / 5, and influence on the board per player in round 5 (`scripts/economy.js`, 200 games, 5 players):
     - Off (the first draft): 94% / 67% / 30% / 9%; 4.4.
     - `influencePerMove=2` (2 per destination): 95% / 64% / 34% / 12%; 6.6. Little change early: moves are rare in round 1.
     - `influenceAtOrigin=on` (1 also where the tokens leave): 92% / 53% / 23% / 6%; 6.9.
     - `influenceToBoard=on` (1 of a card spent for influence goes onto a location its faction controls): 47% / 13% / 6% / 2%; 8.9. The only lever that changes round 1.
       - *Designer (2026-10-07):* off for now; held in reserve, to bring in if more influence is needed.
   - **Scores reset (designer, 2026-10-07):** our own documents shouldn't trust the scores yet. The measures and their weights make sense, but every score so far is likely naive: none comes from whole-round runs of a card with bots that play strategically. Every score is reset to 0 (`public/card-scores.json`, `public/card-round-scores.json`), and the figures recorded below and in H.7 (rounds 8 to 16) stand as history, not as findings. With every score at 0, D12's weighting has nothing to order by, so each suit's 2, 3 and 4 are dealt at random until cards are measured again.
   - **How tuning proceeds (designer, 2026-10-07):** 1. tune the bots with tournaments (`scripts/tournament.js`); 2. tune the cards with card tuning passes; repeat.
   - **One tuning tool (designer, 2026-10-08):** the tournament (`scripts/tournament.js`, `npm run cards:plays`) does the card balancing too, with the simulate, economy, balance and roundplay scripts merged into it. Per game: the ending and winners (by profile, seat and slayer group), presence by round, scorched locations, trophies; the economy before each round's fights (bidding contests, influence on the board, standing). Per card: held, played, for its action or its influence, playable, the swing in its player's chance of winning, how often its player won, what each action did to the round's fights (trophies, flips, control, pieces moved, influence placed), and openers. **Probes:** on a share of turns, the controlled card test (a random handful of cards played in that moment against letting the turn go, the rest of the round played out): cause, where whole games give correlation, and cards nobody held. Probes run on copies with their own randomness, so they never change the games; they are optional (`probe=0`) and slow (each costs about as much as a few whole games). Progress is saved after every game and a run resumes where it stopped; the card review page shows the figures as they come in.
   - **Third card tuning pass (2026-10-09; the first with the smarter bots: play-out search, weakest-colour access, every target listed, hand-aware draft, face-down tokens counted):** 400 games on backer, backer, goal, goal, hunter (mixed decks; probes on 5% of turns and every round's first play, 112–493 per card; the probes' imagined futures played without the play-out search, `probeLite=1`). *Caveat:* the hunter seat measured clearly worse (6.8% of wins) and was removed after this pass (designer's rule); a fresh pass on backer, backer, goal, goal, goal follows.
     - *Games:* the island won 77.5%, the invaders 22.5% (target: island over 50%; two backers about 40%, so the invaders' ending is now under target: smarter trophy players stop the backers more often). Presence 35 → 33 → 28 → 22 → 19 → 15.6. Win shares: goal 64% (two seats), backer 29.3% (two seats), hunter 6.8%. Calibration is reasonable through round 4 and over-confident at the top in round 5.
     - *By suit (mean probe):* 80's Sci-Fi +1.09, Nocturnals +1.03, Demons +0.78, Undead +0.59, Sentients +0.45; unsuited +0.86.
     - *Strongest:* Defect +2.6, Set the Bait +2.3, Beam Them Up +2.0, Chase Them Down the Slope +1.8, Trade Secrets +1.5, Read from the Book +1.5, Broadcast a Signal +1.4, Lead the Horde +1.4. Hack the Network +1.3 (opener +2.0) and Call Home +1.1 hold up from round 20.
     - *Weakest:* Drag Them Under −0.4, Go Viral −0.3, Lay Them to Rest −0.1, Spread a Virus 0.0 (the deck's Sentient Strike), Link the Swarm 0.0, Livestream the Fight 0.0, the infectious Virus 0.0, Invert the Pentagram +0.2, Hijack the Feed +0.2.
     - *Marked cards:* Set a Trap (A) +0.44 (opener +0.45) now measures below Lock Down the Town (C) +0.86 / +0.78 and Put a Bounty On It (D) +0.57 / +0.69: A is meant to be the clear standout (FP2, CB1).
     - *Printed influence (D12, written to card-strength.json):* Set v2 changes: Broadcast 2→3, Leak 3→4, Beam 4→2; Reroute 3→2, Traffic Lights 2→3; Bell 2→3, Board Up 3→2; Summoning Circle 3→2, Light Every Lamp 2→3.
     - **Designer (2026-10-09):** cut the weak cards, unless they carry a novel mechanism that could be strengthened and would be fun. *Cut (Claude's sort; mechanism done better elsewhere):* Spread a Virus (the deck's Sentient Strike, replaced by Hack the Network, the strongest Sentient Strike), Spread a Virus (infectious), Network the Virus, Go Viral (four virus variants), Drag Them Under (a pull-together Lure and Set the Bait cover), Hijack the Feed (double influence, overlapping Split Up and Install a Backdoor), Smash the Mirror (a fixed teleport Beam Them Up does better). *Kept to strengthen (novel and fun):* Lay Them to Rest (trophy denial), Livestream the Fight (a doubled fight), Invert the Pentagram (the smaller group wins), Link the Swarm (networked strength, AP3), Install a Backdoor (tokens as influence), Tip Off the Sheriff (profit from rivals' moves), Hear the Banshee Wail (push outward), Open the Pit (fall through), Silver Bullets (in the deck).
   - **Second card tuning pass (2026-10-08; the first with sound bots, measure and table):** 400 games on the standard table (two backers, two goal trophy players, hunter; mixed decks; probes on 5% of turns, 130–300 per card; probes play out the real table).
     - *Games:* the island won 61.5%, the invaders 38.5% (the designer's targets). The styles are balanced: backer about 19.7% a seat, goal 18.9%, hunter 22.9%. Presence went 35 → 33 → 30 → 26 → 22 → 19.7, ending at the threshold, so the outcome stays in doubt. 79% of round-1 fights have two or more players bidding. Calibration holds through the middle range.
     - *Strongest by probe* (change in the player's win chance, percentage points): Trade Souls +3.2, C (scaffold) +2.7, Defect +2.4, Light Every Lamp +2.4, Chase Them Down the Slope +2.2, Set the Bait +2.1, Broadcast a Signal +2.0.
     - *Weakest:* Install the Cameras −0.4, Spread a Virus −0.3, Lay Them to Rest −0.2, Open the Pit −0.1, Take Over the Wake 0.0, Silver Bullets +0.1, Canvass the Town and Sign the Contract +0.2.
     - *By player type:* moving cards are worth far more to backers, who protect and build a faction with them (Leak the Documents +3.7 for a backer against +0.4 for a trophy player; Reprogram the Traffic Lights +3.4 against +0.5); Stake Out the reverse (+1.4 to +2.8 for trophy players, −0.3 for backers). The hidden-token fight modifiers are mostly weak (−0.2 to +0.4).
     - *Influence against actions:* with the measure normalised, both uses give similar swings; the earlier gap was an artefact of the unnormalised measure.
     - *Reading:* gaps under about 0.5 are within noise.
   - **First card tuning pass (superseded: bots, measure and table were flawed; kept as history) (2026-10-08; `npm run cards:plays`, 400 games, goal ×3, goal-deep, hunter; mixed decks; probes on 5% of turns, a median 231 per card):**
     - *Games:* the island won 95% (no seat backs a faction at this table). Presence fell from 35 to 21 after round 1 and about 10 by the end. 5.4 fights in round 1, falling to 0.3 by round 5; by round 2, 96% of fights have two or more players bidding (66% three or more), so the bidding contest the designer wanted is there. Hunter won 33% from one seat (goal 17% a seat, goal-deep 16%): hunter is still the strongest island player.
     - *Strongest by probe* (mean change in the player's win chance, percentage points, against letting the turn go): Defect +1.7, Set the Bait +1.6, Stake Out (6) +1.6, Broadcast a Signal +1.4, Trade Souls +1.3, Claim the Spoils +1.0. Unsuited cards from rounds 14–16 hold four of the top six.
     - *Weakest by probe:* Turn On the Tractor Beam −0.4, the infectious Virus −0.4, Back Up to the Cloud −0.4, Install the Cameras −0.4, Spread a Virus −0.4, Smash the Mirror −0.3, Take Over the Wake −0.3.
     - *Influence against actions:* suited cards spent for influence raise the player's win chance more than their actions do in almost every case (for example Reroute the Power Grid +2.9 for influence against 0 for its action; the Church Bell +2.1 against 0), yet the bots play most of them for their actions.
     - *Opener probes* have only about 8 per card, too few to read.
     - *Caveats:* probe gaps under about 0.3 are within noise; the bots are not yet as strong as hunter at the island game, and every figure is under the current first draft (IC1, each faction pays, the new setup, influence bonus 0).
   - **Target (designer, 2026-10-07):** the island should win more than 50% of the time. *Designer:* what makes the invaders win less is players prioritising trophies; bots incentivised towards trophies cause more tokens to be removed, and bots prioritising a faction's growth to ally with for the end game make that faction grow. Measured (100 games each, new starting setup, IC1, each faction pays): smart bots 14% island; trophy-priority bots 33–36%; a mixed table 25%. *Next:* bots with goals that can shift and adapt while prioritising the best chance at victory (F.9).
   - *Measuring over a played-out round (designer, 2026-10-07):* the measurement tests are reworked so a whole round is played out. A card's strength is its **benefit to the player** (designer's pick): the player plays it, bots play the rest of the round through its fights, and the player's position after them (the bots' position value) is compared with letting the turn go. `scripts/roundplay.js`, with deep bots (designer's pick: a reply lookahead), runs on every core; `opening=1` measures each round's first play. The one-move measure (`scripts/balance.js`) is kept for comparison: it can't see a gambit that pays off later in the round.
   - *Hidden tokens and the supply (measured 2026-10-07, round 13 of the card rounds):* a hidden token needs a cube from the player's supply (MC3), and the supply empties as influence goes to standing and the board: the share of turns with an empty supply is 0% in round 1, 8% in round 2, 51% in round 3, 78% in round 4 and 80% in round 5 (40 bot games, 5 players). Every token card can be played in only about 60% of states for this reason. *Designer (2026-10-07):* supply shouldn't be a bound yet; it is a balancing concern, and we are in early card design. Designer: just bump it a bit. The prototype's default is now 30 cubes per player (`playerCubes`): turns with an empty supply fall to 0%, 0%, 2%, 18% and 40% in rounds 1 to 5 (from 0%, 8%, 51%, 78%, 80% at 20). With an unbounded supply (99, tried first), token cards could be played in 86–100% of states and their battle scores roughly doubled (Invert the Pentagram 6.9, Salt and Burn the Bones 6.3, Set the House on Fire 5.2).
     - All three: 45% / 16% / 5% / 3%; 11.5.
     - With `influenceToBoard=on`, the cards that need influence already on the board gain the most: Stake Out the Den's battle score rises from 1.1 to 3.2 and it can be used in 61% of states (29% before); the hidden tokens rise a little; Track falls (11.3 to 9.6), since standing goes to the board instead of the chase.

Earlier favourites ("preferred" in section 3) were the starting point: `DR3`, `DR4`, `MC3`, `FR1`, `PT2`, `ST3`, `ET3`. The draft kept `DR3`, `DR4` and `PT2`, chose `FR5`, `ST1` and `ET4` instead of `FR1`, `ST3` and `ET3`, and left `MC3` to the cards.

**First draft so far** (draft picks for prototyping, not decision records). Written up as one ruleset in Appendix G:

| Area | Draft pick | First variant |
|---|---|---|
| General: supply | One supply per colour. Player-coloured cubes return to that player for later actions; faction tokens return to that faction to be placed later | None |
| General: no pieces leave the game | No piece is ever removed from the game entirely; anything that leaves the board returns to its supply | None |
| General: cards only shift tokens | Card actions never remove faction tokens from the board outright; they only shift them to other locations. Tokens leave the board only as fight casualties (and through scorching) | None |
| General: responses | Out of the first draft (2026-10-07): they add complexity playtesting doesn't need yet. Response ideas stay candidates in Appendix H; cards keep their response text in the catalogue, unused. In the prototype a played action resolves at once (variant `responses`, off) | Responses on, as in the earlier prototype (pending step, before/after answers) |
| 3.1 Board topology | `CN3` Regions; `BD1` one board; `LL1` two-faction limit (no action may bring in a third faction); `TM1` scorched earth (a true tie burns everything: no trophies, no influence to factions, all pieces back to their supplies) | None |
| 3.2 Location control | `LC1` factions control, players never do; `LC2` control by token count | None |
| 3.3 Location-archetype alignment | `AL2` tied fights on aligned ground; `AL3` boosted growth. (`AL1`, spread archetypes, holds through the layout D map) | None |
| 3.4 Invader forces | The decisions only (one random faction per archetype, as tokens). No archetype or faction powers: every faction plays the same; powers (`AP1`–`AP6`) stay ideas for later | None |
| 3.5 Invader population | `SD1` seeding (provisional 5 + 1 + 1, home location random of the three); growth by `GR1` at resolution, which is the game's own growth system (`GR3`); growth always comes after fights, so each growing location holds one faction | None |
| 3.6 Action acquisition | All of `DR1`–`DR6`: a draft at the start of each round; unplayed cards lost back to the pool; pick and pass with the put-back rule; the same pool every round; the undealt cards left out unseen; the pool is the whole action set. Hand size 6/5/4 at 3/4/5 players (`PS1`) | None |
| 3.7 Player actions | Cards are played once. Every suit card can be spent for influence with its affinity faction instead of its own action or response, for an amount printed on the card, more than 1 (`CU1`); the six unsuited extras have no influence use and offer wild, powerful or flexible actions; some cards also offer a choice of actions, all held to `AC1` (distinct and precious) and to theme above all. `SU1` five archetype suits of three cards (15), plus 6 others (A to D and two unmarked); `LK1` location cards set aside. `CU2` out. Card-driven growth (`GR2`, and `CU4`'s *Grow* use) is out. The rest is being designed with the cards | None |
| 3.8 Timing and passing | `TU1` play or pass, passing is not final; `FP1` first player by marked cards, with four marked cards A to D under the fixed pool (`FP2`); the round ends when everyone passes in a row (`RE3`, 3.12) | None |
| 3.9 Persistent progression | The decision: no persistent upgrade mechanism | None |
| 3.10 Player characters | The decisions (five slayer groups, one per archetype); affinity as `AB1` tiebreaker | None (`AB2` is not yet a close second) |
| 3.11 Information | The decision (hidden hands); `IN2` secret trophies. `UT1` unresolved hidden tokens stay face down into the next round. `IN1` hidden actions, with `HT1`/`HT2`, `BT1` and `MC1`–`MC3`, deferred to step 2 with the cards | — |
| 3.12 Round structure and game length | `GL1` a fixed number of rounds; `RS1` draft, play, resolve; `RE3` round ends when all pass; the resolve phase runs fights, then growth | None |
| 3.13 Conflict resolution | `RQ1`–`RQ5` what a fight must do; `FS1` two-sided fights; `FR5` half, rounded down, minimum 1. `TF1` tied fights: both wiped out and the location scorched (`TM1`), unless one faction is aligned with the location, which then wins as normal under `FR5`. `TD1` trophies by influence at the location: bigger pile to the leader, smaller to the runner-up. Ties between players: affinity first (`AB1`), otherwise `PT2` standing tie, and under `ST1` nobody tied collects: a tie uses up every place the tied players were in line for (tied leaders return both piles to the supply). `UP1`: a lone player at the location collects both piles; with no players there, both piles return to the supply. Piles cannot be declined. After a fight (`AF3`, adjusted): half the leader's influence there, rounded down, moves to the winning faction and the rest returns to the leader's supply; all other influence stays. `AT1`: after a tied fight on neutral ground (location scorched), all influence there returns to each player's supply. `AS1`: tied leaders' influence returns to their own supplies, with nothing gained; players tied for runner-up keep theirs at the location. Influence where no fight occurs stays into the next round. No spillover (`RO1` out): fights are independent, so their order doesn't matter. No dice (`FR4` out). Fight trigger: `FT1` only, every contested location fights in the round-end resolve phase. No boil-over (`FT2`), card-triggered fights (`FT3`) or dynamic round end (`RE2`) in the first draft | None |
| 3.14 Influence | `IF1` influence with factions is public; `IF2` each player holds influence with each faction; `IM1` influence placed on locations is spent from a faction (`CA2`) or, for some actions such as traps, comes from the player's own supply (`CA3`). How influence is gained (`CA1`) is worked out with the cards. A player's cubes are always in their supply, in standing with a faction, or on a location. `IB1`–`IB4` as guiding principles. No costly displacement (`IB5` out). `IL1` (leader-only moves) is the first variant: in the first draft anyone can affect any faction, but influence placed by a presence effect is spent from standing with the faction affected. Each slayer group starts with some influence with its linked faction | `IL1` only a faction's influence leader can affect its presence |
| 3.15 Victory | `WC1` the island or one faction wins; `TH1` end-game presence threshold (provisionally more than 15); `FX1` factions tied on presence: most locations controlled, and if still tied they win together (`FX2`), scoring each player's influence minus trophies with each, added up; `EG3` player score: a faction wins, influence with it minus its trophies; the island wins, `TS2` weakest colour: the count of the colour a player holds fewest of, ties to the next weakest colour (`WT1`). Ties when a faction wins (`ET4`): fewest trophies of that faction, then affinity, then the next faction (`ET1`). Players tied after every tiebreaker share the victory. Avoiding fights is a bet on a faction win | None |
| 3.16 Player-count scaling | 3 to 5 players (decision). `PS1` fixed pool of 21 unique cards in place of the tiered pool (D7): hands of 6/5/4 at 3/4/5 players, with 3/1/1 cards left out unseen | None |
| 3.1 Map (regions and borders) | The prototype board, layout D: five regions of three in a ring round a central lake. Mountains (Weather Station, Ski Resort, Mine), Badlands (Military Facility, Junkyard, Caves), Coast (Fallout Bunker, Shipping Docks, Lighthouse), Old Town (Graveyard, Beach City, Occult Camp), Woods (State Park, Sawmill, The Lake House). Borders: Mountains–Badlands, Badlands–Coast, Coast–Old Town, Old Town–Woods, Woods–Mountains | None |

**Where the cards stand (2026-10-06):**

- Structure: five archetype suits of three, Strike (influence 2), Shift (3) and Signature (4, the suit's primary card: the archetype's rule-bend plus the suit's response); six unsuited extras, A to D and two unmarked (the Cancel removed, 2026-10-08). Fixed pool of 21 (PS1); hands of 6, 5 and 4.
- Card principles 1–14 in 3.7. Every suit card targets either a suit location (any faction) or the suit's faction (anywhere) (principle 14). Presence actions have no token limits, move any faction, and spend influence from the faction moved; as many as possible are unique moves.
- Responses are interrupts, few, thematic, and never just move tokens (blocking is fine); each says whether it resolves before or after its trigger; no responses to responses.
- Fight modifiers are only hidden actions, with all of 3.11's hidden-token rules: one token per location, bluffs placed under the same rules, effects that apply to any fight there.
- Appendix H holds seven rounds of ideas and two candidate sets; **Set v2 (H.8) is waiting for the designer's review.** Appendix I catalogues reference games (The King is Dead, Blood Rage, Inis, Rumble Nation, COIN, Twilight Struggle and more).
- Next: review Set v2; then design the six unsuited extras; then settle marker cubes (MC3 is preferred) and the open reference-game questions (a cost for cashing in a card, card-driven turn order, tempo costs, cards removed after use).
- Balancing note: a simulation suggests about six moves a round hold total presence near 30 to 35 tokens, so the presence threshold (now more than 15) should move near that.

Everything else is in the backlog below; finished work is in the changelog (A.2).

## Backlog

Not the current focus. Items come back into focus when the draft needs them.

**Open questions on candidates**

- **3.10 Player characters:** the permanent plus-one's open points: where an extra trophy comes from, and where extra influence goes.
- **3.13 Conflict resolution:** under drop-down ties, whether tied influence still clears, and which pile is shared when the piles are equal.
- **3.5 Invader population:** whether growth can make a location boil over. (Neither question arises in the first draft: fights happen only at round end and growth comes after them, so there is no boil-over and only one faction is left to grow.)

**Analysis**

- **Fits and clashes:** card uses and influence, growth, the map, and the end game are still to do (Appendix E).
- **Trade-offs:** a first pass covers the whole game; more are wanted.
- **Sample rulesets:** four first drafts exist (E.4); the first draft of the rules supersedes them as the working ruleset.
- **New candidates not yet in the sample rulesets:** AB1, AB2, PT2, ST1, ST2, ST3, AS1, LC2, AL2, AL3, FT2, IN1, IN2, HT1, HT2, DR3, DR4, DR5, DR6, ET1, ET2, ET3, FX1, BT1, MC1, MC2, MC3, UT1.

**Later stages**

- **Map design:** which regions border which.
- **Card design beyond the first draft:** the movement types; what the marked cards do; which cards belong to the 3+, 4+ and 5+ tiers.
- **Balancing:** each player's starting cubes, each slayer group's starting influence with its linked faction, starting presence, total tokens per faction, the presence threshold, the volatility threshold, the growth threshold, the number of rounds, hand size, and how many real and bluff tokens a hidden action places.

**Prototype art (open, low priority)**

- UI colours, token cardboard colours, and whether anything needs a daytime look (`assets/README.md`).

---

## 1. Context

### 1.1 Working style and approach

**Collaboration**

- Project goal: design a new board game.
- The current phase is **prototyping**: working toward a playable prototype.
- Every rule, idea, and mechanism starts with a seed from the designer. Claude does not add or infer mechanisms or ideas on its own.
- Seeds are worked through together, in small steps: questions, implications, conflicts, and gaps, then refinement.
- No wholesale generation. Claude doesn't produce large swaths of rules, content, or design in one go.
- If the designer explicitly asks for options, Claude offers a small number, clearly labeled as suggestions.
- Only what the designer agrees to is recorded as a decision.
- Work happens across repeated sessions in Claude Code, in the prototype repository, using this single document (`docs/motw-design.md`), continually updated and committed.
- Map design and card design are later stages. Details that belong to them are deferred until then.
- Balancing numbers are also left until later, once cards are in place. They will be set by running the maths and by simulated playthroughs, in the web prototype with bots (Appendix F).

**Document principles**

- Use subsections where necessary.
- Keep context and direct game details distinct.
- Every section is descriptive in its own right. Other games are referenced only in the reference games list (1.6) and the research appendix (C).
- Reference game research uses The King is Dead's second edition rules.
- The document shows only the current state. It never refers to earlier, ruled-out, or changed decisions, and contains no "superseded by" notes. The changelog is the only exception.
- Each design decision area is a single entry in section 3. Content matures in place, through four levels: **Ideas → Decisions → Details → Rules**. An entry's stage is the most mature level it has reached.
- Ideas are candidates, not decisions. An idea is removed once it's ruled out, and moves to Decisions once it's decided.
- The current focus is gathering candidate ideas, mechanisms, and pillars. Candidates that conflict with each other coexist; one idea never rules out another. Only the designer rules an idea out.
- A decision is only settled once it has no open questions. Anything with open questions stays an idea.
- Details are the granular parts of settled decisions, marked open or settled. A question whose parent decision isn't settled sits under Ideas instead, with the idea it's most closely linked to, or in a shared entry.
- Settled content (Decisions, Details, Rules) never refers to ideas.
- Tiebreakers sit within the thing they apply to; there is no global tiebreaker.
- Game design decisions are recorded as decision records (Appendix A.1). Reasoning is included only when it was given.
- The changelog (Appendix A.2) records actual changes to mechanisms and game structure, including any alternatives that were ruled out. Clarifications to preferences, naming, and document organization aren't logged; the document is simply updated.
- Terms are used as defined in the glossary (Appendix B), and new terms are added there as they gain specific meaning.
- Every candidate in section 3 carries a short code. Candidates are grouped into slots, a slot being a question the game has to answer, and a code is the slot's two letters plus a number. Open questions and provisional numbers have no code. Appendix D indexes the codes.
- Appendix E holds the analysis of candidates: fits and clashes, trade-offs, groups, and sample rulesets. It is Claude's analysis, not design: it never adds, changes, or rules out a candidate. Claude adds to it as candidates come in, without needing the designer's approval for each addition.

**Comparing rulesets**

The strategy for weighing candidates against each other. It is still being refined.

- Candidates are compared in combination, not one at a time. The aim is to find which rules work well together and which work against each other's aims.
- The steps build on each other:
  1. **Code every candidate.** Each candidate gets a short code, grouped into slots (Appendix D).
  2. **Fits and clashes.** Note the combinations with a clear fit or a clear clash, one cluster of the game at a time.
  3. **Trade-offs.** Find the choices where both sides work but lead to different games. Finding more trade-offs is the part to keep pushing on.
  4. **Groups.** Synergies can be larger than pairs. A set of candidates that reinforce each other gets a name and a code.
  5. **Sample rulesets.** Put together selections of candidates that show one character of game, such as the lightest rules, the deepest decisions, the most interlocked, or the most swingy.
- Every ruleset has to meet the requirements, which are the slots marked "All" in Appendix D.
- The analysis is Claude's, and goes into Appendix E as candidates are added. It doesn't need the designer's explicit approval.

### 1.2 Design pillars

Short statements of what the game must be, used to judge every future decision.

1. **Push and pull.** A push and pull between the players and the two major win conditions.
2. **Tough decisions.** Really tough decisions that spawn from a limited set of actions.
3. **Read the table.** Players constantly analyze other players' positions to understand how to advance their own.
4. **Simple mechanisms.**
5. **Few choices, huge consequences.** A thinky decision space built from very few possible decisions, where the consequences of each choice are huge depending on what other players are aiming for and invested in.

### 1.3 Anti-goals

What the game deliberately is not.

- **Not heavy or involved.** The game should be light.
- **Not economy-focused.** An economic system is not the focus of play.

### 1.4 Opinions and feel

- The game should feel like a **push and pull** between the players and the invaders' fate.
- A **readable board state** is the main mechanism.
- **Never in control.** Players should never feel in direct control of the island. As in monster-of-the-week shows, they launch gambits, hatch plans, set traps, and conduct séances that cause the invaders to react.
- **Knife's edge.** The game should constantly balance on a knife's edge between its two outcomes: the island winning, where players compete on the trophies they have collected, and a faction winning, where players compete on their standing with that faction.
- **Ties are a tool.** A tie is useful for clearing factions off the board, and the influence around them, and for stopping a player who has allied with a faction from carrying it past the presence check at game end.
- **Mostly open, with room for gambits.** Most information is open, with just enough hidden to keep tension and to give players room for gambits that deny each other.
- **On the board, not in memory.** Persistent rules that aren't represented by a piece are hard to keep track of. Wherever possible, a rule is driven by something present in the play space.

### 1.5 Thematic inspiration

- Monster-of-the-week shows, such as **Buffy** and **Steven Universe**, for the kind of characters players represent.
- **Pixel-art RPGs** and animated series like **Steven Universe**, for the feel of the setting.

#### Source works

Shows, films, games, and comics for thematic inspiration for actions, scenes, and descriptions.

- **Buffy the Vampire Slayer** (TV)
- **Steven Universe** (TV)
- **Gravity Falls** (TV)
- **Stranger Things** (TV)
- **The X-Files** (TV)
- **Riverdale** (TV)
- **The Terminator** films
- **The Thing** (film)
- **Tremors** (film)
- **Super 8** (film)
- **EarthBound** (game)
- **Paper Girls** (comic)
- **Locke & Key** (comic)
- **The Lost Boys** (film)
- **The Monster Squad** (film)
- **Fright Night** (film)
- **E.T.** (film)
- **The Goonies** (film)
- **WarGames** (film)
- **Hackers** (film)
- **Weird Science** (film)
- **Tron** (film)
- **Night of the Living Dead** (film)
- **Shaun of the Dead** (film)
- **The Evil Dead** (film)
- **The Exorcist** (film)
- **The Conjuring** (film)
- **Evil** (TV)

#### Slayer group references

The works each slayer group (2.5) is based on.

| Slayer group | Based on |
|---|---|
| Slayerettes | Buffy the Vampire Slayer, The Lost Boys, The Monster Squad, Fright Night |
| Kids on Bikes | Stranger Things, Super 8, Paper Girls, E.T., The Goonies |
| AV Club | WarGames, Hackers, Weird Science, Tron |
| Neighbourhood Watch | Tremors, Night of the Living Dead, Shaun of the Dead, The Evil Dead |
| Father and the Flock | The Exorcist, The Conjuring, Evil |

- Naming pattern: a concrete picture of who the group is, without a leading "the".
- Slayerettes and Kids on Bikes are prototype names. Both are already in use elsewhere, and are to be revisited before publication.

#### Trope inspiration for actions

Common monster-of-the-week, campy horror, and invasion-movie tropes, as inspiration for actions. Thematic only; no mechanisms attached. This is a living list: add to it, or run revision cycles on it, whenever new ideas are needed.

**Gambits that make the invaders react**

- **Bait:** dangle something the monster wants (a person, a relic, fresh blood, a signal) to lure it somewhere.
- **Set a trap:** a pit, a salt circle, a net, a rigged generator, waiting for whoever walks in.
- **Lure them into each other:** lead one monster into another's territory and let them fight it out.
- **Spread a rumour / plant evidence:** convince one group that another stole from them, killed one of theirs, or is coming for them.
- **Fake signal:** a forged distress call, a mimicked howl, a broadcast pretending to be the mothership.
- **The séance / summoning:** call something up, deliberately or not, that stirs things nearby.
- **Break the seal:** open the crypt, smash the ward, dig up what was buried.
- **Seal it back up:** reconsecrate the ground, restore the ward, cave in the mine.
- **Ring the alarm:** the foghorn, the church bell, the air-raid siren, making everything converge or scatter.
- **Cut the power:** plunge a place into darkness and let the night creatures move.
- **Evacuate the town:** clear people out of somewhere, removing what the monsters came for.
- **The decoy:** dress up, swap places, or run off drawing the pursuit away.
- **Research montage:** the library, the archives, old newspapers, to learn a weakness or a secret.
- **Steal the artifact:** grab what a faction needs, and watch them come looking.

**Gaining standing with a faction**

- **The parley:** meet the leader on neutral ground under a white flag.
- **The bargain:** trade something they want for a promise, often a dangerous one.
- **The offering / tribute:** leave the right gift at the right place.
- **Learn their ways:** speak their language, respect their customs, follow their rules.
- **Save one of theirs:** spare or rescue a monster, earning a debt.
- **The inside contact:** the friendly one who isn't like the others; the defector; the sympathetic scientist.
- **Infiltrate:** pose as one of them, join the cult, get the uniform.
- **Make a pact:** a binding agreement, usually with a catch.
- **Hand over evidence:** give them proof about a rival that turns them against it.
- **Become a believer:** publicly back the faction's story when no one else will.
- **The secret society:** get invited into the hooded meeting and take the oath.
- **The family secret:** learn that your family has an old tie to them.
- **Redeem the monster:** help one of them see they don't have to be what they were made to be.
- **The protected one:** someone the faction cares about is under your protection.
- **Join the cult:** paint everything blue, wear the robes, chant along.

Some tropes, such as spreading a rumour or handing over evidence, sit across both groups.

**More tropes (farmed 2026-10-05).** Drawn from Buffy, Supernatural, The X-Files, Scooby-Doo, Stranger Things, Gravity Falls, Goosebumps, Ghostbusters, Fright Night, The Monster Squad, The Lost Boys, Tremors, Gremlins, Evil Dead, Night of the Living Dead, Shaun of the Dead, Twin Peaks, Men in Black, Independence Day and Mars Attacks!.

- **Research and preparation:** the library all-nighter; the old-timer who knows the legend; the microfiche of the 1950s newspaper; the grimoire with the missing page; learning "the rules" (don't get them wet, never feed them after midnight); mapping the ley lines; interviewing the lone survivor; decoding the transmission.
- **Weapons and wards:** holy water, silver, salt lines, iron, rock salt in a shotgun, a flamethrower, a chainsaw, a wooden stake, garlic, a crucifix, consecrated ground, UV light, mirrors, fire, the head shot.
- **Lures and distractions:** a blood trail; a decoy in your jacket; loud music; a car alarm; fireworks; acting like one of them to walk through the crowd; a noise from the other side of the house.
- **Exploiting a weakness:** they must be invited in; they can't cross running water; they must count spilled rice; they hunt by vibration, so stay off the ground; water makes them multiply; one song makes their heads explode; a common cold kills them; say its true name.
- **Teen life:** sneaking out after curfew; the school dance; parents out of town; riding bikes after dark; walkie-talkies and a CB radio; the house party; the arcade; locking yourselves in the mall overnight; the dare to enter the abandoned house; "let's split up, gang."
- **Authority and cover-ups:** the sheriff won't listen; the men in black arrive; a quarantine; a curfew; a news blackout; an evacuation; calling in the National Guard; burning the evidence.
- **Rituals:** the séance; the Ouija board; a summoning, a banishing, a binding; sigils on the floor; chanting in a circle; the cursed artifact; waiting for the eclipse or the blood moon.
- **Traps and tactics:** the net trap; the pit; fortifying the farmhouse; barricading the doors; luring them into the light; setting the building alight; collapsing the mine; blowing up the gas station; driving them into the sea; cutting the bridge.
- **Tech:** hacking in; an EMP; jamming the signal; reversing the polarity; uploading a virus to the mothership; the radio telescope; night vision; the motion tracker; the ham radio.
- **Drama and sacrifice:** the last stand; someone stays behind; holding the door; the bitten friend hiding the wound; the unmasking ("it was the janitor"); the monster was human all along; the redemption.
- **Episode structure:** the cold-open victim; the town legend; the cursed object; the warning ignored; the creepy kid who knows; the twist ending; the sequel stinger ("it's back").

### 1.6 Reference games

Detailed notes on how each game's mechanisms work are in Appendix C.

| Game | What we like |
|---|---|
| The King is Dead | The simplicity of the map; action cards used to influence the board; the very tough decisions that come from a limited set of actions. Also the model for the board: a single map with cubes at locations |
| Inis | The draft through which players receive and plan their actions for the round, which they then have to use to play out that round |
| Blood Rage | General inspiration |
| Pax Pamir (2nd edition) | Influence mechanics over an external faction |
| Reiner Knizia games | Simple mechanisms; players making moves on a shared board to advance their goals; constantly analyzing other players' positions to understand how to advance their own. The reference is to shared-board play in general |
| SILOS (Reiner Knizia) | Players bid for control of locations, much like our influence mechanic, but which locations they want shifts throughout the game; no one keeps all their control in one or two locations for the whole game |
| Northern Pacific (Amabel Holland) | An incredibly thinky decision space built from only two possible decisions, where the consequences of either choice are huge depending on what other players are aiming for and invested in |
| Hansa Teutonica (Andreas Steding) | The push and pull of being able to push out another player's existing pieces, but at a higher cost, and while giving the displaced player a benefit |
| Rumble Nation (Shun Taguchi) | The cascading nature of the resolution flow |
| Battle for Rokugan | The system for indicating intent without revealing actual values until resolution, which creates room to bluff or cast aspersions |
| A War of Whispers (Jeremy Stoltzfus) | Simple, deterministic combat resolved from presence alone |
| Pandemic (Matt Leacock) | A growth system run by the game itself: presence grows over time and players have to work to keep it in check |
| Spirit Island (R. Eric Reuss) | A growth system run by the game itself: presence grows over time and players have to work to keep it in check |
| Big Shot (Alex Randolph) | Ties for a majority are disregarded, so the prize passes to the next player in line |
| El Grande (Wolfgang Kramer and Richard Ulrich) | Tied players all drop to the next place down, however many are tied |

---

## 2. Game foundation

### 2.1 Core tension and experience goals

- The push and pull plays out between the players and the **two major win conditions**: all the invaders losing, or a single faction winning.
- Players score by taking actions that **cause invaders to eliminate one another**.
- Players can gain **influence with a faction**, and benefit if that faction wins.

### 2.2 Theme and setting

- A mashup of common monster-of-the-week themes and tropes.
- Setting: a small island town, in a pixel-art RPG / animated-series style.
- The factions are **invaders** of the island.

### 2.3 Players

- Each player plays a **slayer group**: a small group of characters modelled on a monster-of-the-week trope (2.5).
- Players influence the board using **monster-of-the-week trope actions**: baiting, trapping, and similar.

### 2.4 Genre and core system

- A shared-board area control / area majority game.
- Driven by a "play a card, take an action" system.

**Genre layers (ideas)**

- **Card-driven:** the action system and player influence run on cards.
- **Area control on the board:** board state and control resolution are the major signposts and events of the game.
- **Bidding in disguise:** the influence track is a public, sequential bidding / area-control contest for dominance over factions.
- **Stock speculation:** trophy collection works like a stock market, with each faction's trophies worth more or less depending on the end-game outcome.

### 2.5 Game content

#### Archetypes and factions

Five archetypes, each with three factions (15 total).

| Symbol | Archetype | Factions |
|---|---|---|
| ◐ | Nocturnals | Vampires, Werewolves, The Occult |
| ↂ | 80's Sci-Fi | Aliens, Dark Government, Cryptids |
| ⏏ | Sentients | Machines, Artificial Intelligence, Cyberpunks |
| ☾ | Undead | Zombies, Skeletons, Spirits |
| ⎈ | Demons | Demons, The Possessed, Shadows |

#### Locations

Fifteen locations, three aligned with each archetype.

| Symbol | Locations |
|---|---|
| ↂ | Military Facility, Weather Station, State Park |
| ☾ | Sawmill, Mine, Graveyard |
| ◐ | Ski Resort, Fallout Bunker, Occult Camp |
| ⎈ | Caves, Lighthouse, The Lake House |
| ⏏ | Shipping Docks, Junkyard, Beach City |

#### Slayer groups

Five slayer groups, one linked to each archetype.

| Symbol | Archetype | Slayer group | Trope |
|---|---|---|---|
| ◐ | Nocturnals | Slayerettes | High school vampire hunters |
| ↂ | 80's Sci-Fi | Kids on Bikes | Kids on bikes with walkie-talkies |
| ⏏ | Sentients | AV Club | Teen hackers and computer club nerds |
| ☾ | Undead | Neighbourhood Watch | Small-town survivalists |
| ⎈ | Demons | Father and the Flock | A parish exorcist and reluctant helpers |

---

## 3. Design decisions

Every core design decision, grouped into four parts of the game's architecture, plus scaling:

- **The Contest:** what's being fought over, and by whom.
- **The Levers:** how players push on the contest.
- **The Reckoning:** when and how the contest resolves.
- **The Stakes:** how players profit from the outcome.
- **Scaling:** how the game adapts to player count.

Stages: **Not started** · **Ideas** · **Decisions** · **Details** · **Rules**

### 3.0 Index

| Part | Decision area | Stage |
|---|---|---|
| Contest | 3.1 Board topology | Ideas |
| Contest | 3.2 Location control | Ideas |
| Contest | 3.3 Location-archetype alignment | Ideas |
| Contest | 3.4 Invader forces | Decisions |
| Contest | 3.5 Invader population | Ideas |
| Levers | 3.6 Action acquisition | Ideas |
| Levers | 3.7 Player actions | Ideas |
| Levers | 3.8 Timing and passing | Ideas |
| Levers | 3.9 Persistent progression | Decisions |
| Levers | 3.10 Player characters | Decisions |
| Levers | 3.11 Information | Decisions |
| Reckoning | 3.12 Round structure and game length | Ideas |
| Reckoning | 3.13 Conflict resolution | Ideas |
| Stakes | 3.14 Influence | Ideas |
| Stakes | 3.15 Victory | Ideas |
| Scaling | 3.16 Player-count scaling | Decisions |

---

### The Contest

#### 3.1 Board topology · *Ideas*

**Ideas**

- `BD1` One board (first draft): an illustration of the island showing the 15 locations.
- `LL1` **Two-faction limit (first draft):** a location can hold at most two factions.
  - First draft: no action can bring a third faction into a location. A move that would do so is not allowed.
- **How locations connect.** Candidates:
  - `CN1` *Fixed connections:* each location has a fixed set of adjacent locations.
  - `CN2` *Connections built by players:* connections are dynamic and must be built by players as actions.
    - `TM2` *Burned connections:* a connection can be burned when a fight ends in a tie.
    - *Open:* what is connected at the start of the game.
    - *Open:* whether a built connection can be used by everyone or only by its builder.
    - *Open:* which connections burn in a tie.
  - `CN3` *Regions (first draft):* the island is divided into regions. Movement is free within a region and allowed between neighbouring regions.
    - Five regions of three locations, for now. More regions are preferred, so that movement is harder.
    - No region borders all the others.
    - Which regions border which is left to map design.
- `TM1` **Scorched earth (first draft):** a location where a fight ends in a tie is scorched, and is no longer a location for the rest of the game.
  - First draft: scorching only comes from a true tie, and a true tie never rewards anyone. It burns everything: no trophies are collected and no influence goes to any faction. Tokens, influence, hidden tokens and any other pieces on the location return to their supplies.
  - First draft: a region whose locations are all scorched is impassable. Nothing moves into or through it, so the ring of regions can break.
- *Open:* whether locations limit the number of tokens they hold, or have special properties.

#### 3.2 Location control · *Ideas*

**Ideas**

- `LC1` **Factions control locations; players never do (first draft).** Players control their influence with factions and collect trophies. Their actions shift the board state, but they are never in control of a location.
- `LC2` **Control by token count (first draft):** a faction controls a location when it has the most tokens there.
  - If two factions are tied, the one with affinity for the location controls it.
  - Otherwise no one controls it.
- Control gives a faction two things: boosted growth on its aligned locations (AL3, 3.3), and the edge when factions are tied in presence at game end (FX1, 3.15).

#### 3.3 Location-archetype alignment · *Ideas*

**Ideas**

- A location's archetype alignment ties into seeding and setting up initial presence on the board (SD1, 3.5).
- `AL1` Each archetype's three locations are spread across the island, not grouped together.
- Cards can use alignment to break the normal movement rules (MV2, 3.7).
- A slayer group wins ties between players at the locations aligned with its archetype (AB1, 3.10).
- `AL2` **Tied fights on aligned ground (first draft):** in a tied fight at a location aligned with one of the two factions, that faction wins the fight (3.13).
- `AL3` **Boosted growth (first draft):** a faction that controls a location aligned with its archetype (LC2, 3.2) gains one extra token there, on top of normal growth (3.5).
  - For now, the extra token applies only where the location already grows. A faction under the growth threshold gains nothing.

#### 3.4 Invader forces · *Decisions*

**Decisions**

- One faction is picked randomly from each archetype at setup, so every game includes five factions, one per archetype.
- Invaders are represented as tokens placed at locations.
- A token always represents a specific faction: the one in play for its archetype.

**Ideas**

- `FD1` **Layered differences:** archetypes have the wider range of differences between them. Factions within an archetype are variations on the same core set of themes, with subtle differences in how they control, move, and conflict on the board.
  - Archetypes should be easily learnable and thematic.
  - Faction twists should be small and quickly internalized.
  - The archetype differences below are loose candidates. Combat is worked out first, and the differences are shaped to fit it.
  - `FD2` **Differences through combat losses:** archetype or faction differences could be expressed as variations on how tokens are lost in a fight. These would be tricky to balance.
  - *Open:* what the archetype-level differences are.
  - `AP1` **Nocturnals ◐, converts:** when they win a battle, some of the losing tokens become theirs instead of being removed.
    - *Open:* how many tokens convert, and how this interacts with battle trophies.
  - `AP2` **80's Sci-Fi ↂ, abduction / mind control:** they can pull tokens of other factions out of a location without a battle.
    - *Open:* what happens to abducted tokens, and how mind control differs from abduction.
  - `AP3` **Sentients ⏏, networked:** their strength at a location counts their tokens in connected locations too.
    - *Open:* what counts as connected (depends on 3.1 Board topology).
  - `AP4` **Demons ⎈, corruption:** a corruption mechanism.
    - *Open:* how corruption works in a way that's easy to track.
  - `AP5` **Undead ☾:** Undead factions spawn from the remnants of other battles.
    - *Open:* what counts as remnants, and how many Undead spawn from them.
    - *Open:* where they spawn.
    - `AP6` One idea: Undead only spawn from battles that don't involve Undead, and only from battles where humanoid factions were present.
      - *Open:* which factions count as humanoid.
    - *Open:* how this interacts with battle trophies, since removed tokens go to players.
  - *Open:* what the faction-level variations are, and how subtle.

#### 3.5 Invader population · *Ideas*

**Ideas**

- `SD1` **Seeding (first draft):** each faction starts on its home territory. Every faction has a home location of its own, one of its archetype's three locations.
  - First draft: the home location is drawn at random from the three.
  - Provisional numbers: 5 tokens on the home location, and 1 token on each of the faction's other two aligned locations.
  - Starting presence and the total number of tokens per faction, including the supply, are left to balancing.
- **Growth.** Candidates. These are separate ideas, need not be used together, and could be mutually exclusive:
  - `GR1` *At resolution (first draft):* at round end, after conflict resolution, every location where a faction has reached the growth threshold gains one token of that faction.
    - The growth threshold is provisionally 2 tokens. The number is left to balancing.
    - It applies at every location that meets the threshold, whether or not a fight happened there.
    - Growth never follows a mid-round fight straight away.
    - A faction that controls one of its aligned locations gains one extra token there (AL3, 3.3).
    - First draft: a faction whose supply runs short grows as far as its supply allows. Its influence leader chooses which locations grow; tied influence leaders take turns placing one token each, in turn order from the first player.
    - First draft: growth never happens before a fight, so when growth runs each location holds only one faction. The question of two factions growing at one location does not arise.
    - *Open:* whether a location that growth pushes to the volatility threshold boils over at once, or waits for the next round.
  - `GR2` *Through cards (out of the first draft):* one use of a card grows a faction and gains the player influence with it (CU4, 3.7). Cards can trigger growth alongside growth at resolution.
    - *Open:* where the new token goes.
  - `GR3` *Run by the game (first draft):* the game itself has a system that grows presence over time, which players have to work to keep in check.
    - In the first draft, `GR1` is this system: growth at resolution is how the game grows presence.
  - `GR4` *As spillover:* the spillover from a resolved fight is how invaders grow, so population growth and combat form one cascade rather than two systems (linked to cascading resolution in 3.13).
    - *Open:* whether spillover is the only source of growth.

---

### The Levers

#### 3.6 Action acquisition · *Ideas*

**Ideas**

- `DR1` *(First draft.)* Cards or actions are drafted at the start of each round.
- `DR2` *(First draft.)* Cards still in hand when a round ends are lost, and go back into the draft pool.
- Two cards in the draft are marked A and B, and decide who goes first (FP1, 3.8).
- `DR3` **Pick and pass (preferred; first draft, with the put-back rule):** players keep one card and pass the rest. Each time a new batch arrives, the cards kept so far rejoin the hand, so a player ends each pass keeping one more card than before.
  - A player can put any number of earlier picks back into the hand they pass on, taking that many extra from the batch they received.
- `DR4` **Same pool every round (preferred; first draft):** the whole card pool is drafted again every round.
  - First draft: every card in the pool is unique, with no duplicates (21 cards, PS1, 3.16).
  - The pool stays small and known. A large deck would be unwieldy, and wouldn't give players enough reliability to plan ahead.
  - The pool scales with player count (3.16).
- `DR5` **One card left out (first draft):** one card is left out of the deal each round, unseen.
  - First draft, with the fixed pool (PS1, 3.16): every card not dealt is left out, unseen: 3 at 3 players, 1 at 4 and 1 at 5.
  - With about four cards each, the pool would be 13 cards at 3 players, 17 at 4 and 21 at 5. These numbers move with hand size.
  - The left-out card is never revealed. By the end of the round it no longer matters.
- `DR6` **The pool is the whole action set (first draft):** the drafted pool is the limited set of actions. There is no separate set of actions outside it.
- Hand size is left to balancing, and depends on how many actions the game needs. Provisional target: about four cards per player per round.
  - With exactly four cards, at most one earlier pick can go back at each pass.

#### 3.7 Player actions · *Ideas*

**Ideas**

- `CD1` Player actions and player influence run on cards.
- `MP1` **Multi-purpose cards:** each card can serve several purposes:
  - determine the board state action being taken;
  - let a player adjust their influence with a faction in some way;
  - if round end is dynamic, determine the "time" movement toward a resolution phase.
- *Open:* how a card's uses combine. Options under consideration:
  - `CU1` *One-of (first variant):* a player chooses either the board action or the influence adjustment.
  - `CU2` *Applied together (ruled out of the first draft):* every play does both.
  - `CU3` *Intertwined (first draft, as single-purpose cards):* cards are single use and do one thing (increase influence, alter or modify board presence, and so on), but board actions require spending an influence cube.
- *Intertwined option, ideas:*
  - `IC1` A board action costs influence with the faction being moved. **First draft (designer, 2026-10-07; D15):** the card dictates how influence is placed, and that placement is a requirement, paid from standing with the faction moved. A move goes only as far as the player can pay. Example: a card spreads one group to several locations and places 1 influence at each location spread to, however many tokens go there; a player with 1 standing with that faction can spread to only one location. A card that places no influence has no requirement.
  - `IC2` The cost depends on the card. Indirect cards (such as a "bait" card) cost no influence but have a smaller effect: fewer tokens or locations. Direct cards cost influence but make a bigger move; thematically, the player is cashing in some of their sway with the faction's leader.
  - *Open:* what a board action affecting more than one faction costs.
  - *Open:* whether players start with any influence, since costly cards are unusable without it.
- `CU4` **Dual-use cards:** a card has two uses.
  - *Grow:* grow a faction and gain influence with that faction. (Out of the first draft: card-driven growth is ruled out for now.)
  - *Move:* spend influence with a faction, move that influence onto a location, and take a presence or movement action.
- `MV1` **Distinct movement actions:** each card allows a particular type of movement, and every movement action is different from the others. How many tokens a move takes is set by the card.
- `MV2` **Rule-breaking moves:** cards can break the normal movement rules, through alignment or through special movement actions.
- `CB1` **Balance:** cards differ in what they do but are close in power. The card marked A (3.8) is the exception.
- The movement types themselves are left to card design.
- *Open:* how players influence the board with monster-of-the-week trope actions (baiting, trapping, and similar).
- `AC1` **Distinct, precious actions (designer's aim):** actions should feel distinct and precious. Dual-use cards risk feeling too flexible, and so boring, unless there are enough distinct actions; which way uses combine depends on what feels best.
- `LK1` **Location cards (set aside for the suits, SU1):** each card is tied to one location, one card per location, so every location's card is in the pool at every player count. Designer's pick, 2026-10-05, from a suggested structure (S2, geography cards).
  - Hand size becomes 5 cards each, so the 15 location cards are all dealt at 3 players.
- `SU1` **Archetype suits (first draft; designer's seed, 2026-10-05):** cards come in five suits, one per archetype. Each card is a thematic action for its archetype: for example, gain influence with that archetype's faction, or a presence effect targeting a location on the board and a faction at that location.
  - First draft: suits replace the location cards (LK1 set aside). Fifteen suit cards, three per archetype, each a thematic action whose target is chosen on the board. With the six extras (A to D and two unmarked) the pool stays at 21 (PS1).
  - Designer's principles for the suited set (2026-10-05). Above all, every card must be incredibly thematic, feel very unique, and fit its suit's theme; the rest serve that.
    1. *(Widened by principle 14.)* A presence effect always offers the option of affecting one of its suit's three locations.
    2. An influence action gains influence either with the suit's affinity faction (its archetype's faction) or with a faction controlling one of the suit's locations.
    3. Every action feels strongly thematic to both its suit and the action itself.
    4. Some cards can be multi-use; some single-use. Multi-use means a card offers more than one action, of which the player takes one; every card is played once.
    5. Like Inis, some cards could have an "on your turn" action and an "in response" action, so the card can be spent either way.
       - "In response" actions can be unique actions informed purely by the theme. Unlike the card's turn action, they don't have to apply to the suit's locations or factions (principles 1 and 2 govern turn actions only).
       - Responses are interrupts: played the moment their trigger happens, on anyone's turn, and they don't use a turn. First draft: each response says when it resolves, before or after its trigger, depending on what it does. A cancel response (like Inis's Geis) resolves before, and there is only ever one cancel response in the pool. It is on one of the two unmarked unsuited cards, not on A to D. *Designer (2026-10-08): the Cancel card is removed entirely; the pool has no cancel response.*
       - First draft: a response can't be answered by another response. If the response makes the triggering action impossible, that action resolves as far as it can, and its card is still spent.
       - In the web prototype the game never pauses for responses; a response fires as it happens (2026-10-06). A turn action is announced when its card is played and stays *in progress* while the acting player chooses its targets; a "before" response (the cancel, a block) can fire in that window. An "after" response fires once the action has resolved. If no one fires, the action resolves when the acting player confirms.
       - Responses should be few. Most ways to undo or alter another player's move are presence actions taken on a normal turn, so responses are kept for what a turn can't do.
       - Responses are always thematic. Apart from the one cancel, a response never just undoes or alters where tokens are; that is the job of turn actions. Blocking is acceptable: a response may stop a move from happening (for example, tokens stay put).
    6. *(Set aside with IL1.)* A card that lets one faction act on another needs you to lead the acting faction; if not, gain influence with it instead. In the first draft no lead is needed, and the influence use comes from principle 7.
    7. First draft: every suit card can be spent for influence with its suit's affinity faction, instead of its presence action or its response. The amount is printed on each card, more than 1, like Twilight Struggle's operations points (CU1, one-of, for every suit card).
    8. First draft: the six unsuited extra cards (A to D and two unmarked) don't offer influence. Instead they allow wild, powerful or flexible actions.
    9. Action themes are not limited to the inspiration and ideas recorded so far. A strong thematic action can lead to a new mechanism, and a strong mechanism can find a new theme.
    10. Presence actions have no token limits, whatever kind they are (concentrate and scatter are only examples, not the only kinds). They are defined by geography instead: for example, move any faction's tokens from locations adjacent to a location of this suit into it, or move any amount of the affinity faction from neighbouring regions into a single region.
    11. Cards are written from the slayer group's point of view, never the monster's. Each is something a slayer group would plausibly do that has the card's effect on the monsters: perform a séance, leave out fresh meat, hack a computer.
    12. *(Set aside with IL1.)* Whether a card needs the lead of the faction it moves is decided card by card. In the first draft no card needs a lead.
    13. As many presence effects as possible should be a unique move, like Track Them in the Snow (H.1): a distinct way of moving that opens gambits only its holder has. Plain "move tokens from here to there" effects are the fallback, not the norm.
    14. Every suit card works two ways (2026-10-06). Its text describes the effect; the player then picks its target, either:
        - **a location:** any faction, at one of the suit's locations; or
        - **a faction:** the suit's own (affinity) faction, at any location.
        This mirrors principle 2 for influence (the affinity faction, or a faction controlling a suit location).
        - Each card says which location counts as the target when its effect involves two (where tokens come from, or where they go), and which faction counts as the target when it involves two.
        - It applies to every suit card where possible. For an influence action it reads: gain influence with the suit's faction, or with a faction controlling one of the suit's locations.
        - **Why:** it gives cards flexibility while keeping strong ties to their theme, and it lets strategies evolve and change during the round, as a puzzle that still feels like the suit.
  - First draft, suit structure (from a suggestion, 2026-10-05). Each suit has three cards:
    - *Strike:* a move that creates a contest at or from a suit location. Printed influence 2 to start.
    - *Shift:* a relocation that concentrates or scatters tokens. Printed influence 3 to start.
    - *Signature:* the suit's primary card. The archetype's rule-bend, plus the suit's response (one per suit, so five in the pool; the Cancel was removed, 2026-10-08), and the suit's highest printed influence, provisionally 4 (2026-10-06).
    - *Printed influence (D12, 2026-10-07):* not fixed by slot. Every suit prints the same total influence (9 at present), split across its three cards however balances them; the 2/3/4 above is the starting split. Always weighted to the action's strength: the weakest of the three prints the most.
    - Across a suit's cards, one concentrates and one scatters. Concentrating tokens feeds growth (GR1 needs 2 or more tokens); scattering them into single tokens stops growth, so both sides of the win condition have a tool in every suit.
- **Card ideas** are catalogued in Appendix H, all in one format. Every entry there is an idea, not a decision.
  - The unsuited extras come later. They are spice, balance and swing for the suited cards, and take inspiration from Inis's unique effect cards.
- **The staleness tension (designer's observation, 2026-10-05):** if each card always does the same unique action at the same place, the game gets stale quickly. If each card allows similar, more flexible actions, each action loses its impact, immediacy and vibe. The card design has to sit between the two.
- **Common card actions (designer's seed, 2026-10-05; to be worked through in step 2):**
  - `CA1` *Gain influence:* a simple, straightforward action. The player gains some influence (stake) with a faction.
  - `CA2` *Affect a faction's presence:* an action changes a faction's presence on the board, and places influence spent from that faction (IM1, 3.14). Example: move a faction's tokens from one location to adjacent locations; at each location moved to, the player takes 1 influence from that faction and places it there, along with at least 1 of the faction's tokens.
  - `CA3` *Place without moving presence:* some actions, such as a trap, place tokens and 1 influence from the player's own supply on a location, without affecting any faction's presence (IN1, 3.11).

#### 3.8 Timing and passing · *Ideas*

**Ideas**

- `TU1` *(First draft.)* On their turn in the play phase, a player plays a card or passes. A player who has passed can still play a card if the turn comes back to them.
- The round ends when all players pass in a row (RE3, 3.12).
- Cards still in hand when the round ends are lost (DR2, 3.6).
- `FP1` **First player by marked cards (first draft):** two cards in the draft are marked A and B. The player holding A is first player, and play goes clockwise from them. If A is the card left out that round (DR5, 3.6), the player holding B is first player.
  - A and B are both in the 3+ core set, so they are in the pool at every player count (3.16).
  - `FP2` *Four marked cards with the fixed pool (first draft):* with the location-card catalogue (LK1, PS1), four cards are marked A, B, C and D. The player holding the earliest letter dealt is first player and opens the round with that card. At most three cards are left out, so at least one marked card is always dealt. The earlier ruling against a third marked card (changelog, 2026-10-03) still applies to the tiered pool.
    - First draft: A to D are four of the six cards that aren't location cards, leaving two unmarked extra cards.
    - First draft: the marked cards step down in power, A > B > C > D. A stays the one clear standout (CB1); the letter shows roughly how strong each is.
  - The first player must open the round with their marked card.
  - The marked cards are powerful, and A is the stronger. A is the one clear standout; otherwise cards are close in power (CB1, 3.7).
  - What the marked cards do, and how one is played when it didn't make its holder first player, are left to card design.

#### 3.9 Persistent progression · *Decisions*

**Decisions**

- The game has no persistent upgrade mechanism.

#### 3.10 Player characters · *Decisions*

**Decisions**

- Each player plays a slayer group: a group of characters modelled on a monster-of-the-week trope.
- There are five slayer groups, each linked to one archetype (2.5).

**Ideas**

- Slayer groups play identically, apart from affinity.
- **Affinity:** a slayer group has a small edge with its linked archetype's faction and at that archetype's locations. Candidates:
  - `AB1` *Tiebreaker (for now; first draft):* affinity breaks ties between players.
    - Battle: in a tie in influence at a location, the group with affinity for that location wins (3.13).
    - Influence: in a tie in influence with a faction, the group with affinity for that faction wins (3.14).
    - The two never cross. Affinity for a faction has no effect in battle, and affinity for a location has no effect on influence with a faction.
    - When no tied player has affinity: in battle, see PT1 and PT2 (3.13); in influence, the tie stands, and at game end it is settled by the next faction (ET1, 3.14).
    - At game end, affinity for a faction breaks a tie on standing with that faction however standing is measured (ET3, 3.14). An alternative compares raw influence first (ET2).
  - `AB2` *Permanent plus-one:* a small standing bonus with the linked archetype, always on from setup. Examples: gain an extra trophy; place an extra influence.
    - *Open:* where an extra trophy comes from, since trophies are the casualties of a fight (RQ2, 3.13).
    - *Open:* whether extra influence goes to the linked faction or onto a linked location.

#### 3.11 Information · *Decisions*

**Decisions**

- Players' hands are hidden from each other.

**Ideas**

- `IN1` **Hidden actions:** a select few actions, such as "set a trap", place a token with a blind side on a location. When the location resolves, the token flips and becomes part of the resolution. These actions inherently allow for bluffing or misdirection.
  - First draft (2026-10-06): fight modifiers are only ever hidden actions. A card that changes a fight places a face-down token on its target during play; the token flips and applies when that fight resolves (HT1). Under UT1, a token whose location doesn't fight stays face down into the next round.
    - Fight modifiers take every hidden-action rule: the token's presence and its owner are public and its face is hidden (IN1); the owner's marker cube on it counts as their influence at the location (IN1; where the cube comes from is MC1–MC3, with MC3 preferred); each play places one real token and one bluff (BT1); and an unresolved token stays face down (UT1).
    - Tokens always go on a location. Under the two targets (principle 14, 3.7), that is either one of the suit's locations (any faction) or a location holding the suit's faction (anywhere), chosen when the card is played.
    - The suit constraint is checked only when the token is placed. If presence changes afterwards (the suit's faction leaves, say), the token stays where it is and still applies to that location's fight.
    - The bluff follows the same placement rules as the real token.
    - A hidden effect must always be able to apply to whatever fight happens at its location. It is never conditional on a particular faction being in the fight.
    - One token per location, real or bluff. A location holding a token can't take another, so tokens never mix and the rule is checkable in public. Planting first claims a location, and a bluff can block one.
    - If only one valid location is free, the player chooses whether to place the real token or the bluff there.
  - Public: that a token is at the location, and which player placed it. Hidden: the token's face.
  - The owner is marked by one of their cubes on the token. That cube counts as the player's influence at the location.
  - What a flipped token affects. Candidates:
    - `HT1` *The fight (first draft, for fight modifiers):* the token changes the contest between the two factions.
    - `HT2` *The collection:* the token changes which players collect the trophies.
  - What each token does is left to card design.
  - Hidden actions are rare: only a few cards in the pool place a real hidden token. Which cards they are is left to card design.
  - `BT1` **Bluff tokens:** each player has a bluff token to place as well. It looks like a real hidden token from its blind side, and its marker cube can count as influence at the location, but it does nothing else when it flips.
    - Each action that places hidden information places one real token and one bluff. The exact numbers are left to balancing.
  - Where the marker cubes come from. Candidates, to be chosen through balancing and playtesting:
    - `MC1` *Spent from a faction:* each marker cube is influence spent from a faction, as other influence on locations is (IM1, 3.14).
    - `MC2` *From the player's supply:* the marker cubes are free, and cost no standing with any faction.
    - `MC3` *From the player's supply, and back to it (preferred, pending playtesting):* the marker cubes come from the player's own supply, count as influence while the token is on the board, and return to that supply afterwards. They never go anywhere else.
  - `UT1` **Unresolved tokens persist (first draft):** a token on a location that doesn't resolve that round stays there face down, with its marker cube, and carries into the next round. It stays until the location resolves.
- `IN2` **Secret trophies (first draft):** a player's collected trophies are kept secret. Everyone sees which pile a player takes at the moment of a fight; the running total is hidden.

---

### The Reckoning

#### 3.12 Round structure and game length · *Ideas*

**Ideas**

- `GL1` *(First draft.)* The game lasts a set number of rounds.
- `RS1` *(First draft.)* Each round runs in phases: draft cards or actions, play cards or actions, resolve the board state, repeat.
- How a round ends. Candidates:
  - `RE1` *Fixed:* the round ends once all players have played all their cards.
  - `RE2` *Dynamic (out of the first draft):* cards carry an extra resource, such as a time value, that advances a moon track. When the moon reaches full, the round resolves and players lose any unplayed cards.
  - `RE3` *All pass (first draft):* the round ends when all players pass in a row (3.8).
- The number of rounds, and how it relates to the number of cards drafted per round, are left to balancing.
- The resolve phase runs conflict resolution first, then growth (GR1, 3.5).
- *Open:* what else the resolve phase includes, such as cleanup.
- *Open:* if round end is dynamic: whether time values are on every card or only some; whether the moon track resets each round.

#### 3.13 Conflict resolution · *Ideas*

**Ideas**

- **What combat has to do (first draft, all five):**
  - `RQ1` The winner takes casualties too. Otherwise invader presence can't be whittled down.
  - `RQ2` Trophies are the tokens removed from combat as casualties.
  - `RQ3` The game revolves around who receives which trophies. First place receives the larger share and second place receives some.
  - `RQ4` Which colour of trophy a player gets depends on where they stand at the location and on which way the fight goes.
  - `RQ5` Resolution is deterministic, quick and easy. Nothing is added to a fight once it has begun. A hidden token already at the location can flip up and take part (IN1, 3.11).
- `FS1` **Two-sided fights (first draft):** a fight is always between two factions, which follows from the two-faction limit (LL1, 3.1).
- **How a fight resolves.** Candidates:
  - `FR1` *Half, rounded up (preferred):* the larger group wins. The losing faction loses all its tokens at the location, and the winning faction loses half that number, rounded up.
  - `FR2` *One-for-one cancellation:* tokens cancel one for one, and the larger group survives with the difference. Both factions lose the same number, so first place receives no more than second.
  - `FR3` *Flat one:* a weaker candidate. The larger group wins. The losing faction loses all its tokens at the location, and the winning faction always loses exactly one token.
  - `FR4` *Dice (out of the first draft):* a weaker candidate, since deterministic combat is preferred.
  - `FR5` *Half, rounded down (first draft):* the larger group wins. The losing faction loses all its tokens at the location, and the winning faction loses half that number, rounded down, with a minimum of 1. The winner always takes a loss (RQ1), so the runner-up always has a pile (RQ3).
- `TF1` **Tied fights (first draft):** when the two groups are the same size, both are wiped out and the location is left empty.
  - At a location aligned with one of the two factions, that faction wins the fight instead (AL2, 3.3).
    - First draft: the aligned faction wins and loses half the loser's tokens, rounded down, minimum 1, as in any other win (FR5). In a 3 v 3 tie at its aligned location, the winner loses 1 and keeps 2.
    - A tie on ground aligned with neither faction (a true tie) wipes out both groups, and the location is scorched (TM1, 3.1). No trophies are collected: the wiped tokens return to their factions' supplies.
- `TD1` **Trophy distribution by influence at the location (first draft):** players place influence on locations (IM1, 3.14), and the players with the most influence at a location collect the trophies from a fight there.
  - The casualties form two piles, one per faction.
  - Piles are handed out by size: the bigger pile goes to the leader, the player with the most influence at the location, and the smaller pile to the runner-up.
  - If the piles are the same size, players pick in order of influence.
  - Players tied in influence at the location. A slayer group with affinity for the location wins the tie (AB1, 3.10). When no tied player has that affinity, candidates:
    - `PT1` *Lower influence:* the tie goes to the player with lower influence with the faction whose pile is being handed out. This is decided pile by pile.
      - *Open:* what breaks the tie when their influence with that faction is also equal.
    - `PT2` *Standing tie (preferred; first draft):* the tie is not broken.
  - What a standing tie does to the piles. Candidates:
    - `ST1` *Nobody collects (first draft):* the piles the tied players were in line for return to the supply.
      - First draft: a tie uses up every place the tied players were in line for. Tied leaders use up first and second, so both piles return to the supply and players below them collect nothing. Players tied for runner-up use up second, so the smaller pile returns to the supply.
    - `ST2` *Disregard the tied players:* tied players are ignored, and everyone below them moves up. With two leaders tied, the third player collects the bigger pile and the fourth the smaller.
      - A pile with no player left in line is unclaimed (UP1, UP2).
    - `ST3` *Drop down a place (preferred):* tied players all take the next place down. Tied leaders both count as runner-up: the bigger pile returns to the supply, and they share the smaller pile equally, with any odd token returned to the supply.
      - The smaller pile is a single colour, so the tied players never receive a mix of colours.
      - Players tied for runner-up drop to third and collect nothing, and the smaller pile returns to the supply.
      - *Open:* whether the tied players' influence still clears (AS1), or is treated as a runner-up's.
      - *Open:* which pile the tied leaders share when the two piles are the same size.
  - A pile with no player in line to collect it. Candidates:
    - `UP1` *(First draft.)* it goes to the only player with influence at the location, who then collects both piles.
    - First draft: when no player has influence at the location, both piles return to the supply.
    - `UP2` it returns to the supply.
  - First draft: a player cannot decline a pile. Every pile a player is owed is collected.
- `TD2` **Trophy distribution by faction influence:** casualties are distributed to players based on their influence with a faction.
  - If faction influence is used, the player with the lowest influence with the faction makes more thematic sense than the highest.
  - *Open:* whose influence decides: influence with the faction that lost the tokens, or with the faction that won the fight.
- **Influence at a location after a fight.** Candidates:
  - `AF1` *Always clear:* all influence at the location clears after a fight.
  - `AF2` *One left behind:* the leader or the runner-up leaves one influence behind, which carries into the next fight there.
  - `AF3` *Leader moves, others stay (first draft, adjusted):* the leader's influence moves to the faction that won the fight, whichever faction it was spent from. The runner-up's influence stays at the location, and so does that of players in third place or lower.
    - First draft: only the leader's influence leaves the location. Half of it, rounded down, becomes the leader's influence with the faction that won the fight; the rest returns to the leader's own supply. Everyone else's influence stays at the location.
  - `AT1` *(First draft.)* In a tied fight, the influence at the location clears, back to each player's own supply.
  - `AS1` *(First draft.)* In a standing tie between players, the tied players' influence clears off the board, back to each tied player's own supply, and does not go to a faction.
    - First draft: this applies only to tied leaders. Players tied for runner-up keep their influence at the location, like any other non-leader.
  - First draft: cleared influence returns to its player's own supply (see Supply, Appendix B).
  - First draft: influence at a location where no fight occurs stays there into the next round.
- **When fights happen.** Candidates:
  - `FT1` *End of round (first draft):* every contested location fights at the end of every round. Each fight leaves one faction or none, so every round starts with no location contested.
  - `FT2` *Volatility threshold (out of the first draft):* a location's volatility is the number of tokens present there. When it reaches a threshold, the location boils over and the fight resolves mid-round.
    - A location that boils over resolves whether or not the two groups are equal. An equal split resolves as a tied fight, which makes it more consequential to bring a location close to boiling over.
    - Used alone: fights happen only when a location boils over. This keeps presence on the board for players allied with a faction.
    - Used with end-of-round fights (FT1): whatever is still contested fights at round end. This is a way to pick up low-contest trophies.
    - The threshold is the same at every location. The number itself is left to balancing.
  - `FT3` *Card trigger (out of the first draft):* a card resolves a fight during the play phase. Timing matters: a player gains influence at a location and then triggers the battle.
- `RO1` **Cascading resolution (out of the first draft):** locations resolve one at a time in a fixed, visible order, and the outcome at one location spills over into locations that haven't resolved yet.
  - *Open:* what sets the resolution order.
  - *Open:* what spills over, and where it goes.

---

### The Stakes

#### 3.14 Influence · *Ideas*

**Ideas**

- `IF1` *(First draft.)* Players can gain influence with a faction, and influence is public.
- `IF2` *(First draft.)* Players hold influence with each faction, which breaks end-game ties, and decides how battle trophies are distributed (TD2, 3.13).
- `IM1` **Influence on locations (first draft):** influence can be spent from a faction and placed on a location (CU4, 3.7). After a fight, the leader's influence at the location can move to the faction that won (AF3, 3.13), so influence spent from one faction can end up with another.
- Lower influence with a faction wins ties for that faction's trophies (PT1, 3.13).
- If a faction wins the game, a player's trophies of that faction count against their influence with it (EG3, 3.15).
- **Where a player's cubes are (first draft):** each player's cubes are always in one of three places.
  - *Supply:* unused cubes. Cubes return here after a fight (the leader's remainder, AF3), from a standing tie (AS1), and from a tied fight (AT1).
  - *Standing with a faction:* public influence. Cubes arrive from the supply (CA1) or from a location when a fight's leader converts half (AF3).
  - *On a location:* a bid for that location's trophies. Cubes arrive from standing with a faction (CA2) or from the supply (CA3).
  - The supply limits how much influence a player can ever build. How many cubes each player starts with is left to balancing.
- `IB1` **Influence as bidding (first draft):** the influence track is an area-control / bidding game in disguise. Players outbid each other for dominance in influence with a faction that appears poised to win the end-game board state check.
  - Bids are sequential, player by player, never simultaneous.
- `IB2` **Shifting desirability (first draft):** what keeps influence targets moving is board presence itself. Depending on the board state, influence with a faction can become highly contested or very niche.
- `IB3` *(First draft.)* Players don't bid with money or any other resource. A bid is an action spent increasing influence, at the cost of not taking an action that affects board presence.
- `IB4` *(First draft.)* Influence bids and trophies are separate systems.
- How influence is gained: by card actions (CA1, CA2 and CA3, 3.7), worked out with the cards. How it is tracked: see where a player's cubes are, below.
- Ties between players in influence with a faction go to the slayer group with affinity for that faction. When no tied player has that affinity, the tie stands (AB1, 3.10).
  - `ET1` **End-game ties look to the next faction (first draft):** at game end, players still tied on standing with the winning faction compare their standing with the faction that has the next highest presence, and so on down.
    - First draft: players still tied on every faction share the victory.
  - Where the end-game score isn't plain influence (EG3, 3.15). Candidates:
    - `ET3` *Affinity breaks any tie on standing (preferred):* however standing is measured, the slayer group with affinity for the winning faction wins a tie on it. If no tied player has that affinity, the next faction decides (ET1).
    - `ET2` *Raw influence first:* players tied on score with the winning faction compare their raw influence with it. If that is level, affinity decides, and after that the next faction (ET1).
    - `ET4` *Fewest trophies first (first draft):* players tied on score with the winning faction compare their trophies of that faction, and the fewest wins. If that is level, affinity decides, and after that the next faction (ET1).
- `IL1` **Only the influence leader moves a faction (first variant; out of the first draft):** only a faction's influence leader, the player with the most influence with that faction, can take an action that affects that faction's presence on the board (CA2, 3.7). Players are never called a faction's leader. Designer's seed, 2026-10-05.
  - First draft, without IL1: any player can take an action that affects any faction's presence. The limit is influence: a presence effect that places influence must spend it from the player's standing with the faction being affected (IM1). A player with no standing with that faction places none, so has no claim on the trophies there.
  - First draft: each slayer group starts the game with some influence with its linked archetype's faction, a head start with that faction. The amount is left to balancing.
  - First draft: 0 influence counts. With a faction no slayer group is linked to (at 3 or 4 players), every player starts tied at 0, so every player is its influence leader until someone leads outright.
  - Ties: affinity breaks a tie for the most influence (AB1, 3.10), so a tied player whose slayer group has affinity for the faction is its sole influence leader. When no tied player has that affinity, the tie stands and doesn't freeze the faction: all the tied players are influence leaders and can take actions that affect its presence, until one of them leads outright.
- `IB5` **Costly displacement (out of the first draft):** outbidding another player's influence with a faction costs more than an uncontested bid, and the player knocked down receives a compensation.
  - Out of the first draft: it needs playtest evidence, or a clear reason, for overtaking to have an effect.
  - *Open:* what the extra cost is, given bids aren't paid with a resource.
  - *Open:* what the compensation is.

#### 3.15 Victory · *Ideas*

**Ideas**

- `WC1` **Two win conditions (first draft):** the island wins, or one faction wins.
- `TH1` **End-game presence threshold (first draft):** at the end of the game, total invader presence is checked against a threshold. Below it, the invaders lose and the island wins. At or above it, the invaders win, and the faction with the highest presence is the winning faction.
  - Presence is a plain token count. Total invader presence is the number of invader tokens on the board, and a faction's presence is the number of its own tokens on the board.
  - The threshold is a simple fixed number. Provisional: more than 15. The number, and whether the line is "more than" or "at or above", are left to balancing.
  - `FX1` **Faction ties go to most locations (first draft):** when factions are tied in presence, the one that controls more locations (LC2, 3.2) ranks higher.
    - `FX2` *Still tied, they win together (first draft):* if the tied factions also control the same number of locations, they all win. Each player's score is their influence minus trophies (EG3) with each of those factions, added together, and the highest total wins.
- `EG1` **End game based on elimination points and influence:**
  - *Invaders win:* the winning player is the one with the most influence with the winning faction.
  - *Island wins:* the winning player is the one who scored the most elimination points (points from actions that caused invaders to eliminate each other).
  - *Open:* how elimination points are earned and tracked, including how ties between players are broken.
- `EG2` **Double-edged end game, based on trophies:**
  - *Invaders win:* the player with the fewest trophies from the winning faction wins. Ties go to the highest influence with that faction at the end.
  - *Island wins:* the player with the most complete sets of trophies wins.
- `EG3` **End game based on trophies and influence (first draft):**
  - *Island wins:* players compare trophies. One candidate is complete sets, where a player's score is their count of the faction they hold fewest of.
  - *A faction wins:* a player's score is their influence with that faction minus their trophies of that faction, and the highest score wins. Trophies count against influence because being responsible for a faction's doom doesn't earn its favour.
- `TS1` **Trophies as stock speculation (first draft, as a principle):** each faction's trophies are worth more or less depending on the end-game outcome.
- `TS2` **Weakest-color scoring (first draft, when the island wins):** a player's score equals the number of trophies they hold of the faction they have the fewest of.
  - Scoring must reward spreading out. Factions that don't fight grow (GR1, 3.5), so they have to be kept in check, and that makes a complete spread achievable.
  - `WT1` *Ties go to the next weakest colour (first draft):* players tied on their weakest colour compare their second-fewest colour, then their third, and so on.
    - First draft: players still tied on every colour share the victory.
- First draft: avoiding fights is a bet that a faction wins. With few trophies, a player keeps their full influence (EG3), but scores 0 if the island wins (TS2). Fighting widely is the opposite bet, in keeping with TS1.
- How often complete sets occur with five factions in play is left to playtesting. Ties are broken by the next weakest colour (WT1).

---

### Scaling

#### 3.16 Player-count scaling · *Decisions*

**Decisions**

- 3 to 5 players.
- The card pool scales with player count. Cards are marked 3+, 4+ or 5+, and a card is in the pool when the game has at least that many players.

**Ideas**

- `PS1` **Fixed pool (first draft, in place of the tiered pool above):** every card is always in the pool, at every player count. Player count changes only the hand size and how many cards are left out of the deal, unseen.
  - First draft: a pool of 21 unique cards (15 suit cards, SU1, and 6 others). Hands of 6 at 3 players, 5 at 4 and 4 at 5, so 18, 20 and 20 cards are dealt and 3, 1 and 1 are left out.
  - The board sees about the same number of plays each round at every player count.
  - This departs from the decision above (D7, cards marked 3+, 4+, 5+). D7 stays recorded; the first draft tests PS1 instead.

---

## Appendix A: Design decisions

### A.1 Decision records

#### D1. Theme, setting, and content

- **Decided:** a monster-of-the-week mashup on a small island town; five archetypes, each with three factions; 15 locations, three aligned with each archetype.
- **Affects:** 2.2, 2.5.
- **Date:** 2026-09-30

#### D2. Genre and core system

- **Decided:** a shared-board area control / area majority game, driven by a "play a card, take an action" system.
- **Affects:** 2.4.
- **Date:** 2026-09-30

#### D3. Player count

- **Decided:** 3 to 5 players.
- **Affects:** 3.16.
- **Date:** 2026-09-30

#### D4. No persistent progression

- **Decided:** the game has no persistent upgrade mechanism.
- **Affects:** 3.9.
- **Date:** 2026-10-03

#### D5. Slayer groups

- **Decided:** each player plays a slayer group, a group of characters modelled on a monster-of-the-week trope. There are five, each linked to one archetype: Slayerettes (Nocturnals), Kids on Bikes (80's Sci-Fi), AV Club (Sentients), Neighbourhood Watch (Undead), and Father and the Flock (Demons).
- **Affects:** 2.3, 2.5, 3.10.
- **Date:** 2026-10-03

#### D6. Hidden hands

- **Decided:** players' hands are hidden from each other.
- **Affects:** 3.11.
- **Date:** 2026-10-03

#### D7. Card pool scaled to player count

- **Decided:** the card pool scales with player count. Cards are marked 3+, 4+ or 5+, and a card is in the pool when the game has at least that many players.
- **Affects:** 3.16, 3.6.
- **Date:** 2026-10-03

#### D8. Prototype architecture

- **Decided:** the web prototype is built on Cloudflare Workers, with the game state as one text document, an HTML and JavaScript UI, a JavaScript game engine written as a state machine, magic links for players, bots, a host page for starting a new game, and a single game at a time.
- **Affects:** Appendix F.
- **Date:** 2026-10-03

#### D9. Prototype art direction

- **Decided:** whatever would be printed art in a physical production is pixel art; whatever would be physical is UI; a select few physical pieces imitate real 3D objects. One palette for the game and UI. Fonts: Tiny5 for headings and labels, Rubik for everything else. Every location shows its presence visually: faction presence as cardboard tokens with pixel art on the face, player influence as cubes in seat colours.
- **Scope:** prototype only; not a rule of the game.
- **Affects:** Appendix F.
- **Date:** 2026-10-03

#### D10. Table talk in the prototype

- **Decided:** the prototype includes table talk: a chat channel at the table, with a short saved history that clears on a new deal. It has no effect on the game.
- **Scope:** prototype only; not a rule of the game.
- **Affects:** Appendix F.
- **Date:** 2026-10-03

#### D11. Prototype palette

- **Decided:** the prototype's palette is a set of 32 colours supplied by the designer, listed in the art guide (`assets/README.md`).
- **Scope:** prototype only; not a rule of the game.
- **Affects:** Appendix F.
- **Date:** 2026-10-03

#### D12. Printed influence per suit

- **Decided:** printed influence is not fixed by slot. Every suit's cards print the same total influence, split card by card however balances them: a weaker action can print more influence.
- **Decided (2026-10-07):** influence is always weighted to the strength of the card's action: the weaker the action, the more influence it prints. In the prototype a suit's three cards print 2, 3 and 4, ordered by measured strength (the battle score from `scripts/balance.js`): the strongest prints 2, the weakest 4. Set at game creation for every deck, fixed or mixed. Under it, Set v2's values change: Track 2 and Fresh Meat 3; Leak 4 and Beam 3; the Virus 4 and Traffic Lights 2 (measured 2026-10-07). Power may differ between cards (a spread is desirable); a weaker action is balanced in other ways, such as more influence when spent for influence, or doing something special, unique and slightly rule-breaking.
- **Decided (designer, 2026-10-08):** the strength that orders printed influence is the probe result from the tuning tournament (the change in a player's chance of winning when the card is played, against letting the turn go, the rest of the round played out by the standard table), written to `public/card-strength.json` by `npm run cards:plays`. A card not yet measured counts as weakest. Set v2 under the second card tuning pass: Fresh Meat 2, Track 3, Silver Bullets 4; Broadcast 2, Leak 3, Beam 4 (Broadcast and Leak within noise); Traffic Lights 2, Reroute 3, Virus 4; Bell 2, Board Up 3, Salt and Burn 4; Light Every Lamp 2, Summoning Circle 3, House on Fire 4.
- **Affects:** 3.7 (suit structure), Appendix H (Set v2 influence values).
- **Date:** 2026-10-07

#### D13. No one moves another player's influence

- **Decided:** no card or rule ever moves another player's influence. A card may move the player's own influence.
- **Affects:** 3.7 (cards), 3.11.
- **Date:** 2026-10-07

#### D15. Influence is a requirement (IC1)

- **Decided:** in the first draft, the card dictates how influence is placed, and that is treated as a requirement: paid from standing with the faction moved, and a move goes only as far as the player can pay. Example (designer): a card lets a single group spread to several locations and places 1 influence on each location spread to, however many tokens move there; a player with 1 influence with that faction can move to only one location.
- **Which faction pays (designer):** cards that give the flexibility to select a faction at a location use the selected faction's influence to do the action.
- **First-draft starting place (designer; not set in stone, "something like it seems like a logical starting place"):** actions tell you how to move and which locations. Each faction moved to a new location costs 1 influence from that faction, placed on the new location, regardless of the size of the group moved. So a draw-in can place up to two influence (a location holds two factions), and spreading out can place more. It makes sense that you must use influence with a faction to move it; it narrows when cards that can affect more than one faction's presence can be played, and it puts more influence on the board (designer: too little influence may reach the board for an interesting bidding contest). *Considered:* only the selected faction pays and the others come along free (variant `whoPays=selected`).
- **Idea (designer):** if actions are to place more influence, cards likely need to provide more influence too (the printed influence for spending a suited card). *Rejected:* the card's suit faction (unless a hand holds two cards of a suit, it is hard to take an action and gain influence in the same round). *Considered:* the faction with the most tokens in the group moving.
- **Follow-up (designer):** review every card for places where the location or amount of influence placed is vague or unspecified, and specify it.
- **Affects:** 3.7 (IC1), 3.14, Appendix G (G.2, G.8), every card's text; the prototype (variant `influenceRequired`).
- **Date:** 2026-10-07

#### D16. The core loop

- **Decided (designer):** the core loop:
  1. Players gain trophies by having the most influence at locations with big conflicts.
  2. To get influence on the board, players place it from factions by taking a card action that affects the board presence of that faction (or other ways to place influence on the board).
  3. To get influence with a faction, players discard a suited card for that influence, sacrificing its action.
  4. Repeat.
- **The invaders' ending (designer):** if the invaders win, influence with a faction is most valuable, but players will likely need influence with other factions too, to keep their favoured faction from being wiped out.
- **The core loop when the invaders win (designer):**
  1. Increase influence with the faction you want to have the most presence, and avoid taking that faction's trophies.
  2. Keep that faction's tokens from being removed from the board in fights: affect that faction's presence, or take actions on other factions so they can't wipe the chosen faction out.
  3. Repeat.
- **Affects:** 2 (core tension), 3.7, 3.13, 3.14; bot strategy (F.9).
- **Date:** 2026-10-07

#### D14. Tokens and cubes

- **Decided:** faction presence on the board is made of **tokens**; **cubes** are always players' influence. A faction never has cubes, and a player never has tokens (apart from hidden and bluff tokens, which are separate pieces).
- **Affects:** all sections, Appendix B (Token, Supply, Influence cube), Appendix G, Appendix H card text, the prototype (`spec.json` text, the `factionTokens` variant, the engine's board state).
- **Date:** 2026-10-07

### A.2 Changelog

Actual changes to mechanisms and game structure.

| Date | Change | Notes |
|---|---|---|
| 2026-09-30 | Decisions D1–D2 recorded |  |
| 2026-09-30 | Player count set to 3–5 (D3) |  |
| 2026-10-02 | Candidate ideas added for combat, trophies, influence at locations, growth, the map, seeding, timing and turn order. No decisions recorded | Ruled out: fights with three or more sides; combat by fixed damage per piece; combat that removes every token at the location; a map with no connections; connections by shared archetype symbol. Set aside: the leader picking a pile first in every fight |
| 2026-10-03 | Persistent progression ruled out (D4). Slayer groups set: five, one linked to each archetype (D5). Candidate ideas added for affinity and for ties between players | Ruled out: a persistent upgrade mechanism; tied players splitting the piles evenly, because a mix of colours is worth more than either pile, so tying would beat winning |
| 2026-10-03 | Candidate ideas added for location control, tied fights and boosted growth on aligned locations, presence as a token count, and volatility as a token count. Balancing numbers deferred. No decisions recorded |  |
| 2026-10-03 | Hands are hidden (D6). Candidate ideas added for hidden tokens, secret trophies, and the draft: pick and pass, with the same pool drafted every round |  |
| 2026-10-03 | Card pool scales with player count (D7). Candidate ideas added: one card left out of the deal each round, and the drafted pool as the whole action set. Marked cards reduced to A and B | Ruled out: a third marked card, C |
| 2026-10-03 | Candidate ideas added or refined for standing ties, end-game ties, faction ties, growth at round end, bluff tokens, marker cubes, and unresolved hidden tokens | Ruled out: removing an unresolved hidden token at round end, whether revealed or not |
| 2026-10-04 | Current focus set: first draft of the rules, then the cards, then the web app prototype. Other open work moved to the backlog | Done before this: fits and clashes for the combat cluster, affinity, ties between players, location control, alignment, volatility, information and the draft; a first pass of trade-offs; four sample rulesets. Prototype architecture (D8), scaffold (built and deployed), art direction (D9), palette (D11) and the prototype art set (F.17) |
| 2026-10-05 | First draft of the rules written up (Appendix G), from the designer's picks in each area. New candidates: CA1–CA3 (card action seeds), IL1 (only the influence leader moves a faction), FR5 (half rounded down, minimum 1), ET4 (fewest trophies first), WT1 (next weakest colour), FX2 (tied factions win together). General rules: one supply per colour; no piece leaves the game. No decisions recorded | Out of the first draft: archetype powers, card-driven growth, boil-over, card-triggered fights, dynamic round end, spillover, costly displacement, dice |
| 2026-10-05 | Card design started. Archetype suits (SU1) with Strike, Shift and Signature slots; fixed pool of 21 (PS1); four marked cards A to D (FP2); card principles 1–13 in 3.7; card catalogue started (Appendix H). First draft taken without IL1 (now the first variant): any faction can be moved, with influence spent from the faction moved. General rule: cards only shift tokens. Adjacent means hexes sharing a border. No decisions recorded | Set aside: location cards (LK1), the tiered pool for the first draft (D7 stays recorded) |
| 2026-10-07 | Printed influence is always weighted to the action's strength: within a suit the weakest prints the most (D12). Set by measured battle score at game creation | Set v2 changes: Track 2, Fresh Meat 3, Leak 4, Beam 3, the Virus 4, Traffic Lights 2 |
| 2026-10-07 | Mixed decks for playtests (designer): when a game is created, each suit draws one Strike, one Shift and one Signature at random from the deck and the test cards, printed 2, 3 and 4 influence weighted to strength (D12); the unsuited extras stay. Host option `deck` (mixed by default; fixed is Set v2). Prototype test plumbing, not a rule | Trials test mixes of cards; test cards get provisional slots |
| 2026-10-07 | Player supply bumped while the cards are designed: 30 cubes per player in the prototype (G.7) | Supply is a balancing concern for later; hidden tokens were blocked by empty supplies |
| 2026-10-07 | Responses out of the first draft; still candidate ideas (variant `responses`, off by default) | The Cancel card and the Signatures' responses are unused while they are out |
| 2026-10-07 | No one moves another player's influence (D13). Influence economy levers under test as variants: influencePerMove, influenceToBoard, influenceAtOrigin (all off by default) | Designer: all three are good candidates |
| 2026-10-07 | Printed influence: the same total per suit, split card by card, not fixed by slot (D12). Card action balance review opened | Starting split stays 2/3/4 per suit (9 each) until the review changes it |
| 2026-10-07 | Terms (D14): faction presence is tokens, player influence is cubes; every faction "cube" in the document, the card text and the prototype renamed to "token" | Reference-game appendices (C, I) keep their own games' terms |
| 2026-10-07 | Mixed decks (prototype): the two unmarked unsuited slots draw at random from every unmarked unsuited card; A to D stay | Round 14 unsuited test cards can be dealt |
| 2026-10-08 | Round 17 revisions adopted (designer): Silver Bullets (deck), Lay Them to Rest, Sign the Contract, Install the Cameras, Open the Pit | Each keeps its name; strengths from the round 17 measurement |
| 2026-10-08 | Printed influence ordered by probe strength (D12, designer); the one-move scores file retired | Set v2 changes: Traffic Lights 4→2, Virus 2→4, Light Every Lamp 3→2, Summoning Circle 2→3 |
| 2026-10-08 | One tuning tool (designer): simulate, economy, balance and roundplay merged into the tournament, with per-card play figures and controlled probes; `npm run cards:plays` | The engine still reads `card-scores.json` for D12's order (all 0, so random) until D12 takes a trusted measure |
| 2026-10-08 | Bots pruned to the strongest (designer): goal (standard), goal-deep, hunter | Goal bots tuned by challenger tournaments; two backers force the invaders' ending 40% of the time |
| 2026-10-08 | Round 18 adopted (designer): Set a Trap is marked card A; Wake the Dead replaces Take Over the Wake | B to D stay scaffolds; Research Montage returned to the test cards (no board effect, a blind draft pick) |
| 2026-10-08 | Round 19 adopted (designer): Lock Down the Town is C, Put a Bounty On It is D. Switch to Plan B and Change the Plan merged into one card, Plan B. The Cancel removed entirely. Every scaffold card removed | B and one unmarked slot are open; the prototype fills them from the unmarked unsuited cards so the pool stays 21 |
| 2026-10-08 | Research Montage removed outright (designer): a useless card | The table's card-choice step, used only by it, removed from the prototype |
| 2026-10-08 | Claim the Spoils can't be played as your last card in hand (designer) | Card flag `notLast` in the spec; the engine refuses the play |
| 2026-10-08 | Change Allegiance renamed Defect (designer) | Same card and action; earlier records updated to the new name |
| 2026-10-08 | Swap Allegiances renamed Trade Secrets (designer) | Same card and action; earlier records updated to the new name |
| 2026-10-08 | Beaten test versions retired (designer): Take Over the Wake v2, Spread a Virus v3, Canvass the Town v2, Network the Virus v2, Hold the Wake | Each measured weaker than the card it was meant to replace; mixed decks no longer deal them |
| 2026-10-08 | Host page: each seat is a human or a bot, with a chosen profile (goal, goal, deep, backer, hunter) or a random one picked at the deal (designer). Bots keep their memory between turns on the server | Prototype tooling, not rules |
| 2026-10-08 | Stake Out (6) retired; Stake Out places 4 (designer) | The 6 copy was a measurement of how strength grows with the amount |
| 2026-10-08 | Set a Trap (round 18) removed; Claim the Spoils renamed Set a Trap and made marked card A, without the last-card rule (designer) | The old trap fell flat as an opener: sprung cheaply by a rival's small group or by its owner's big one |
| 2026-10-08 | Set a Trap is hidden (designer): a face-down token and a bluff; at its fight the token's owner takes every pile | Uses the face-down token rules (IN1, BT1); the open claim is gone |
| 2026-10-09 | Smarter bots standard: play-out search, access to the weakest colours, every target listed, hand-aware draft, face-down tokens counted (designer asked for smarter bots) | All together won 57.9% as a challenger (even share 20%); card figures from before are measured by weaker bots |
| 2026-10-09 | Hunter bot removed; weak bots are removed as soon as they measure clearly worse (designer). The play-out search's size is tunable (`keep`, `playouts`) for faster cycles | Standard table: backer, backer, goal, goal, goal |
| 2026-10-09 | Weak cards cut (designer): Spread a Virus, its infectious version, Network the Virus, Go Viral, Drag Them Under, Hijack the Feed, Smash the Mirror. Hack the Network takes Spread a Virus's place as the Sentient Strike in the deck | Weak cards with a novel, fun mechanism kept to strengthen (listed in Current focus) |
| 2026-10-09 | Play-out bug fixed: every seat in a play-out plays its own profile and keeps its plan (designer: a play-out that ignores the bots' goals is broken) | Earlier play-out figures carry the bug; checks and the standard table rerun on the fixed bots. Cards left as they are while the bots are tuned (designer) |
| 2026-10-09 | goal-deep removed (designer); the lighter play-out search not used (clearly worse). Bot tests run on small samples, about 10 games, variants side by side (designer) | Profiles left: goal, backer |
| 2026-10-09 | The goal bot renamed trophy (designer); profiles: trophy, backer | A saved game naming goal plays it as trophy |
| 2026-10-09 | Bots tuned against each other (10-game runs): backers guard presence, hold their plan, push their faction to the top and race for its standing lead once presence is safe (`protect`, `commit`, `top`, `race`); trophy bots weigh rivals' invader chances at 3 | Backers and trophy bots even at 20% a seat; the invaders' ending 4 in 10 with two backers |
| 2026-10-07 | Card scores reset to 0 and not to be trusted until cards are measured over whole rounds with strategic bots (designer). Tuning process: tournaments to tune the bots, then card tuning passes, repeat | D12's weighting falls back to random 2/3/4 per suit while every score is 0 |
| 2026-10-07 | D15 starting place: each faction moved to a new location pays 1 of its influence there, regardless of group size (variant `whoPays`, each by default). Card scores taken off the card review page until they can be trusted (designer) | Economy, 100 bot games: with IC1, fights with 2+ players bidding rise from 1% to about 40% in round 1 (fewer fights, 0.6 a round against 3.2); each-pays slightly ahead of selected-pays |
| 2026-10-07 | IC1 in the first draft: the influence a card places is a requirement (D15). The core loop recorded (D16) | Bot games after IC1: fewer fights (1.4 a round) and the invaders win 97% (30 games); presence climbs to about 50 against a threshold of 20 |
| 2026-10-07 | Card strength measured over a played-out round, as benefit to the player (designer); deep bots with a reply lookahead and strategy breakpoints on two axes (the ending; influence or trophies mid-game); bot tournament | Prototype tooling, not rules; the breakpoint numbers are suggestions to tune |

---

## Appendix B: Glossary

| Term | Meaning |
|---|---|
| **Adjacent** | *(First draft.)* Two locations whose hexes share a border. |
| **Affinity** | *(Idea.)* The edge that comes from sharing an archetype. A slayer group has affinity for its linked archetype's faction and for that archetype's three locations. A faction has affinity for its archetype's three locations. |
| **Archetype** | One of five groups of three related factions: Nocturnals ◐, 80's Sci-Fi ↂ, Sentients ⏏, Undead ☾, Demons ⎈. Each has a symbol and three aligned locations. |
| **Bluff token** | *(Idea.)* A token each player has that looks like a real hidden token from its blind side. Its marker cube can count as influence, but it does nothing else when it flips. |
| **Boil over** | *(Idea.)* What a location does when its token count reaches the volatility threshold: its fight resolves mid-round. |
| **Bot** | A seat in the prototype played by the server with random legal moves. |
| **Cascade** | *(Idea.)* Resolving locations one at a time in a fixed, visible order, with each outcome spilling over into locations not yet resolved. |
| **Casualties** | *(Idea.)* The tokens a faction loses in a fight. Casualties become trophies. |
| **Code** | A short label for one candidate: the two letters of its slot plus a number, such as FR1. Indexed in Appendix D. |
| **Contested** | *(Idea.)* Describes a location holding two factions. |
| **Control** | *(Idea.)* A faction controls a location when it has the most tokens there. If two factions are tied, the one with affinity for the location controls it; otherwise no one does. Players never control locations. |
| **Core set** | The cards marked 3+, which are in the pool at every player count. |
| **Elimination points** | *(Idea; working name.)* Points players earn from actions that cause invaders to eliminate one another. Decide the winner if the island wins, under one candidate end game. |
| **Engine** | The module of pure functions that holds all the rules of the prototype. The server uses it to decide and the browser uses it to preview. |
| **Faction** | One specific type within an archetype, such as Vampires or Aliens. Five factions are in play each game, one per archetype. |
| **Group** | A set of candidates that reinforce each other, with a name and a code such as G1. Listed in Appendix E. |
| **Growth threshold** | *(Idea.)* The number of tokens a faction needs at a location to grow there at round end. Provisionally 2. |
| **Hidden action** | *(Idea.)* One of a select few actions, such as setting a trap, that places a hidden token on a location, allowing bluffing or misdirection. |
| **Hidden token** | *(Idea.)* A token placed blind side up on a location by a hidden action. Everyone can see it and who placed it. Its face stays hidden until the location resolves, when it flips and takes part. |
| **Home location** | *(Idea.)* The location a faction starts on with its largest group. One of its archetype's three locations, drawn at random in the first draft. |
| **Host page** | The prototype page where a game is started: seats are named, options and bots chosen, and the magic links copied. |
| **Humanoid faction** | *(Idea.)* A faction whose battles can give rise to Undead. Which factions are humanoid is not yet defined. |
| **Influence** | *(Idea.)* A player's standing with a faction. Public. Held with several factions at once. It can be spent from a faction and placed on a location, where it counts toward collecting trophies. |
| **Influence cube** | *(Idea.)* A cube representing a player's influence with a faction. Cubes are only ever players'; factions have tokens; may be spent to take board actions. |
| **Influence leader** | *(Idea.)* The player with the most influence with a faction. Affinity breaks a tie for the most (AB1); otherwise players tied for the most are all influence leaders. A player is never called a faction's leader. |
| **Invaders** | *(For now.)* All the factions on the board, taken together. |
| **Leader** | *(Idea.)* The player with the most influence at a location. |
| **Location** | One of the 15 places on the island board, each aligned with an archetype through its symbol. |
| **Magic link** | A link that belongs to one seat in the prototype. Opening it is how a player takes that seat. |
| **Marked card** | *(Idea.)* One of two cards in the draft, marked A and B. The player holding A goes first. If A was left out of the deal that round, the player holding B goes first. |
| **Marker cube** | *(Idea.)* A player's cube placed on a hidden token or bluff token to show who placed it. It counts as that player's influence at the location. |
| **Phase** | A step within a round. |
| **Pile** | *(Idea.)* One faction's casualties from a fight, handed to a player together as trophies. |
| **Player view** | The copy of the game state that one seat is allowed to see. |
| **Presence** | *(Idea.)* The number of invader tokens on the board. A faction's presence is the number of its own tokens on the board. |
| **Presence threshold** | *(Idea.)* The level of total invader presence, checked at game end, that decides which win condition applies. |
| **Region** | *(Idea.)* A group of locations on the island. Movement is free within a region and allowed between neighbouring regions. |
| **Round** | One full cycle of the phases. |
| **Ruleset** | A sample selection of candidates that could be played together, built to show one character of game, such as the lightest rules. Listed in Appendix E. |
| **Runner-up** | *(Idea.)* The player with the second most influence at a location. |
| **Scorched earth** | *(Idea.)* A location removed from play for the rest of the game after a true tie there. Everything on it returns to its supply. A region whose locations are all scorched is impassable. |
| **Seat** | One player's place in a prototype game, reached through its magic link. |
| **Slayer group** | What a player plays: one of five groups of characters modelled on a monster-of-the-week trope, each linked to one archetype. |
| **Slot** | A question the game has to answer, such as how a fight resolves. Candidates in the same slot share a two-letter prefix. |
| **Supply** | *(First draft.)* Where a cube or token waits off the board. Each colour has one supply: a player's cubes return to that player, to be placed again with later actions; a faction's tokens return to that faction, to be placed again later. No piece is ever removed from the game entirely. |
| **Standing tie** | *(Idea.)* A tie between players that is not broken. |
| **Tied fight** | *(Idea.)* A fight between two groups of the same size. Both are wiped out, unless one of the factions has affinity for the location, in which case it wins. |
| **Token** | The physical piece representing invaders on the board: faction presence. Always represents a specific faction. Cubes are the players' pieces (influence); tokens are the factions'. Hidden tokens and bluff tokens are separate pieces. |
| **True tie** | *(First draft.)* A tied fight at a location aligned with neither faction. Both groups are wiped out, nobody is rewarded, and the location is scorched. |
| **Trophy** | *(Idea.)* A token removed in a fight as a casualty and kept by a player. |
| **Two-faction limit** | *(Idea.)* The rule that a location can hold at most two factions. |
| **Volatility** | *(Idea.)* The number of tokens present at a location. When it reaches a threshold, the location boils over. |

---

## Appendix C: Reference game research

Research notes describing how each reference game's mechanisms work. Descriptive only.

### C.1 The King is Dead, 2nd edition (Peer Sylvester, Osprey Games, 2020)

**What we like:** the simplicity of the map, action cards used to influence the board, and the very tough decisions that come from a limited set of actions. Also the model for the board: a single map with cubes at locations.

#### Premise

Players are nobles competing to become the chosen ruler of medieval Britain. They don't control the three factions (Scottish, Welsh, English); they steer the factions' fights and try to become the favorite of whichever faction ends up most powerful. Factions are represented by colored follower cubes across 8 regions.

#### The map

- 8 regions. Three are home regions, one per faction.
- Setup: 2 followers of each faction go in its home region. The rest go in a bag; each player draws 2 followers as a starting court, then followers are drawn to fill every region to 4. Leftovers form the supply.
- Region cards are shuffled and dealt face up beside numbered spaces 1 to 8. This visible order decides which region is contested next.
- France sits off-map, holding 3 instability discs.

#### The action cards

Every player gets the **same 8 cards for the whole game**. A played card is gone, so each player has at most 8 actions per game.

- **Scottish / Welsh / English Support (one each):** place 2 followers of that faction from the supply into one region bordering a region that faction controls. Until the faction's home region is resolved, the region bordering the home region also qualifies.
- **Assemble (×2):** place one follower of each faction from the supply, in any region or regions.
- **Negotiate:** swap the positions of two face-up region cards, changing the order of upcoming struggles, and lock one with your negotiation disc so it can't be swapped again.
- **Manoeuvre:** swap one follower in any region with one follower in any other region.
- **Outmanoeuvre:** swap one follower in a region with two followers in a bordering region.

Swap actions can't immediately undo another player's identical swap. Cards must be carried out as fully as possible, but can be played even when they'd have no effect.

**Advanced game:** each player's three Support cards are replaced with three secret, randomly dealt "cunning" cards (from 12 total), such as copying the top card of an opponent's discard pile, or a card that is never played and instead counts as a follower of any faction at game end. Because hands differ, opponents' remaining actions become harder to deduce.

#### Turn structure and resolution

- On your turn, play one card or pass. Passing only skips that turn; you can play again when it comes back around.
- When **all players pass in sequence**, a power struggle resolves in the lowest-numbered face-up region. This makes passing a strategic weapon.
- The faction with the most followers there takes control and places a control disc; all followers there return to the supply. Resolved regions can never be changed.
- A **tie, or an empty region, becomes unstable**: an instability disc from France is placed there instead.

#### Alignment through collecting cubes

After every action, the player **must summon one follower** from any region on the board into their court. This is the only way to gain influence with a faction, and it also weakens that faction in the region it's taken from. Every action therefore both shapes the board and shifts the player's allegiance.

#### Winning

- **Coronation:** if all 8 regions resolve, the faction controlling the most regions is most powerful (ties go to the faction that won a struggle most recently). The player with the most followers of that faction wins. Ties go to the most followers of the second most powerful faction, then to the player who played all their cards first.
- **French invasion:** if all 3 instability discs reach the board, the game ends immediately. The winner is the player with the most **complete sets** (one follower of each faction). Ties go to the player who most recently played a card.

#### Notable details

- Played cards form a personal discard pile with only the top card visible to others, so players must remember what opponents have used.
- Actions can target any unresolved region, not only the contested one, so moves set up future struggles.
- With four players, players sitting opposite each other form silent teams; they can't discuss strategy, and a team pools its followers only in an invasion.

---

### C.2 Inis (Christian Martinez, Matagot)

**What we like:** the draft by which players receive and plan their actions for the round, which they then have to use to play out the round.

#### Premise

Celtic clans spread across an island that grows as territories are discovered. Players compete to be elected High King.

#### The draft (the Assembly phase)

- At the start of each round, players draft a hand of **4 action cards**.
- Everyone starts with 4 cards, keeps 1, and passes the rest. When you receive the next batch, you add your kept card back in, choose again, and pass on.
- Because your previously kept cards go back into your hand each pass, you can reconsider and even **pass along a card you picked earlier**.
- The action deck is scaled to player count (13 cards for 3 players, 17 for 4), so some cards go unused each round.
- **Hate-drafting** is a significant part of play: players can keep cards that would help an opponent.

#### Playing the drafted hand (the Season phase)

- On your turn, play one card, pass, or take a Pretender token (a claim to victory).
- **Passing doesn't end your participation**; the round ends only when all players pass in a row (the same structure as The King is Dead).
- Unplayed action cards are **not carried over** into the next round.
- Actions include adding clans, moving clans, building sanctuaries and citadels, exploring new territories, and special effects.

#### Other card types

- **Advantage cards:** go to whoever leads (is "chieftain" of) a matching territory, reassigned each round.
- **Epic Tale cards:** earned and kept across rounds, used for powerful effects.

#### Winning

Three victory conditions, each at a target of 6: lead territories containing 6 opposing clans, be present in 6 territories, or be present in territories with 6 sanctuaries combined. Deeds earned during play reduce these targets. A player must hold a Pretender token to claim victory, and victory is checked at the start of rounds.

#### Notable details

- Combat exists, but eliminating clans often hurts you, because leadership victory depends on opponents' clans being present in your territories. Peaceful coexistence is common.
- Turn order direction is randomized each round by a coin-flip token.

---

### C.3 Blood Rage (Eric M. Lang, CMON)

**What we like:** general inspiration.

#### Premise

Viking clans battle for glory during Ragnarök over three ages, while the world gradually destroys itself.

#### The draft

- Each of the **3 ages** begins with a draft: players are dealt 8 cards, keep one, and pass the rest, until each player holds 6.
- One unused card can be held over into the next age.
- The card pool is **different each age**, and cards grow more powerful in later ages.
- The draft mixes three card types: Battle cards (combat boosts), Quest cards (secret objectives), and Upgrade cards.

#### Upgrades

- Playing an Upgrade costs Rage (the game's action currency) equal to the card's strength.
- Each clan sheet has **8 upgrade slots**: 1 Leader, 1 Warrior, 1 Ship, 2 Monsters, 3 Clan.
- Placed upgrades are **permanent** for the rest of the game, unless you overwrite a slot with a new upgrade, which discards the old one.
- **Troop upgrades** (Leader, Warrior, Ship) change the abilities of those figures.
- **Monster upgrades** give you a unique mythological monster figure to add to your clan. Each monster exists only once, so drafting it denies it to everyone else. Replacing a monster upgrade removes the old monster from the game.
- **Clan upgrades** give broad passive abilities that differentiate your clan's strategy.
- Playing a figure upgrade lets you immediately bring that figure onto the board at no extra cost.

#### Why the persistence matters

Upgrades drafted in Age 1 shape your strategy for the whole game. Each later draft becomes a decision about building on your engine or adapting it, and the fixed slot count forces trade-offs.

#### Notable details

- Dying in battle isn't purely bad: some upgrades and quests reward it, and dead figures earn glory in Valhalla.
- Clan stats (Rage, Axes, Horns) grow over the game and determine action capacity, battle rewards, and army size.

---

### C.4 Pax Pamir, 2nd Edition (Cole Wehrle, Wehrlegig Games)

**What we like:** influence mechanics over an external faction.

#### Premise

Players are Afghan leaders after the collapse of the Durrani Empire, manipulating three outside coalitions (British, Russian, Afghan) for their own ends. Players are not the coalitions; they align with them.

#### Loyalty

- Each player is loyal to exactly **one coalition** at a time, shown on a loyalty dial and chosen at setup.
- Your loyalty determines the color of coalition blocks (armies and roads) you place when playing cards.
- Coalition blocks help **whoever is currently loyal** to that coalition, not whoever placed them. If you switch sides, the armies you raised don't follow you.
- Player-colored pieces (tribes and spies) always stay yours, regardless of loyalty.

#### Influence

- Your influence with your coalition is **1 plus** the number of patriots in your court, prizes you hold, and gifts you've bought.
- **Patriots:** cards in your court belonging to your coalition.
- **Prizes:** cards taken from opponents' courts through betrayal.
- **Gifts:** influence bought with money.

#### Changing loyalty

- You switch coalitions by playing a patriot of another coalition or accepting a prize tied to another coalition. Prizes can be refused to stay loyal.
- When you switch, **you lose all your patriots, prizes, and gifts** before gaining the new one. Switching is powerful but costly.

#### Dominance checks (scoring)

- Scoring happens during special event cards called Dominance Checks, buried in the card deck (4 total).
- **If one coalition is dominant** (a clear lead in coalition blocks on the map), only players loyal to it score, ranked by their influence.
- **If no coalition is dominant**, players score by their **personal power base** (their own pieces in play) instead, for fewer points.
- After each check, the board is partially reset.
- The game ends when a player leads by 4 or more points after a check, or after the fourth check.

#### Notable details

- The market of cards is shared, with prices rising for cards further down the row.
- Even though players build personal rows of cards (their "court"), most actions interfere with others.

---

### C.5 Reiner Knizia Games

**What we like:** simple mechanisms; players making moves on a shared board to advance their goals; players constantly analyzing other players' positions to understand how to advance their own.

**Scope of this reference:** the reference is to shared-board play in general, not to tile laying specifically. The titles below are illustrative examples of that style, not specific reference points.

Knizia has designed hundreds of games. His **"tile-laying trilogy"** (Tigris & Euphrates, Samurai, and Through the Desert) is most often cited for this style. Two examples are summarized below.

#### Samurai (1998)

- **Board:** the islands of Japan, with cities and villages holding three kinds of faction figures: helmets (warriors), Buddhas (priests), and rice fields (peasants).
- **Tiles:** each player has an identical set of hex tiles, each carrying influence for one faction (or all three, via samurai tiles), with values from 1 to 4. Ships go on water; special tiles allow multiple plays or swapping tiles on the board.
- **Hand:** players hold 5 tiles drawn randomly from their own set.
- **Play:** on your turn, place a tile next to a city. When every land space around a city is filled, the city resolves: for each figure there, the player with the most influence of that type captures it.
- **Ties:** if players tie, nobody gets the figure; it's removed from the game.
- **End:** when all figures of one type are gone, or when 4 figures have been removed through ties.
- **Winning:** players compete for majorities in each figure type. You must have a majority in at least one type to be eligible, and ties are broken by the "other" figures you collected. Specializing too narrowly is risky.

#### Tigris & Euphrates (1997)

- **Board:** a square grid of ancient Mesopotamia along two rivers.
- **Leaders:** each player has 4 leaders (king, priest, farmer, trader), each tied to a color.
- **Play:** place tiles to grow kingdoms; tiles placed in a kingdom score for the matching leader there. Leaders are shared-board pieces, so kingdoms often contain leaders from several players.
- **Conflict:** when two kingdoms are joined by a tile, same-colored leaders fight, and only one of each color survives.
- **Scoring:** your final score is your **lowest** score across the four colors. This forces balanced play, and makes every player watch what others are weak in.
- **Hidden information:** scores are kept behind screens.

#### Common Knizia principles

- Very few rules, with depth coming from interaction on a shared board.
- Identical resources for all players, so the board state and timing decide the game.
- Scoring systems that punish over-specialization or reward reading opponents.
- Ties are often a meaningful outcome, not just an edge case.

---

### C.6 SILOS (Reiner Knizia, Bitewing Games, 2025)

**What we like:** players bid for control of locations, much like our influence mechanic, but which locations they want shifts throughout the game; no one keeps all their control in one or two locations for the whole game.

#### Premise

A remastered and rethemed edition of Knizia's *Municipium* (2008). Players are rival alien factions secretly infiltrating a small mid-century American town, abducting and brainwashing humans (and cows) to gain societal power. 2 to 4 players, about 45 to 60 minutes. It's the first game in Bitewing's "Cosmic Silos" trilogy, alongside EGO and ORBIT.

#### The board and figures

- A town of numbered locations connected by paths, each with a location power. Modular alternate location tiles can replace the standard powers for variety.
- Each player has 7 alien figures. One wears a hat as a **leader**, worth 1.5 influence. Aliens can later become **distinguished**, worth 2.
- Setup: players take turns placing aliens one at a time anywhere, until all are placed. Aliens are **never removed** from the board by any action; the game is entirely about repositioning.
- Influence at a location is the total weight of your figures there. **Ties are broken by Town Hall ranking**, a tiebreak order that is itself set by who holds the most influence at the Town Hall, and can be reshuffled by the Town Hall's power.

#### Turn structure

Each turn has two parts:

1. **Move** up to two aliens along paths to connected locations.
2. **Activate a card** (mandatory), choosing either:
   - the top card of the shared **common deck** (uncertain), or
   - one of your three personal **faction cards** (certain, but each usable only once per game).

#### The common deck and public card counting

- A small shared deck of 12 cards: 5 UFO Advance, 4 Marked Specimen, 2 One Power, 1 All Power.
- Played cards are laid out on a track around the board edge, so everyone can see exactly what's left. Card counting, which was hidden skill in the original, is now public and easy.

#### Resolution events

- **UFO abduction:** the UFO moves clockwise to the next location. The player with the most influence there takes the cow; the player in second place takes the human. Both spaces then refill.
- **Mind control:** when a location's "focus group" fills with three humans, the most influential player picks two and the second-most takes the last.
- **Power events:** a card activates one location's power, or all of them in numerical order. Powers include pulling all of one color's figures to a location, upgrading figures to distinguished, stealing a human, trading humans for points, and repositioning all of your figures.

Control only pays off at the moment a location resolves, so much of the game is anticipating where and when the next event will land.

#### Winning

- Humans come in four types; a set of one of each earns a **societal power emblem**, and completing a set forces you to cash it in. Cows are wild.
- The game ends at the end of the round in which a player reaches 5 emblems (4 for a shorter game). Most emblems wins; ties go to the most remaining humans and cows.

#### Notable details

- Reviewers highlight timing as the core skill: few actions, a public deck, and one-use certain cards make *when* you act the central decision.
- Rewarding second place keeps players close and contesting the same locations.
- Common criticisms: it can feel random, prone to analysis paralysis, and the board state can be hard to read at a glance.

### C.7 Northern Pacific (Amabel Holland; Winsome Games 2013, Rio Grande Games reprint)

**What we like:** an incredibly thinky decision space built from only two possible decisions, where the consequences of either choice are huge depending on what other players are aiming for and invested in.

Designed by Amabel Holland, co-founder of Hollandspiele; older sources credit the design under a former name. A luck-free railroad game for 3 to 5 players (with official two-player rules), in the lineage of TransAmerica and SNCF / Paris Connection.

#### Inspiration

- The designer set out to make a light, simple filler rather than a heavy, math-driven train game, after encountering *Paris Connection*.
- Thematic inspiration came from the spaghetti western *Once Upon a Time in the West*, whose plot turns on someone buying land because they correctly guess the railroad must pass through it. The whole game is built on that premise: investing somewhere in the hope the train arrives.
- The designer describes the intent as exploring shared incentives and chains of "if I do this, she'll do that."

#### The core: "cube or train"

- Each player starts with one large and three small investment cubes in hand.
- On a turn, a player does exactly one of two things:
  - **Cube:** invest by placing a cube in a city the railroad hasn't reached yet. Several players can invest in the same city.
  - **Train:** build track by extending the single railroad line from the city it currently occupies.
- There is **one train**, shared by everyone. Track has directional arrows and can never run backward or revisit a city, so the line only moves forward.

#### Payoff and loss

- When the railroad reaches a city, every player invested there takes back their cubes plus a return: one extra cube for a small cube, two for a large one.
- If the line passes a city by without connecting to it, those investments never pay off.
- When the railroad reaches Seattle, the round ends. Cubes in hand are recorded as good investments; cubes stranded on the board are recorded as bad investments.

#### Rounds and winning

- The board resets after each round. Players can play a single round, or a series in which the first to win two rounds wins.
- In the official two-player rules, a neutral player's cubes are placed and must be connected to, standing in for the missing opponents.

#### Notable dynamics

- **Moves as offers:** since only one shared train exists, a player can't profit alone; they need others to want to move the train toward their cities too. One reviewer notes greed fails without giving others a reason to come along.
- **Timing and momentum:** players invest and wait, then the train surges forward in bursts once its path benefits enough people. Good play means triggering (or getting others to trigger) the surge when you're sure to come out ahead.
- **Unforgiving positioning:** commentary on its opening theory notes that a single positional mistake can sink a player.
- **Player count changes its character:** at 3 to 4 players it plays almost like a negotiation game; at 6 players turns become mostly reactive.
- **Divisive:** its stark, two-rule simplicity is what fans love and critics question. Kingmaking in the final turns is an accepted part of the game.

### C.8 Hansa Teutonica (Andreas Steding, Argentum Verlag 2009; Big Box edition, Pegasus 2020)

**What we like:** the push and pull of being able to push out another player's existing pieces, but at a higher cost, and while giving the displaced player a benefit.

#### Premise

Players are merchants in the Hanseatic League, scoring prestige by building trade posts in cities and improving their personal abilities. Best at 3 to 5 players.

#### The board

- A network of cities joined by trade routes. Each route has a few spaces for pieces.
- Pieces come in two kinds: traders (cubes) and merchants (discs).
- When a player fills every space on a route with their own pieces, they claim it: they can establish an office in a neighbouring city, upgrade an ability, or take a bonus. Owners of offices at either end of the route score a point.
- The player with the most offices in a city controls it.

#### Actions and the personal board

- Each player has a small board of five ability tracks, which set how many actions they get per turn, how many pieces they can bring in, how far they can move, which city spaces they may occupy, and an end-game multiplier.
- Pieces start in a personal supply and must be brought into a ready stock before they can be placed on the board.

#### Displacement

- For one action, a player can place a piece on a route space already occupied by an opponent, pushing that piece out.
- **Higher cost:** the displacing player also pays extra pieces back into their supply: one extra to displace a trader, two to displace a merchant.
- **Benefit to the displaced player:** the displaced player takes back their piece and places it, plus one or two additional pieces, onto nearby routes for free.
- So blocking a space is never a complete denial: the opponent can always choose whether pushing through is worth the cost and the gift it hands over.

#### Ending and winning

- The game ends immediately when a player reaches 20 prestige, when ten cities are full, or when the bonus markers run out.
- End-game scoring adds points for controlled cities, a fully upgraded ability, bonus markers, and the largest connected network of offices.

#### Notable details

- Reviewers single out the displacement decision as the heart of the game's interaction: whether to push an opponent out and accept giving them a boost.
- Even with strong blocking, no player can have their game completely ruined by another.

### C.9 Rumble Nation (Shun Taguchi)

**What we like:** the cascading nature of the resolution flow.

#### Premise

Warlords in Sengoku-era Japan fight for control of 11 castle areas. 2 to 4 players, around 30 minutes.

#### The board

Eleven areas, each with a castle token numbered 2 to 12. The number is both the area's point value and its place in the resolution order.

#### Deployment phase

- Players take turns until all soldiers are placed.
- On a turn, roll three dice (one reroll of all dice allowed), then split them: the sum of two dice picks the area, and the third die sets how many soldiers go there (1 to 2 = one, 3 to 4 = two, 5 to 6 = three).
- Instead of rolling, a player may use a tactic card from a shared display, once per game each. Tactic cards close once anyone has placed all their soldiers.
- The first player to finish placing takes the highest sword chip, which is the tiebreaker for the rest of the game.

#### War phase: the cascade

- Areas resolve one at a time in ascending order, from 2 to 12.
- The player with the most strength in an area takes its castle token. In 3 to 4 player games, second place takes a smaller token worth half (rounded down).
- **Reinforcements:** the winner places reinforcement pieces (two per area in 3 to 4 player games) into each adjacent area that hasn't resolved yet and where they already have at least one soldier.
- Those reinforcements count toward strength when the later area resolves, so an early win can tip the next fights, which can tip the ones after. Low-value early areas matter for what they set up downstream.

#### Winning

Highest total castle value wins. Ties go to the higher sword chip.

#### Notable details

- Reviewers describe the end-of-game cascade as where the real interest lies, with placement serving to set it up.
- Each roll offers up to three choices of pairing, which tempers the dice.
- An advanced mode adds a daimyo piece worth two soldiers in battle and a unique once-per-game ability per player.

### C.10 Battle for Rokugan (Fantasy Flight Games, 2017)

**What we like:** the system for indicating intent without revealing actual values until resolution, which creates room to bluff or cast aspersions.

#### Premise

Clan leaders fight over the provinces of Rokugan across five rounds. 2 to 5 players, about an hour.

#### Combat tokens

- Each player has a pool of double-sided combat tokens. Token types and counts are public, printed on each player's screen; which ones a player has drawn is hidden.
- Types include armies and navies with strength values, shinobi (attack or defend anywhere), blessings (add strength), diplomacy (permanent peace), raids (destroy a province), and one bluff token per player.
- Each round, players fill their hand behind a screen to six tokens, always including their bluff.

#### Placement: intent without values

- In turn order, each player places one token at a time, face down, until each has one left behind their screen.
- Placement shows intent: a token on a border with its arrow pointing into a province is an attack; a token inside a province you control is a defence. Only one token can sit on each border.
- The value stays hidden. A face-down attack could be a strong army, a weak one, or the bluff.
- The bluff can be placed as any token. It also lets a player hold back a valuable token for the next round, since the one unplaced token is kept.
- Single-use scout cards let a player peek at face-down tokens; shugenja cards remove them.

#### Resolution

- All tokens flip at once. Bluffs and illegally placed tokens are discarded first (bluffs return to their owner).
- Raids, then diplomacy, then battles resolve. Battles are simple sums: highest total takes the province, and the defender wins ties.
- A successful defence adds a face-up control token that boosts future defence of that province.

#### Winning

After five rounds, honor is scored for controlled provinces, defence tokens, full territories, and a secret objective.

#### Notable details

- Reviewers describe the reveal as the dramatic peak, and the bluff as what lets any player stare down an opponent's apparent threat.
- Because placement is sequential, players react to each other's visible commitments while guessing their hidden strength.

### C.11 A War of Whispers (Jeremy Stoltzfus, Starling Games, 2019)

**What we like:** simple, deterministic combat resolved from presence alone.

#### Premise

Five empires are at war. Players are secret societies who control none of them; they bet on how the war will end and pull strings so their bets pay off. 2 to 4 players, four rounds.

#### The board and pieces

- A circular map of regions. Each region is coloured as the home of one of the five empires.
- Armies are banner cubes in five colours, 100 in total. Each empire has its own reserve pile.
- Regions can carry three kinds of icon: farms, forts, and cities.
- Setup is fixed: banners go on starting spots printed on the map, so the war begins the same way every game.
- **Control:** an empire controls a region if it has at least one banner there, or if it is one of its home regions and holds no enemy banners. An empty home region therefore belongs to its home empire.

#### Loyalty: the bet

- Each player has five loyalty tokens, one per empire. At setup they are shuffled and placed face down, at random, on five slots worth ×4, ×3, ×2, ×0, and ×−1.
- At the end, each token scores the number of cities its empire controls multiplied by its slot. One empire is always worth nothing to a player, and one costs them points for every city it holds.
- **Swap:** at the end of each of the first three rounds, a player may swap two unrevealed tokens. Both are then turned face up and can't be swapped again.

#### Councils: how players act

- Each empire has a council of four positions in a fixed order. Each round, a player first takes back one of their agents from the board, then players take turns placing agents on open positions until each has placed two (three in a two-player game). Agents otherwise stay where they are from round to round.
- Empires act one after another in a fixed order around the board. Within an empire, the positions act in order, each directed by the player whose agent sits there.
- An empty position is directed by the owner of the first agent to its right in that council. If there is none, it does nothing.
- The actions are few: add banners to regions the empire controls (a flat number, or one per farm it holds), attack one adjacent enemy region, draw cards from the empire's deck, or swap places with another agent in the council and take that position's action.

#### Combat

- **Attack:** any number of banners move from one region the empire controls into an adjacent enemy region. An attack can't be used to shift banners between the empire's own regions, and at least one banner must stay behind in a conquered region.
- **Resolution:** each side discards banners one for one until one side, or both, has none left. A side with banners remaining has won. Removed banners return to their empire's reserve.
- **Forts:** a fort counts as one extra banner for the defender for that fight.
- **Ties:** all banners on both sides are removed. Control then follows the normal rule, so a tied fight in a home region leaves it with its home empire.
- **Supply limit:** at the end of an empire's turn, a region may hold at most 4 banners, or 6 if it has a farm. The excess returns to the reserve.

#### Empire cards

- Each empire has its own deck. Cards are drawn through council actions and can only be played while one of the player's agents is acting.
- A card lists several abilities. Stronger ones cost extra discards of particular empires' cards; the card being played counts toward its own cost.
- Played cards are shuffled back into their empire's deck. Hand limit is 5, checked at the end of the round.

#### Winning

After four rounds, all loyalty tokens are revealed and scored; the highest total wins. Ties go to the player who swapped loyalty least, then to the player holding the most cards.

#### Notable details

- Players' actions are fully open; only their loyalties are hidden. Much of the play is reading what others want from what they do.
- Reviewers describe the actions as extremely simple, with the interest coming from the fixed starting position, the fixed order of empire turns, and the shifting bets.
- One criticism: because four of the five loyalty tokens can be swapped, players' loyalties can converge by the end, which makes ties more likely.
- An advanced rule lets a player place an agent on a region instead of a council. It counts as a city for that player only, scored for whichever empire controls the region at the end. At most two agents per player may be on the map.

### C.12 Pandemic (Matt Leacock, Z-Man Games, 2008)

**What we like:** a growth system run by the game itself: presence grows over time and players have to work to keep it in check.

#### Premise

A cooperative game for 2 to 4 players. Players are specialists trying to cure four diseases while disease cubes spread across a map of connected cities.

#### The growth system

- An infection deck holds one card for each city. At the end of every player's turn, a number of cards equal to the current infection rate is drawn, and one cube is added to each city drawn.
- **Outbreaks:** a city holds at most three cubes of a colour. If a fourth would be added, each connected city gains one cube instead. Outbreaks can chain from city to city.
- **Epidemics:** epidemic cards are seeded through the players' own deck. Each one raises the infection rate (from two cards a turn up to four), puts three cubes on a new city, and shuffles the infection discard pile back on top of the deck, so cities that were already hit come up again soon.

#### Keeping it in check

- As an action, a player removes one cube from the city they are in. Players can't keep up everywhere, so they choose which cities to treat and which to leave.
- The players lose if eight outbreaks occur, if the cubes of any colour run out, or if the players' deck runs out. They win by curing all four diseases.

#### Notable details

- Growth is predictable in the short term: players know that recently infected cities are about to be drawn again.
- The system runs the same way regardless of player count.

### C.13 Spirit Island (R. Eric Reuss, Greater Than Games, 2017)

**What we like:** a growth system run by the game itself: presence grows over time and players have to work to keep it in check.

#### Premise

A cooperative game for 1 to 4 players. Players are spirits of an island, defending it from colonising invaders that the game itself runs.

#### The growth system

- An invader deck holds cards that each show a type of land. The invader board has three spaces in a row: explore, build, and ravage.
- Each turn, the invaders take three actions in order:
  - **Ravage:** in lands of the type on the ravage card, invaders damage the land and the island's native people. Two or more damage adds blight to the land. Surviving natives fight back.
  - **Build:** in lands of the type on the build card that already hold invaders, a town or city is added.
  - **Explore:** a new card is revealed, and explorers enter lands of that type.
- The cards then slide along one space: the explore card moves to build, and the build card to ravage. A land type is therefore explored one turn, built in the next, and ravaged the turn after.

#### Keeping it in check

- Players use powers to destroy or move invaders, or to defend a land, before an action lands there.
- Blight added to a land that already has blight spreads to an adjacent land, so neglected areas cascade.
- The players lose if the island is overrun by blight, if a spirit is destroyed, or if the invader deck runs out.

#### Notable details

- Growth is announced in advance. Players can see where the invaders will build next turn and ravage the turn after, and plan around it.
- The invaders' expansion is described as semi-predictable, and the game escalates as it goes on.

---

### C.14 Big Shot (Alex Randolph)

**What we like:** ties for a majority are disregarded, so the prize passes to the next player in line.

#### Premise

An auction game for 2 to 4 players, lasting about 30 minutes. Players bid for coloured cubes and place them on city lots to win ownership of those lots.

#### The board

- 13 lots, each with a printed value, divided into four districts.

#### Play

- The game lasts 18 rounds.
- Each round, a set of coloured cubes chosen by a die roll goes up for auction. The winning bidder places those cubes on lots.
- A lot locks once it holds seven cubes, and nothing more can be added to it.
- Players can borrow to bid. Each loan costs 10 to repay at the end of the game.

#### Ownership and ties

- The player with the most cubes on a lot owns it.
- Players tied for the most are disregarded. With cubes split 3, 3 and 1, the player with a single cube owns the lot.

#### Winning

- Owners collect the value of their lots. Some values double when the owner also holds the doubling space for that district.
- Loans are repaid, and the player with the most money wins.

---

### C.15 El Grande (Wolfgang Kramer and Richard Ulrich, 1995)

**What we like:** tied players all drop to the next place down, however many are tied.

#### Premise

An area majority game set in medieval Spain. Players are grandees placing caballeros, their cubes, into regions to hold the most of them when the regions are scored.

#### The board

- Nine regions, plus the Castillo, a tower that caballeros are dropped into unseen.
- Each region has a scoring board showing the points for first, second and third place.
- Each player has a home region, marked by their Grande. The King stands in one region at a time.

#### Play

- Players choose action cards in turn order. Each card lets its player place a number of caballeros and offers a special action.
- The game has three general scorings, after the third, sixth and ninth rounds. It ends after the third.

#### Scoring and ties

- The Castillo is scored first, then each region in a fixed order.
- In each, the players with the most, second most and third most caballeros score the points shown. With fewer players, fewer places score.
- Tied players all score the next lower place, however many are tied. If everyone ties for first, they all score as second.
- First place earns two extra points in the King's region, and two extra in the region holding the player's own Grande.

---

## Appendix D: Candidate codes

An index of every coded candidate in section 3. A slot is a question the game has to answer, and each candidate answer has a code made of the slot's two letters and a number.

The **Pick** column says how candidates in a slot relate:

- **One:** the candidates are alternatives, and the game would use one of them.
- **Any:** the candidates can be combined, or used separately.
- **All:** requirements, which every combination has to meet.

### The Contest

| Slot | Pick | Code | Candidate | Section |
|---|---|---|---|---|
| Board (BD) | One | `BD1` | One board showing the 15 locations | 3.1 |
| Location limit (LL) | One | `LL1` | Two-faction limit | 3.1 |
| Connections (CN) | One | `CN1` | Fixed connections | 3.1 |
|  |  | `CN2` | Connections built by players |  |
|  |  | `CN3` | Regions |  |
| Tie effects on the map (TM) | Any | `TM1` | Scorched earth | 3.1 |
|  |  | `TM2` | Burned connections (needs CN2) |  |
| Location control (LC) | Any | `LC1` | Factions control locations; players never do | 3.2 |
|  |  | `LC2` | Control by most tokens; ties go to affinity; otherwise no one |  |
| Alignment (AL) | Any | `AL1` | Aligned locations spread across the island | 3.3 |
|  |  | `AL2` | The faction with affinity for the location wins a tied fight there |  |
|  |  | `AL3` | One extra token of growth on a controlled, aligned location (needs LC2) |  |
| Faction differences (FD) | Any | `FD1` | Layered differences | 3.4 |
|  |  | `FD2` | Differences through combat losses |  |
| Archetype powers (AP) | Any | `AP1` | Nocturnals convert | 3.4 |
|  |  | `AP2` | 80's Sci-Fi abduct or mind-control |  |
|  |  | `AP3` | Sentients networked |  |
|  |  | `AP4` | Demons corrupt |  |
|  |  | `AP5` | Undead spawn from remnants |  |
|  |  | `AP6` | Undead spawn only from fights without Undead and with humanoid factions (needs AP5) |  |
| Seeding (SD) | One | `SD1` | Home locations | 3.5 |
| Growth (GR) | Any | `GR1` | At round end, after fights, wherever a faction meets the growth threshold | 3.5 |
|  |  | `GR2` | Through cards |  |
|  |  | `GR3` | Run by the game |  |
|  |  | `GR4` | As spillover |  |

### The Levers

| Slot | Pick | Code | Candidate | Section |
|---|---|---|---|---|
| Draft (DR) | Any | `DR1` | Cards drafted each round | 3.6 |
|  |  | `DR2` | Unplayed cards return to the draft pool |  |
|  |  | `DR3` | Pick and pass, with earlier picks able to go back (preferred) |  |
|  |  | `DR4` | The same pool is drafted every round (preferred) |  |
|  |  | `DR5` | One card left out of the deal each round |  |
|  |  | `DR6` | The drafted pool is the whole action set |  |
| Card engine (CD) | One | `CD1` | Actions and influence run on cards | 3.7 |
| Card purposes (MP) | One | `MP1` | Multi-purpose cards | 3.7 |
| Card uses (CU) | One | `CU1` | One-of | 3.7 |
|  |  | `CU2` | Applied together |  |
|  |  | `CU3` | Intertwined |  |
|  |  | `CU4` | Dual-use: grow or move |  |
| Influence cost (IC) | Any | `IC1` | Board actions cost influence with the faction moved | 3.7 |
|  |  | `IC2` | Indirect cards are free and small; direct cards cost influence and are bigger |  |
| Movement (MV) | Any | `MV1` | Distinct movement actions | 3.7 |
|  |  | `MV2` | Rule-breaking moves |  |
| Action aim (AC) | Any | `AC1` | Actions feel distinct and precious | 3.7 |
| Location cards (LK) | One | `LK1` | One card per location, in the pool at every player count | 3.7 |
| Suits (SU) | One | `SU1` | Five archetype suits of thematic actions | 3.7 |
| Pool size (PS) | One | `PS1` | Fixed pool; player count sets hand size and how many are left out | 3.16 |
| Card actions (CA) | Any | `CA1` | Gain influence with a faction | 3.7 |
|  |  | `CA2` | Affect a faction's presence, placing influence spent from it |  |
|  |  | `CA3` | Place tokens and 1 influence from the player's supply, without affecting presence |  |
| Influence leader (IL) | One | `IL1` | Only a faction's influence leader can affect its presence (first variant) | 3.14 |
| Weakest-colour ties (WT) | One | `WT1` | Ties go to the next weakest colour | 3.15 |
| Card balance (CB) | One | `CB1` | Cards close in power, with A the exception | 3.7 |
| Turn options (TU) | One | `TU1` | Play a card or pass; a pass isn't final | 3.8 |
| First player (FP) | One | `FP1` | Marked cards A and B | 3.8 |
|  |  | `FP2` | Four marked cards, A to D, with the fixed pool (first draft) |  |
| Affinity (AB) | Any | `AB1` | Tiebreaker: location for battle, faction for influence | 3.10 |
|  |  | `AB2` | Permanent plus-one |  |
| Information (IN) | Any | `IN1` | Hidden actions: tokens that flip at resolution | 3.11 |
|  |  | `IN2` | Secret trophy totals |  |
| Bluff token (BT) | One | `BT1` | A hidden action places one real token and one bluff; a bluff counts as influence and does nothing else | 3.11 |
| Marker cube (MC) | One | `MC1` | Spent from a faction, like other influence on locations | 3.11 |
|  |  | `MC2` | From the player's supply, free |  |
|  |  | `MC3` | From the player's supply, returning to it afterwards (preferred) |  |
| Unresolved token (UT) | One | `UT1` | Stays, with its marker cube, until the location resolves | 3.11 |
| Hidden token effect (HT) | Any | `HT1` | Changes the fight between the factions | 3.11 |
|  |  | `HT2` | Changes which players collect the trophies |  |

### The Reckoning

| Slot | Pick | Code | Candidate | Section |
|---|---|---|---|---|
| Game length (GL) | One | `GL1` | A set number of rounds | 3.12 |
| Round structure (RS) | One | `RS1` | Draft, play, resolve | 3.12 |
| Round end (RE) | Any | `RE1` | All cards played | 3.12 |
|  |  | `RE2` | Moon track |  |
|  |  | `RE3` | All players pass in a row |  |
| Combat requirements (RQ) | All | `RQ1` | The winner takes casualties too | 3.13 |
|  |  | `RQ2` | Trophies are the casualties |  |
|  |  | `RQ3` | First place receives the larger share, second place some |  |
|  |  | `RQ4` | Trophy colour depends on standing and on which way the fight goes |  |
|  |  | `RQ5` | Deterministic and quick; nothing added once a fight has begun |  |
| Fight sides (FS) | One | `FS1` | Two-sided fights (follows from LL1) | 3.13 |
| Fight rule (FR) | One | `FR1` | Half, rounded up (preferred) | 3.13 |
|  |  | `FR2` | One-for-one cancellation |  |
|  |  | `FR3` | Flat one (weaker) |  |
|  |  | `FR4` | Dice (weaker) |  |
|  |  | `FR5` | Half, rounded down, minimum 1 (first draft) |  |
| Tied fight (TF) | One | `TF1` | Both factions wiped out, location left empty | 3.13 |
| Trophy distribution (TD) | One | `TD1` | By influence at the location, piles handed out by size | 3.13 |
|  |  | `TD2` | By faction influence |  |
| Player tiebreak (PT) | One | `PT1` | Lower influence with the pile's faction, pile by pile | 3.13 |
|  |  | `PT2` | Standing tie: the tie is not broken (preferred) |  |
| Standing tie (ST) | One | `ST1` | Nobody collects; the piles return to the supply | 3.13 |
|  |  | `ST2` | Tied players are disregarded, and everyone below moves up |  |
|  |  | `ST3` | Tied players drop a place; tied leaders share the smaller pile (preferred) |  |
| Unclaimed pile (UP) | One | `UP1` | To the only player with influence there | 3.13 |
|  |  | `UP2` | Back to the supply |  |
| Influence after a fight (AF) | One | `AF1` | Always clear | 3.13 |
|  |  | `AF2` | One left behind |  |
|  |  | `AF3` | Leader moves to the winning faction, others stay |  |
| Influence after a tied fight (AT) | One | `AT1` | Influence at the location clears | 3.13 |
| Influence after a standing tie (AS) | One | `AS1` | Tied influence clears and does not return to a faction | 3.13 |
| Fight trigger (FT) | Any | `FT1` | End of round | 3.13 |
|  |  | `FT2` | Volatility threshold, by token count |  |
|  |  | `FT3` | Card trigger |  |
| Resolution order (RO) | One | `RO1` | Cascading resolution | 3.13 |

### The Stakes

| Slot | Pick | Code | Candidate | Section |
|---|---|---|---|---|
| Influence basics (IF) | Any | `IF1` | Influence with factions is public | 3.14 |
|  |  | `IF2` | Faction influence breaks end-game ties |  |
| Influence on locations (IM) | One | `IM1` | Influence spent from a faction onto a location | 3.14 |
| End-game player tie (ET) | Any | `ET1` | Tied players compare standing with the faction next highest in presence | 3.14 |
|  |  | `ET2` | Tied on score: raw influence first, then affinity, then the next faction |  |
|  |  | `ET3` | Tied on score: affinity decides, then the next faction (preferred) |  |
|  |  | `ET4` | Tied on score: fewest trophies of the winning faction, then affinity, then the next faction (first draft) |  |
| Influence as bidding (IB) | Any | `IB1` | Influence as bidding | 3.14 |
|  |  | `IB2` | Shifting desirability |  |
|  |  | `IB3` | A bid is an action, not a payment |  |
|  |  | `IB4` | Bids and trophies are separate systems |  |
|  |  | `IB5` | Costly displacement |  |
| Win conditions (WC) | One | `WC1` | The island wins, or one faction wins | 3.15 |
| Presence threshold (TH) | One | `TH1` | End-game presence threshold | 3.15 |
| Faction tie (FX) | One | `FX1` | Factions tied in presence: the one controlling more locations ranks higher (needs LC2) | 3.15 |
|  |  | `FX2` | Still tied on locations: the factions win together, and players add up their scores with each (first draft) |  |
| End-game scoring (EG) | One | `EG1` | Elimination points and influence | 3.15 |
|  |  | `EG2` | Double-edged, based on trophies |  |
|  |  | `EG3` | Sets if the island wins; influence minus trophies if a faction wins |  |
| Trophy scoring (TS) | Any | `TS1` | Trophies as stock speculation | 3.15 |
|  |  | `TS2` | Weakest-colour scoring |  |

---

## Appendix E: Candidate analysis

How the coded candidates (Appendix D) relate to each other. This is Claude's analysis, added as candidates come in; it does not add, change, or rule out any candidate. It has four parts: fits and clashes, trade-offs, groups, and sample rulesets.

### E.1 Fits and clashes

Only combinations with a clear fit or a clear clash are listed. So far this covers the combat cluster (the fight rule, trophy distribution, influence after a fight, and the fight triggers), plus affinity, ties between players, location control, alignment, volatility, information, and the draft.

#### Clear fits

| Codes | Why they work together |
|---|---|
| FR1 + TD1 | The loser's pile is always the bigger one, so rank fixes colour (RQ4). Picks only happen in single-token fights and ties. |
| TD1 + PT1 + EG3 | Players with low influence win ties for a faction's tokens, and those trophies cost them the least. |
| AF3 + CU4 + GR2 | Influence circulates: grow a faction to gain it, spend it onto a location, get it back by leading a fight. |
| AF3 + FR1, FR2 or FR3 | With deterministic combat, the leader knows which faction their influence will land on unless someone flips the fight. |
| AF3 + AT1 | AF3 lets influence pile up at locations, and a tie is what flushes it. |
| FT1 + LL1 + TF1 | Every fight leaves one faction or none, so each round starts with nothing contested. |
| FT1 + RE3 | Ending the round is the trigger. Players who like the pairings pass, and the rest have to spend cards. |
| FT1 + RO1 | A resolution order only matters when many fights resolve together. |
| FT1 + GR1 | Fights and growth happen in the same step. |
| FT3 + FR1 | Triggering cashes in a known result, so the play is to stake and then trigger. |
| UP2 + any GR | Unclaimed tokens return to the supply and can come back as growth. |
| AB1 + PT2 | Affinity is the only thing that breaks a tie between players. One rule covers every such tie, and where no affinity group is involved the tie simply stands. |
| AB1 + AL1 | A group's three aligned locations are spread across the island, so its edge in ties is spread out too. |
| AB1 + PT2 + ST1 | At its own locations a group that ties still collects, so everyone else has to beat it by one there. |
| PT2 + ST1 + AS1 | A standing tie pays no trophies and refunds no influence. Matching a leader cancels their payout, at the cost of the spoiler's own stake. |
| PT2 + ST2 + AF3 | The player who moves up becomes the leader, so a small stake below a tie collects the bigger pile and has its influence move to the winning faction. |
| ST2 + AS1 | The tied players lose their stake and their trophies, while the players below them are paid. Tying is costly for the pair and valuable to everyone beneath them. |
| AS1 + AF3 | A standing tie has no leader, so nothing moves to the winning faction. Tying a leader blocks their refund. |
| AS1 + AT1 + TF1 | Both kinds of tie end the same way: a tied fight wipes the factions and clears the influence there, and a tie between players clears the tied influence. |
| ST1 + UP2 | Tied piles and unclaimed piles get the same answer: back to the supply. |
| AL2 + AB1 | One rule for both sides: at a location, the linked faction wins tied fights and the linked slayer group wins tied influence. |
| LC2 + FR1 + AL2 | The controlling faction is always the one that would win the fight if it happened now, so control previews the result. |
| LC2 + AF3 | A leader can see which faction their influence would move to by looking at who controls the location. |
| AL3 + GR1 | Growth at round end gives the extra token a step to attach to. |
| FT2 + TD1 | Movement becomes the trigger. A player can place influence and then tip the location over, with no special card needed. |
| FT2 + TF1 | A tie at boil-over removes every token at the location, so the last token moved decides between a win and a full wipe. |
| IN1 + RQ5 | A hidden token is on the location before the fight begins, so nothing is added once resolution starts. |
| IN1 + TD1 | The marker cube counts as influence, so setting a trap is also a stake in the trophies there. |
| IN1 + PT2 | One extra influence from a token can tie a leader or break a standing tie, so a trap can double as the spoiling move. |
| IN2 + EG3 | Influence is public and trophies are secret, so final standings are uncertain and precise kingmaking is harder. |
| DR3 + hidden hands | Players know what they passed on, which gives them partial knowledge of other hands without seeing any. |
| RE3 + hidden hands | No one knows whether a passing player still holds cards, so passing can be a bluff. |
| DR3 + FP1 | Marked cards circulate in the draft. Whoever ends up holding the highest one has to open with it. |
| DR5 + FP1 | Only one card sits out, so A and B can't both be missing, and the first player is always decided. |
| DR4 + DR6 + hidden hands | The pool is small and known, so players can plan around a fixed list of actions without seeing who holds what. |
| DR5 + DR4 | One unseen card adds a little doubt about whether a given action is available, without making the pool unreliable. |
| ET1 + IB2 | A tie on the winning faction is settled by standing with the next faction, so spreading influence across factions has a payoff at the end. |
| ET2 + AB1 | A tie on score falls back to raw influence, which is exactly where the affinity tiebreaker already applies, so affinity needs no second rule. |
| ET2 + IN2 | Influence is public and trophies are secret, so the first tiebreak is something everyone can see coming. |
| FX1 + LC2 | Control gets a second job. Between factions level on tokens, the one spread across more locations beats the one piled up in a few. |
| FX1 + ET1 | Ranking factions by presence, then by locations controlled, gives the order that end-game ties between players are settled in. |
| GR1 + FX1 | Splitting a faction into more groups that meet the growth threshold makes it grow faster and wins it presence ties, so backers want their faction spread out. |
| GR1 + FT2 alone | A stand-off that grows every round creeps toward the volatility threshold, so it can't sit under the line for ever. |
| BT1 + IN1 | Every hidden action puts down a real token and a bluff, so the table knows who set the trap but not which token it is. |
| BT1 + IM1 | Both tokens carry a marker cube that counts as influence, so one hidden action stakes its player at two locations at once. |
| UT1 + MC3 | A waiting token keeps its token on the location as a standing claim, and the token goes back to the supply only when the location resolves. |
| UT1 + FT2 alone | Where fights only happen on boil-over, a token can sit for several rounds, so traps are bets on where the next big fight will be. |

#### Clear clashes

| Codes | Why they pull against each other |
|---|---|
| FR2 vs RQ3 | Both piles are equal, so first place gets no more than second. |
| FR2 vs TD1 | Every fight becomes a pick, so colour no longer follows from the result (RQ4). |
| FR4 vs RQ5, AF3 | Dice aren't deterministic, and the leader can't know where their influence will land. |
| TD2 vs RQ4, IM1 | If faction influence hands out trophies, standing at a location means nothing and influence on locations has no job. |
| FT2, FT3 vs RO1 | Mid-round fights resolve one at a time as they're triggered, which leaves a cascade nothing to order. |
| UP1 vs AF3 + EG3 | A lone leader takes the winner's tokens just as their influence moves to the winner, and those tokens count against it. |
| TD1, AF3 vs IB4 | "Bids and trophies are separate systems" stops being true once influence is what collects trophies. |
| AB2 vs IB2 | A standing bonus with one faction gives each player a home faction from setup, which works against influence targets shifting with the board. AB1 has the same pull, but only in ties. |
| AB2 (extra trophy) vs RQ2 | An extra trophy isn't a casualty, so it has to come from somewhere other than the fight. |
| AB2 (extra trophy and extra influence) vs EG3 | If the extra influence is with the linked faction, the two bonuses partly cancel when the score is influence minus trophies. |
| ST1 or ST3 + any GR vs TH1 | Tied piles return to the supply and can come back as growth, which works against using ties to hold presence under the threshold. |
| AL2 vs TF1, TM1, AT1 | A tied fight only wipes both factions on ground aligned with neither, so scorched earth and the influence clear trigger less often. |
| AL2 + AL3 + SD1 vs TH1 | Factions start on ground where they win ties and grow faster, so presence builds where it is hardest to clear. This leans the game toward a faction win. |
| FT2 alone vs LL1, FT1 | A stand-off under the threshold never fights. It fills its location, keeping other factions out, and rounds no longer start with nothing contested. |
| ST3 vs AS1 | Dropping to runner-up keeps the tied players in the payout, while AS1 clears their influence as if they had lost everything. One of the two has to give. |
| AP1 to AP6, FD1 vs "on the board, not in memory" (1.4) | Archetype powers and faction twists are standing rules that differ by faction. Unless each is shown by a piece or a card in the play space, players have to carry them in memory. |
| HT1 vs LC2, AF3 | Where a token sits, control no longer previews the fight, and a leader can't be sure which faction their influence will land on. |
| IN2 vs TS2 | With trophy totals secret, opponents can't be sure which colour a player is short of, so denying a set is less precise. |

### E.2 Trade-offs

Choices where both sides work but lead to different games. Most of them sit on four axes:

- **Who pushes presence up:** the players, or the game.
- **What happens to influence:** spent for good, or circulating.
- **How results land:** graded, or all-or-nothing.
- **How much the board carries:** strict and light, or textured and heavier.

#### Combat

| Choice | One way | The other way |
|---|---|---|
| AF1 or AF3 | AF1: every stake is a permanent sacrifice of standing for trophies. Sharpest knife's edge, lightest board. | AF3: the leader is refunded. More interlocked, more to track, and first place gains on both scores. |
| FT1 or FT3 | FT1: one batch of fights a round. Calmer and easier to read. | FT3: several fights a round. Swingier, and with AF3 a player can restake in the same round. |
| FR1 or FR3 | FR1: losses scale with the fight, so presence falls steadily. | FR3: simplest to compute, but big groups barely shrink. |
| TM1 with TF1 + AT1 | Without TM1: a tie wipes two factions and the influence there. | With TM1: it also removes the location. Three consequences on one event, very swingy. |

#### Growth and presence

| Choice | One way | The other way |
|---|---|---|
| GR2 alone, or with GR1 | Alone: presence only rises when a player chooses to grow a faction, so the game drifts toward the island. | With GR1: groups left in peace grow for free. Backers get a passive lever and trophy hunters get a reason to attack. |
| GR2 or GR3 | GR2: growth is each player's choice, tied to their own stake. | GR3: the game pushes presence up regardless. Players can only cut it back, and a backer can sit and wait. |
| UP1 or UP2 | UP1: being alone at a location pays double, and trophies leave the game faster, so presence can't recover. | UP2: uncontested fights pay less, and the tokens return to the supply, which keeps a faction win alive longer. |

#### Cards and the round

| Choice | One way | The other way |
|---|---|---|
| CU4 alone, or with IC2 | Alone: every card can grow or move, so hands are uniform and every move needs influence first. | With IC2: some cards make small free moves. Players with no influence can still act, and the draft has more texture. |
| MV2 off or on | Off: the map is strict, blocking is strong, and positions are easier to predict. | On: jump cards bypass blocks. Fewer dead ends, but less certainty about what others can reach. |
| RE3 or RE2 | RE3: players end the round together by passing, so stalling is possible. | RE2: every card played pushes the clock, so rounds can't stall, but each card carries one more value to weigh. |
| RO1 off or on | Off: fights are independent and can resolve in any order. | On: early fights tip later ones. Players plan sequences, and there's more to track. |

#### Stakes and scoring

| Choice | One way | The other way |
|---|---|---|
| EG3 or EG2 | EG3: influence minus trophies. High standing can absorb a few trophies, so results are graded. | EG2: fewest trophies of the winning faction wins. Avoiding those tokens is everything and influence only breaks ties. |
| TS2 or EG1 | TS2: sets need every colour, so you have to take tokens of the faction you back. | EG1: a plain count of eliminations. Simpler, with no colour tension, and it rewards whoever fights most. |
| AF2, leader or runner-up | Leader leaves one: incumbency. The player ahead stays ahead at that location. | Runner-up leaves one: consolation. The lead tends to pass back and forth. |

#### Map and factions

| Choice | One way | The other way |
|---|---|---|
| CN3 or CN1 | CN3: a few region borders, quick to learn, coarse distances. | CN1: location-by-location links. Finer chokepoints, more to read, and more map design work. |
| Archetype powers off or on | Off: all factions behave alike, so the board is easier to read and balance. | On: more theme and variety, but up to 243 faction mixes to balance. |

#### Affinity, ties, control, volatility and information

| Choice | One way | The other way |
|---|---|---|
| AB1 or AB2 | AB1: only matters in a tie. Light, and it falls through cleanly when no affinity group is involved. | AB2: always on. Stronger group identity, but it pushes fixed allegiances, and at 3 or 4 players some factions have no group with a bonus. |
| PT1 or PT2 | PT1: every tie resolves, so a tie never denies a pile. | PT2: ties are outcomes. Matching a leader becomes a move, and more ties stand at 3 players, where fewer affinity groups are at the table. |
| ST1 or ST2 | ST1: the fight pays no one. Simplest, and the tokens return to the supply, which keeps a faction win alive longer. | ST2: everyone below the tie moves up. A small stake can take the bigger pile, which rewards reading the table. The trophies leave the game, and spoiling a leader hands the prize to a third player. |
| ST2 or ST3 | ST2: the tied players get nothing and the players below them are paid, so a tie is a gift to a third player. | ST3: the tied players keep a small, single-colour prize and the bigger pile is lost. A tie costs the main prize without wiping the pair out, and needs a little arithmetic. |
| FT2 alone, or with FT1 | Alone: fights happen only on boil-over. Small contested groups stay on the board, which protects presence for players allied with a faction. Every fight is about the same size. | With FT1: whatever is still contested fights at round end. Small piles become cheap trophies, and presence drains faster, which favours the island. |
| AL2 and AL3 off or on | Off: every location treats all factions alike, and a tie can clear two factions anywhere. | On: factions hold their own ground. They win ties and grow faster there, so the island side has to outnumber them at home. |
| HT1 or HT2 | HT1: tokens change the fight. More dramatic, but the board outcome is uncertain wherever a token sits. | HT2: tokens change who collects. The fight stays readable from the board, and the bluffing is entirely between players. |
| IN2 off or on | Off: trophies are open, so players can count each other's standing exactly. | On: totals are secret. Players track by memory, final scores stay uncertain, and choices of pile leak information. |
| MC1 or MC2 | MC1: a hidden action costs two influence, and a player with none can't set a trap. One rule covers all influence on locations. | MC2: traps are free, which suits an indirect action (IC2). With AF3, a free cube that leads a fight becomes real standing with the winning faction. |
| MC2 or MC3 | MC2: a free cube behaves like any other influence afterwards, so it can end up as standing with a faction. | MC3: the cube only ever returns to the supply. A trap gives a temporary stake in the trophies, and neither costs nor creates standing. |
| ET3 or ET2 | ET3: affinity breaks any tie on standing. One rule under every end-game candidate, and affinity for the winning faction is a real edge at the finish. | ET2: raw influence is compared first. The bigger backer wins, the first tiebreak is public, and affinity stays exactly as defined, at the cost of a longer chain. |

### E.3 Groups

Sets of candidates that reinforce each other, where each rule sets up the next.

| Code | Group | Codes | What links them |
|---|---|---|---|
| `G1` | Influence loop | GR2 + CU4 + IM1 + TD1 + AF3 | Grow a faction to gain influence, spend it onto a location, lead the fight, take the bigger pile, and get the influence back on the winning faction. |
| `G2` | Clean round | LL1 + FS1 + FT1 + TF1 + RE3 | Two factions at most, so every fight is two-sided. All of them resolve at the end of the round, each leaves one faction or none, and passing is what ends the round. |
| `G3` | Steer the fight | FR1 + TD1 + PT1 + MV1 | The loser's pile is the bigger one, so rank fixes colour. Shifting one token can flip the winner and swap who gets which colour. |
| `G4` | Knife's edge | CU4 + GR2 + TH1 + EG3 + TS2 | Each card play either grows presence and the player's stake, or leads to a fight that lowers presence and pays trophies. Sets need every colour, and each colour counts against its holder if that faction wins. |
| `G5` | Tie bomb | TF1 + AT1 + TM1 + TD1 | A tie wipes both factions, clears the influence there, removes the location and pays the most trophies, with the leader picking first. |
| `G6` | Draft standoff | DR1 + DR2 + FP1 + CB1 + TU1 | The marked cards set turn order, A is strong but must open, waiting is a tactic, and unplayed cards are lost back to the pool. |
| `G7` | Cascade | FT1 + RO1 + GR4 | Fights resolve in a visible order and each result spills into locations still to come, so combat and growth are one chain. |
| `G8` | Hard map, valuable jumps | CN3 + AL1 + MV2 + LL1 + SD1 | Regions make ordinary movement slow, full locations block, and aligned locations spread across the island give cards a way to jump. |
| `G9` | Spoiler's tie | AB1 + PT2 + ST1 + AS1 + AF3 | A tie between players stands unless affinity breaks it. Matching a leader cancels their trophies and their refund, costs the spoiler their own stake, and can't be done to a group at its own locations. |
| `G10` | Home ground | SD1 + LC2 + AL2 + AL3 + AB1 | Each archetype's three locations favour its own. The faction starts there, wins tied fights there and grows faster there, and its slayer group wins tied influence there. |
| `G11` | Boiling point | FT2 + TF1 + TD1 + IM1 | The token count sets the timing of a fight. A player stakes influence, then tips the location over, and an equal split wipes everything there. |
| `G12` | Open table, hidden edges | IN1 + IN2 + DR3 + hidden hands | The board, influence and token ownership are open. Hands, trophy totals and token faces are hidden, so every read is good but never certain. |

- G2, G3, G4 and G6 appear in every sample ruleset. They are the spine of the game as it stands.
- G9, G10, G11 and G12 are not yet placed in a sample ruleset.
- G1 is the biggest single choice: it is the difference between influence being spent for good and influence circulating.

### E.4 Sample rulesets

Four selections of candidates that could be played together, each built to show one character of game. Only the combat cluster has been analysed pair by pair, so the choices outside combat are first guesses.

#### Shared core

All four rulesets use the same codes wherever a slot has one candidate, or the requirements leave one option.

- **Map and setup:** BD1, LL1, LC1, CN3, AL1, SD1.
- **Cards and turns:** DR1, DR2, CD1, CU4, GR2, MV1, CB1, TU1, FP1.
- **Round and combat:** GL1, RS1, RE3, FS1, FR1, TF1, TD1, PT1, IM1.
- **Stakes:** IF1, WC1, TH1, TS2.

Three of these are forced. TD1 is the only trophy distribution that meets RQ4. TD1 needs influence on locations, which only CU4 provides, and CU4's grow use is GR2. FR1 is the only fight rule that meets all five requirements without being marked weaker.

#### Where they differ

| Slot | Lightest rules | Deepest decisions | Most interlocked | Most swingy |
|---|---|---|---|---|
| Influence after a fight | AF1 | AF3 + AT1 | AF3 + AT1 | AF3 + AT1 |
| Unclaimed pile | UP2 | UP1 | UP2 | UP1 |
| Fight trigger | FT1 | FT1 + FT3 | FT1 | FT1 + FT3 |
| Extra growth | none | GR1 | GR4 | none |
| Resolution order | none | none | RO1 | none |
| Rule-breaking moves | none | MV2 | MV2 | MV2 |
| Round end | RE3 | RE3 | RE3 + RE2 | RE3 |
| Tie effect on the map | none | none | TM1 | TM1 |
| End-game scoring | EG3 | EG3 | EG3 | EG2 |
| Groups switched on | G2, G3, G4, G6 | G1, G2, G3, G4, G6, G8 | G1 to G8 | G1, G2, G3, G5, G6, G8, and G4 with EG2 in place of EG3 |

#### What each one is like

- **Lightest rules:** influence on a location always clears, there is one batch of fights a round, and there are no exceptions to movement. The risk is that influence is only ever spent, which may feel like an economy.
- **Deepest decisions:** stakes persist and queue up, players can trigger fights, and groups of two or more grow, so a player backing a faction has a lever. The risk is board load. UP1 is included on purpose: it makes being alone at a location a trap as well as a prize.
- **Most interlocked:** combat feeds growth through a cascade, cards drive the round clock, unclaimed tokens return to the supply, and ties remove locations. It is the heaviest, and it leans on three ideas with large open questions (RO1, GR4, RE2).
- **Most swingy:** ties wipe factions, influence and the location, fights can be triggered mid-round, and the end game is all-or-nothing on one faction's trophies. The risk is kingmaking, and games decided by one token.

#### Candidates no ruleset uses

- **Fails a requirement:** FR2, FR4, TD2.
- **Not defined enough to place:** GR3, IB5.
- **Not needed once CU4 is in:** CU1, CU2, CU3, IC1, IC2.
- **Not chosen:** CN1, CN2, TM2, FR3, AF2, EG1, TS1, and the archetype powers.
- **Not yet placed in a ruleset:** AB1, AB2, PT2, ST1, ST2, ST3, AS1, LC2, AL2, AL3, FT2, IN1, IN2, HT1, HT2, DR3, DR4, DR5, DR6, ET1, ET2, ET3, FX1, BT1, MC1, MC2, MC3, UT1.

---

## Appendix F: Prototype architecture

The patterns and architecture the web prototype is built on. This appendix covers how the prototype is built and run. It does not add, change, or settle any rule of the game.

### F.1 The eight choices

| Choice | What it means |
|---|---|
| Cloudflare Workers | One Worker serves the pages and routes every request. It runs on the free plan. |
| Game state as one text document | The whole game is a single JSON document. One Durable Object holds it in memory and saves it after every accepted move. |
| HTML and JavaScript UI | Static pages with no build step. The browser draws one player's view and sends moves. |
| JavaScript game engine as a state machine | One plain module of pure functions holds all the rules. The server uses it to decide; the browser uses it only to preview. |
| Magic links | Each seat has a link of its own. The link is the player's identity, with no accounts and no lobby. |
| Bots | Any seat can be a bot. The server plays it with a random legal move as soon as it can act. |
| Host page | A page for naming the seats, choosing options and bots, dealing a new game, and copying the links. |
| Single game | One game exists at a time. Dealing a new game replaces the one in progress. |

### F.2 How the pieces fit

```
Browser, one per seat  ──websocket──▶  Worker  ──▶  Durable Object "the-game"
     │                                                  │
     │  imports the engine for previews                 │  imports the engine as the authority
     │  draws its own player view                       │  holds the game state in memory
     │  sends moves                                     │  validates, applies, saves
     │                                                  │  sends each seat its own player view
     ▼                                                  ▼
 static pages in public/                        storage: one JSON document, the game state
```

- **One authority.** The Durable Object is a single instance that handles one message at a time, so two players committing at the same moment cannot conflict.
- **Save, then tell.** The state is saved after every accepted move and before anyone is told about it. A crash mid-game loses nothing.
- **The client never decides.** Every move goes to the server, which checks it with the engine. The browser uses the same engine only to preview, such as greying out an illegal move.
- **Live updates.** Each seat holds a websocket. The server sends a seat its new view whenever the state changes.

#### Routes

| Route | What it does |
|---|---|
| `GET /p/<token>` | Serves the table page. The token in the address is the player's identity. |
| `GET /ws/<token>` | Opens the websocket for that seat. Handled by the Durable Object. |
| `GET /host` | Serves the host page. |
| `GET /hotseat` | Serves the table page in hotseat mode. |
| `POST /admin/new-game` | Deals a new game from the seat names, an optional seed, the options chosen, and the list of bot seats. Returns the magic links. |
| `GET /admin/links` | Lists the magic links for the current game again. |
| `GET /admin/status` | Reports the phase, the round, and each seat, including whether it is online and whether it is a bot. |
| `GET /assets` | Serves the assets page, where art is reviewed (F.17). |
| anything else | A static file from `public/`. |

The Worker itself only routes. It passes the websocket and admin routes to the Durable Object and serves pages for the rest.

#### Messages

| Direction | Message | What it carries |
|---|---|---|
| Browser to server | `move` | One move for the engine. |
| Browser to server | `chat` | A line of table talk. |
| Server to browser | `state` | That seat's player view, who is online, and which seats are bots. |
| Server to browser | `error` | Why a move was rejected. Sent only to the seat that made it. |
| Server to browser | `chat` | New chat lines, or a reset when a new game is dealt. |
| Server to browser | `presence` | Who is online, sent when a seat connects or drops. |

#### Safeguards

- **Rate limit.** Each connection has a small allowance of messages that refills over time, so a stuck browser can't flood the game.
- **Malformed messages** are rejected with an error and change nothing.
- **Illegal moves** are rejected by the engine, and the state is left as it was.

### F.3 Game state

- **One document.** The state is a single JSON document, readable as text. It is stored in the Durable Object's own storage under one key.
  - This is the Durable Object's storage, not a file on a disk. It behaves the same way: one text document, read on waking and rewritten after each move.
- **Everything about the game is in it.** The board, every seat's hidden information, the card pool, the round and phase, and the history of resolved fights.
- **Three small records sit beside it**, each under its own key: the map from tokens to seats, the list of bot seats, and the chat history.
- **Reloaded on waking.** The Durable Object sleeps between messages and loses what it held in memory. Every time it wakes, it reloads the four records before doing anything else.
- **Seats survive sleep too.** Each websocket carries a note of which seat it belongs to, so the server still knows who is who after waking.
- **Reproducible deals.** A game can be created from a seed, so the same deal can be replayed.

### F.4 The engine

- **Pure functions.** The engine never touches the network, the page, or storage. It takes a state and returns a new one, so it runs unchanged in the server, the browser, the tests, and the simulation.
- **The same module on both sides.** It is plain JavaScript with type comments, checked under strict TypeScript. The types for the state, the moves, and the player view are written at the top of the file.
- **It reads the data file.** The engine imports the data file, builds its lookups from it once, and passes it on to whoever imports the engine.

#### The functions

| Function | What it does |
|---|---|
| `createGame({ seed, players, options })` | Sets up a new game from a seed, the seat names, and the options chosen by the host. It checks the seat count against the limits in the data file. |
| `validate(state, { player, move })` | Says whether a move is legal, and why not if it isn't. |
| `applyMove(state, { player, move })` | Validates the move, then returns the state after it. An illegal move raises an error carrying the reason. |
| `resolve(state)` | Runs the automatic part of a round. |
| `playerView(state, player)` | Returns the copy of the state that one seat is allowed to see. |

- **The server calls three of them:** `createGame` when a game is dealt, `applyMove` for every move, and `playerView` for every seat after every change.

#### Moves and verdicts

- **A move is a small tagged object:** a `type` naming the kind of move, plus that move's own details. A submission pairs a move with the seat making it.
- **Every check returns a verdict:** either "ok", or "not ok" with a reason in plain words. The reason is what the player sees when a move is rejected.
- **Validation runs in a fixed order:** the seat exists, the game isn't over, the move is the right kind for the phase, it's that seat's turn or they haven't yet committed, and finally the details of the move itself.
- **Small checks are shared.** Each kind of input has its own check, exported so the browser can run the same check to preview a move before sending it.
- **Two kinds of error.** A player's illegal move raises the illegal-move error, which the server turns into a message for that seat. Anything else is a bug and is left to fail loudly.

#### Applying a move

- **Copy, then change.** `applyMove` validates, makes a full copy of the state, changes the copy, and returns it. The state passed in is never altered.
- **Automatic steps run in the same call.** When the move that completes a round lands, the engine runs `resolve` before returning, so the server never sees a half-finished state.

#### Phases

- **The state carries the current phase.** The phase decides which moves are legal and who may make them.
- **Phases where everyone acts at once** keep a "committed" mark for each seat. Each submission is stored privately, and when all seats have committed, the marks are cleared, the submissions take effect together, and the phase moves on.
- **Phases taken in turn** keep a turn counter in the state. Whose turn it is, and the full turn order, are worked out from the state by helper functions and never stored separately.
- **A round ends by resetting** the fields that belong to one round and advancing the round counter.
- **The game ends** by setting the phase to "ended" and writing the final scores, the ranking, and the winner into the state.
- **Phases for this game** follow the round structure in 3.12. They are written out once a complete ruleset is chosen.

#### Randomness

- **Seeded and repeatable.** The engine uses its own small random number generator, started from the seed. The current seed value is kept in the state and updated each time a shuffle uses it.
- **No outside randomness.** Because the engine never asks the system for a random number, the same seed and the same moves always give the same game.

#### The log

- **A public history.** Each round's automatic step appends a record of what was revealed and what happened. The log is the only history, and it is what players see when a round resolves.

#### Helpers for the browser and the bots

- **Lists of legal options.** The engine exports functions that list every legal choice for a given situation. The browser uses them to grey out what can't be done, and the bots use them to pick a random legal move.
- **Derived values.** Running totals and similar figures are computed by exported helpers, so the browser shows exactly what the server will check.

### F.5 Hidden information

- **It stays on the server.** The server holds the full state. Each seat receives only its own player view, so hidden information never reaches another player's browser until the rules reveal it.
- **The server works out results.** Anything that depends on hidden information is computed by the server. Players never report it themselves.
- **The shape of a player view.** It has three parts: what everyone can see, a public summary of each seat, and a "me" part holding the viewing seat's own private information.
- **Counts in place of contents.** For anything no one may see, the view carries how many there are and not what they are.
- **Reveals happen through the state.** When the rules reveal something, it is written into the public log or the public summary, and so reaches every seat's view.
- **For this game**, the player view hides whatever section 3.11 says is hidden. Hands are hidden by decision. Secret trophy totals, token faces, and the card left out of the deal are hidden under the current candidates.

### F.6 The table

The page a player sees. It is one script with no framework and no build step.

#### What the browser holds

- **One object for everything the page knows:** the token from the address, the latest player view, who is online, which seats are bots, the chat lines, the connection, and a short note about the connection's status.
- **The player's unsent choices live here too.** Anything a player is still deciding, such as a selection or a half-made move, is kept in the browser only. It reaches the server when the player commits it as a move.
- **Choices reset when the phase changes.** The page keeps a key made from the round and the phase. When a new view arrives with a different key, the unsent choices are cleared.

#### Talking to the server

- **One websocket**, opened to the seat's own address using the token.
- **Incoming messages are sorted by type:** a new state replaces the stored view and redraws the page; presence updates the seat list; chat adds lines; an error is shown as a short notice that fades after a few seconds.
- **Reconnecting.** If the connection drops, the page says so and tries again after a short pause. If the server closed it on purpose, because the seat was removed or the link is no longer valid, the page says that and stops trying.
- **Sending.** A move or a chat line is sent only if the connection is open. Otherwise the player is told they aren't connected.

#### Drawing the page

- **One function per panel.** Each part of the page has its own function that builds that panel from the stored view and writes it into a fixed place on the page. One top-level function calls them all whenever anything changes.
- **A panel that follows the phase.** One panel shows what the player can do now. A small table maps each phase to the function that draws it.
- **Buttons say what they do.** Each control carries a short action name, and the page acts on that name when the control is used.
- **Everything shown is made safe first.** Any name or text from a player is escaped before it goes onto the page.
- **A colour per seat**, taken from a fixed list in seating order.

#### Previews

- **The engine's checks run in the browser.** While a player builds a move, the page runs the same checks the server will run, to show running totals, mark what can't be chosen, and say why a move isn't legal yet.
- **The commit button follows the check.** It is enabled only when the engine says the move is legal.
- **The server still decides.** A preview is a courtesy. The move is checked again when it arrives.

#### Showing other players

- **The seat list** shows each seat's public information, whether they are online, whether they are a bot, which seat is the viewer's own, and a short status for the current phase, such as still deciding or already committed.
- **Waiting notices** name the seats the game is waiting on.
- **Turn order** is shown as a row of seats, with past turns, the current turn, and turns to come marked differently.

#### Table talk

- **A chat panel** at the table, sent over the same websocket. Lines are short, and a saved history of recent lines clears when a new game is dealt.
- **No effect on the game.** Chat is table talk only; the engine never reads it.

#### Replaying a round

- **Step by step.** When a round resolves, the page walks through the newest entry in the public log one step at a time, with controls for the next step, showing everything, and closing.
- **The replay position is local.** Each player steps through at their own pace, and it has no effect on the game.

#### For this game

- What the table shows follows the board (3.1) and the information rules (3.11). The panels are designed once a complete ruleset is chosen.

### F.7 Magic links and seats

- **One link per seat**, of the form `/p/<token>`. The server maps each token to a seat.
- **The link is the identity.** Opening it again after a disconnect restores that seat. There are no accounts and no sessions.
- **Tokens are random and unguessable.** They are made when a game is dealt, shown to the host, and written to the server log.
- **Seats keep their links across games.** A seat with the same name as before keeps its token, so dealing again moves every open tab to the new game. A new name gets a new token.
- **Dropped seats are disconnected.** If a new deal no longer includes a seat, that seat's connection is closed.

### F.8 Host page

Where a game is started. The host page holds no game rules. Everything it does is a call to one of the admin routes.

#### What it shows

- **The current game:** the round, the phase, the options in use, and each seat with whether it is connected, away, or a bot.
- **The deal form:** one row per seat with a name, a bot tick-box, and a remove button; a button to add a seat; the options for this game; and an optional seed.
- **The links:** each seat's magic link with a copy button, and one button to copy them all.

#### Dealing

- **Seats are filled in from the current game.** When a game already exists, the form starts with its seat names and bot choices, so dealing again with the same names keeps everyone's links.
- **Checks before sending:** every seat has a name, the names are all different, at least one seat is human, and the number of seats is within the game's limits.
- **Dealing replaces the game in progress.** The server refuses to deal over a game in progress unless told to force it. The host page always forces, and shows a warning beside the deal button when a game is under way. A finished game can be replaced freely.
- **A new deal starts clean.** It replaces the state, the bot list, and the chat history together.
- **The result is shown back:** the seed used and the options chosen, so the deal can be repeated.
- **Options chosen per game.** The host can pick between rule variants when dealing, so candidate rules can be compared in play.

#### Locking

- **Open by default.** With no admin secret set, the host page and admin routes work for anyone who can reach them. Anyone who can reach an open host page can redeal the game and read every seat's link.
- **Locked with a secret.** When an admin secret is set, every admin call must carry it.
- **The page finds out by asking.** On opening, it asks the server for the game's status. An open server answers and the page unlocks. A locked server refuses, and the page shows a box for the key.
- **The key is kept for that tab only.** A key that is refused is forgotten and the page says so.

#### Hotseat

- **`/hotseat`** lets one person play every human seat from a single tab, switching between seats. It fetches the seat links through the admin routes, so it needs the key when the server is locked. It is for testing alone.

### F.9 Bots and simulation

#### Bots in a live game

- **Bots on the server.** A bot seat is played by the server the moment it can act. Bots and human seats mix freely, so one person can play against a table of bots.
- **The bot loop.** After a new deal, and after every accepted move, the server lets each bot seat act in turn until none of them can, up to a fixed cap. It then saves once and sends everyone their view.
- **At least one seat must be human.** A bot seat always shows as online.

#### How a bot is written

- **One entry function.** Given the state and a seat, it returns a move or nothing. Nothing means that seat can't act right now: the game is over, it has already committed, or it isn't its turn.
- **It follows the phases.** The entry function looks at the current phase and hands off to a small function that makes a random move of the kind that phase needs.
- **Pure, like the engine.** A bot never changes the state. It only proposes a move, which goes through `applyMove` like any other.
- **The random source is passed in.** The server gives it ordinary randomness, and the simulation gives it a seeded one so runs can be repeated.
- **Three ways to stay legal:**
  - pick from one of the engine's lists of legal options;
  - make a random choice, then trim it back until the engine's check passes;
  - try a few random choices against the engine's check, and fall back to a move that is always legal.
- **Profiles.** A bot can be given a named profile (below, under "Bots that play to win"). The server uses the standard one; the simulation can run several and compare them.
- **Bots read the full state.** A bot that plays to win would have to be limited to its own player view for a fair game against people (open, below).

#### Simulation

- **One bot module.** The same module drives the bots in a live game and in the simulation.
- **Thousands of games.** A script plays whole games with bots and prints summary figures.
- **Checking the rules.** Whole bot games check that the rules run from start to finish and exercise every phase (random bots did this until they were pruned, 2026-10-08).
- **A limit for balancing.** Bot figures are a guide, not a prediction; they are checked against human play.

#### Bots that play to win (designer, 2026-10-07)

- **Purpose.** Bots play out rounds to measure cards and play whole games to test the systems. *Designer:* bot speed is not a concern; bots should play as tactically and strategically as we can make them, and their reactions should be designed carefully.
- **Profiles** (`public/bots.js`; tuning, not rules). *Pruned (designer, 2026-10-08): every dumb or weak bot was removed; three remain.*
  - *trophy* (named *goal* until 2026-10-09; designer renamed it, as both profiles are goal-driven): the trophy player, the standard bot (server, scripts, tests). Goal-driven, below; leans toward the island and trophy sets. Older notes say *goal* for it.
  - *backer:* the faction backer: leans toward backing a faction for the invaders, guards presence (`protect`), holds its plan unless the island is clearly better (`commit`) and pushes its faction to the top (`top`).
  - *goal-deep:* removed (2026-10-09, designer): goal plus a reply lookahead, which bypassed the play-out search; it won 5% of 10 games against 42.5% for goal. A lighter play-out search (`keep=4,playouts=2`) also measured clearly worse (10% against 45%), so tuning runs keep the full search and stay fast with small samples (about 10 games, variants side by side; designer).
  - *hunter:* removed (2026-10-09): against the smarter goal bots it took 6.6% of wins from its seat in the full card run (331 games), against about 31% for each goal seat. The standard table is now backer, backer, goal, goal, goal.
  - **Designer (2026-10-09):** whenever a bot profile measures clearly worse than the others, remove it; a weak bot in the tuning rounds skews the results. For faster cycles, tune the strong bots' search down (fewer play-outs, fewer moves kept, `goal:keep=4,playouts=2`), never keep a weak bot.
  - *Removed:* random, smart, invader, island, trophy, deep, deep-bold, deep-balanced, deep-cautious, and the goal personalities under test (any can be rebuilt as overrides, e.g. `goal:proof=0.6`). The presence trend and loose board influence settings were removed too: neither helped.
- **Strategy breakpoints (designer, 2026-10-07; the first build, deep-bold/balanced/cautious, lost every tournament and was removed; the goal bots carry the idea).** Points at which a bot shifts focus, with different numbers per bot to give each its own play profile. Two axes:
  1. *The ending:* a trophy mix (the island wins) or faction influence (the invaders win). A bot commits when the projected presence is far enough from the threshold, or in the last round; otherwise it hedges. Which faction to back is two-sided (designer): if the invaders look like winning, the faction it has the best shot at leading; mid-game, if they look like losing, the faction that sets up the actions it wants to take with its cards.
  2. *Mid-game:* influence on a faction (spending cards for standing) or actions that produce trophies, switching by round and by how much standing it already holds.
- **Tournament** (`scripts/tournament.js`): whole games with one profile per seat, rotated through the seats, counting wins and how each profile's games end.
- **Goal-driven bots (designer approved the approach, 2026-10-07; built as `goal` and `goal-deep`).** Bots with goals that can shift and adapt while prioritising the best chance at victory. Next session's build order: (1) the win-chance evaluator, (2) goals with switch margins, (3) tournaments against the current bots.
  - *Win chance:* P(invaders win) × P(I win as invaders) + P(island wins) × P(I win as island). Each "I win" is a probability from my margin against the best rival (standing less trophies with the likely top faction; weakest trophy colour, then the next), sharpening as rounds run out. P(invaders win) comes from projected end-of-game presence (the board now plus the recent trend) against the threshold. Every move is scored by how much it raises the win chance; the deep bot's lookahead stays as the tactical layer.
  - *Goals:* back faction F (build standing, avoid its trophies, protect its tokens: the invaders' loop, D16); win the island (collect the weakest colour, make big fights you lead, remove tokens); swing (losing under the likely ending but strong under the other: push toward the other); hedge (early, unclear). A bot changes goal only when the new goal's win chance beats the current one by a margin: the breakpoints, per bot (switch margin, risk appetite, horizon). Bots keep their goal between turns.
  - **Designer (2026-10-07):** bots in general require more proof to aim for a faction win than a trophy-set win: they are more easily swayed to go for the trophy-set win and maximise trophies. (An asymmetric breakpoint: backing a faction needs a clearly better win chance than the island.)
  - *Why it should help the target:* in a 5-player game only one or two players can lead the winning faction, so for most players the best chance is the island; bots reasoning about their own chances should pull tables there.
  - *Open:* trophies are secret (IN2) but bots read the full state; fair bots would estimate rivals' trophies from the fights they saw.
  - *First runs (2026-10-07, built as profiles `goal` and `goal-deep`; current first draft: IC1, each faction pays, the new starting setup):*
    - Five `goal` bots: the island won 51% of 200 games, from the bots' own reasoning (plain smart bots: 14%).
    - Mixed table (200 games, one seat each): goal-deep 25%, goal 20%, hunter 20%, smart 19%, trophy 17% (an even share is 20%). The goal bots won mostly as invaders, the trophy-priority bots as the island.
    - Personalities of `goal` (400 games, one seat each): needing more proof to back a faction did best (23%); needing none did worst (17%). This agrees with the designer's rule.
    - A table where every bot leans hard to the island ends at the island 99.5% of the time: nobody plays for the invaders, so presence collapses. Which ending wins depends on who sits at the table, so personalities are now judged as one challenger against a field of four standard `goal` bots.
    - Tuning tool: a tournament profile can carry persona numbers, e.g. `goal:proof=0.4,other=0.6`.
    - *Challengers against four `goal` bots (2026-10-08, 400 games each; even share 20%):* with the field at proof 0.1, challengers needing more proof won 27% (proof 0.25, 0.6) and hunter 27%; proof 0 and smart 20% and 17%. The field moved to proof 0.3.
    - *Against the proof 0.3 field:* the island won 99–100% of games and **no bot backed a faction any more**. Hunter won 40%; every goal personality 19–23% (goal-deep 23%; extra margin weight 20%). The goal bot plays the island game worse than hunter's plain trophy count.
    - *Thresholds, five goal bots:* the island won 100% at 20, 99.5% at 15 and 92% at 10. When every player pushes fights, presence falls through any threshold: fights remove the whole losing group and half as many from the winner.
    - *Designer (2026-10-08):* tune back toward the invader-ally ending so it does happen and can win. *Finding so far:* the invaders' ending happens only when some players back a faction; whether backing pays for the one who does it is the question (a game balance question, not only a bot one).
    - *More challengers against the proof 0.3 field (2026-10-08, 400 games each):* weighting raw margins made goal bots worse (margin 2: 15%, margin 5: 18%); projecting the presence trend changed nothing (20–21%; a whole table of them: the island 98%). Why hunter wins 40% is not yet found.
    - *The invader niche:* a lone eager faction backer (proof −0.3) forced the invaders' ending in 43 of 400 games and won 31 of them, 18% overall against an even 20%: backing is close to break-even, not hopeless.
    - **Designer (2026-10-08):** it should be very, very difficult for a single player backing a faction to force the invaders' ending alone. Invader endings should generally happen only when more than one player is going for them, because players going for trophies should be working to bring presence under the threshold so they can win. So the measure is the ending split by how many players back factions, not one backer's win share.
    - **Target (designer, 2026-10-08):** it should always be hard to work against the group: two backers at a table of five should force the invaders' ending about 40% of the time (less than half). (Measured with the earlier goal bots: one backer 11%, two 64%, three 84%; too steep a jump at two.)
    - *Measured (2026-10-08), after fixing the goal bots (loose board influence no longer counted; margin 3; no weight on the other ending):* two backers against three trophy chasers forced the invaders' ending in **40%** of 400 games (each backer won about 23%, each trophy chaser 18%). Hunter against the fixed field: 31% (was 47% against the first goal bots). The cause of hunter's lead was the goal bots valuing loose influence on the board as future trophies, which spread their influence thin (4.1 trophies a game against hunter's 7.2), and banking standing for the ending they weren't pursuing.
    - *Island games and the tiebreak:* in bot games almost no player completes a set (the weakest colour averages close to 0), so island games are decided by WT1, the next weakest colour. *Designer (2026-10-08):* island games ending in ties makes sense.
    - *Evaluator fixes (2026-10-08):* (1) goal bots count island trophies directly, as hunter does, instead of as a probability, which flattened one more trophy into nothing (challenger 32% against 20%); (2) margins are no longer multiplied by an ending's chance: a negative margin multiplied that way rewarded a bot that was behind for making that ending less likely, so trailing bots pushed presence up (with it fixed, five goal bots end at the island 78% of the time). The new goal bot beats the old field 28% to 20%. Hunter still wins 41% against it, mostly through the invaders: it quietly builds standing with the leading faction while the goal bots chase trophies, and no bot moves to block it. Next: bots that see a rival pulling ahead with a faction and act against it.
    - **Designer (2026-10-08):** the idea that players going for trophies would let a single player back a faction and win with faction presence is not realistic. If a faction win seems likely, all trophy players shift their strategy to removing presence, in a way that optimises trophies for them, but still removing presence when they can't, because if they don't they lose regardless. *Built as the goal bots' `threat` setting (the best rival's chance of winning through the invaders counts against a bot): with it, hunter fell from 41% to 20% and its invader wins from 114 to 11 of 400.*
    - **Designer (2026-10-08):** multiple players backing factions should still make the invaders' ending possible, and when a majority back factions, likely. Together with the target above, the measure is the invaders' share by the number of backers at a table of five: 1 very hard, 2 about 40%, 3 or more likely.
    - *Bot profile rework (2026-10-08, after a review of the whole system):* competence, style and table are kept apart. Competence (one evaluator for every goal bot): island trophies counted directly, margins never scaled by an ending's chance, the threat of a rival's faction lead, and a win-chance measure normalised across the table (calibrated: round 1 predicts 20% and 20% happen; round 4's 15%, 25%, 43% came true 18%, 28%, 35%; very high late predictions are still over-confident). Style is two numbers: a lean toward factions or trophies that fades by round (varied a little each game) and stubbornness. Stances are now fluid: backers open on a faction (72% in round 1) and many give up late (30% still backing in round 5); trophy players sometimes join late (11% in round 5). Probes play out the real table with each bot's plan.
    - *Rules test with committed backers (never abandon their faction; 200 games each):* the invaders' ending with 1 backer 25%, 2 backers 43%, 3 backers 58.5%, 4 backers 67%. Two backers and a majority meet the targets; a lone backer at 25% is easier than "very, very difficult". That is a rules question (how well a lone faction holds presence against four players removing it). *Designer (2026-10-08): 25% is fine for now.*
- **Bots read the full state.** A bot that plays to win would have to be limited to its own player view for a fair game against people; for measuring cards, full state is used. *Open:* whether to limit them.
- **Smarter bots (designer, 2026-10-08: make the bots even smarter; a little cheating, the reply lookahead seeing the next hand, is fine for now).** Five search switches on the goal bots (`public/bots.js`, tuning, not rules), each tested as a challenger in seat 5 against backer, backer, goal, goal (200 games each; an even share is 20%):
  - *sim, play-out search:* its six best moves one move ahead (passing always among them), each played to the end of the round four times by fast goal bots, with shared randomness; passing and holding a card are judged like any other move. **49.9%** (the goal bots 15.0%).
  - *sets, access to the weakest colours:* for the island, standing and board influence with the factions of its weakest colours count (the access to their fights under IC1), fading out by the last round. sets=1 26.0%, **sets=2 29.3%**, sets=4 21.0%. Prompted by a game where a bot took 31 trophies, 18 of them Machines, and lost on a colour at 0 (designer: lots of trophies only matter with many complete sets).
  - *enum, every target listed* (up to 40 per card, sampling past it): 24.8%. *combo, hand-aware draft* (a card's worth after each kept card's best play): 24.3%. *hidden, face-down tokens counted* (its own as they are, a rival's as even odds of a bluff): 21.5%.
  - *All together* (sets=1): **57.9%**, with the most balanced sets of any bot (weakest colour 0.41, second 0.97, against 0.01 and 0.17 for the goal bots).
  - *Standard from 2026-10-09:* goal, goal-deep and backer carry all five (sets=2). Play-outs, the probes' imagined futures (`probeLite=1`) and the tests use `fast()`: the same persona without sim, enum or combo. A bot move now takes about a second; a deployed Worker's CPU limit may need the fast setting at bot-heavy tables.
  - *Play-out bug (found 2026-10-09):* the play-outs had every seat, the bot itself included, play as a trophy-leaning goal bot with a blank plan, so a backer imagined itself abandoning its faction and nobody imagined the backers backing. **Designer:** if the play-out doesn't take the bots' goals into account it is fundamentally broken; nothing else until it is fixed. *Fixed:* each seat plays its own profile (fast) and keeps the plan it holds (switch `table`, standard). Every figure measured with the play-out search before this fix (the challengers, the third card pass) carries the bug.
  - *Backers (designer, 2026-10-09: are backers losing because they play suboptimally, or because backing is harder? Tune until every bot plays strongly).* 10-game runs on backer, backer, goal, goal, goal, the same seeds each time:
    - After the play-out fix: backers 15% a seat (goal 23%), the invaders' ending 1 in 10. Presence 35 → 31 → 22 → 17 → 14 → 11: under the threshold by round 3. Backers back 70–85% in rounds 1–3, 25% and 15% in rounds 4–5.
    - *Holding on (designer's idea, Claude's switches `commit`, `allies`):* never abandoning kept them backing to the end (70% in round 5) but won less (5%); committing at double the chance, or counting fellow backers' push, no better (5–10%). They abandon because presence is already gone; holding on only loses harder.
    - *Guarding presence (`protect`, standard for backers at 4):* presence held at or over the threshold through round 4 (35 → 35 → 28 → 24 → 21 → 14) and backers stayed committed longer (65% in round 4), but presence still falls in the last round, when trophy players have no future to guard and take every fight. Reading: backers were partly playing suboptimally (not guarding presence); the last-round collapse may be structural (a design question, not settled).
    - *Guarding and holding (protect with commit=2, standard):* presence 35 → 35 → 28 → 25 → 25 → 20.3 and the invaders' ending 5 in 10 (target about 4 in 10 with two backers): the last-round collapse came from backers giving up, not from the rules. Backers still won only 3 of those 5; in the others a goal bot led the winning faction's standing.
    - *Backing the top faction (`top`, standard at 2):* the invaders' ending is won by the faction with the most presence (TH1), so backers value their faction being on top. Backers 30% a seat against goal 13% (top=1 22.5%/18.3%), with 4 island wins (fighting the faction's rivals earns trophies); the invaders' ending 3 in 10. **Answer to the designer's question:** backers were losing because they played suboptimally, not because backing is weak. Next: the goal bots' counter-play.
    - *Counter-play (10 games each):* trophy bots weighing a rival's invader chance more (`threat`) won 23% a seat at 2 and 30% at 3 (backers 15% and 5%); `sets=3` 26.7%. At threat 3 they took over the lead of the backers' faction: the invaders' ending 4 in 10, backers winning only 1. `threat=3` standard for trophy.
    - **Designer (2026-10-09):** if trophy players take up the faction, backers should respond by backing it harder once presence is no longer at risk. *Built as `race`:* a backer values its lead in its faction's net standing, weighted by how safe presence is. race=1 17.5%/21.7%, **race=2 20%/20%** (the invaders' ending 4 in 10, backers winning 3), race=4 15%/23.3%. `race=2` standard: the two profiles even and the designer's targets met, on 10 games; a 40-game confirmation follows.

### F.10 Single game

- **One Durable Object with a fixed name** holds the only game.
- **No lobby and no list of games.** A new deal replaces the game in progress.
- **Room to grow.** Supporting several games later means naming the Durable Object after a game id. Nothing else changes.

### F.11 Data file

- **All content and constants are data**, in one file, `spec.json`, read by the engine and the browser. The engine holds the rules; the data file holds everything the rules are applied to.
- **Tuning without code changes.** A number is changed in the data file and tested with the simulation. Nothing in the engine is rewritten.

#### How the file is laid out

| Section | What it holds |
|---|---|
| About the game | The game's name, a version label, and the seat limits: the fewest, the most, and the count the numbers were tuned for. |
| Constants | Every number in the rules, each under a plain name. |
| Board | The fixed layout of the board. |
| Content lists | One list for each kind of card or piece. Every entry has a short fixed id, a name to show, and its own properties. |
| Lookup tables | Anything a player would otherwise have to work out, stored ready-made so it can be shown directly. |
| Variants | The rule variants a host can choose between: which is the default, the list of choices, a sentence describing each, and any extra content or numbers a variant needs. |

#### How it is used

- **The state refers to content by id.** A hand holds card ids, not whole cards. The engine looks each one up in the data file when it needs the details.
- **Lookups are built once.** When the engine loads, it indexes each content list by id.
- **The seat limits are enforced from it.** Setting up a game checks the seat count against the limits in the file.
- **Notes for people sit beside the data.** Short descriptions in the file explain what an entry or a variant means, so the file can be read without the code.

#### For this game

- **Constants:** the balancing numbers in the current focus, such as the thresholds, starting presence, hand size, and number of rounds.
- **Content lists:** the locations with their archetypes, the factions, the slayer groups, and the cards with their player-count tiers.
- **Variants:** the candidate rules a host can switch between when dealing.

### F.12 File layout

```
public/
  index.html      the table
  app.css         styles
  app.js          client: draws one player view, sends moves, previews with the engine
  host.html, host.js   host page: deal games, choose options and bots, copy links
  assets.html, assets.js   assets page: every token, token, and sprite, and the palette
  pieces.js       presence tokens and influence cubes, drawn in CSS
  assets/         built art: sprites, token outlines, and their data file
  bots.js         the bots (goal, goal-deep, hunter), shared by the server and the scripts
  engine.js       the rules: createGame, validate, applyMove, resolve, playerView
  spec.json       all constants and content as data
src/
  worker.ts       routing, and the game's Durable Object: tokens, websockets, saving
test/             engine tests and a headless render of every phase
scripts/
  tournament.js   the tuning tournament: bot games, endings, economy, card plays and probes
  lib.js          shared by the tournament and the tests
  smoke.js        plays a whole game against a running server
  admin.js        create a game, list the magic links
assets/           art source: the palette and sprites as data, the build script, the art guide
docs/             this document, then the rules and implementation spec
wrangler.toml     Worker configuration
```

### F.13 Running and deploying

- **Locally:** `wrangler dev` runs the Worker, the Durable Object, and the static pages together, with hot reload.
- **Deploying:** the repository is connected to Cloudflare, so every push to the main branch builds and deploys.
- **Checks:** type checking, tests, and a trial bundle run on every push.

### F.14 Testing and scripts

These are strategies, described by what each is for.

| Strategy | What it checks |
|---|---|
| Engine tests | The rules, using worked examples: that legal moves give the expected result, that illegal moves are rejected with a reason, and that each seat's view hides what it should. |
| Render tests | That every phase can be drawn from a player view without error, run without a browser. |
| Tuning tournament | Whole games with bots, across every core: that games run start to finish, the figures for tuning the bots, the economy and the cards (with controlled probes), saved as it runs and resumable (`scripts/tournament.js`). |
| Smoke test | That a whole game can be played against a running server over websockets, end to end. |
| Admin script | Not a test: it deals a game and lists the magic links from the command line, using the same admin routes as the host page. It can be pointed at a local or a deployed server. |
| Checks on every push | Type checking, the tests, and a trial bundle of the Worker. |

- **The engine is tested first and most.** Because it is pure, it can be tested without a server or a browser, and it is the part that is rerun whenever a rule changes.

### F.15 Build order

Each stage can be tested before the next is started.

1. **The engine**, tested with the bot harness over thousands of games.
2. **The Worker**: routing, the Durable Object, tokens, websockets, saving, and sending each seat its view.
3. **The table**: the board and the panels for each phase.
4. **Play it.**

### F.16 Needed before building

- **A complete ruleset.** The engine can only implement rules with no open questions. The sample rulesets in Appendix E are the starting point, and they don't yet include the candidates added since.
- **An implementation spec.** A document that restates the rules as state, inputs, validation, and procedure, with a visibility table saying what each seat may see.
- **Seat count.** The prototype seats 3 to 5 players, with the card pool changing by player count (3.16).
- *Open:* whether the prototype allows undo.
- *Open:* how capable the bots need to be before their figures can be used for balancing.

### F.17 Art and rendering

How the prototype looks. The working detail, the asset list, and the art tools are in the repository's art guide, `assets/README.md`. This section does not add, change, or settle any rule of the game. Everything in it is a choice for the prototype, open to change, and none of it is to be applied to the rules.

#### The rule

| Tier | What | Drawn as |
|---|---|---|
| Pixel art | Whatever would be printed art in a physical production: illustrations, icons, location tiles, the art on a token or card | Pixel sprites at whole-number scales, never smoothed |
| UI | Whatever would be physical: boards, panels, cards, tracks, buttons | Clean, readable layout, not imitated |
| Physical pieces | A select few pieces that sit on the board: presence tokens, influence cubes | Objects that look real but clean: depth, edges, soft shadows |

#### Decided for the prototype

- **Style:** a small island town in a pixel-art RPG / animated-series style (1.5, 2.2).
- **Palette:** one palette of 32 colours for the game and the UI, listed in the art guide. Pixel art uses only the palette; the UI and the pieces take their colours from it and may shade them, but add no new hue.
- **Fonts:** Tiny5, a pixel face, for headings and labels; Rubik for everything else.
- **Presence on locations:** every location shows its presence visually, at a glance.
- **Faction presence:** one token per faction: cardboard cut to the outline of the faction's art, with the pixel art printed on the face and a visible card edge. In the rules, invaders are tokens at locations (3.4).
- **Player influence:** tokens in the player's seat colour, seen from above: a square top face with the near and right sides showing.
- **Archetype symbols:** drawn as pixel art: a moon and star for the Nocturnals, an alien head for 80's Sci-Fi, a power symbol for the Sentients, a skull for the Undead, and horns for the Demons. The characters ◐ ↂ ⏏ ☾ ⎈ remain as text shorthand in this document.
- **Board hexes:** each location is a flat hex tile with a border in its archetype's colours, its building at the top, its archetype's symbol at the bottom over the border, and the space between kept clear for presence tokens and influence cubes.
- **Prototype board, for testing only:** five regions of three locations, each region mixing three archetypes: Mountains (Weather Station, Ski Resort, Mine), Coast (Lighthouse, Shipping Docks, Fallout Bunker), Woods (State Park, Sawmill, The Lake House), Old Town (Beach City, Graveyard, Occult Camp), Badlands (Military Facility, Junkyard, Caves). The regions form a ring round a central lake, each touching exactly two others. This arrangement exists so the prototype has a board to play on. The designer accepted it as the first draft's map (2026-10-04); it is still not a decision and does not settle map design.
- **Slayer group art:** each group has a 16x16 emblem and a 160x64 banner for its player card. Banners are mood scenes with no people.
- **Prototype board art, for testing only:** the board is drawn as one island round the hexes, inside a framed rectangle of sea, and shown at night so the pieces stand out, with moonlight from the west. Details in `assets/README.md`.
- **Review:** the assets page shows the prototype board, every hex, token and token, every sprite against the content it draws, the player cards, and the palette.

#### Open

- *Open:* which palette colours are the five seat colours and the UI colours, and whether the UI is dark or light.
- *Open:* the asset list: which assets the prototype needs, at what sizes.
- *Open:* whether a location shows one token per unit, or one with a number.
- *Open:* how influence cubes are used on locations, which follows the influence rules (3.7, 3.13, 3.14).

---

## Appendix G: First draft ruleset

The first draft's picks (Current focus) restated as one ruleset, for prototyping only. It adds nothing that is not in the picks. Gaps are marked **To come with the cards** (step 2) or **Gap** (a question the picks leave open). Numbers in brackets are provisional and left to balancing.

### G.1 Components

- **The board:** one island (BD1) of 15 locations in five regions of three, ring-shaped round a central lake (layout D, the prototype map).
  - Mountains: Weather Station, Ski Resort, Mine. Badlands: Military Facility, Junkyard, Caves. Coast: Fallout Bunker, Shipping Docks, Lighthouse. Old Town: Graveyard, Beach City, Occult Camp. Woods: State Park, Sawmill, The Lake House.
  - Borders: Mountains–Badlands, Badlands–Coast, Coast–Old Town, Old Town–Woods, Woods–Mountains.
  - Each location is aligned with one archetype (2.5).
  - **Adjacent locations:** hexes that share a border. On layout D:

    | Location | Adjacent to |
    |---|---|
    | Weather Station | Mine, Ski Resort, State Park |
    | Ski Resort | Junkyard, Military Facility, Mine, Weather Station |
    | Mine | Junkyard, Ski Resort, State Park, The Lake House, Weather Station |
    | Military Facility | Caves, Junkyard, Ski Resort |
    | Junkyard | Caves, Fallout Bunker, Military Facility, Mine, Ski Resort |
    | Caves | Fallout Bunker, Junkyard, Military Facility, Shipping Docks |
    | Fallout Bunker | Beach City, Caves, Junkyard, Lighthouse, Shipping Docks |
    | Shipping Docks | Caves, Fallout Bunker, Lighthouse |
    | Lighthouse | Beach City, Fallout Bunker, Shipping Docks |
    | Graveyard | Beach City, Occult Camp, The Lake House |
    | Beach City | Fallout Bunker, Graveyard, Lighthouse, Occult Camp |
    | Occult Camp | Beach City, Graveyard |
    | State Park | Mine, Sawmill, The Lake House, Weather Station |
    | Sawmill | State Park, The Lake House |
    | The Lake House | Graveyard, Mine, Sawmill, State Park |
- **Factions:** five in play, one drawn at random from each archetype (3.4). Each has tokens in its own colour and its own supply. Factions play identically; there are no powers.
- **Players:** 3 to 5, each a slayer group linked to one archetype (3.10). Each player has cubes in their own colour (influence) and their own supply.
- **The card pool:** 21 unique, single-purpose cards (CU3), all used at every player count (PS1): five archetype suits of three cards each (SU1) and 6 others. Four of the 6 others are marked A, B, C and D (FP2); two are unmarked. **To come with the cards:** the cards themselves.
- **Hidden tokens and bluff tokens:** **to come with the cards** (IN1).

### G.2 General rules

- **Supply:** every colour has one supply. A player's cubes that leave the board return to that player, to be used again; a faction's tokens return to that faction, to be placed again.
- **No piece ever leaves the game.**
- **Cards only shift tokens:** a card never removes a faction's tokens from the board outright; it only moves them to other locations. Tokens leave the board only as fight casualties, or when a location is scorched.
- **A player's cubes** are always in one of three places: their supply, their standing with a faction (public influence), or on a location (influence there).
- **Two-faction limit (LL1):** a location holds at most two factions. No action may bring a third faction into a location.
- **Control (LC1, LC2):** factions control locations; players never do. A faction controls a location when it has the most tokens there. If two factions are tied there, the one aligned with the location controls it; otherwise no one does.
- **Moving factions:** any player can take an action that affects any faction's presence. Influence placed by such an action is spent from the player's standing with the faction being affected. **IC1 (D15):** that placement is a requirement: a move goes only as far as the player can pay for it, so a player with no standing with a faction can't move it with a card that places influence. (Variant: only a faction's influence leader can affect it, IL1.)
- **Influence leader:** the player with the most influence with a faction. Affinity breaks a tie for the most (AB1); otherwise all tied players are influence leaders. It decides where a short-supplied faction grows.
- **Affinity (AB1):** a slayer group has affinity for its archetype's faction and for that archetype's three locations. Affinity only breaks ties between players: affinity for a location in fights there, affinity for a faction in influence with it.
- **Hidden information:** hands are hidden. Influence with factions is public. Collected trophies are secret: everyone sees which pile a player takes, but not their running total (IN2).

### G.3 Setup

1. Draw one faction from each archetype.
2. **Seed the board (SD1):** each faction places [5] tokens on its home location, one of its archetype's three locations, and [1] token on each of the other two. Each faction's home location is drawn at random from its archetype's three. Every location starts with exactly one faction.
3. Each player takes a slayer group and their cubes [number to balance].
4. Each player starts with [some] influence with their linked archetype's faction. Factions with no linked player in the game start with every player at 0, so every player is their influence leader.
5. Shuffle the card pool (all 21 cards).

### G.4 The round

The game lasts a fixed number of rounds [to balance] (GL1). Each round has three phases (RS1).

#### 1. Draft (DR1–DR6)

- The whole card pool is drafted again every round (DR4). It is the whole set of actions; there are none outside it (DR6).
- Deal hands of 6 cards at 3 players, 5 at 4 and 4 at 5 (PS1). The cards not dealt (3, 1 or 1) are left out, unseen and never revealed (DR5).
- **Pick and pass (DR3):** each player keeps one card and passes the rest on. When a new batch arrives, the cards kept so far rejoin the hand, so a player ends each pass keeping one more card than before. A player may put any number of earlier picks back into the hand they pass on, taking that many extra from the batch they received.

#### 2. Play (TU1, FP1)

- **First player:** whoever holds the earliest marked card dealt (A, then B, C, D; FP2). They must open the round with that card. Play goes clockwise.
- On their turn a player plays a card or passes. Passing is not final: a player who passed can play when the turn comes back to them.
- The round ends when every player passes in a row (RE3). Cards still in hand are lost back to the pool (DR2).
- **To come with the cards:** what the cards do (3.7). The seeds:
  - *Gain influence (CA1):* move cubes from your supply into standing with a faction.
  - *Affect a faction's presence (CA2):* any faction, placing influence spent from your standing with it. Example: move a faction's tokens from one location to adjacent locations, and at each location moved to, place 1 influence spent from that faction, along with at least 1 of its tokens.
  - *Place without moving presence (CA3):* for example a trap; place tokens and 1 influence from your supply on a location.
  - Movement follows the regions (CN3): free within a region, and allowed into a neighbouring region. A region whose three locations are all scorched is impassable: nothing moves into or through it.
  - What the marked cards A to D do.

#### 3. Resolve

**Fights (FT1):** every contested location (one holding two factions) fights. Fights are independent, so their order doesn't matter (no spillover). Hidden tokens at a fighting location flip and take part (RQ5); **to come with the cards:** what they do.

For each fight:

1. **Outcome (FR5).** The larger group wins. The loser loses all its tokens there. The winner loses half the loser's number, rounded down, minimum 1.
2. **Tied fight (TF1, AL2).** If the groups are equal:
   - At a location aligned with one of the two factions, that faction wins, and the outcome is as above.
   - Otherwise it is a true tie: both groups are wiped out and the location is **scorched (TM1)**. It is no longer a location for the rest of the game, and the fight ends here: no trophies and no influence to any faction. Everything on it returns to its supply: both factions' tokens to their factions, all influence to each player (AT1), hidden tokens and any other pieces to their owners.
3. **Trophies (TD1).** The casualties form two piles, one per faction: the loser's tokens and the winner's losses.
   - The player with the most influence at the location (the leader) takes the bigger pile; the runner-up takes the smaller. If the piles are equal, the leader picks first.
   - Ties between players: a tied player with affinity for the location wins the tie. Otherwise the tie stands (PT2), and tied players collect nothing (ST1): a tie uses up every place the tied players were in line for. Tied leaders use up both places, so both piles return to their factions' supplies. Players tied for runner-up use up second place, so the smaller pile returns.
   - If only one player has influence at the location, they collect both piles (UP1). If no player has influence there, both piles return to their factions' supplies.
   - Players cannot decline a pile. Collected trophies are kept secret.
4. **Influence after the fight (AF3, adjusted).** Only the leader's influence leaves the location: half of it, rounded down, becomes their influence with the faction that won; the rest returns to their supply. Everyone else's influence stays. Tied leaders' influence returns to their supplies, with nothing gained (AS1); players tied for runner-up keep theirs at the location.

**Locations that don't fight:** influence there stays into the next round. Hidden tokens there stay face down (UT1).

**Growth (GR1, AL3):** after all fights, every location where a faction has at least [2] tokens gains 1 token of that faction from its supply. Each such location holds only one faction, since every contested location has just fought. A faction that controls a location aligned with its archetype gains 1 extra token there, but only where the location already grows. If a faction's supply runs short, it grows as far as its supply allows, and its influence leader chooses which locations grow (including any extra token from AL3). When the lead is tied, the tied influence leaders take turns placing one token each, in turn order from the first player.

### G.5 The end of the game

After the last round's resolve phase:

1. **Which side wins (TH1).** Count every invader token on the board. If the total is [more than 15], the invaders win; otherwise the island wins.
2. **The winning faction (FX1, FX2).** If the invaders win, the faction with the most tokens on the board wins. Tied factions: the one controlling more locations. Still tied: they all win together.
3. **The winning player (EG3).**
   - *A faction wins:* each player scores their influence with it minus their trophies of its colour. With factions winning together, players add up their scores with each. Highest score wins.
     - Ties (ET4, ET1): fewest trophies of the winning faction, then affinity for it, then compare scores with the faction next highest in presence, and so on down.
   - *The island wins (TS2):* each player scores the number of trophies they hold of the colour they have fewest of. Highest score wins.
     - Ties (WT1): compare the second-fewest colour, then the third, and so on.
   - Players still tied after every tiebreaker share the victory.

Avoiding fights is a bet that a faction wins (few trophies keep influence whole); fighting widely is a bet that the island wins (TS1).

### G.7 First-draft numbers for the prototype (2026-10-06)

Educated first guesses, made at the designer's request so bots can run simulations and refine them. Not decisions; each becomes a host-selectable variant in `spec.json`.

| Number | First guess | Reasoning |
|---|---|---|
| Rounds (GL1) | 5 | Enough for presence to swing from the start to the threshold band. |
| Presence threshold (TH1) | more than 20 | With about 10 presence moves a round, an earlier simulation put total presence at about 15–25 by round 3 and 10–17 by round 5; 20 sits in that band so the last round decides it. |
| Seeding (SD1) | 5 + 1 + 1 | As recorded; 35 tokens in all. |
| Growth threshold (GR1) | 2 | As recorded. |
| Tokens per faction | 20 | 7 on the board at setup, 13 in supply; trophies draining a supply still matters. |
| Each player's starting cubes | 20 | Moves place about 1–3 influence a turn and half comes back after a fight. *While the cards are designed (designer, 2026-10-07): 30 in the prototype, a bump so the supply rarely limits play; supply is a balancing concern for later.* |
| Starting influence with the linked faction | 3 | Two or three moves in round 1 before more must be gained. |
| Bluff tokens per player | 3 | One per hidden play; three hidden cards in the pool. |
| Marker cubes | MC3 | The designer's stated preference (from the player's supply, and back). |
| Slayer group per player | random (host may choose) | A default for bots. |

### G.8 Readings used in the prototype engine (2026-10-06)

Where a rule or card left a detail open, the engine (`public/engine.js`) uses the reading below. These are implementation choices for the prototype, listed so the designer can review them; none is a decision.

- **Placing influence with a move:** at each destination, 1 influence is placed per faction moved there, spent from the mover's standing with that faction, whenever they have any (it is not optional).
- **Draft:** each pass, a player keeps one more card than before from their kept cards plus the batch in front of them, and passes the rest to the next seat (DR3 with the put-back rule, as one choice). The last card of each batch is kept automatically, since there is no choice to make.
- **First player with no marked card dealt:** cannot happen at 4–5 players; at 3 players, if none is dealt, the first player rotates by round.
- **Partial actions:** a card with no legal target can still be played as an action for no effect.
- **Responses in the web prototype** *(out of the first draft from 2026-10-07; this describes the `responses` variant when on)*: a played action is *pending* until its player confirms; "before" responses (the cancel, Never Invite Them In) can be played while it is pending; "after" responses answer what the last action did, until the next card is played or a player passes. Each event is answered once. The cancel can't cancel a response, since responses resolve at once.
- **Taking a card back (web prototype):** until anyone answers it, the acting player can take a pending card back into their hand.
- **Leave Out Fresh Meat:** the largest group adjacent to the bait location that can enter moves in; ties go to the player's choice.
- **Track Them in the Snow:** the whole group sets off; each location entered gets 1 token and 1 influence; leftover tokens stay together where the chase stops, or at the start if it never moved; the chase never enters a location twice, nor returns to its start (provisional, picked for the prototype 2026-10-07).
- **Board Up the Windows:** the player divides the group across two or more adjacent locations as they like.
- **Spread a Virus:** tokens go to adjacent locations in map order, one each, as far as the group lasts.
- **Ring the Church Bell, Draw a Summoning Circle, Reroute the Power Grid:** groups move in, largest first, until the two-faction limit stops a group.
- **Reprogram the Traffic Lights:** groups move one at a time in map order; a group that can't enter stays.
- **Light Every Lamp:** when both factions at the location are the same size, either may be driven out, since neither is larger (provisional, picked for the prototype 2026-10-07).
- **Silver Bullets:** the loser already loses everything, so the winner loses 2 more.
- **Salt and Burn the Bones:** the winner loses everything too; both piles are handed out as trophies.
- **Hidden tokens:** the marker cube comes from the player's supply and counts as their influence at the location; it returns with the rest of that location's influence after the fight (MC3).
- **Short-supply growth:** the faction's influence leaders take turns placing one token each at a location still due growth, starting with the first leader in seat order.
- **End of the game, faction win:** a player's score is standing (influence held with the faction), minus trophies of that faction; influence still on locations doesn't count.

### G.6 Gaps to close

- **To come with the cards** (ideas so far in Appendix H): every card and what it does; how card uses combine; movement types; cards A to D; hidden tokens, bluffs and marker cubes (IN1, BT1, MC1–MC3).
- **Balancing:** rounds, the presence threshold, the growth threshold, seeding numbers, each player's starting cubes, and starting influence with the linked faction.

---

## Appendix H: Card catalogue

Every card idea, in one format. Entries are ideas for the first draft, not decisions, until the designer picks them. Cards follow the suit principles in 3.7.

**Shared wording**

- **Any faction:** a presence action can move any faction, with no token limit (3.7, principles 10 and 12; IL1 is out of the first draft).
- **Influence:** a presence action places 1 influence at each destination, spent from the player's standing with the faction moved. Under IC1 (D15) this is a requirement: each destination's move happens only if the player can pay its influence (variant `influenceRequired`, on by default; off is the old reading, where a player with no standing still moves and places none).
- **Infl.:** the influence a suit card gives with its suit's affinity faction when spent for influence instead (principle 7).
- **Kind:** concentrate (gather into one location; feeds growth), scatter (break into single tokens; stops growth), merge (force a fight), split (prevent a fight), pin (nothing enters or leaves), swap (two groups trade places), far push, relocate, fight math, timing, standing effect (lasts the round), block, influence, information, catch-up, rule-bend, sow (mancala), lure (the largest group comes), teleport, halve, conveyor, network jump, shove, mirror, leap.
- **Group:** all of one faction's tokens at one location.
- **Target (round 7 on):** every suit card's effect names its target. The player picks a *location target* (one of the suit's locations, any faction) or a *faction target* (the suit's faction, any location) (3.7, principle 14). Entries from round 7 give both readings.
- **(response)** entries are response ideas not yet attached to a card.
- **Round:** the revision round the idea came from.
- **Adjacent** (or "next to"): two locations are adjacent when their hexes share a border. On the prototype map that is always within a region or across the border of a neighbouring region (see G.1).

- **Fight math:** every fight-modifier card is a hidden action: it places a face-down token on its target, which flips when that fight resolves (IN1, HT1). The token goes on a location: a suit location, or a location holding the suit's faction.

**Columns:** Card · Slot (Strike, Shift, Signature, or – if unplaced) · Kind · Turn action · Response · Infl. · Round

### H.1 ◐ Nocturnals: Ski Resort, Fallout Bunker, Occult Camp

| Card | Slot | Kind | Turn action | Response | Infl. | Round |
|---|---|---|---|---|---|---|
| Leave Out Fresh Meat | Strike | Concentrate | Choose a ◐ location. Move any number of tokens of any faction from adjacent locations into it. | – | 2 | 1 |
| Hang Garlic and Wolfsbane | Shift | Scatter | Choose a ◐ location. A faction there is driven out, split across at least two other locations. | *Follow the Tracks:* when another player moves tokens, place 1 influence from your supply where they arrived. | 3 | 1 |
| Wait for Sunrise | Signature | Timing, scatter | Play only after you have passed this round. All Nocturnal tokens at one ◐ location flee to any locations in that region and the next. | – | 3 | 1 |
| Never Invite Them In | – | Pin | Choose a ◐ location. No faction can be moved into it this round. | – | – | 2 |
| Play the Howl Recording | – | Merge | Move a whole faction into a location in the next region that holds exactly one other faction. | – | – | 2 |
| Silver Bullets | – | Fight math | Mark a ◐ location. At this round's fight there, the Nocturnal faction loses 2 more tokens as casualties. | – | – | 3 |
| Track Them in the Snow | – | Far push, scatter | Choose a ◐ location. Take all of one faction's tokens there and drive them hex by bordering hex, leaving 1 token in each location they enter, like sowing in mancala, until none are left. Each location entered costs 1 influence, placed there from your standing with that faction; the path continues only while you have influence to place. A location it can't enter (two factions already, or scorched) ends the path. Tokens still left when the path ends stay together at the last location entered. | – | – | 3, 5 |
| (response) Stay Indoors | – | Influence | – | When another player moves tokens into a location where you have influence, move your influence there to an adjacent location. | – | 3 |
| Hold a Midnight Vigil | – | Influence, timing | Gain 2 influence with the Nocturnal faction, or 4 if you have already passed this round. | – | – | 4a |
| Join the Coven | – | Influence | Gain 2 influence with the faction controlling a ◐ location, plus 1 for each other ◐ location it controls. | – | – | 4a |
| Follow the Pack | – | Influence | Gain influence with the Nocturnal faction equal to the number of contested locations it is in (at least 1). | – | – | 4a |
| (response) Howl at the Moon | – | Timing | – | When any player passes, move any number of Nocturnal tokens from one location to an adjacent one. | – | 4c |
| Leave Out Fresh Meat (v2) | – | Lure | Choose a ◐ location or one adjacent to it. The largest group in any adjacent location moves in, all of it. The hungriest comes first. | – | – | 6 |
| Leave Out Fresh Meat (v3) | Strike | Lure | The largest group adjacent to the target moves into it, all of it. **Target:** the bait location. *Location:* bait a ◐ location; whoever is hungriest comes. *Faction:* bait anywhere; only the Nocturnals' largest adjacent group comes. | – | 2 | 7 |
| Track Them in the Snow (v2) | Signature | Sow | Drive the target group hex by bordering hex, leaving 1 token and 1 of your influence in each location entered; the chase lasts while you have influence with that faction; a blocked location ends it; leftover tokens stay together at the last location. **Target:** the group chased. *Location:* any faction's group at a ◐ location. *Faction:* a Nocturnal group anywhere. | – | 3 | 7 |
| Never Invite Them In (v2) | Shift | Block | Nothing can be moved into the target this round. **Target:** the threshold. *Location:* a ◐ location; no faction can enter. *Faction:* the Nocturnals; they can't be moved into any location they aren't already in. | – | 3 | 7 |
| Hold a Midnight Vigil (v2) | – | Influence, timing | Gain 2 influence with the target faction, or 4 if you have already passed this round. **Target:** the Nocturnal faction, or a faction controlling a ◐ location. | – | – | 7 |
| Stake Out the Den | – | Influence (move) | Move up to 3 of your influence from other locations to the target. **Target:** the den. *Location:* a ◐ location. *Faction:* a location holding the Nocturnals. | – | – | 8 |
| Wait for the Full Moon | – | Reinforce | Up to 3 tokens from the faction's supply join the target group. **Target:** the group. *Location:* any faction at a ◐ location. *Faction:* a Nocturnal group anywhere. | – | – | 10 |
| Chase Them Down the Slope | – | Slide | Choose a direction; the target group slides hex by hex that way until it reaches a location it can't enter, or the coast. **Target:** the group. *Location:* any faction at a ◐ location. *Faction:* a Nocturnal group anywhere. | – | – | 11 |
| Circle the Prey | – | Rotate | The groups round the target circle it: each moves one location on, clockwise, where it can enter. **Target:** the prey. *Location:* a ◐ location; any faction circles. *Faction:* anywhere; only Nocturnal groups circle. | – | – | 12 |
| Howl at the Moon | – | Gather from range | Every group of one faction two hexes from the target moves one hex closer (to a location next to it; one already holding that faction if it can). **Target:** where the howl rises. *Location:* a ◐ location; any one faction answers. *Faction:* anywhere; the Nocturnals answer. | – | – | 13 |

### H.2 ↂ 80's Sci-Fi: Military Facility, Weather Station, State Park

| Card | Slot | Kind | Turn action | Response | Infl. | Round |
|---|---|---|---|---|---|---|
| Broadcast a Signal | Strike | Concentrate | Move any number of tokens of one faction, from up to two locations anywhere on the island, into an ↂ location. Regions don't matter. | – | 2 | 1 |
| Leak the Documents | Shift | Scatter | Choose an ↂ location. A faction there scatters to at least two locations in that region or the next. | *Cut the Phone Lines:* when another player moves tokens into a location, send back as many of them as the influence you spend from your standing with that faction. | 3 | 1 |
| Lead Them to the Landing Site | Signature | Concentrate | Move tokens of any faction from locations next to an ↂ location into it. | – | 2 | 1 |
| Jam the Frequencies | – | Split | Choose a contested location in an ↂ location's region. Move one of its factions out to a neighbouring location, cancelling the fight. | – | – | 2 |
| Swap the Case Files | – | Swap | Two locations in an ↂ location's region trade their groups. | – | – | 2 |
| File a Records Request | – | Influence, information | Gain 2 influence with the Sci-Fi faction, and look at the cards left out this round. | – | – | 3 |
| Call in the Men in Black | – | Standing effect | For the rest of the round, tokens moved into an ↂ location by any player go to an adjacent location of your choice instead. | – | – | 3 |
| (response) Tinfoil Hats | – | Block | – | When another player's card would move tokens out of a location where you have influence, those tokens stay. | – | 3 |
| Call in the National Guard | – | Fight math, sink | Mark a contested location in an ↂ location's region. At this round's fight there, the winner loses as many tokens as the loser. | – | – | 4b |
| Beam Them Up | – | Teleport | Take one group from anywhere on the island and set it down at a location adjacent to an ↂ location. | – | – | 6 |
| Leak the Documents (v2) | – | Halve | Choose a group at an ↂ location. Half of it, rounded down, leaves for an adjacent location of your choice. | – | – | 6 |
| Broadcast a Signal (v2) | Strike | Concentrate | Call the groups of one faction from up to two locations anywhere into the target. **Target:** where they answer the call. *Location:* any faction, into an ↂ location. *Faction:* the Sci-Fi faction, into any location. | – | 2 | 7 |
| Beam Them Up (v2) | Signature | Teleport | Lift the target group and set it down at any location on the island. **Target:** the group taken. *Location:* any faction's group at an ↂ location. *Faction:* a Sci-Fi group anywhere. | – | 3 | 7 |
| Leak the Documents (v3) | Shift | Halve | Half the target group, rounded down, leaves for an adjacent location of your choice. **Target:** the group split. *Location:* any faction at an ↂ location. *Faction:* a Sci-Fi group anywhere. | – | 3 | 7 |
| Call in the Men in Black (v2) | – | Standing effect | For the rest of the round, tokens about to be moved into the target go to an adjacent location of your choice instead. **Target:** the cordon. *Location:* an ↂ location, against any faction. *Faction:* the Sci-Fi faction, wherever it is moved. | – | – | 7 |
| Raise the Force Field | – | Fight math, protection | Place a face-down token (and a bluff) on the target. At its fight, the winner loses no tokens. **Target:** *Location:* an ↂ location. *Faction:* a location holding the Sci-Fi faction. | – | – | 8 |
| Leak It to the Press | – | Halve, far | Half the target group, rounded down, goes to any location on the island it can enter. **Target:** the group split. *Location:* any faction at an ↂ location. *Faction:* a Sci-Fi group anywhere. | – | – | 9 |
| Turn On the Tractor Beam | – | Carry a fight | Both groups at the target are lifted together into an adjacent location with no tokens; the fight happens there. **Target:** the contest. *Location:* a contest at an ↂ location. *Faction:* a contest the Sci-Fi faction is in. | – | – | 10 |
| Crash-Land the Saucer | – | Chain reaction | Choose a direction; the target group moves one hex that way. Any group of another faction in its way is knocked one hex on, the same way, and so on down the line; a group with nowhere to go stays. **Target:** the group. *Location:* any faction at an ↂ location. *Faction:* a Sci-Fi group anywhere. | – | – | 11 |
| Follow the Lights | – | Follow the leader | The target group moves to an adjacent location; then a group of another faction next to that location may follow it in. **Target:** the leader. *Location:* any faction at an ↂ location. *Faction:* a Sci-Fi group anywhere. | – | – | 12 |

### H.3 ⏏ Sentients: Shipping Docks, Junkyard, Beach City

| Card | Slot | Kind | Turn action | Response | Infl. | Round |
|---|---|---|---|---|---|---|
| Spread a Virus | Strike | Scatter | Choose a ⏏ location. A faction there spreads into every other location in that region, at least 1 token each. | – | 2 | 1 |
| Reroute the Power Grid | Shift | Concentrate | Move any number of tokens of one faction from one region into a ⏏ location in that region or the next. | *Pull the Plug:* when another player spends a card for influence, they gain 1 less, and you gain 1 with the same faction. | 3 | 1 |
| Hack the Mainframe | Signature | Fight math | Mark a ⏏ location. At this round's fight there, the Sentient faction counts all its tokens in that region. | – | 3 | 1 |
| Reboot the System | – | Swap | Choose a ⏏ location. Its group trades places with the group at a location next to it. | – | – | 2 |
| Turn Them on Each Other | – | Merge | Move every token at a ⏏ location into a neighbouring location that holds exactly one other faction. | – | – | 2 |
| Phishing Email | – | Influence, catch-up | Gain influence with the Sentient faction equal to the number of players with more influence with it than you (at least 1). | – | – | 3 |
| Trigger an EMP | – | Pin | Choose a region with a ⏏ location. No tokens move into, out of or within it this round. | – | – | 3 |
| (response) Firewall | – | Influence | – | When another player places influence at a location where you have influence, place 1 from your supply there too. | – | 3 |
| Overload the Generator | – | Fight math, sink | Mark a ⏏ location. At this round's fight there, each group loses 2 more tokens as casualties. | – | – | 4b |
| Reprogram the Traffic Lights | – | Conveyor | Choose a region with a ⏏ location and one of the six hex directions. Every group in that region moves one hex that way, where it can. | – | – | 6 |
| Back Up to the Cloud | – | Network jump | Move a group from one ⏏ location to another ⏏ location, however far apart. | – | – | 6 |
| Spread a Virus (v2) | Strike | Scatter | The target group puts 1 token into every adjacent location it can enter, as far as its tokens go. **Target:** the infected group. *Location:* any faction at a ⏏ location. *Faction:* a Sentient group anywhere. | – | 2 | 7 |
| Reprogram the Traffic Lights (v2) | Shift | Conveyor | Choose one of the six hex directions; every group of the target moves one hex that way, where it can. **Target:** *Location:* every group in a ⏏ location's region. *Faction:* every Sentient group on the island. | – | 3 | 7 |
| Back Up to the Cloud (v2) | – | Network jump | Move the target group across the network, however far. **Target:** the group moved. *Location:* any faction's group, from one ⏏ location to another. *Faction:* a Sentient group, to any location holding another Sentient group. | – | – | 7 |
| Hack the Mainframe (v2) | Signature | Fight math | At this round's fight at the target, the target faction also counts its tokens in the rest of that region. **Target:** *Location:* a ⏏ location; you choose which faction there benefits. *Faction:* the Sentients, at any fight they're in. | – | 3 | 7 |
| Hijack the Feed | – | Fight math, trophies | Place a face-down token (and a bluff) on the target. At its fight, the token's owner counts their influence there twice when the trophies are handed out. **Target:** *Location:* a ⏏ location. *Faction:* a location holding the Sentients. | – | – | 8 |
| Spread a Virus (infectious) | – | Scatter, attrition | As Spread a Virus (v2); where a token joins another faction, that faction loses 1 token to its supply. **Target:** the infected group. *Location:* any faction at a ⏏ location. *Faction:* a Sentient group anywhere. | – | – | 9 |
| Reprogram the Drones | – | Defect | Up to 3 tokens of the target group change sides: they join the other faction at that location (swapped through the supplies). **Target:** the group that defects. *Location:* a group in a contest at a ⏏ location. *Faction:* a group fighting the Sentients; its tokens become Sentients. | – | – | 10 |
| Livestream the Fight | – | Fight math, double trophies | Place a face-down token (and a bluff) on the target. At its fight, each trophy pile is doubled from its faction's supply. **Target:** *Location:* a ⏏ location. *Faction:* a location holding the Sentients. | – | – | 11 |
| Install the Cameras | – | Influence (place, spread) | Place 1 influence at the target and at each location next to it that holds tokens, each spent from your standing with a faction there (the one you hold most). **Target:** the hub. *Location:* a ⏏ location. *Faction:* a location holding the Sentients. *Revised in round 17 (designer adopted): the influence comes from your supply, not your standing.* | – | – | 12 |

### H.4 ☾ Undead: Sawmill, Mine, Graveyard

| Card | Slot | Kind | Turn action | Response | Infl. | Round |
|---|---|---|---|---|---|---|
| Ring the Church Bell | Strike | Concentrate | Choose a ☾ location. Move any number of tokens of any faction from adjacent locations into it. | – | 2 | 1 |
| Board Up the Windows | Shift | Scatter | Choose a ☾ location. A faction there is turned away, split across at least two other locations. | *Hold a Séance:* when a hidden token is placed, look at it, or look at the cards left out this round. | 3 | 1 |
| Consecrate the Ground | Signature | Fight math | Mark a location in a ☾ location's region. This round a true tie there doesn't scorch it; both groups are still wiped out. | – | 3 | 1 |
| Lead Them Over the Cliff | – | Far push | Move a whole faction from a ☾ location through the next region and into the one beyond. | – | – | 2 |
| Draw the Salt Line | – | Pin | Choose a ☾ location. Nothing moves in or out this round. | – | – | 2 |
| Salt and Burn the Bones | – | Fight math | Mark a ☾ location. At this round's fight there, both groups lose all their tokens; trophies are handed out as normal and the location is not scorched. | – | – | 3 |
| Chainsaw Through the Horde | – | Merge | Move every token of any faction from locations adjacent to a ☾ location into it, if it holds exactly one faction. | – | – | 3 |
| (response) Ouija Board | – | Information | – | When a player spends a card for influence, look at one player's trophies. | – | 3 |
| Lead the Horde | – | Shove | Move a whole group into an adjacent location. If that would make three factions there, the smaller group already there is shoved on to an adjacent location of your choice. | – | – | 6 |
| Ring the Church Bell (v2) | Strike | Concentrate | Every token in adjacent locations is drawn into the target. **Target:** where the bell rings. *Location:* a ☾ location; any faction comes. *Faction:* anywhere; only Undead tokens come. | – | 2 | 7 |
| Lead the Horde (v2) | Shift | Shove | Move the target group into an adjacent location; if that would make three factions there, the smaller group already there is shoved on to an adjacent location of your choice. **Target:** the horde. *Location:* any faction's group at a ☾ location. *Faction:* an Undead group anywhere. | – | 3 | 7 |
| Salt and Burn the Bones (v2) | Signature | Fight math, sink | At this round's fight at the target, both groups lose all their tokens; trophies are handed out as normal and the location is not scorched. **Target:** *Location:* a ☾ location. *Faction:* any fight the Undead are in. | – | 3 | 7 |
| Draw the Salt Line (v2) | – | Pin | Nothing moves into or out of the target this round. **Target:** *Location:* a ☾ location. *Faction:* the Undead; none of their tokens can move. | – | – | 7 |
| Take Over the Wake | – | Influence (place) | Place up to 3 influence at the target, spent from your standing with a faction there. **Target:** the wake. *Location:* a ☾ location. *Faction:* a location holding the Undead. *Retired 2026-10-08 (designer): replaced by Wake the Dead (round 18).* | – | – | 8 |
| Hear the Banshee Wail | – | Repel | Every group next to the target is driven one hex straight on, away from it, where it can enter. **Target:** where she wails. *Location:* a ☾ location; any faction is driven. *Faction:* anywhere; only Undead groups are driven. | – | – | 10 |
| Lay Them to Rest | – | Fight math, no trophies | Place a face-down token (and a bluff) on the target. At its fight, no one takes trophies; the tokens lost go back to their supplies. **Target:** *Location:* a ☾ location. *Faction:* a location holding the Undead. *Revised in round 17 (designer adopted): at its fight, the token’s owner takes the smaller pile; the rest go back to their supplies.* | – | – | 11 |
| Drag Them Under | – | Meet | The target group and a neighbouring group of another faction are both dragged into a location next to them both. **Target:** the first group. *Location:* any faction at a ☾ location. *Faction:* an Undead group anywhere. | – | – | 12 |

### H.5 ⎈ Demons: Caves, Lighthouse, The Lake House

| Card | Slot | Kind | Turn action | Response | Infl. | Round |
|---|---|---|---|---|---|---|
| Read from the Book | Strike | Relocate | Move whatever faction is at a ⎈ location, all of it, to locations in that region or the next. | – | 2 | 1 |
| Perform an Exorcism | Shift | Scatter | Choose a ⎈ location. A faction there is driven out, split across at least two other locations. | *Sign in Blood:* when another player spends influence from a faction, gain 1 influence with the Demon faction. | 3 | 1 |
| Draw a Summoning Circle | Signature | Concentrate | Move any number of Demon tokens from neighbouring regions into one ⎈ location. | – | 3 | 1 |
| Smash the Mirror | – | Swap | The groups at two ⎈ locations trade places. | – | – | 2 |
| Light Every Lamp | – | Split | Choose a contested location in a ⎈ location's region. The faction with fewer tokens is driven to a neighbouring location. | – | – | 2 |
| Make a Deal at the Crossroads | – | Influence, catch | Gain 4 influence with the Demon faction; the player with the least influence with it gains 1. | – | – | 3 |
| Burn the Book | – | Rule-bend | Choose a contested ⎈ location. Its fight doesn't happen this round; both factions stay. | – | – | 3 |
| (response) Speak Its True Name | – | Influence | – | When a card's action targets a location where you have influence, move that influence to your standing with the faction there. | – | 3 |
| Set the House on Fire | – | Fight math, sink | Mark a ⎈ location. Any fight there this round counts as a true tie: both groups are wiped out and the location is scorched. | – | – | 4b |
| Smash the Mirror (v2) | – | Mirror | Move a group at a ⎈ location to its reflection across the lake, or bring one from the reflection. On layout D: Lighthouse and State Park, The Lake House and Fallout Bunker; Caves has none. | – | – | 6 |
| Light Every Lamp (either side) | – | Split | At a contested location, either faction is driven to an adjacent location of your choice, so the fight there doesn't happen. **Target:** the faction driven out. *Location:* either faction at a contested ⎈ location. *Faction:* the Demons, wherever they are contested. | – | – | 9 |
| Open the Pit | – | Remove | The target group, 3 tokens or fewer, falls in: its tokens go back to its supply. **Target:** the group. *Location:* a small group at a ⎈ location. *Faction:* a small group sharing a location with the Demons. *Revised in round 17 (designer adopted): the group falls through to any location in its region it can enter, instead of being removed.* | – | – | 10 |
| Trade Souls | – | Swap, far | The target group trades places with any other group on the island (of another faction). **Target:** the first soul. *Location:* any faction at a ⎈ location. *Faction:* a Demon group anywhere. | – | – | 11 |
| Invert the Pentagram | – | Fight math, reversal | Place a face-down token (and a bluff) on the target. At its fight, the smaller group wins. **Target:** *Location:* a ⎈ location. *Faction:* a location holding the Demons. | – | – | 12 |
| Read from the Book (v2) | – | Leap | Move a group at a ⎈ location over an adjacent location into the one beyond it, in a straight line. | – | – | 6 |
| Read from the Book (v3) | Strike | Leap | The target group leaps over an adjacent location into the one beyond it, in a straight line. **Target:** the possessed group. *Location:* any faction's group at a ⎈ location. *Faction:* a Demon group anywhere. | – | 2 | 7 |
| Smash the Mirror (v3) | Signature | Mirror | The target group passes to its reflection across the lake (G.1; locations with no reflection can't be used). **Target:** the group reflected. *Location:* any faction's group at a ⎈ location. *Faction:* a Demon group anywhere. | – | 3 | 7 |
| Light Every Lamp (v2) | Shift | Split | At a contested location, the target faction is driven to an adjacent location of your choice, so the fight there doesn't happen. **Target:** the faction driven out. *Location:* the smaller faction at a contested ⎈ location. *Faction:* the Demons, wherever they are contested. | – | 3 | 7 |
| Set the House on Fire (v2) | – | Fight math, sink | Any fight at the target this round counts as a true tie: both groups are wiped out and the location is scorched. **Target:** *Location:* a ⎈ location. *Faction:* any fight the Demons are in. | – | – | 7 |
| Sign the Contract | – | Fight math, trophies | Place a face-down token (and a bluff) on the target. At its fight, the bigger trophy pile goes to the runner-up and the smaller to the leader. **Target:** *Location:* a ⎈ location. *Faction:* a location holding the Demons. *Revised in round 17 (designer adopted): the token’s owner takes the bigger pile and the leader only the smaller; the owner pays 2 standing with the Demons.* | – | – | 8 |

### H.6 Unsuited extras

To come later: spice, balance and swing for the suited cards, inspired by Inis's unique effect cards (3.7). Four are marked A to D (FP2).

**The unsuited cards (2026-10-08).** The scaffold placeholders (2026-10-06: A moved up to two groups, B one group up to two hexes, C one group, D half a group) are removed (designer). Like all extras these have no influence use.

| Card | Effect |
|---|---|
| Set a Trap (A; designer, 2026-10-08) | Hidden: place a face-down token (and a bluff) on the target. At its fight, the token's owner takes every pile, whoever leads. **Target:** any location. Claim the Spoils (round 15) renamed and made A, then made hidden with a bluff (designer). The first Set a Trap (round 18: the first group to move into a named location lost half to you) was removed: a rival could spring it with a small group, or its owner with a big one, so it fell flat as the round's opening play. |
| B | Open: no card yet. |
| Lock Down the Town (C; round 19, designer adopted 2026-10-08) | Name a region; this round, no group moves into or out of it. **Target:** a location in the region. |
| Put a Bounty On It (D; round 19, designer adopted 2026-10-08) | Name a faction; at every fight this round, its group loses 1 more token when it wins, into the trophy piles. **Target:** the faction. |
| Plan B (pivot; draft wording, in the prototype from 2026-10-07) | Move up to 3 of your influence from other locations to one location. One copy (designer, 2026-10-08): Switch to Plan B and Change the Plan were the same card. |
| Unmarked | Open: no card yet. The Cancel is removed entirely (designer, 2026-10-08). |

*Prototype:* while B and the second unmarked slot are open, each game fills them at random from the unmarked unsuited cards (test cards included), so the pool stays at 21 and the draft still leaves cards out (DR5). Not a rule.

**Pivot cards (designer, 2026-10-07).** One or more of the unsuited extras are pivot cards: a "pivot" or "plan B" theme, moving the player's own influence (never another player's, D13). This replaces the ◐ idea Stake Out the Den (round 8) as the home of that move. Draft wording to measure (suggestion): *Switch to Plan B:* move up to 3 of your influence from other locations to one location. Measured as a test card (200 states, 5 players): battle 2.1, usable in 46% of states, control taken 0.4, influence moved 1.3; with `influenceToBoard=on`, 4.1, 73%, 0.7 and 2.4.

**Round 14 test cards (2026-10-07; suggestions):** Stake Out (the designer's seed), Bail Out, Fall Back, Call for Backup (Seize the Moment ruled out). Round 15: Steal Their Playbook, Claim the Spoils, Call a Truce, Lay a Trail. Measured in H.7, rounds 14 and 15; a mixed deck can deal them in the two unmarked slots.

*Designer (2026-10-07):* the scaffold moves A to D are boring. They stay only as placeholders until unsuited designs replace them.

### H.7 Notes from the revision rounds

*Scores reset (designer, 2026-10-07): every measured figure in these notes is naive (one-move measures, or whole rounds with untuned bots) and is kept as history only. Current focus 4 has the tuning process.*

- Round 1: the three scattering Shift cards (Hang Garlic, Board Up the Windows, Perform an Exorcism) are near twins.
- Round 2 added pins, merges, splits, swaps and a far push, so each suit can hold different kinds of action. A suggested swap-in: Never Invite Them In for Hang Garlic; Draw the Salt Line or Board Up the Windows, not both; Smash the Mirror or Light Every Lamp for Perform an Exorcism; Turn Them on Each Other for Spread a Virus.
- Round 3 filled gaps: responses (only five so far), slayer actions that gain influence (principle 2), and bigger rule-bends. New kinds: standing effects that last the round, blocks, moving influence, catch-up influence, information, and a presence sink (Salt and Burn the Bones), which matters because presence only falls through fights. Burn the Book postpones a fight, which bends FT1.
- Round 4a, Nocturnal influence: Hold a Midnight Vigil (rewards passing, so it pairs with Wait for Sunrise), Join the Coven, Follow the Pack.
- Round 4b, presence sinks: Call in the National Guard (one-for-one losses), Overload the Generator (+2 losses each side), Set the House on Fire (forces a true tie, so it scorches). With Silver Bullets and Salt and Burn the Bones, every suit now has a sink idea. Sinks are the island's main tool, since cards never remove tokens.
- Round 4c, responses: the response ideas now cover distinct jobs. Protect tokens (Tinfoil Hats); redirect a move (Cut the Phone Lines); tax influence (Pull the Plug); information (Hold a Séance, Ouija Board); piggyback influence (Firewall); pull influence to safety (Stay Indoors, Speak Its True Name); feed an affinity faction (Sign in Blood); act on a pass (Howl at the Moon). Follow the Tracks duplicates Firewall and could be dropped.
- Round 4d, a candidate full set: see H.8.

- Round 6, unique moves (principle 13): each presence effect gets its own way of moving, so whoever holds it has a gambit nobody else does. Sow (Track Them in the Snow), lure (Fresh Meat v2), teleport (Beam Them Up), halve (Leak the Documents v2), conveyor (Reprogram the Traffic Lights), network jump (Back Up to the Cloud), shove (Lead the Horde), mirror (Smash the Mirror v2), leap (Read from the Book v2). Mirror and leap depend on the map's geometry, so they are prototype-map specific.

- Responses after the 2026-10-06 principles (few; thematic; apart from the one cancel, never just undoing or altering token locations): Cut the Phone Lines and Howl at the Moon move tokens, so they don't fit as written. Tinfoil Hats (tokens stay put) is a block, which fits. The influence, information and tax responses (Firewall, Stay Indoors, Speak Its True Name, Hold a Séance, Ouija Board, Pull the Plug, Sign in Blood) still fit.

- Round 7, two-target rewrites (principle 14): the strongest ideas rewritten so each names its target and reads two ways. The location reading fights over the suit's ground with any faction; the faction reading pushes the suit's monster anywhere. Some effects change character between readings: Reprogram the Traffic Lights moves one region or the whole Sentient network; Back Up to the Cloud jumps between ⏏ locations or between Sentient groups; Never Invite Them In shuts a door or bars the Nocturnals from new ground. Twenty cards across the five suits have round 7 versions; a Set v2 can be picked from them.

- Hidden effects must apply to whatever fight happens at their location, never only if a particular faction is in it (3.11). Round 7 entries that need rewording: Hack the Mainframe ("the target faction counts its tokens in the region") and the faction readings of Salt and Burn the Bones and Set the House on Fire ("any fight the Undead/Demons are in"). Under the placement rule their faction reading becomes "a location holding the suit's faction", and the effect must work on whichever two factions end up fighting there.

- Round 8 (2026-10-07; suggestions, driven by Claude at the designer's request): aimed at the top two criteria of the strength ranking (Current focus 4), where the data showed gaps: taking influence control of a contested location (Stake Out the Den, Take Over the Wake: influence moved or placed without moving tokens) and shaping big fights, including for the invaders (Raise the Force Field: protection; Hijack the Feed and Sign the Contract: trophy redirection). Measured as never-dealt test cards (`spec.testCards`, `scripts/balance.js`, 200 states, 5 players): all five score low on every measure (battle 1.1–1.7, control 0.2–0.5). They are capped by the influence economy, not their wording: in rounds 1–2 most fights have no player influence at them (see Current focus 4). Unique and slightly rule-breaking: Stake Out the Den (moves the player's own influence, which nothing else does; D13 forbids moving anyone else's. Designer's seed for its theme: a "pivot" or "plan B"), Sign the Contract (reverses TD1's pile order), Hijack the Feed (bends the ranking).

- Round 9 (2026-10-07; suggestions, driven by Claude at the designer's request): one change each to the three weakest movers on battles (Leak, Lamps, the Virus), to see whether their wording or their situation holds them back. Measured as test cards against the dealt versions (200 states, 5 players; battle score, then with `influenceToBoard=on`):
  - Leak It to the Press (half the group goes anywhere): 7.3 against Leak's 5.3; 7.9 against 5.6. The only clear gain, and it lands mid-pack (near Reroute and Board Up). Leak's limit was its reach.
  - Light Every Lamp (either side): 4.7 against 4.3; 6.4 against 5.6. Lamps has a target in only 55% of states (a contested ⎈ location, or a contested Demon group). Its limit is how often it can be played, not which side it drives out.
  - Spread a Virus (infectious): 4.3 against 5.0; 4.7 against 5.3. Worse: taking tokens off the board outside a fight shrinks the fights and so the trophies at stake. Attrition works against criterion 1 as measured.
  - Elsewhere in the same run, with the deck as it stands (pivots in, responses out): the pivots score 2.3 battle and can be played in 44% of states (4.3 and 87% with `influenceToBoard=on`); the unsuited scaffold moves A to C still outscore every suit card (A: 24.1).

- Round 10 (2026-10-07; suggestions, driven by Claude). Designer's direction for the rounds: no dialling in on any one card unless something about it is very compelling; each round brings new ideas and looks for the most unique candidates that are balanced well and on the strong side. Five moves no card makes: reinforce from supply (Wait for the Full Moon), carry a whole fight elsewhere (Turn On the Tractor Beam), change tokens' side (Reprogram the Drones), push away, the Bell's opposite (Hear the Banshee Wail), and remove a small group (Open the Pit). Battle score (with `influenceToBoard=on` in brackets), how often it can be played, against Broadcast 16.4, the Bell 11.3, Reroute 9.0 and Lamps 4.3:
  - Hear the Banshee Wail: 7.4 (8.2), 79%. The strongest of the round, near Reroute. Unique and readable.
  - Turn On the Tractor Beam: 5.9 (6.9), 53%, largest 40. It changes who wins the trophies, not the fight: the same fight happens where other players hold the influence (its presence swing is near 0). The most unique of the round; strong when it can be played.
  - Reprogram the Drones 2.9 (2.8); Wait for the Full Moon 1.9 (3.1); Open the Pit 0.8 (1.5). Weak.
  - A finding about the system: cards that change a group's size score low, and cards that move whole groups score high. A fight's trophies are its tokens lost, so adding tokens rarely flips a winner, and taking tokens away shrinks the prize (as with the infectious Virus in round 9). Open the Pit is weak by construction: it only reaches small groups, so small fights.

- Round 11 (2026-10-07; suggestions, driven by Claude). Leaning into what scored well (moving whole groups, changing who collects), plus two open entries from H.9 (chain reaction; double trophies) and trophy denial. Battle score and how often playable, against Reroute 9.0:
  - Chase Them Down the Slope (slide in a line until stopped): 9.9, 91%.
  - Trade Souls (a group trades places with any group of another faction): 9.6, 97%; it moves more pieces than any suit card (12.8). Swaps never make three factions, so it can almost always be played.
  - Crash-Land the Saucer (chain reaction: knocks groups on down a line): 8.5, 93%; 8.8 pieces moved.
  - Livestream the Fight (double trophies) 1.6 and Lay Them to Rest (no trophies) 0.8: like every hidden token so far, low and playable in about 60% of states. Trophy effects only matter where players hold influence at a fight, which is rare early (Current focus 4).
  - The card review on the assets page (`/assets`, Cards) now shows every card the engine can play, deck and test cards, drawn as the table draws them and tagged with these measures (designer, 2026-10-07: every new card the engine can play goes there for review).

- Round 12 (2026-10-07; suggestions, driven by Claude). More unique movers, one card aimed at control (criterion 2, which only Track serves well), and a reversal token. Battle score and how often playable:
  - Follow the Lights (H.9's open "follow the leader": a group moves next door and a group of another faction follows it in): 15.1, 93%; 10.1 pieces moved. Close to Broadcast (16.4), the strongest new idea in rounds 8 to 12. It makes a fight wherever two groups are near each other.
  - Circle the Prey (the groups round a location rotate one step): 10.5, 96%; 9.6 moved, largest 48.
  - Drag Them Under (two neighbouring groups pulled into a third location next to both): 8.1, 87%.
  - Install the Cameras (1 influence at the target and each occupied neighbour): influence placed 2.8 in every state, but control only 0.6, below Track (1.6). Spreading influence thin rarely makes you the top player at a contest.
  - Invert the Pentagram (the smaller group wins): 2.3, the best hidden token so far (largest 26), still capped by the token's 59% reach.

- Round 13 (2026-10-07; suggestions, driven by Claude). Four movement ideas from earlier rounds that were never built, now measured (Back Up to the Cloud v2, Lead the Horde v2, Read from the Book v2 and Smash the Mirror v2; the last two given two-target readings for the test), and one new one, Howl at the Moon (every group of one faction two hexes out moves one hex closer). Battle score and how often playable:
  - Howl at the Moon: 9.9, 97%.
  - Lead the Horde (shove): 8.4, 100%. Read from the Book (leap): 7.6, 100%, largest 45.
  - Back Up to the Cloud (network jump): 5.8; Smash the Mirror: 4.7. Fixed destinations limit them.
  - Why hidden tokens score low in every round: placing one takes a cube from your supply (MC3), and by round 3 half of players have none left (rounds 1 to 5: 0%, 8%, 51%, 78%, 80% of turns with an empty supply; 40 bot games, 5 players). Their effects are not what holds them back. See Current focus 4.

- *Designer (2026-10-07), on rounds 9 to 13:* cards that change a group's size (add, remove or convert tokens: Wait for the Full Moon, Reprogram the Drones, Open the Pit, the infectious Virus) seem underpowered, and boring too. Later rounds look elsewhere.

- *Mixed decks (designer, 2026-10-07):* playtests now draw each game's suit cards at random, one per slot, from the deck and the test cards (host option `deck`, mixed by default), with 2, 3 and 4 influence across each suit, the weakest card printing the most (D12). The test cards' slots are provisional, assigned by Claude from 3.7's definitions (Strike makes a contest, Shift concentrates or scatters, Signature bends a rule), and the designer can overrule any of them:
  - Strike: Chase Them Down the Slope, Crash-Land the Saucer, Follow the Lights, Spread a Virus (infectious), Drag Them Under, Read from the Book.
  - Shift: Howl at the Moon, Leak It to the Press, Back Up to the Cloud, Hear the Banshee Wail, Lead the Horde, Light Every Lamp (either side).
  - Signature: Wait for the Full Moon, Circle the Prey, Raise the Force Field, Turn On the Tractor Beam, Hijack the Feed, Reprogram the Drones, Livestream the Fight, Install the Cameras, Take Over the Wake, Lay Them to Rest, Sign the Contract, Open the Pit, Trade Souls, Invert the Pentagram, Smash the Mirror.
  - Bots can play every test card (a random walk through the table's choices); in 40 bot games with mixed decks, all 27 test cards were dealt and played.

- Round 14 (2026-10-07; suggestions, driven by Claude, from the designer's seeds): the unsuited extras. *Designer:* unsuited cards should have unique abilities that no faction card offers, such as moving your own influence (as Plan B does); in general they should score high on strength; valuable influence actions should score very highly too, for example a card A like "Stake Out" that places a large amount of influence on a single location. Five built as test cards (slot `extra`, no influence use), measured with Switch to Plan B and the scaffold moves (200 states, 5 players, smart bots; battle, control, influence placed, playable):
  - Stake Out (designer's seed; amount 4 as a starting number, in `spec.json`): place 4 influence from your supply on any location. 3.0, 0.8, 3.5, 90%: the most influence placed and as much control as any card, with Broadcast a Signal (0.8).
  - Bail Out: move all your influence at one location to any other location. 1.9, 0.3, 1.0, 59%.
  - Fall Back: move all your influence from every location next to the target into it. 1.1, 0.2, 1.3, 59%.
  - Call for Backup: double your influence at the target, the extra from your supply. 0.2, 0.1, 0.8, 50%.
  - Seize the Moment: take another turn right away. Scores 0. (Ruled out by the designer; see below.)
  - For comparison: Switch to Plan B 2.0, 0.4, 1.3, 59%; scaffold A 23.5, 1.6; Broadcast a Signal 17.8, 0.8.
  - *Finding:* on the current measure, influence-only cards can't reach the strength of cards that move tokens. Battle counts trophies changing hands and fights whose winner flips; moving tokens changes the fights themselves, while influence only changes who collects. Influence cards also need influence already on the board (about 59% of states), except Stake Out, which draws on the supply. Measuring influence cards "very high" needs either bigger amounts or a measure that values control and influence placed more (the strength ranking is the designer's call).
  - *Prototype:* in a mixed deck, the two unmarked unsuited slots now draw at random from every unmarked unsuited card (the pivots and these test cards); A to D stay.
  - *Designer (2026-10-07), on Seize the Moment:* a card that only gives another turn is the same as having played the other card. Ruled out and removed from the test cards.

- *Designer (2026-10-07), on the marked cards A to D:* keep the idea that these cards set turn order (FP2); they just have to be more interesting. Their actions should make sense as a first move, thematically and mechanically: something with the potential to set a big gambit for the round, or shake up the meta. B, C and D won't always be played as opening moves; A, when it is dealt, always is.

- Round 15 (2026-10-07; suggestions, driven by Claude): unsuited ideas aimed at the marked slots, each something no faction card does. Measured on every turn (200 states) and, with the new `opening=1` option of `scripts/balance.js`, on each round's first play only (100 states); battle score, all turns / opening:
  - Steal Their Playbook: play the action of the last card played, as if it were yours. 11.1 / 5.3 (playable 83% / 60%; as an opener it copies the last card of the previous round).
  - Claim the Spoils: at this round's fight at the target, you take every pile, whoever leads. 4.6 / 0.2. *Designer (2026-10-08): it can't be played as your last card in hand. It is open information (the claim is visible). Later the same day: renamed Set a Trap and made marked card A, without the last-card rule.*
  - Call a Truce: no fight at the target this round; both groups stay. 3.1 / 0.1.
  - Lay a Trail: move a whole group into a location where you alone have the most influence, from next door. 3.5 / 2.3 (playable 40% / 36%).
  - Round 14's influence cards as openers: Stake Out 0.1 (it still places the most influence, 3.3); Plan B, Bail Out, Fall Back and Call for Backup 0.
  - The scaffolds as openers: A 23.0, B 17.9, C 14.6, D 8.3.
  - *Finding:* the measure can't see a gambit. It scores the board as if the round ended straight after the card, and at the round's first play few locations are contested yet, so anything that pays off later in the round (a claim, a truce, a stake) scores near 0 as an opener. Cards that move tokens score high because they make or change a fight at once. To judge openers, the measure would need a horizon: for example, bots play out the rest of the round after the card, compared with the same round without it (a measuring change for the designer to decide).

- Round 17 (2026-10-08; suggestions, driven by Claude at the designer's request): revisions of the weakest faction cards from the second tuning pass and more unsuited cards, measured in a focused tournament (200 games on the standard table, probes on 10% of turns, 365–751 per card; change in the player's chance of winning, percentage points).
  - *Faction revisions (original → v2):* Install the Cameras, influence from the supply instead of standing: −0.28 → +0.32. Lay Them to Rest, the token's owner takes the smaller pile: −0.11 → +0.42. Sign the Contract, the owner takes the bigger pile and pays 2 Demon standing: +0.04 → +0.49. Silver Bullets, the owner takes the extra casualties as a pile: +0.42 → +0.65. Open the Pit, the group falls through to a location in its region instead of being removed (no longer a size change): +0.53 → +0.44. Take Over the Wake, influence equal to the Undead there (up to 4): −0.55 → −0.42 (still weak). Spread a Virus, only into neighbours holding one other faction: +0.24 → −0.14 (worse).
  - *Unsuited:* Trade Secrets (new; swap your standing with two factions) +2.87 (+4.5 for backers), second only to Defect +3.52; Raise the Stakes (new; at a contest, influence from your supply equal to the larger group, up to 5) +0.71 (about 0 for backers); Canvass the Town v2 (1 at every contested location) +0.07, worse than the original +0.26. References: C (scaffold) +2.21, Set the Bait +2.03, Stake Out +1.12.
  - *Readings:* giving a hidden token's owner a direct payoff works (all three token revisions improved). Standing cards are the strongest unsuited type; they may be genuinely strong, or the measure may over-reward them (moving standing changes the bot's own estimate of leading a faction at once). Run-to-run noise is larger than assumed (the originals moved by up to 0.6 between passes), so gaps under about 0.5 are unproven.
  - *Designer (2026-10-08): adopted* the revisions of Install the Cameras, Lay Them to Rest, Sign the Contract, Silver Bullets (in the deck) and Open the Pit, each under its original name. Checked whether the probe over-rewards standing cards: players who play Defect or Trade Secrets for their action go on to win 20.5–23.8% of the time (an even share is 20%), in line with other strong cards; no sign of inflation, on small samples.
- Round 18 (2026-10-08; suggestions, driven by Claude at the designer's request): marked-card candidates aimed at a big opening gambit (Split Up, Gang!; Research Montage; Set a Trap; Tip Off the Sheriff), and new ideas for the Undead and Sentient cards that failed in round 17 (Wake the Dead, Hold the Wake, Network the Virus). Measured in a focused tournament (200 games on the standard table, probes on 6% of turns and on every round's first play; change in the player's chance of winning, percentage points, all turns / as opener).
  - *Marked-card candidates:* Set a Trap +0.93 / +1.51; Research Montage +1.27 / +1.19; Tip Off the Sheriff +0.43 / +0.88; Split Up, Gang! +0.72 / +0.70 (no legal target in 178 probes). Scaffolds: A +1.57 / +0.91, B +2.02 / +0.78, C +1.91 / +0.98, D +0.96 / +0.94. Only Set a Trap and Research Montage beat the scaffolds as openers; none is near the strong unsuited cards (Defect +3.82 / +3.50, Trade Secrets +2.92 / +2.38).
  - *Faction ideas:* Wake the Dead +0.78 / +0.87, always playable, against Take Over the Wake −0.52 / +0.46. Hold the Wake +0.09 / +0.20 and Network the Virus +0.12 / +0.60 (no legal target in about half their probes), against Spread a Virus −0.54 / −1.11.
  - *Designer (2026-10-08): adopted* Set a Trap as A (A to D still step down in power, FP2: it is the best opener measured). Wake the Dead replaces Take Over the Wake. Research Montage was put back with the test cards: it does nothing on the board, so it sets no gambit, and in the draft it is a blind pick whose worth depends on cards not yet left out (the probe adds it to the hand free, so its figure flatters it). Research Montage, Tip Off the Sheriff and Split Up, Gang! stay candidates for B to D, to revise or replace; Hold the Wake and Network the Virus to revise again.
- Round 19 (2026-10-08; suggestions, driven by Claude; the designer had Claude pick the best candidates): marked-card candidates Put a Bounty On It (name a faction; at every fight this round its winning group loses 1 more token, into the trophy piles) and Lock Down the Town (name a region; this round no group moves into or out of it), and Network the Virus v2 (1 token to each location within two hexes it can enter, nearest first). Call Your Shot was held back: its bonus needs a number the designer hasn't set. Same measurement as round 18 (200 games; all turns / as opener).
  - *Marked-card candidates:* Set a Trap (A) +0.92 / +1.61; Lock Down the Town +0.79 / +1.35; Put a Bounty On It +0.96 / +1.13; Research Montage +1.24 / +1.53; Split Up, Gang! +0.60 / +0.76; Tip Off the Sheriff +0.40 / +0.70. Scaffolds: B +2.15 / +1.82, C +1.80 / +1.24, D +0.95 / +0.95. Both new cards are always playable (no target missing).
  - *Faction:* Network the Virus v2 −0.36 / +0.21, still unplayable in about 40% of probes (standing to pay, IC1), worse than Network the Virus +0.17 / +0.39 and Spread a Virus +0.07 / +0.66.
  - *Readings:* the B scaffold's opener figure moved from +0.78 (round 18) to +1.82 here, so opener gaps under about 1 point are unproven. Lock Down the Town and Put a Bounty On It sit between the C and D scaffolds as openers.
  - *Designer (2026-10-08): adopted* Lock Down the Town as C and Put a Bounty On It as D (Claude's suggestion: the stronger opener takes the earlier letter, FP2). Research Montage removed outright (designer, 2026-10-08): a useless card.
- Round 20 (2026-10-08; suggestions, driven by Claude at the designer's request: make the Sentients stronger and more interesting; the weakest suit, mean +0.75 against +0.94 to +1.53). Five new Sentient test cards: Go Viral (Strike: 1 token from the supply into each neighbour holding one other faction, influence from standing for each), Hack the Network (Strike: the group moves to any location holding one other faction), Call Home (Shift: 1 token from every location holding the faction, anywhere), Link the Swarm (Signature: at the target's fight the Sentients count their tokens next door too, for who wins) and Install a Backdoor (Signature: at the target's fight your influence counts 1 more per Sentient token there). Also measured: the new Set a Trap (hidden, takes every pile) and every Sentient card. 200 games; all turns / as opener; the invaders won 58% of these games.
  - *New:* Hack the Network +2.26 / +1.62 (playable 68%); Call Home +1.00 / +0.94; Install a Backdoor +0.32 / +0.37; Link the Swarm +0.09 / +0.05; Go Viral −0.27 / −0.82 (playable 54%).
  - *Sentient references:* Reprogram the Drones +2.01 (playable 46%); Back Up to the Cloud +1.21; Reprogram the Traffic Lights +0.94; Reroute the Power Grid +0.68; Install the Cameras +0.43; Spread a Virus (infectious) +0.17; Network the Virus +0.13; Hijack the Feed +0.11; Livestream the Fight +0.09; Spread a Virus −0.21 (the deck's Strike, still the weakest).
  - *Set a Trap (A, hidden):* +0.91 / +1.09, no target in 27% of probes (no cube in supply for the token, late). Defect +3.74 for reference.
  - *Readings:* Hack the Network is the first Strike to beat Spread a Virus clearly, by about 2.5 points; Call Home is a solid Shift. The two fight-math Signatures (Link the Swarm, Install a Backdoor) barely help: the bots may not yet steer fights to use them. Bots measuring these cards don't yet count face-down tokens or plan beyond one round; the bot improvements under test may change these figures.

### H.8 Candidate sets

A candidate set picks three cards per suit and attaches the responses, so the whole pool can be read as cards. Each is a suggestion to test, not a decision.

**Set v1 (round 4d)**

| Suit | Strike (2) | Shift (3) + response | Signature (3) |
|---|---|---|---|
| ◐ | Leave Out Fresh Meat (concentrate) | Never Invite Them In (pin) + *Howl at the Moon* | Wait for Sunrise (timing, scatter) |
| ↂ | Broadcast a Signal (concentrate) | Leak the Documents (scatter) + *Cut the Phone Lines* | Call in the Men in Black (standing effect) |
| ⏏ | Spread a Virus (scatter) | Reroute the Power Grid (concentrate) + *Pull the Plug* | Hack the Mainframe (fight math) |
| ☾ | Ring the Church Bell (concentrate) | Board Up the Windows (scatter) + *Hold a Séance* | Salt and Burn the Bones (fight math, sink) |
| ⎈ | Read from the Book (relocate) | Light Every Lamp (split) + *Sign in Blood* | Draw a Summoning Circle (concentrate) |

- Every suit has a card that concentrates and one that scatters or splits.
- Kinds: concentrate 5, scatter 4, split 1, pin 1, relocate 1, standing effect 1, fight math 2 (one a sink). No merges, so fights come only from moves into occupied locations.
- Five responses, each a different job: act on a pass, redirect a move, tax influence, information, feed an affinity faction.
- Printed influence: 40 in total (2 on Strikes, 3 on Shifts and Signatures).
- Left out but worth testing as swaps: Silver Bullets or Hold a Midnight Vigil (◐), Make a Deal at the Crossroads (⎈), Turn Them on Each Other (⏏), Tinfoil Hats as a response.
- Round 5: Track Them in the Snow became a mancala move (designer's idea): the pack leaves 1 token in each location it enters until none are left. It scatters into single tokens (no growth) and can start a fight at every occupied location it touches. A location it can't enter ends the path. Influence goes down at every location entered, and the path continues only while the player has influence with that faction to place. Tokens still left when the path ends stay together at the last location entered, so a short chase ends in a real attack.

**Set v2 (2026-10-06)**

*Temporary (2026-10-07): every card in this set is for gathering data and testing systems, not a final card.* Built to principles 1–14, the Strike/Shift/Signature slots (Signature carrying the response and the highest influence), fight modifiers as hidden tokens, and responses that never just move tokens. *Loc* is the location reading (a suit location, any faction); *Fac* is the faction reading (the suit's faction, anywhere).

| Suit | Slot (Infl.) | Card | Kind | Effect and target | Response |
|---|---|---|---|---|---|
| ◐ | Strike (2) | Leave Out Fresh Meat | Lure, concentrate | The largest group adjacent to the target moves into it, all of it. Target: the bait location. *Loc:* a ◐ location, any faction comes. *Fac:* anywhere, only the Nocturnals come. | – |
| ◐ | Shift (3) | Track Them in the Snow | Sow, scatter | Drive the target group hex by bordering hex, leaving 1 token and 1 of your influence in each location entered, while your influence with that faction lasts; a blocked location ends it; leftover tokens stay together. Target: the group chased. *Loc:* any group at a ◐ location. *Fac:* a Nocturnal group anywhere. | – |
| ◐ | Signature (4) | Silver Bullets | Hidden, sink | Place a face-down token (and a bluff) on the target. At its fight, each group loses 2 more tokens as casualties, and the token’s owner takes those as a pile of their own (revised in round 17, designer adopted). Target: *Loc:* a ◐ location. *Fac:* a location holding the Nocturnals. | *Never Invite Them In* (before): when a player is about to move tokens into a location where you have influence, block it; the tokens stay where they are. |
| ↂ | Strike (2) | Broadcast a Signal | Concentrate | Call the groups of one faction from up to two locations anywhere into the target. Target: where they answer. *Loc:* any faction, into an ↂ location. *Fac:* the Sci-Fi faction, into any location. | – |
| ↂ | Shift (3) | Leak the Documents | Halve, scatter | Half the target group, rounded down, leaves for an adjacent location of your choice. Target: the group split. *Loc:* any group at an ↂ location. *Fac:* a Sci-Fi group anywhere. | – |
| ↂ | Signature (4) | Beam Them Up | Teleport | Lift the target group and set it down at any location on the island. Target: the group taken. *Loc:* any group at an ↂ location. *Fac:* a Sci-Fi group anywhere. | *Classified* (after): when a hidden token is placed, look at its face. |
| ⏏ | Strike (2) | Hack the Network | Contest anywhere | Move the target group to any location on the island that holds one other faction, so it fights there at the round's end. Target: the group, then where it goes. *Loc:* any group at a ⏏ location. *Fac:* a Sentient group anywhere. *Replaced Spread a Virus, 2026-10-09 (designer: cut the weak cards).* | – |
| ⏏ | Shift (3) | Reroute the Power Grid | Concentrate | Move one faction's tokens from every location in the target's region into the target. Target: the destination. *Loc:* any faction, into a ⏏ location. *Fac:* the Sentients, into any location. | – |
| ⏏ | Signature (4) | Reprogram the Traffic Lights | Conveyor | Choose one of the six hex directions; every group of the target moves one hex that way, where it can. Target: *Loc:* every group in a ⏏ location's region. *Fac:* every Sentient group on the island. | *Pull the Plug* (after): when a player spends a card for influence, they gain 1 less, and you gain 1 with the same faction. |
| ☾ | Strike (2) | Ring the Church Bell | Concentrate | Every token in adjacent locations is drawn into the target. Target: where the bell rings. *Loc:* a ☾ location, any faction comes. *Fac:* anywhere, only Undead tokens come. | – |
| ☾ | Shift (3) | Board Up the Windows | Scatter | The target group is turned away, split across at least two adjacent locations. Target: the group. *Loc:* any group at a ☾ location. *Fac:* an Undead group anywhere. | – |
| ☾ | Signature (4) | Salt and Burn the Bones | Hidden, sink | Place a face-down token (and a bluff) on the target. At its fight, both groups lose all their tokens; trophies are handed out as normal and the location is not scorched. Target: *Loc:* a ☾ location. *Fac:* a location holding the Undead. | *Hold a Séance* (after): when any player passes, look at the cards left out this round. |
| ⎈ | Strike (2) | Draw a Summoning Circle | Concentrate | Every group of one faction in neighbouring regions moves into the target. Target: the circle. *Loc:* any faction, into a ⎈ location. *Fac:* the Demons, into any location. | – |
| ⎈ | Shift (3) | Light Every Lamp | Split | At a contested location, the target faction is driven to an adjacent location of your choice, so the fight there doesn't happen. Target: the faction driven out. *Loc:* the smaller faction at a contested ⎈ location. *Fac:* the Demons, wherever they are contested. | – |
| ⎈ | Signature (4) | Set the House on Fire | Hidden, sink | Place a face-down token (and a bluff) on the target. Any fight there counts as a true tie: both groups are wiped out and the location is scorched. Target: *Loc:* a ⎈ location. *Fac:* a location holding the Demons. | *Sign in Blood* (after): when a player spends influence from a faction, gain 1 influence with the Demon faction. |

- Every suit concentrates (Fresh Meat, Broadcast, Reroute, the Bell, the Summoning Circle) and scatters or splits (Track, Leak, the Virus, Board Up, the Lamps).
- Three presence sinks, all hidden (Silver Bullets, Salt and Burn, the House on Fire): the island's main tool now that cards never remove tokens. Hidden actions stay rare: three of fifteen.
- Two strong rule-bends that aren't hidden (Beam Them Up, Reprogram the Traffic Lights).
- Five responses, one per Signature: a block (Never Invite Them In), two information (Classified, Hold a Séance), a tax (Pull the Plug), feeding a faction (Sign in Blood). None moves tokens. The cancel is on an unsuited card.
- Printed influence: 45 in total (five each of 2, 3 and 4).
- Watch in testing: the faction readings of Reprogram the Traffic Lights and Draw a Summoning Circle can sweep the whole island; Set the House on Fire scorches on demand; the two information responses are close.
- Swaps worth testing: Read from the Book or Smash the Mirror (⎈), Back Up to the Cloud (⏏), Draw the Salt Line (☾), Call in the Men in Black (ↂ), Hold a Midnight Vigil (◐).

### H.9 Action types

A map of the kinds of action that fit the game's structure (draft, play, fights at round end, growth, influence, secret trophies, hidden tokens, scorching, adjacency), to draw from when designing cards. Suggestions from a design pass on 2026-10-05; not decisions. Presence actions are in the Kind list at the top of this appendix; the rest are new.

1. **Presence:** sow, lure, teleport, halve, conveyor, network jump, shove, mirror, leap, swap, pin, merge, split, concentrate, scatter. Still open: *chain reaction* (a group moves, and the group it lands on is pushed onward in turn), *follow the leader* (a group moves and an adjacent group of another faction follows it).
2. **Fight modifiers,** set during play and applied at round end: sinks (more casualties), protection (fewer), trophy redirection (the smaller pile goes to the leader, or the bigger pile to the runner-up), double trophies, influence weight (influence of one player counts double at a location).
3. **Growth modifiers,** without card-driven growth: stop growth at a location this round; divert a location's growth to an adjacent location; lower or raise the growth threshold at one location.
4. **Alignment and control:** desecrate a location so it counts as aligned with no archetype this round (no AL2 tie win, no AL3 boost, no affinity there); consecrate it to an archetype instead.
5. **Influence economy:** move a player's influence between factions (corruption); move your influence between locations; cash out influence at a location into standing before the fight; tax other players' placements; protect your influence from being moved.
6. **Trophies:** look at a player's secret trophies; bury the evidence (return one of your trophies to its faction's supply face down, so its colour stays secret, lowering what counts against you); trade a trophy for influence. Trophies are the score, so these are powerful and should be rare.
7. **Information and bluff:** hidden tokens and bluffs; look at a hand; look at the left-out cards; reveal a token early.
8. **Tempo and turn order:** play after passing; take a second turn; force a player to pass; play out of turn; end the round early (the next pass ends it).
9. **The draft:** take back a pick; swap a card with a left-out card; look at a player's hand while drafting.
10. **Terrain:** barricade the border between two hexes (they stop being adjacent this round); open a temporary path across the lake (a boat); quarantine a region; burn an empty location deliberately (a controlled scorch).
11. **Lasting location states:** tokens that stay until the location resolves, like UT1's hidden tokens: haunted, quarantined, warded.
12. **Suit synergy:** a card that is stronger if you played a card of the same suit, or of a different suit, earlier this round. It gives the five suits a reason to be collected or spread in the draft.
13. **Player deals:** a card that makes a table-talk pact binding for the round (D10 keeps table talk non-binding otherwise).
14. **The end game:** move the presence threshold by one for this game; a last-round-only card.

Fits best with the rules as they stand: fight modifiers, growth modifiers, alignment, trophies, terrain and suit synergy. Each touches a system the draft already has, and each gives a gambit only its holder has (principle 13).

---

### H.10 Influence wording review (D15)

*Designer (2026-10-07):* review every card for places where the location and amount of influence placed is vague or unspecified, and specify it. Under IC1 (D15) the influence a card places is a requirement, so the text has to say exactly where and how much. The prototype today follows G.8: 1 influence at each location a group moves into, per faction moved, from standing with that faction; under IC1, a move it can't pay for doesn't happen. *The suggested wordings below are suggestions, for the designer to accept or change, pattern by pattern.*

| Pattern | Cards | What the text says now | Suggested wording (suggestion) |
|---|---|---|---|
| A. One group, one destination | Leave Out Fresh Meat, Leak the Documents, Beam Them Up, Leak It to the Press, Light Every Lamp (both), Chase Them Down the Slope, Read from the Book, Smash the Mirror, Back Up to the Cloud, Lay a Trail, scaffolds B, C, D | Nothing about influence | "Place 1 influence where it lands, from your standing with its faction." |
| B. One faction, several groups, one destination | Broadcast a Signal, Reroute the Power Grid, Draw a Summoning Circle, Howl at the Moon | Nothing | "Place 1 influence at the target, from your standing with that faction." (One placement however many groups come; for Howl the groups land next to the target, so: "at each location a group moves into".) |
| C. One group, several destinations | Spread a Virus (both), Board Up the Windows | Nothing | "Place 1 influence at each location it moves into, from your standing with its faction; it moves into only as many as you can pay for." |
| D. Several factions move | Ring the Church Bell, Hear the Banshee Wail, Circle the Prey, Reprogram the Traffic Lights, Crash-Land the Saucer (knock-ons), Turn On the Tractor Beam, Trade Souls, Drag Them Under, Follow the Lights, Lead the Horde (the shove), scaffold A (two groups) | Nothing | "Place 1 influence at each location a group moves into, from your standing with that group's faction; a group you can't pay for stays." |
| E. Nothing moves | Wait for the Full Moon, Reprogram the Drones, Open the Pit, Claim the Spoils, Call a Truce | Nothing; they place none | No influence, so no requirement: under IC1 these are the only board actions anyone can play with no standing. |
| F. Influence from the supply | Hidden tokens (Silver Bullets, Salt and Burn, House on Fire, and the test fight modifiers), Stake Out, Canvass the Town, Call for Backup | Stake Out, Canvass and Backup are exact. Hidden tokens don't mention the marker cube | Hidden tokens: "Place it, and a bluff, each with 1 of your cubes from your supply on it, counting as 1 of your influence there." |
| G. Your own influence or standing | Switch to Plan B, Change the Plan, Bail Out, Fall Back, Defect | Exact | No change. |
| H. Already exact | Track Them in the Snow, Take Over the Wake, Install the Cameras | Exact | No change. |
| Special | Set the Bait; Steal Their Playbook | Set the Bait: 2 from the supply is exact, but the drawn group also places 1 from standing, unstated. Steal Their Playbook: whatever the copied card places | Set the Bait: either say "then draw a group in (1 influence from your standing with its faction)" or make the draw free. Steal Their Playbook: "Its influence and requirements apply as written." |

**Questions for the designer, raised by IC1:**
- *Pattern D:* when a card moves several factions, should each moved group need its own faction's influence (as suggested), or only the target faction, with the others carried along free? Ring the Church Bell, for example, today draws only the factions the player can pay for.
  - *Designer (2026-10-07):* a card that lets you select a faction at a location uses the selected faction's influence (D15). First-draft starting place: each faction moved to a new location pays 1 of its influence there, regardless of group size; the others don't come along free (D15). The free reading is kept as variant `whoPays=selected`, where the selected faction gets in first.
- *Knock-ons:* groups pushed or shoved as a side effect (the Saucer's line, the Horde's shove, the Banshee's wail): paid like any other move, or free?
- *Pattern E:* size-change and fight-rule cards place no influence, so IC1 never limits them. Is that intended, or should they place (and require) influence too?

## Appendix I: Reference card catalogue

Cards and card-driven mechanisms from other games, as raw material for our own (Appendix H). Each section says how complete and how verified it is. These describe other designers' games; nothing here is a mechanism of ours.

### I.1 The King is Dead, 2nd edition (complete; from the rulebook)

Every player has the same eight cards and summons a follower to court after every action. A region's power struggle happens when all players pass in a row.

| Card | Effect |
|---|---|
| Scottish Support | Place two Scottish followers into one region bordering a Scottish-controlled region (or bordering Moray if it is unresolved). |
| Welsh Support | The same for the Welsh (Gwynedd). |
| English Support | The same for the English (Essex). |
| Assemble (×2) | Place one Scottish, one Welsh and one English follower from the supply into any region or regions. |
| Negotiate | Swap the positions of two face-up region cards (changing the order of power struggles); lock one with your negotiation disc. |
| Manoeuvre | Swap a follower in any region with a follower in any other region. Can't undo another player's Manoeuvre straight away. |
| Outmanoeuvre | Swap a follower in a region with two followers in a bordering region. |

**Cunning actions** (advanced game; each player gets three of twelve at random):

| Card | Effect |
|---|---|
| Spy | Copy the action on top of another player's discard pile. |
| Ambush | Place two Scottish followers into a region, then return any follower there to the supply. |
| March | Move two followers from one region to one bordering region. |
| Plot | Can't be played. At game end it counts as a follower of a faction of your choice, and wins a specific tie. |
| Aid | Place two followers of whichever faction has the most followers in the supply. |
| Influence | Swap one English follower in a region with two non-English followers in another. |
| Dispute | Swap a Welsh follower in a region with a non-Welsh follower in another. |
| Edict | Swap two Scottish followers with two non-Scottish followers in a bordering region. |
| Resist | Place two non-Scottish followers into a region bordering Scottish control. |
| Quell | Return a Welsh follower near Welsh control, then place two followers of any factions there. |
| Suppress | Return an English follower near English control and another follower, then place one follower. |
| Muster | Return a Scottish follower near Scottish control, then place two followers of any factions there. |

**Worth stealing:** one fixed hand for everyone, so everyone knows what everyone can still do; swaps rather than moves; reordering the resolution (Negotiate); copying a rival's last action (Spy); a card that is never played but scores (Plot).

### I.2 Blood Rage (near complete; from Board Game Arena's game help)

Cards are drafted each age; each is a battle card, an upgrade, a monster or a quest.

**Battle cards** (played secretly into a battle):

| Age | Card | Effect |
|---|---|---|
| 1 | Frigga's Grace (+2) | If you pillage successfully, raise another clan stat. |
| 1 | Heimdall's Sight (+X) | Worth the same as the highest revealed enemy card. |
| 1 | Loki's Trickery (+0) | If you lose, steal 1 rage from the winner. |
| 1 | Odin's Smite (+1) | Destroy one warrior of each opponent here before comparing strength. |
| 1 | Thor's Hammer (+1) | Gain 3 glory if you win. |
| 1–3 | Tyr's Bash, Smash, Crush, Smite, Rage, Judgement (+2 to +8) | Plain strength. |
| 2 | Heimdall's Eye (+2) | Play it after all cards are revealed. |
| 2 | Heimdall's Watch (+0) | Discard all revealed cards, gain glory equal to their strength, then everyone plays again. |
| 2 | Loki's Backstab (+0) | If you lose, steal 2 glory from the winner. |
| 2 | Odin's Tide (+1) | Before comparing, every player destroys all but one of their figures here. |
| 2 | Thor's Oath (+1) | If you win, raise a clan stat. |
| 3 | Heimdall's Gaze (+3) | Play it after all cards are revealed. |
| 3 | Loki's Poison (+0) | If you lose, take the winner's revealed cards into your hand. |
| 3 | Odin's Judgement (+2) | Gain 2 glory per figure destroyed in this battle, yours included. |
| 3 | Thor's Ascension (+1) | If you win, gain 3 rage and 3 glory. |
| 3 | Thor's Primacy (+3) | Cancel the text of every opponent's revealed card. |

**Clan upgrades:**

| Age | Card | Effect |
|---|---|---|
| 1 | Frigga's Succor | When you invade, invade with an extra warrior there for free. |
| 1 | Loki's Blessing | If you lose a battle, invade that province with a warrior for free. |
| 1 | Loki's Domain | Gain 1 glory per figure you release from Valhalla. |
| 1 | Thor's Glory | Gain 2 glory whenever 2 or more enemy figures die in a battle you're in. |
| 2 | Frigga's Protection | Pay 1 rage to stop one of your figures being destroyed. |
| 2 | Loki's Eminence | Gain 2 glory per figure released from Valhalla. |
| 2 | Thor's Domain | After invading, pay 2 rage to pillage at once. |
| 2 | Tyr's Challenge | Pay 2 rage to re-pillage a pillaged province. |
| 2 | Tyr's Prowess | If you win, keep revealed cards for 1 rage each. |
| 3 | Frigga's Domain | Pay 1 rage to invade with any figure from Valhalla. |
| 3 | Frigga's Sacrifice | Destroy 2 figures to raise a clan stat. |
| 3 | Loki's Wrath | Gain 3 glory per figure released from Valhalla. |
| 3 | Odin's Throne | Double quest glory. |
| 3 | Thor's Conquest | 3 glory per figure on the board at game end. |
| 3 | Tyr's Domain / Tyr's Smite | A quest card revealed in battle counts as +3 / +5. |

**Monsters:** Sea Serpent (counts as a ship), Dwarf Chieftain (free to upgrade or invade), Troll (destroys all warriors when invading), Fire Giant (destroys all non-monsters when invading), Dark Elf (can invade Yggdrasil), Valkyrie (2 glory per enemy figure destroyed), Frost Giant (pillage rewards twice), Soldier of Hel (free), Volur Witch (escapes to Yggdrasil instead of dying).

**Leader, warrior and ship upgrades:** Lord of Hammers, Axes, Spears (bonuses when the leader pillages); Brothers, Experts, Masters in Arms (pairs of warriors are stronger); Loki's, Fire and Eternal Dragons (glory when your ship dies).

**Quests** (secret goals for the age): Alfheim, Jotunheim, Manheim (most strength in a province of that colour), Yggdrasil, Widespread (most strength in two provinces), Glorious Death (four figures in Valhalla).

**Worth stealing:** losing pays (Loki's cards, Glorious Death, dragons); revealing after everyone else (Heimdall); cancelling text (Thor's Primacy); a whole battle that wipes everyone down to one (Odin's Tide); secret goals tied to map colours.

### I.3 Inis (action cards complete; from the Inis fan wiki)

Action cards are drafted each season. A *season* effect is played on your turn; a *triskel* effect is played at the trigger it names, even out of turn. The standard set is used at every player count; the others join at 4 or 5 players.

| Card | Players | Type | Effect |
|---|---|---|---|
| Bard | All | Season or triskel | Draw an epic tale card. *Or:* after one of your manoeuvres removes opposing clans, gain a deed. |
| Citadel | All | Season | Place a citadel where you are present. If that territory's advantage card hasn't been played, take it. |
| Conquest | All | Season | Choose a territory; you may move any number of clans from adjacent territories into it. |
| Craftsmen & Peasants | All | Season | In each territory where you are present, place a clan for each citadel there. |
| Druid | All | Season | Look at the discarded action cards and take one into your hand. Can't be played as your last action card. |
| Emissaries | All | Season | Move one of your clans to an adjacent territory without starting a clash. |
| Exploration | All | Season | A new territory is added to the map, adjacent to two others; place a clan in it. |
| Festival | All | Season | Where you are present and there is a sanctuary, place a clan and the festival token. Anyone who starts a clash there removes one of their clans. Removed at season's end. |
| Geis | All | Triskel | When an opponent plays an action card: ignore its effect and discard it. |
| Migration | All | Season | Choose a territory; move clans from it into one or more adjacent territories. |
| New Alliance | All | Season | Where you are present: place a clan, *or* replace one clan of an opponent with two or more there with one of yours. |
| New Clans | All | Season | Place two clans in territories where you are present. |
| Raid | All | Triskel | During a clash, after your attack: take a random action card from the attacked player's hand; if they have none, remove one of their exposed clans. |
| Sanctuary | All | Season | Place a sanctuary where you are present and draw an epic tale card. (Another source adds: then you may move clans from one territory to one adjacent territory.) |
| Warlord | All | Season or triskel | Start a clash where you are present, as instigator. *Or:* during a clash you're in, after a manoeuvre, place an exposed clan there and choose who manoeuvres next. |
| Master Craftsman | 4+ | Season or triskel | Discard a card if able, then draw an epic tale card. *Or:* after you play an epic tale card, give it to another player instead of discarding it, and gain a deed. |
| Scouts & Spies | 4+ | Season | Look at one opponent's action cards; then you may move clans from one territory into one adjacent territory. |
| Clans Harmony | 5 | Season | Place a clan in each shared territory where you are present, *or* place one clan in any territory where you are present. |
| Coalition | 5 | Season | Choose a shared territory; move any number of your clans to one adjacent territory, and name an opponent there who may move clans to the same territory. You instigate the clash, and you two can't attack each other or use citadels in it. |
| Fili | 5 | Season | Place the Fili token in a shared territory: nothing can start a clash there this season. |
| The King and the Land | 5 | Season | Discard an advantage card to draw an epic tale card, *or* give one of your advantage cards to another player present in its territory: you gain a deed and they may place a clan there. |

**Advantage cards** (only four are on the wiki): Aber (move a clan between two territories adjacent to the Aber), Cove (after a season card, swap a card with the one set aside in the draft), Forest (after an epic tale card, draw another), Gates of Tir na Nog (draw an extra epic tale card when resolving that territory, keep one).

**Epic tale cards** (about thirty; names only, effects not found): Lug's Spear, Dagda's Cauldron, The Stone of Fal, Ogma's Eloquence (ends a clash at once), and others.

**Worth stealing:**
- **Triskel effects:** a second effect played at a named trigger instead of on your turn. This is our principle 5.
- **Cancelling a card as it's played (Geis):** the hardest response there is.
- **A peaceful zone (Fili):** a fight is postponed. Compare Burn the Book.
- **An escort into a fight (Coalition):** you invite a rival in and agree not to attack each other.
- **Taking a card back from the discard (Druid).**
- **Replacing an enemy piece rather than removing it (New Alliance).**
- **Stealing a card from a hand (Raid).**
- **Peeking at a hand, then moving (Scouts & Spies).**
- **A fight tax (Festival):** starting a fight there costs you.

### I.4 Rumble Nation (partial; from Board Game Arena's game help)

Most actions are dice placements. A shared display of tactic cards (each usable once per game) moves soldiers and bumps enemies out; their individual texts weren't found. The deluxe daimyo cards each move or place soldiers around a leader figure:

| Daimyo | Effect |
|---|---|
| Uesugi Kenshin | Move up to 3 of your soldiers from the daimyo's area to adjacent land areas. |
| Oda Nobunaga | Move the daimyo to an adjacent area, optionally taking a soldier. |
| Takeda Shingen | Move up to 3 soldiers of one opponent from the daimyo's area to adjacent areas. |
| Mōri Motonari | Place up to 3 soldiers from stock into areas adjacent to the daimyo. |
| Chōsokabe Motochika | Move up to 3 units from the daimyo's area to areas adjacent by sea. |
| Ōtomo Sōrin | Replace an opponent's soldier in up to two areas adjacent to the daimyo with your own. |

**Worth stealing:** a shared display of once-per-game tactics that closes when someone finishes placing; sea movement as a second kind of adjacency; replacing an enemy piece rather than removing it.

### I.5 The COIN series, e.g. Cuba Libre (system; from GMT's Cuba Libre playbook)

Four asymmetric factions share one deck of event cards. Cuba Libre's factions: the Government, the 26 July Movement, the Directorio and the Syndicate.

- **The card sets the turn order.** Each event card shows the four faction symbols in an order. The leftmost faction that is *eligible* acts first, then the next eligible faction to its right.
- **What the 1st eligible faction can do:** the card's event; or one operation without a special activity; or one operation with a special activity; or pass.
- **What the 2nd eligible faction can do depends on the first.** If the first faction took Ops plus a special activity, the second may only take the event or a *limited operation* (an operation in one space, with no special activity). Each choice closes some options for the next faction.
- **Acting costs the next card.** A faction that does anything but pass is ineligible on the next card, so most factions act on every other card. A faction that passes stays eligible (and gains a small resource).
- **The next card is visible.** The played card and the card "on deck" are both face up, so players plan around what is coming.
- **Dual-use events.** Most events have an unshaded half and a shaded half that usually favour opposite sides: often something to help you or hurt a rival.
- **Operations and special activities** are each faction's own menu (Government: Train, Sweep, Assault, with Air Strike and Transport; 26 July: Rally, March, Attack, Terror, with Kidnap; Directorio: Assassinate; Syndicate: money, buying protection).
- **Propaganda cards** are seeded through the deck, one in each third. When one comes up, there is a scoring and upkeep round, and every faction becomes eligible again.

**Worth stealing:**
- **Turn order from the card,** not the seat. Each of our cards could show the archetype order for the round's turn order, or for a resolution order.
- **The cost of acting is sitting out the next card.** A tempo rule that makes passing a real choice.
- **What the first player does limits what the second may do.** This is a direct model for responses and follow-on plays.
- **Seeing the next card coming.** It could be applied to the draft or to which location fights first.
- **Dual-use events with two halves for two sides.** For example, each suit card's two uses could favour the invaders and the island.
- **Scoring rounds seeded through the deck.** Compare our fixed round count.

**Other COIN games** (from reviews and memory; check before relying on details):

| Game | What it adds |
|---|---|
| Andean Abyss (Colombia) | The first COIN game: three insurgent factions and one government. |
| Fire in the Lake (Vietnam) | Four factions in two loose teams that also compete. *Pivotal events:* each faction holds one powerful event it can play to pre-empt the card order. *Capabilities* last the game; *momentum* lasts until the next scoring round. |
| A Distant Plain (Afghanistan) | Two government factions that must cooperate but are scored apart. A shared pool of resources. |
| Falling Sky (Gaul) | Romans and Gallic tribes; more open battle than the earlier games. Winter cards for scoring and upkeep; Caesar as a leader piece. |
| Liberty or Death (American Revolution) | Two pairs of allied factions; winter quarters. |
| Pendragon (post-Roman Britain) | A track that tips the game's eras; raiders against standing warbands; roads that decay and isolate regions; barbarians recruited as allies. |
| Root (Leder Games, COIN-inspired) | Asymmetric factions sharing a deck of suited cards: each card's suit matches a type of clearing, and ambush cards answer a battle. |

**Worth stealing from the wider series:** one powerful card each player keeps back to break the order once (pivotal events); effects that last until the next scoring round (momentum); two players who must cooperate but are scored apart; a map whose connections wear down over the game (Pendragon's roads, like our scorched regions); suits that match location types (Root, like our archetype suits).

### I.6 Twilight Struggle (system; from GMT's 2nd edition rules)

Two players, the USSR and the US, across ten turns of six or seven card plays each.

- **Every card is an event or operations points (1 to 4).** Points are spent on one thing per card: placing influence, realignment rolls (removing enemy influence), coups, or the space race.
- **Your opponent's event fires anyway.** If you play a card for points and its event belongs to your opponent, their event still happens. You choose whether it happens before or after your operations. Much of the game is deciding which of the opponent's cards you can afford to play.
- **Influence must spread from where you already are.** It is placed in or adjacent to countries where you had influence at the start of the round, and costs double in an enemy-controlled country.
- **Control needs a margin.** A country is controlled by having at least its stability number of influence there *and* that much more than the opponent.
- **Headline phase:** each turn opens with both players secretly choosing a card, revealed together; the higher operations value resolves first.
- **Scoring cards** are in the deck, and must be played in the turn they are drawn. Each scores one region.
- **Cards removed after use (asterisk), and lasting events (underlined)** that stay face up until cancelled.
- **The China Card:** an extra card that, once played, passes face down to the opponent, who can't use it until next turn.
- **DEFCON:** a shared nuclear-tension track. Coups and some events lower it, and the player who brings it to 1 loses at once.
- **Space race:** a way to discard an unwanted card (one of your opponent's events) for a small reward.

**Worth stealing:**
- **Playing a card for its points can still trigger its event for someone else.** Our version: spending a suit card for influence could let that suit's archetype act anyway.
- **Influence that has to grow outward** from where it already is.
- **Control by margin, not just most.**
- **A secret simultaneous opening play** each round (the headline). A natural fit for our draft-then-play rhythm.
- **Scoring cards in the deck** that force a region to score.
- **One card that changes hands every time it is played** (the China Card), like a cursed object passed around the town.
- **A shared doom track that both sides push and nobody wants to finish** (DEFCON). Compare our presence threshold.
- **A safe way to dump a card you can't afford to play** (the space race).

**The full card list** (110 cards, including the optional cards 104–110). Ops is the operations value; Side is whose event it is; Removed means the card leaves the game when played as an event. Effects are described by pattern below, in our own words.

| # | Card | Ops | Side | Removed | Pattern |
|---|---|---|---|---|---|
| 1 | Asia Scoring | 0 | Scoring |  | Scoring |
| 2 | Europe Scoring | 0 | Scoring |  | Scoring |
| 3 | Middle East Scoring | 0 | Scoring |  | Scoring |
| 4 | Duck and Cover | 3 | US |  | The doom track (DEFCON) |
| 5 | Five Year Plan | 3 | US |  | Hands and information |
| 6 | The China Card | 4 | Either |  | The China Card |
| 7 | Socialist Governments | 3 | USSR |  | Strip influence |
| 8 | Fidel | 2 | USSR | Yes | Flip a country |
| 9 | Vietnam Revolts | 2 | USSR | Yes | Spread influence, Ops and tempo |
| 10 | Blockade | 1 | USSR | Yes | Ultimatums and doubling |
| 11 | Korean War | 2 | USSR | Yes | War roll |
| 12 | Romanian Abdication | 1 | USSR | Yes | Flip a country |
| 13 | Arab-Israeli War | 2 | USSR |  | War roll |
| 14 | Comecon | 3 | USSR | Yes | Spread influence |
| 15 | Nasser | 1 | USSR | Yes | Flip a country |
| 16 | Warsaw Pact Formed | 3 | USSR | Yes | Strip influence |
| 17 | De Gaulle Leads France | 3 | USSR | Yes | Flip a country |
| 18 | Captured Nazi Scientist | 1 | Both | Yes | Space race |
| 19 | Truman Doctrine | 1 | US | Yes | Strip influence |
| 20 | Olympic Games | 2 | Both |  | The doom track (DEFCON) |
| 21 | NATO | 4 | US | Yes | Protection and prerequisites |
| 22 | Independent Reds | 2 | US | Yes | Spread influence |
| 23 | Marshall Plan | 4 | US | Yes | Spread influence |
| 24 | Indo-Pakistani War | 2 | Both |  | War roll |
| 25 | Containment | 3 | US | Yes | Ops and tempo |
| 26 | CIA Created | 1 | US | Yes | Hands and information |
| 27 | US/Japan Mutual Defense Pact | 4 | US | Yes | Protection and prerequisites |
| 28 | Suez Crisis | 3 | USSR | Yes | Strip influence |
| 29 | East European Unrest | 3 | US |  | Strip influence |
| 30 | Decolonization | 2 | USSR |  | Spread influence |
| 31 | Red Scare/Purge | 4 | Both |  | Ops and tempo |
| 32 | UN Intervention | 1 | Both |  | Cancel or answer |
| 33 | De-Stalinization | 3 | USSR | Yes | Relocate influence |
| 34 | Nuclear Test Ban | 4 | Both |  | The doom track (DEFCON) |
| 35 | Formosan Resolution | 2 | US | Yes | Protection and prerequisites |
| 36 | Brush War | 3 | Both |  | War roll |
| 37 | Central America Scoring | 0 | Scoring |  | Scoring |
| 38 | Southeast Asia Scoring | 0 | Scoring | Yes | Scoring |
| 39 | Arms Race | 3 | Both |  | Conditional VP and bets |
| 40 | Cuban Missile Crisis | 3 | Both | Yes | The doom track (DEFCON) |
| 41 | Nuclear Subs | 2 | US | Yes | The doom track (DEFCON) |
| 42 | Quagmire | 3 | USSR | Yes | Ops and tempo |
| 43 | SALT Negotiations | 3 | Both | Yes | The discard pile, The doom track (DEFCON) |
| 44 | Bear Trap | 3 | US | Yes | Ops and tempo |
| 45 | Summit | 1 | Both |  | The doom track (DEFCON) |
| 46 | How I Learned to Stop Worrying | 2 | Both | Yes | The doom track (DEFCON) |
| 47 | Junta | 2 | Both |  | Coup tools |
| 48 | Kitchen Debates | 1 | US | Yes | Conditional VP and bets |
| 49 | Missile Envy | 2 | Both |  | Hands and information |
| 50 | “We Will Bury You” | 4 | USSR | Yes | The doom track (DEFCON), Conditional VP and bets |
| 51 | Brezhnev Doctrine | 3 | USSR | Yes | Ops and tempo |
| 52 | Portuguese Empire Crumbles | 2 | USSR | Yes | Spread influence |
| 53 | South African Unrest | 2 | USSR |  | Spread influence |
| 54 | Allende | 1 | USSR | Yes | Spread influence |
| 55 | Willy Brandt | 2 | USSR | Yes | Protection and prerequisites |
| 56 | Muslim Revolution | 4 | USSR |  | Strip influence |
| 57 | ABM Treaty | 4 | Both |  | The doom track (DEFCON) |
| 58 | Cultural Revolution | 3 | USSR | Yes | The China Card |
| 59 | Flower Power | 4 | USSR | Yes | Conditional VP and bets |
| 60 | U2 Incident | 3 | USSR | Yes | Conditional VP and bets |
| 61 | OPEC | 3 | USSR |  | Conditional VP and bets |
| 62 | “Lone Gunman” | 1 | USSR | Yes | Hands and information |
| 63 | Colonial Rear Guards | 2 | US |  | Spread influence |
| 64 | Panama Canal Returned | 1 | US | Yes | Spread influence |
| 65 | Camp David Accords | 2 | US | Yes | Spread influence, Protection and prerequisites |
| 66 | Puppet Governments | 2 | US | Yes | Spread influence |
| 67 | Grain Sales to Soviets | 2 | US |  | Hands and information |
| 68 | John Paul II Elected Pope | 2 | US | Yes | Flip a country |
| 69 | Latin American Death Squads | 2 | Both |  | Coup tools |
| 70 | OAS Founded | 1 | US | Yes | Spread influence |
| 71 | Nixon Plays the China Card | 2 | US | Yes | The China Card |
| 72 | Sadat Expels Soviets | 1 | US | Yes | Flip a country |
| 73 | Shuttle Diplomacy | 3 | US |  | Protection and prerequisites |
| 74 | The Voice of America | 2 | US |  | Strip influence |
| 75 | Liberation Theology | 2 | USSR |  | Spread influence |
| 76 | Ussuri River Skirmish | 3 | US | Yes | The China Card |
| 77 | “Ask Not What Your Country…” | 3 | US | Yes | Hands and information |
| 78 | Alliance for Progress | 3 | US | Yes | Conditional VP and bets |
| 79 | Africa Scoring | 0 | Scoring |  | Scoring |
| 80 | “One Small Step…” | 2 | Both |  | Space race |
| 81 | South America Scoring | 0 | Scoring |  | Scoring |
| 82 | Iranian Hostage Crisis | 3 | USSR | Yes | Flip a country |
| 83 | The Iron Lady | 3 | US | Yes | Flip a country, Protection and prerequisites |
| 84 | Reagan Bombs Libya | 2 | US | Yes | Conditional VP and bets |
| 85 | Star Wars | 2 | US | Yes | The discard pile |
| 86 | North Sea Oil | 3 | US | Yes | Ops and tempo |
| 87 | The Reformer | 3 | USSR | Yes | Spread influence |
| 88 | Marine Barracks Bombing | 2 | USSR | Yes | Strip influence |
| 89 | Soviets Shoot Down KAL-007 | 4 | US | Yes | Coup tools, The doom track (DEFCON) |
| 90 | Glasnost | 4 | USSR | Yes | Coup tools, The doom track (DEFCON) |
| 91 | Ortega Elected in Nicaragua | 2 | USSR | Yes | Strip influence, Coup tools |
| 92 | Terrorism | 2 | Both |  | Hands and information |
| 93 | Iran-Contra Scandal | 2 | USSR | Yes | Coup tools |
| 94 | Chernobyl | 3 | US | Yes | Ops and tempo |
| 95 | Latin American Debt Crisis | 2 | USSR |  | Ultimatums and doubling |
| 96 | Tear Down this Wall | 3 | US | Yes | Spread influence, Coup tools |
| 97 | “An Evil Empire” | 3 | US | Yes | Conditional VP and bets |
| 98 | Aldrich Ames Remix | 3 | USSR | Yes | Hands and information |
| 99 | Pershing II Deployed | 3 | USSR | Yes | Strip influence |
| 100 | Wargames | 4 | Both | Yes | The doom track (DEFCON) |
| 101 | Solidarity | 2 | US | Yes | Spread influence |
| 102 | Iran-Iraq War | 2 | Both | Yes | War roll |
| 103 | Defectors | 2 | US |  | Cancel or answer |
| 104 | The Cambridge Five | 2 | USSR |  | Hands and information |
| 105 | Special Relationship | 2 | US |  | Spread influence |
| 106 | NORAD | 3 | US | Yes | Lasting effects |
| 107 | Che | 3 | USSR |  | Coup tools |
| 108 | Our Man in Tehran | 2 | US | Yes | Hands and information |
| 109 | Yuri and Samantha | 2 | USSR | Yes | Conditional VP and bets |
| 110 | AWACS Sale to Saudis | 3 | US | Yes | Spread influence, Protection and prerequisites |

**The patterns, and what each could become here:**

- **Scoring** (Asia, Europe, Middle East, Central America, Southeast Asia, Africa, South America): a card that scores one region the moment it is played, and can't be held past the turn. *For us:* a card that makes one region's fights happen early, or pays trophies twice there.
- **Flip a country** (Fidel, Romanian Abdication, Nasser, De Gaulle, Sadat Expels Soviets, Iranian Hostage Crisis, John Paul II, The Iron Lady): wipe the rival's influence in one named place and take control. *For us:* one location changes hands outright, as a signature move.
- **Spread influence** (Comecon, Marshall Plan, Decolonization, Colonial Rear Guards, OAS Founded, Puppet Governments, Liberation Theology, Independent Reds, and others): add a little influence across many places, often capped per country. *For us:* scatter influence instead of cubes.
- **Strip influence** (Socialist Governments, Suez Crisis, Voice of America, Truman Doctrine, Pershing II, Marine Barracks Bombing, Muslim Revolution, East European Unrest): remove the rival's influence from a set of places. *For us:* pull rival influence off locations back to their supply.
- **Relocate influence** (De-Stalinization): move your own influence from where it is to new places.
- **War roll** (Korean War, Arab-Israeli War, Indo-Pakistani War, Iran-Iraq War, Brush War): a one-off battle whose odds fall for each adjacent place the defender controls. *For us:* the defender's neighbours matter in a fight.
- **Coup tools** (Junta, Che, Ortega, Tear Down this Wall, Latin American Death Squads, Iran-Contra): free or chained coups, and rolls that favour one side for the turn. Che's second coup happens only if the first one worked.
- **Protection and prerequisites** (NATO, US/Japan Pact, Camp David, AWACS, Formosan Resolution, Willy Brandt, Shuttle Diplomacy): some events lock places against the rival or switch a rival's card off for good; some only work after another card has been played (Marshall Plan or Warsaw Pact before NATO, John Paul II before Solidarity, The Reformer before Glasnost). *For us:* a ward that shuts a suit card off, or a card that only works after another.
- **Ops and tempo** (Containment, Brezhnev Doctrine, Red Scare/Purge, Vietnam Revolts, North Sea Oil, Quagmire, Bear Trap, Chernobyl): raise your card values or lower the rival's for the turn; take an extra action; trap the rival so they must discard to escape; shut one region to them.
- **Hands and information** (CIA Created, Lone Gunman, Aldrich Ames, Five Year Plan, Grain Sales, Missile Envy, Terrorism, Ask Not, Our Man in Tehran, The Cambridge Five): reveal a hand, take or swap a card from it, force a random discard, redraw, or look at the top of the deck. Missile Envy trades for the rival's best card.
- **The discard pile** (SALT Negotiations, Star Wars): take back, or play, a card already used.
- **The doom track** (Duck and Cover, Nuclear Test Ban, Cuban Missile Crisis, How I Learned to Stop Worrying, ABM Treaty, Summit, Wargames, Nuclear Subs, "We Will Bury You", Olympic Games): push DEFCON down for points or up for safety. Cuban Missile Crisis makes the rival's next coup end the game; Wargames lets you end the game at DEFCON 2 by paying the rival. *For us:* cards that move the presence threshold, or that make crossing it on a certain move lose.
- **Cancel or answer** (UN Intervention, Defectors): cancel the rival's event and keep its points; cancel the rival's opening card.
- **Conditional points and bets** (Flower Power, Yuri and Samantha, Arms Race, Kitchen Debates, Alliance for Progress, OPEC, Reagan Bombs Libya, U2 Incident, "An Evil Empire"): score for something the rival does later, or for a board state. *For us:* a bet that pays if a named faction ends up winning, or if a fight happens somewhere.
- **The China Card** (The China Card, Cultural Revolution, Nixon, Ussuri River Skirmish): one card that changes hands every time it is played; other cards steal it. *For us:* a cursed object passed around the town.
- **The space race** (Captured Nazi Scientist, One Small Step): a side track, also used to dump a card you can't afford to play.
- **Ultimatums and doubling** (Blockade, Latin American Debt Crisis): the rival must discard a strong card, or suffer the effect.
- **Lasting effects** (NORAD): a card that keeps paying out each round while a condition holds.

### I.7 More games to mine (from memory; check before relying on details)

| Game | What to look at |
|---|---|
| Smash Up | Minions played onto shared "bases"; a base scores when its total power passes its breakpoint, ranking players 1st, 2nd, 3rd. Very close to our locations, fights and trophy places. |
| El Grande (C.15) | Action cards with a strength value and a special power; scoring regions; the Castillo as a hidden area. |
| A War of Whispers (C.11) | Players move any empire; loyalties are secret. The closest relative of our influence. |
| Twilight Struggle | Each card is either an event or operations points, and an opponent's event fires if you play it for points. |
| Root | Shared deck of suited cards (by clearing type); crafting; ambush cards played in response. |
| Cosmic Encounter | Every alien power breaks one rule; allies invited into a fight share the reward. |
| Dune (2019) | Secret traitors among the leaders; battle plans dialled in secret; alliances with shared win conditions. |
| Chaos in the Old World | Cards placed on regions to change how that region scores; each god's threat dial. |
| Cthulhu Wars | Every faction's spellbooks unlock rule-breaking powers. |
| Rising Sun | Seasons of political actions chosen by the leader; others follow with weaker versions; tea-ceremony alliances. |
| Kemet | Power tiles that permanently change how you fight, move or recruit. |
| Cyclades | Bidding on gods each round; the winning god decides your action. |
| Horrified | Classic movie monsters move by card; villagers must be escorted; each monster has its own defeat puzzle. |
| Last Night on Earth | Heroes and zombies; event cards full of horror-movie tropes. |
| Fury of Dracula / Letters from Whitechapel | Hidden movement: the monster's trail, deduced from clues. |
| Mysterium | A ghost communicates through visions; a natural source for séance and information cards. |
| Arkham Horror (3rd) | Mythos cards that spread doom across neighbourhoods; monster surges. |
| Spirit Island (C.13) | Invaders explore, build and ravage in a visible order; fear cards; slow and fast powers. |
| Tammany Hall | Ward bosses, influence placed and lost in elections; city offices with powers. |

### I.8 Sources

- The King is Dead, 2nd edition rulebook (Osprey Games, 2020), via bghub.org.
- Blood Rage and Rumble Nation game help, Board Game Arena (en.doc.boardgamearena.com).
- Cuba Libre playbook (GMT Games, 2018) and Twilight Struggle 2nd edition rules (GMT Games).
- Twilight Struggle card list: twilightstrategy.com/card-list; sides and removal from the open-source vrazix/twilight-struggle card data (github.com).
- Other COIN games: reviews at theplayersaid.com and therewillbe.games, and BoardGameGeek threads.
- Inis: the Inis fan wiki (inis-game.fandom.com, through its page API), web search results quoting card texts, and Order of Gamers' rules summary (orderofgamers.com).
