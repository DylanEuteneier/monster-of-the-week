# Monster of the Week: principles

The designer's goals, preferences and principles for this game, gathered from the whole design process into one place. CLAUDE.md imports this file, so it is in context for every decision. Every proposal, measurement and change is checked against it.

Everything here is the designer's own, said during the work. Each line cites where it was said (a design document section, a decision, or a date). It changes only when the designer states or changes a preference: add the new one here, with its source, in the session it's said. The design document's sections 1.2 to 1.4 point here; its 1.7 holds the working notes on how the game feels in play now.

## Goals

**Pillars** (1.2): what the game must be.

1. **Push and pull** between the players and the two major win conditions.
2. **Tough decisions** that spawn from a limited set of actions.
3. **Read the table.** Players constantly analyze other players' positions to understand how to advance their own.
4. **Simple mechanisms.**
5. **Few choices, huge consequences.** A thinky decision space built from very few possible decisions; each choice's consequences turn on what other players aim for and have invested in.

**Anti-goals** (1.3): what the game deliberately is not.

- **Not heavy or involved.** The game is light.
- **Not economy-focused.** An economic system is not the focus of play.

**Feel** (1.4)

- **A readable board state** is the main mechanism.
- **Never in control.** Players never feel in direct control of the island. As in monster-of-the-week shows, they launch gambits, hatch plans, set traps and conduct séances that make the invaders react.
- **Knife's edge.** The game balances on a knife's edge between its two endings: the island winning (players compete on trophies) and a faction winning (players compete on standing with it).
- **Ties are a tool:** for clearing factions and the sway around them off the board, and for stopping a player carrying an allied faction past the presence check.
- **Mostly open, with room for gambits:** just enough hidden to keep tension and let players deny each other.
- **On the board, not in memory.** Wherever possible a rule is driven by a piece in the play space; persistent rules with no piece are hard to track.
- **Dynamic and active.** The board stays lively: things happen on it, and players have real options with their cards in every round (1.7, 2026-10-29).

## What a good game looks like

The game report (`scripts/measure.js`) measures each of these. Its targets are provisional, never decisions.

- **The island wins more than half the time** (1.4, 2026-10-07).
- **Every round matters.** Rounds build tension, and each helps decide the ending; one last round deciding everything would feel unsatisfying (RV1, 2026-10-31). A last-round flip is welcome, but if it happens never or almost always, that's a worry. The ending must not be decided only in round 5, and no round-5 decider at all is bad too.
- **No runaway frontrunner.** A comeback is possible, even in round 5, and fortunes change.
- **The invaders' ending is not a plain sway race:** not one sway bid for a single faction; players back different factions (3.15). It depends on someone taking the risk and pushing above the bar, so early backing paying less is intended (2026-11-05).
- **Fights stay costly**; backing must not get easy, and doing your own thing away from the fights must not become too valuable (3.5, 2026-10-29).
- **A hand gives real choices** (2026-11-07). The design feels sound; the cards are what need proving.

## Cards

- **Thematic above all.** Every card is incredibly thematic, feels very unique and fits its suit's theme; everything else serves that (3.7, 2026-10-05). Signatures are the most thematic and have the most interesting abilities in their suit (2026-10-15).
- **Written from the slayers' side,** never the monster's: something a slayer group would plausibly do that moves the monsters (3.7, principle 11).
- **Every card unique.** Each presence effect is its own way of moving, a gambit only its holder has (principle 13). Cards can't overlap: an effect like a gather appears once (2026-10-13).
- **A spread of power is good.** A weaker action is balanced in other ways: something special and slightly rule-breaking, more sway, or more flexibility (2026-10-07). Gut ranking, strongest first: alters a large, high-trophy fight; takes sway control of a contested region; moves tokens and places lots of sway; moves in ways that break the normal rules.
- **Fights are rarely made to disappear.** Being outbid at a location is the core struggle, not an undo. No mechanics that track what was done just to make undoing costlier: the answer is in the cards, by cutting or tightening the lazy, underdeveloped actions (2026-10-13).
- **Strong tropes with a puzzle for the player** (Invite Them In, Bait the Herd, The Big Chase, Plough Through were liked). No geometric movement: push chains, slides, leaps, shoves, swaps, straight lines, blasts (2026-10-17).
- **Card text is already a heavy load.** Prefer a global rule to more card text (GR5, 2026-10-29).

## Tuning

- **One lever at a time, read against the baseline** (1.1, the process).
- **The threshold is the last lever.** Keep the bar at 20 while testing. It only shifts the ending split, so moving it early hides what other changes do (2026-11-01).
- **Presence and the ending split are balanced together.** Raising presence pushes the split toward the invaders (1.7, 2026-10-29).
- **Bots are the instrument, not the target.** Bots play to win, as strongly and as naturally (human-like) as we can make them. Choose bot settings only by play quality, never toward the endings we hope to see; a strong, natural bot that shows bad dynamics is a finding about the game (2026-11-05). Marginally suboptimal, human choices are fine (2026-11-06). Bots may see hidden information in play-outs (2026-10-26).
- **Remove weak bots** as soon as they measure clearly worse; a weak bot skews every card measurement (2026-10-09).
- **Data quality over speed**, so bots search as deep as helps. The limit is a live game against bots in the browser getting too slow to play (2026-11-05). No numbers taken from past tests are hard-coded into bot maths where the game itself can supply them.

## Player-facing words

- **Sway** for a player's standing with a faction and for what they place on locations. Call the piece a **cube** only when explaining the physical piece; never "coloured squares" (D18, 2026-10-10).
- Presence is "monsters on the island". Slayers hatch gambits (bait, traps, plans) hoping monsters react; sway is never command, nor a faction's liking (2026-10-10).

## The table (prototype)

Prototype choices are for testing only, never rules (2026-10-03). Within them:

- Printed art is pixel art, from the palette only, scaled by whole numbers. Physical things are UI. Tokens and cubes are CSS pieces (F.17).
- UI uses no pixel assets unless the designer asks: plain CSS from the palette, clean solid borders, pixel-font headers in all caps. Hover and target states never draw outside the art's footprint and never change hex borders; only the light changes (2026-10-06).
- On phones a regular game never scrolls the page by itself; prompts name where the next click is (2026-10-31).
- Cards: the icon appears once, in the topline; target rows have clear dividers and look clickable; colour blocks are full bleed; every card carries thematic text at the bottom (2026-10-30).
- The table's presentation (tooltips, panels, prompt wording) is Claude's call: decide, build, mention it. Rules, cards and the game's feel are the designer's (2026-10-29).
