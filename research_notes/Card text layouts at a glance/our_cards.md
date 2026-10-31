# Our cards: what the text holds, and how it breaks into parts

Scope: the 21 cards in the current core deck of Monster of the Week (15 suit cards: one strike, shift and signature for each of 5 suits; plus 6 unsuited extras), from local files only. Nothing here changes or adds a rule. Everything marked **DRAFT** is a candidate split made for this analysis only, not a decision and not proposed card text.

Source key (all local, repo root `/Users/dylaneuteneier/Projects/monster-of-the-week`):
- [spec] = `public/spec.json`, `cards` array (21 entries; the exact printed text and readings the prototype uses)
- [doc Lnn] = `docs/motw-design.md`, line nn
- [cards.js] = `public/cards.js` (how a card renders now)
- [icons.js] = `public/icons.js` (VERBS, NOUNS, direction B diagrams)
- [assets.js] = `public/assets.js` lines 44–81 (the "cards in blocks" draft on the assets page)
- [app.css] = `public/app.css` lines 592–648 (card frame CSS)

## 1. Which source is current (read this first)

### Takeaway
The card text to analyse is in `public/spec.json`, and the design notes for each card are in the design doc's "Current focus" section. The Appendix H tables (H.1–H.6) hold older ideas from revision rounds 1–19, not the current 21 cards.

### Cited Findings
- The spec's `cards` array has exactly 21 cards: 15 suit cards (`round: 21`, except Light of the Cross, which has no round field) and 6 unsuited extras (`round: 22`, slot `extra`, sway 0) — [spec]
- Appendix H says "Entries are ideas for the first draft, not decisions, until the designer picks them" — [doc L3237]. Its suit tables (H.1–H.5, L3255–3378) list round 1–13 ideas (Leave Out Fresh Meat, Broadcast a Signal, etc.). None of the current strikes, shifts or signatures appear in those tables.
- The current cards are recorded in "Current focus", slot by slot: strikes (L22–39), shifts (L40–46), signatures (L47–66), the way back (L70–72), unsuited (L73–84) — [doc L22–84]
- H.6 still lists the older unsuited cards (Set a Trap A, Lock Down the Town C, Put a Bounty On It D, Plan B) — [doc L3379–3400]. These were replaced on 2026-10-24: "the marks; all six built as test cards, `favours`, `stakes`, `exit`, `showdown`, `switch`, `playbook`, replacing the stand-ins in the core deck" — [doc L73]
- H.9 "Action types" (L3557–3578) is a list of design-space suggestions from 2026-10-05 ("Suggestions from a design pass on 2026-10-05; not decisions"), not a description of current cards — [doc L3559]

### Inferences
- A report on text layout should treat [spec] as the printed text and [doc L22–84] as the rules behind it. Appendix H is useful only for history and for the older "Kind" vocabulary.

### Gaps
- No current Appendix H entry exists for the 21 cards, so where the doc and spec name things differently (see §6) there is no single catalogue that settles it.

## 2. Card anatomy as built now (physical and visual constraints)

### Takeaway
A prototype card today is a 214 px wide frame: a coloured suit band (glyph, suit name, slot), the name, the text, then either per-use rows (STAND / SWAY / TOKENS / THEIRS / YOURS) or LOC/FAC reading rows, with an option column on the right (LOC, FAC, +N sway, BACK). Action icons exist only as a draft (direction B: mini board diagrams) and no card uses them yet.

### Cited Findings
**Frame and band**
- Card width `--card-w: 214px`; face colour `--card-face: #fbf6ea` ("token cardboard"); solid ink border and shadow — [app.css L93, L111, L592–604]
- The band is filled with the suit colour (`--suit`), in the display font, uppercase, 11 px. For a suit card it holds the suit's pixel symbol, the suit name and the slot. For an unsuited card it holds "Marked A–D" and "opens", or "Unsuited" — [cards.js `band`; app.css L610–616]
- The name is in the display font, uppercase, 13 px — [app.css L617]
- Suit glyphs: Nocturnals ◐, 80's Sci-Fi ↂ, Sentients ⏏, Undead ☾, Demons ⎈ — [spec `archetypes`]

**Text area**
- A card whose text starts "Choose one." is split by `usesOf()` into a head, one row per use, and a foot. The use names map to short tags: `{ Standing: 'STAND', Sway: 'SWAY', Tokens: 'TOKENS', Theirs: 'THEIRS', Yours: 'YOURS' }`. The foot is a closing sentence starting "X is" or "It can't be" — [cards.js `USE_TAGS`, `usesOf`]
- Use rows are a grid with a 44 px tag column. The chosen use stays lit and the others fade to 40% — [app.css L627–631; cards.js]
- The code comment gives the reason: "A card with uses ... reads as a list, one row per use, not a paragraph (designer, 2026-10-29: glanceable) ... Presentation only: the words are the card's." — [cards.js]
- Any other card shows its text as one paragraph. Below it, suit cards show a readings list with `LOC` and `FAC` tags in a 26 px column. The FAC row adds the seat's actual faction name in brackets, and once a reading is chosen the other fades — [cards.js `reading`, `readings`; app.css L620–625]
- When a reading can't be played, it lists what it needs, each marked ✓ or ✗ (designer, 2026-10-28) — [cards.js `why`]
- There is no tooltip: "the card itself shows the text, and a tooltip only covered it (designer, 2026-10-29)" — [cards.js]

**Option column (right side, suit cards only)**
- Buttons: `LOC`, `FAC` (only if the card has an action), `+N` (spend for sway; N is the printed sway, or for a signature the seat's hand size), and `BACK` (bring the faction back) — [cards.js `options`]
- Printed sway in spec: strikes 2, shifts 3, signatures 4. D24 overrides the signatures: "a signature's printed sway is 1 for each card in your hand, itself included, with no cap" — [spec; doc L1286–1290]
- Unsuited extras have no sway use: "the six unsuited extra cards ... don't offer sway" (principle 8) — [doc L845]

**Icons (IK1, D34): decided, not yet on cards**
- D34: "an icon is composed of a verb mark and a noun mark ... Composable blocks, not a unique icon for everything (designer): a new card is written with the existing marks" — [doc L1395–1399]
- IK1's open items: "the look of each mark, and the high-level line for each card that applies one action to different sets" — [doc L782]
- IK1 also says "the cards that apply one action to different sets should state the action at a high level before each use's details" — [doc L782]
- Verbs in code: gather, spread, move, split, trail, march, drive, flee, slay, raise, mark, join, pay, gain, burn, take, bend. Nouns: token, group, lone, fight, sway, standing, location, neighbour, empty, scorched, supply, trophy, pile, card, played, mark, gate, leader — [icons.js `VERBS`, `NOUNS`]
- Direction B (designer, 2026-10-30): "each verb is a mini board diagram, its places and arrows, and the noun is the piece that moves through it. Standing is off the board, so its places are faction circles, not hexes." Each diagram is an 80×44 box drawn at 100×55 px — [icons.js comment and `dia`]
- Amount badges: "An amount (1, X, ½, all) sits beside it where it matters ... No card uses them yet." — [assets.js L77]
- Draft "cards in blocks" on the assets page: Raise the Stakes ("Gather up to X into one: standing, sway or tokens."), Cover Every Exit ("Spread 1 to each of up to X."), Switch Allegiance ("Move up to X from one to another."), Call in Favours ("Gain up to X from your supply."), Draw Them Away, Light of the Cross, The Big Chase, Showdown, Spill Blood on the Altar, Wake the Dead. Each pairs a one-line gist with block lines plus a few words — [assets.js L50–75]
- The project memory records that the designer disliked the first draft ("woof, those need work"). The commit `7c77554` records the designer choosing direction B — [memory icon-set-in-progress.md; git log of icons.js]

**Prototype status**
- CLAUDE.md says prototype choices (art, layout, palette) "are for testing only. Never apply them to the rules or treat them as settled design" — [CLAUDE.md]

### Inferences
- Two text layouts already exist side by side: a use-row list for multi-use cards, and a paragraph plus LOC/FAC rows for suit cards. The suit cards have no equivalent of the use rows for their effect text.
- The `SWAY` use tag (board sway, on unsuited cards) and the `+N` sway button (spend a suit card for standing) share the word "sway" but mean different plays. Unsuited cards have no +N button, so they never appear together on one card.

### Gaps
- The design doc does not record "direction B". It exists only in the code comments, the assets page text and the commit message. D34 still lists "the look of each mark" as open.
- I found no recorded physical (printed) card size or print layout. All dimensions above are from the web prototype.

## 3. Inventory: every card, broken into parts

Notes that apply to all suit cards (not printed on them):
- Common card rules (D23) apply unless the card says otherwise: all or nothing; half from a fight (rounded down); sway paid from standing with the faction moved; 1 sway at each location tokens leave or reach; only where a group can enter; you place odd tokens; you choose who pays where several factions meet; sway placed without movement comes from a faction there (or the suit's faction); every signature bids up to its sway — [doc L1292–1301]
- Every suit card has three ways to play: its action (on one of two readings), spend it for its printed sway with its faction (+N), or BACK (bring its faction back when it has no location with 2+ tokens; "Place up to X of its tokens ... paying 1 standing with that faction per token") — [doc L70–71; principle 7, L844]
- D33: by default, shifts bring tokens: "each sway a shift places on the board brings 1 of its faction's tokens from the supply to the same location". This is a switch (`swayTokens`), not printed on any card — [doc L1384–1390]
- Readings (principle 14): "a location: any faction, at one of the suit's locations; or a faction: the suit's own (affinity) faction, at any location" — [doc L851–855]
- The slot briefs: Strike, "a gather ... draws groups together into a contest"; Shift, "a dispersal ... spreads tokens out"; Signature, "the suit's primary card" — [doc L860–863]

"Uses" below means separate choices printed on the card. Suit cards have one action with two readings, plus the unprinted +N and BACK plays. Word counts are spec `text` plus both readings.

### 3.1 Strikes (printed sway 2)

**Invite Them In** — ◐ Nocturnals · Strike · +2 · 46 words (text 17, readings 29)
- Text: "Two groups of different factions next door are invited into an empty location. Target: where they’re invited." — [spec `invite-in`]
- LOC: "an empty ◐ location; any two groups next to it." FAC: "a location held by a lone group of another faction, next to a Nocturnal group: only the Nocturnals come." — [spec]
- Verb: gather (tokens) (IK1 lists it under Gather) — [doc L791]. Nouns: groups/tokens; location.
- Targets, in order: the destination location first, then the group(s) that come. On LOC, two groups of different factions next to it; on FAC, the Nocturnal group next to a lone host.
- Amount: whole groups (half from a fight, D22 global) — [doc L33]
- Unique rules: the destination is empty (LOC) or holds a lone host (FAC); next door only; all or nothing. The doc's sway detail: "3 sway: 1 at each location they left and 1 at the new fight" (LOC) and "2 sway" (FAC) — [doc L33–35]
- Flavour: none apart from the verb "invited".
- Note: the two readings change the shape of the effect (two groups into an empty place, against one Nocturnal group joining a lone host). The readings are longer than the effect text.
- **DRAFT split** — Topline: "Gather groups into a location." Targets: "Where (LOC: empty ◐ location; FAC: a lone rival's location next to Nocturnals) → who comes (LOC: any two groups next door, of different factions; FAC: only the Nocturnals)." Specifics: "next door only." Flavour: (none in text).

**The Gate** — ↂ 80's Sci-Fi · Strike · +2 · 84 words (text 60, readings 24)
- Text: "Join two locations for the rest of the round: they count as a single location for movement, and fight as one (strength and sway added across both; a true tie scorches both). Each end is an ↂ location or a location holding the Sci-Fi faction; never three factions across them. Only 1 sway, at one end. Target: the two ends." — [spec `gate`]
- LOC: "either end: an ↂ location, or a location holding the Sci-Fi faction." FAC: "either end: a location holding the Sci-Fi faction, or an ↂ location." — [spec]
- Verb: join (locations) — [doc L800]. Nouns: location, fight.
- Targets: two ends, chosen one after the other. Either end may be either kind, so the readings are near mirror images.
- Amount: none (no tokens move). Duration: the rest of the round.
- Unique rules: one location for movement; fights merged (strength and sway added; a true tie scorches both); never three factions across the ends; "Only 1 sway, at one end" (a stated exception to common rule 4) — [doc L1302]. The doc adds more detail that is not printed: the winner's losses come from either end; groups at both ends are one group; hidden tokens at both ends flip — [doc L36]
- Flavour: none in text (the theme is Stranger Things' gate, a wormhole) — [doc L36]
- **DRAFT split** — Topline: "Join two locations as one." Targets: "two ends, each an ↂ location or a location holding the Sci-Fi faction." Specifics: "rest of the round; one location for movement; one fight (strength and sway added; true tie scorches both); never three factions; only 1 sway, at one end." Flavour: (none).

**Spoof the Signal** — ⏏ Sentients · Strike · +2 · 51 words (text 41, readings 10)
- Text: "The AV Club spoofs a command signal to a group: ordered to engage the strongest hostile force in range, it marches on the largest lone group of another faction within two locations of it (ties: your choice). Target: the group fooled." — [spec `hack-targeting`]
- LOC: "a group at a ⏏ location." FAC: "a Sentient group anywhere." — [spec]
- Verb: march on (tokens) — [doc L796]. Nouns: group, lone group.
- Targets: the attacking group (the player's choice). The card's rule then picks the destination: the largest lone rival group within two locations.
- Amount: the whole group (half from a fight).
- Unique rules: range two; the target is chosen by the rule, not the player (ties: your choice); "whatever lies between is ignored"; "no lone rival in range, no play" — [doc L37]
- Flavour: "The AV Club spoofs a command signal ... ordered to engage the strongest hostile force in range". The flavour is woven into the rule sentence.
- **DRAFT split** — Topline: "A group marches on the largest lone rival." Targets: "the group fooled (LOC: at a ⏏ location; FAC: a Sentient group) → automatically, the largest lone group of another faction within two locations." Specifics: "ties: your choice." Flavour: "The AV Club spoofs a command signal: engage the strongest hostile force in range."

**Bait the Herd** — ☾ Undead · Strike · +2 · 52 words (text 42, readings 10)
- Text: "Lay a trail of bait: a group follows it from neighbour to neighbour, picking up its own kind at every stop and leaving nothing behind. It stops where you choose, or crashes into a lone group of another faction. Target: the herd." — [spec `bait-trail`]
- LOC: "a group at a ☾ location." FAC: "an Undead group anywhere." — [spec]
- Verb: trail, picking up (tokens) — [doc L795]. Nouns: group, neighbour, lone group.
- Targets: the herd group, then a path of stops (the player's choice), ending at a stop or at a crash.
- Amount: whole group plus everything of its kind picked up (half from fights).
- Unique rules: picks up its own kind at every stop; leaves nothing behind; ends at your choice or crashing into a lone rival; 1 sway on every location (start, each stop, crash) — [doc L38]
- Flavour: "Lay a trail of bait:"
- Doc note: "the mirror of the Big Chase" — [doc L38]
- **DRAFT split** — Topline: "Trail a group, picking up its kind." Targets: "the herd (LOC: at a ☾ location; FAC: an Undead group) → stops, neighbour to neighbour." Specifics: "picks up its own kind at every stop, leaves nothing; ends where you choose or crashes into a lone rival." Flavour: "Lay a trail of bait."

**Perform the Ritual** — ⎈ Demons · Strike · +2 · 68 words (text 50, readings 18)
- Text: "Father and the Flock begin the rite, and one faction next door is drawn to it: every group of it comes, whole if it’s alone, as many as you choose if it’s in a fight. The centre is empty or holds one faction. Target: the centre, then the faction called." — [spec `ritual`]
- LOC: "a ⎈ location; any faction is called." FAC: "any location next to the Demon faction; the Demons are called." — [spec]
- Verb: gather (tokens) — [doc L791]. Nouns: location (centre), faction, groups next door.
- Targets, in order (printed): "the centre, then the faction called".
- Amount: every group of the called faction next door, whole if alone; from a fight, "as many as you choose" (the doc: "any number up to half, rounded down ... so at least half always stays") — [doc L39]
- Unique rules: the centre is empty or holds one faction; a faction (not a group) is called; all of its neighbouring groups come.
- Flavour: "Father and the Flock begin the rite, and ..."
- **DRAFT split** — Topline: "Gather one faction from next door." Targets: "the centre (LOC: a ⎈ location; FAC: next to the Demons) → the faction called (LOC: any; FAC: the Demons)." Specifics: "every group next door comes, whole if alone; from a fight, as many as you choose; centre empty or one faction." Flavour: "Father and the Flock begin the rite."

### 3.2 Shifts (printed sway 3)

**Draw Them Away** — ☾ Undead · Shift · +3 · 47 words (text 37, readings 10)
- Text: "The Watch sets out distractions all round the location, and one of the dead shambles off to check each. A group sends 1 token to each of at least two neighbours; the rest stay. Target: the group." — [spec `draw-away`]
- LOC: "a group at a ☾ location." FAC: "an Undead group anywhere." — [spec]
- Verb: spread (tokens) — [doc L792]. Nouns: group, token, neighbour.
- Targets: the group, then its neighbours (at least two, the player's choice).
- Amount: 1 token per neighbour; at least two.
- Unique rules: "the rest stay". Under D23 the sway is 1 where the group leaves and 1 at each neighbour reached.
- Flavour: the whole first sentence (19 words).
- **DRAFT split** — Topline: "Spread 1 token to each of 2+ neighbours." Targets: "the group (LOC: at a ☾ location; FAC: an Undead group) → at least two neighbours." Specifics: "the rest stay." Flavour: "The Watch sets out distractions; one of the dead shambles off to check each."

**The Big Chase** — ↂ 80's Sci-Fi · Shift · +3 · 61 words (text 51, readings 10)
- Text: "The Kids on Bikes lead a group on a chase from neighbour to neighbour, across any region, through empty ground, lone rivals, its own kind and fights it’s part of. Every location it passes keeps 1 token; the rest, at least 1, arrive wherever you end it. Target: the group chased." — [spec `big-chase`]
- LOC: "a group at an ↂ location." FAC: "a Sci-Fi group anywhere." — [spec]
- Verb: trail, dropping 1 per step (tokens) — [doc L795]. Nouns: group, neighbour, token.
- Targets: the group chased, then a path (the player's choice), then the end.
- Amount: 1 per location passed; at least 1 arrives.
- Unique rules: what it can pass through (empty ground, lone rivals, its own kind, fights it's part of), and by the doc "never a fight it isn't part of"; "It runs as far as the player's sway allows" — [doc L44]
- Flavour: "The Kids on Bikes lead a group on a chase", woven into the rule.
- **DRAFT split** — Topline: "Trail a group, dropping 1 at each step." Targets: "the group chased (LOC: at an ↂ location; FAC: a Sci-Fi group) → path → where you end it." Specifics: "any region; through empty ground, lone rivals, its own kind and its own fights; at least 1 arrives." Flavour: "The Kids on Bikes lead it on a chase."

**Cut the Powerlines** — ⏏ Sentients · Shift · +3 · 56 words (text 46, readings 10)
- Text: "The AV Club cuts the powerlines. A group scatters to its faction’s other groups anywhere on the island, 1 token at a time: no group gets a second until every group has one. A lone group leaves entirely; from a fight, exactly half. Target: the group." — [spec `cut-powerlines`]
- LOC: "any group at a ⏏ location." FAC: "a Sentients group anywhere." — [spec]
- Verb: spread (tokens), to its own groups (IK1: "Cut the Powerlines to its own groups") — [doc L792]. Nouns: group, token.
- Targets: the group, then the destination groups (the player's choice for extras) — [doc L45]
- Amount: a lone group, all of it; from a fight, exactly half (a stated exception) — [doc L1302]
- Unique rules: destinations anywhere on the island, but only its own faction's groups; round-robin (1 each before any gets a second); "unplayable with no other group to rejoin" — [doc L45]
- Flavour: "The AV Club cuts the powerlines." (6 words)
- **DRAFT split** — Topline: "Spread a group to its own kind, anywhere." Targets: "the group (LOC: at a ⏏ location; FAC: a Sentient group) → its faction's other groups." Specifics: "1 at a time, every group one before any gets two; a lone group leaves entirely; from a fight, exactly half." Flavour: "The AV Club cuts the powerlines."

**Plough Through** — ◐ Nocturnals · Shift · +3 · 65 words (text 53, readings 12)
- Text: "The Slayerettes plough a truck straight through the middle of the brawl. Every side leaves by half, rounded up, split as you choose among its neighbours, never two sides to the same location. Its sway is paid by the factions in the fight or the Nocturnals, split as you choose. Target: the fight." — [spec `plough`]
- LOC: "a fight at a ◐ location." FAC: "a fight the Nocturnals are in." — [spec]
- Verb: drive out (tokens; every side leaves a fight) — [doc L797]. Nouns: fight, sides, neighbours.
- Targets: the fight, then exits for each side.
- Amount: half rounded up from every side (a stated exception to D22; a side of 1 leaves, so the fight can break) — [doc L41; D22 L1280]
- Unique rules: never two sides to one location; sway paid by the fight's factions or the Nocturnals, split as you choose (a stated exception) — [doc L1302]
- Flavour: the first sentence (12 words).
- **DRAFT split** — Topline: "Drive every side out of a fight." Targets: "the fight (LOC: at a ◐ location; FAC: one the Nocturnals are in) → exits for each side." Specifics: "half, rounded up, from each side; never two sides to one location; sway paid by the fighting factions or the Nocturnals, split as you choose." Flavour: "The Slayerettes plough a truck through the brawl."

**Light of the Cross** — ⎈ Demons · Shift · +3 · 38 words (text 28, readings 10)
- Text: "The cross is raised and the target group falls back from its light, split evenly between two neighbours. A group of 1 can’t be split. Target: the group." — [spec `light-cross`]
- LOC: "any group at a ⎈ location." FAC: "a Demon group anywhere." — [spec]
- Verb: split (evenly in two) (tokens) — [doc L794]. Nouns: group, neighbour.
- Targets: the group, then two neighbours.
- Amount: half and half (you place an odd token, common rule 6); from a fight, D22 limits it to half the group — [doc L46]
- Unique rules: never a group of 1.
- Flavour: "The cross is raised and the target group falls back from its light", woven into the rule. This is the shortest suit card.
- **DRAFT split** — Topline: "Split a group evenly in two." Targets: "the group (LOC: at a ⎈ location; FAC: a Demon group) → two neighbours." Specifics: "not a group of 1." Flavour: "The cross is raised; they fall back from its light."

### 3.3 Signatures (printed sway 4 in spec; actually the hand size, D24)

**Wake the Dead** — ☾ Undead · Signature · +hand · 87 words (text 64, readings 23), the longest card
- Text: "The Watch chases the fight into the old cemetery, and the dead rise: as many from the Undead supply as you choose, up to the card’s sway. At a ☾ location they rise as a group of their own, and if two factions are already fighting there, as a third side. Each one risen places 1 of your sway there. Target: where they rise." — [spec `wake-the-dead`]
- LOC: "any ☾ location; at a fight there, the dead rise as a third side." FAC: "any location holding the Undead; the risen join them." — [spec]
- Verb: raise / bring (tokens from supply) — [doc L799]. Also places sway (the bid). Nouns: supply, token, location, fight.
- Targets: the location where they rise.
- Amount: up to the card's sway (= hand size).
- Unique rules: the only three-way fight in the game ("the only way a three-way fight happens"). The three-way fight's resolution rules are in the doc, not on the card — [doc L59]. "Each one risen places 1 of your sway there" (sway per token, not per location).
- Flavour: "The Watch chases the fight into the old cemetery, and the dead rise:" (13 words)
- Note: the LOC rule appears twice, once in the text and once in the LOC reading.
- **DRAFT split** — Topline: "Raise up to X Undead from the supply." Targets: "where they rise (LOC: a ☾ location, as their own group, or a third side at a fight; FAC: where the Undead are, joining them)." Specifics: "1 of your sway per token risen." Flavour: "The Watch chases the fight into the old cemetery, and the dead rise."

**Take Control** — ⏏ Sentients · Signature · +hand · 80 words (text 59, readings 21)
- Text: "The AV Club takes control of the machines and turns them on the enemy. At the target fight, spend your sway there, 1 for each, to cut down up to the card’s sway of a faction’s tokens there: you take them as trophies, and the sway spent goes back to your supply. Target: the fight, then the faction hit." — [spec `take-control`]
- LOC: "any fight at a ⏏ location; you choose the faction hit." FAC: "any fight the Sentients are in; their rival is hit." — [spec]
- Verbs: slay (tokens become your trophies) — [doc L798]. Also burn sway back to the supply — [doc L802]. Nouns: fight, sway, token, trophy, supply.
- Targets, in order (printed): "the fight, then the faction hit".
- Amount: up to the card's sway, limited by your sway there (1 sway per token).
- Unique rules: the spend replaces the signature's bid (a stated exception); trophies at once; "Wiping the rival out is allowed, so this fight can disappear" — [doc L62; L1302]
- Flavour: the first sentence (14 words).
- **DRAFT split** — Topline: "Slay up to X at a fight, burning your sway." Targets: "the fight (LOC: at a ⏏ location; FAC: a fight the Sentients are in) → the faction hit (LOC: your choice; FAC: their rival)." Specifics: "1 of your sway there per token; they're your trophies; the sway goes back to your supply." Flavour: "The AV Club turns the machines on the enemy."

**Night Terrors** — ◐ Nocturnals · Signature · +hand · 64 words (text 58, readings 6)
- Text: "The Slayerettes stir up terrors in the dark. Mark up to the card’s sway of locations, 1 sway on each. When night falls, before the fights, at each mark you may make 1 token of a faction there flee to a neighbouring location it can enter; your sway from the mark may follow it. Target: the locations marked." — [spec `night-terrors`]
- LOC: "◐ locations." FAC: "locations holding the Nocturnals." — [spec]
- Verbs: mark (locations, 1 sway), later flee (1 token at night) and move sway (the sway "following") — [doc L797, L793, L801]. Nouns: location, mark, sway, token, neighbour.
- Targets: up to X locations (several targets of one kind).
- Amount: up to the card's sway of marks; 1 token per mark.
- Unique rules: a delayed effect at nightfall (a new step before the fights); optional; the sway may follow; no three-way fights ("a fleeing token enters only where it could normally") — [doc L48]
- Flavour: the first sentence (8 words).
- **DRAFT split** — Topline: "Mark up to X locations." Targets: "the locations marked (LOC: ◐ locations; FAC: locations holding the Nocturnals)." Specifics: "at nightfall, before the fights, at each mark you may make 1 token flee to a neighbour; the mark's sway may follow." Flavour: "The Slayerettes stir up terrors in the dark."

**Study the Bodies** — ↂ 80's Sci-Fi · Signature · +hand · 56 words (text 49, readings 7)
- Text: "The Kids on Bikes sneak in after the fight to study the bodies. Mark up to the card’s sway of locations, 1 sway on each. This round, at a marked location’s fight, if you lead there, you also take 1 trophy from the runner-up’s pile. Target: the locations marked." — [spec `study-bodies`]
- LOC: "ↂ locations." FAC: "locations holding the Sci-Fi faction." — [spec]
- Verbs: mark; bend a fight ("the leader also takes 1 from the runner-up's pile") — [doc L801, L804]. Nouns: location, mark, fight, trophy, pile, leader.
- Targets: up to X locations.
- Amount: up to the card's sway of marks; 1 trophy per fight.
- Unique rules: only if you lead; "No runner-up ... nothing extra"; a mark with no fight comes to nothing — [doc L51]
- Flavour: the first sentence (13 words).
- **DRAFT split** — Topline: "Mark up to X locations." Targets: "the locations marked (LOC: ↂ locations; FAC: locations holding the Sci-Fi faction)." Specifics: "this round, at a marked fight, if you lead, you also take 1 trophy from the runner-up's pile." Flavour: "The Kids on Bikes sneak in after the fight to study the bodies."

**Spill Blood on the Altar** — ⎈ Demons · Signature · +hand · 46 words (text 40, readings 6)
- Text: "Father and the Flock spill blood on the altar. Mark up to the card’s sway of locations, 1 sway on each. This round, at a marked location’s fight, the winner loses as many as the loser. Target: the locations marked." — [spec `spill-blood`]
- LOC: "⎈ locations." FAC: "locations holding the Demons." — [spec]
- Verbs: mark; bend a fight ("the winner loses as many as the loser") — [doc L804]. Nouns: location, mark, fight.
- Targets: up to X locations.
- Amount: up to the card's sway of marks.
- Unique rules: in a three-way fight, "the larger loser's number" (doc only) — [doc L54]
- Flavour: the first sentence (9 words).
- **DRAFT split** — Topline: "Mark up to X locations." Targets: "the locations marked (LOC: ⎈ locations; FAC: locations holding the Demons)." Specifics: "this round, at a marked fight, the winner loses as many as the loser." Flavour: "Father and the Flock spill blood on the altar."

### 3.4 Unsuited extras (no sway use; X = the cards in your hand, this one included)

**Call in Favours** — Unsuited · Marked A · 2 uses · 36 words
- Text: "Choose one. Sway: 1 sway from your supply at each of up to X fights. Standing: up to X standing with one faction, from your supply. X is the cards in your hand, this one included." — [spec `favours`; uses `["sway","standing"]`]
- Use SWAY: verb gain/place from supply; noun sway; target up to X fights; amount 1 each.
- Use STAND: verb gain; noun standing; target one faction; amount up to X.
- Unique: "Uses the supply, which no other unsuited card reaches"; it can open a round "on its faction reading, as no fights stand at the start" — [doc L80, L73]
- Flavour: none.
- **DRAFT split** — Topline: "Gain up to X from your supply" (assets page draft gist: "Gain up to X from your supply." [assets.js L65]). Targets: "SWAY: 1 at each of up to X fights. STAND: with one faction." Specifics: none. Flavour: (none).

**Raise the Stakes** — Unsuited · Marked B · 3 uses · 62 words
- Text: "Choose one. Standing: take 1 standing from each of up to X factions, all into one. Sway: gather up to X of your sway from next door into one location. Tokens: up to X tokens of one faction come in from its groups next door, to a location where you have sway. X is the cards in your hand, this one included." — [spec `stakes`]
- All three uses share the verb gather (IK1 lists it with token, sway and standing) — [doc L791]
- STAND: 1 from each of up to X factions → one faction. SWAY: up to X of yours from neighbours → one location. TOKENS: up to X of one faction from its groups next door → a location where you have sway (from a fight, half, D22) — [doc L76]
- Flavour: none. The IK1 seed came from this card: "Prompted by Raise the Stakes reading as a paragraph" — [doc L782]
- **DRAFT split** — Topline: "Gather up to X into one." (assets draft: "Gather up to X into one: standing, sway or tokens.") Targets: "STAND: from up to X factions → one. SWAY: from next door → one location. TOKENS: one faction's groups next door → a location where you have sway." Specifics: none beyond targets. Flavour: (none).

**Cover Every Exit** — Unsuited · Marked C · 3 uses · 55 words
- Text: "Choose one. Standing: move 1 standing from one faction to each of up to X others. Sway: send 1 of your sway from one location to each of up to X neighbours. Tokens: a group sends 1 token to each of up to X neighbours. X is the cards in your hand, this one included." — [spec `exit`]
- All three uses share the verb spread (1 to each) — [doc L792]
- STAND: one faction → each of up to X others. SWAY: one location → each of up to X neighbours. TOKENS: a group → each of up to X neighbours it can enter (from a fight, half) — [doc L77]
- Flavour: none (the name: "your people at every way out") — [doc L77]
- **DRAFT split** — Topline: "Spread 1 to each of up to X." Targets: "STAND: one faction → up to X others. SWAY: one location → up to X neighbours. TOKENS: a group → up to X neighbours." Specifics: none. Flavour: (none).

**Showdown** — Unsuited · Marked D · 1 use · 35 words
- Text: "At a lone group, never a fight, burn your sway there, 1 for each token, to take that many of its tokens as your trophies. Burned sway goes back to your supply. Target: the group." — [spec `showdown`]
- Verbs: burn (sway) → slay (tokens as trophies) — [doc L798, L802]. Nouns: lone group, sway, trophy, supply.
- Target: the lone group (location only; no FAC reading) — [doc L79]
- Amount: "up to your sway there and the group's size"; "Not X" — [doc L79]
- Unique: never a fight (to keep it apart from Take Control) — [doc L79]
- Flavour: none.
- **DRAFT split** — Topline: "Burn your sway to slay a lone group." Targets: "a lone group (never a fight)." Specifics: "1 of your sway there per token; they're your trophies; sway back to your supply." Flavour: (none).

**Switch Allegiance** — Unsuited · unmarked · 2 uses · 41 words
- Text: "Choose one. Standing: burn up to X standing with one faction to gain the same with another. Sway: move up to X of your sway from one location to any other. X is the cards in your hand, this one included." — [spec `switch`]
- STAND: burn → gain (1:1), one faction → another. SWAY: move, any distance ("switching sides is instant, so it jumps") — [doc L78]. IK1 lists both under Move — [doc L793]
- Flavour: none.
- **DRAFT split** — Topline: "Move up to X from one to another." (as assets draft). Targets: "STAND: one faction → another. SWAY: one location → any other." Specifics: "it jumps (no path needed)" — doc only. Flavour: (none).

**Steal Their Playbook** — Unsuited · unmarked · 2 uses · 62 words
- Text: "Choose one. Theirs: take a card another player played this round, however they played it, from the played cards into your hand, and play it now as your own. Yours: take back into your hand a card you played earlier this round. It can't be your last card played: as the last card in your hand it is discarded, for no effect." — [spec `playbook`]
- Verb: take a card — [doc L803]. Nouns: played card, hand.
- THEIRS: another player's played card this round → your hand → play now. YOURS: your own earlier card → your hand.
- Card-wide rule (rendered as the foot): "It can't be your last card played ..." (D30) — [doc L1362–1366]
- Flavour: none.
- **DRAFT split** — Topline: "Take a played card." Targets: "THEIRS: another player's card from this round; play it now. YOURS: one of yours from this round, back to hand." Specifics: "not your last card: as your last card in hand it is discarded." Flavour: (none).

## 4. Patterns across the 21 cards

### Takeaway
Thirteen verbs cover 21 cards. Gather, spread and mark each lead three cards, and most other verbs lead one. Every suit card carries a "Target:" line plus a LOC/FAC pair. The repeating text is mostly the targeting formulas and the signature's "mark up to the card's sway", which are candidates for a general rule or keyword. Average length is about 57 words including readings; the longest is 87.

### Cited Findings (counts from [spec], verbs from [doc L790–805])
**Primary verb per card** (IK1 assignments)
- gather: 3 (Invite Them In, Perform the Ritual, Raise the Stakes ×3 uses)
- spread: 3 (Draw Them Away, Cut the Powerlines, Cover Every Exit ×3 uses)
- mark: 3 (Night Terrors, Study the Bodies, Spill Blood), with a second verb each: flee, bend, bend
- trail: 2 (The Big Chase drops, Bait the Herd picks up)
- slay: 2 (Take Control, Showdown), both with burn
- one each: split (Light of the Cross), march on (Spoof the Signal), drive out (Plough Through), join (The Gate), raise (Wake the Dead), gain (Call in Favours), move (Switch Allegiance), take a card (Steal Their Playbook)
- pay sway from standing is in "every action" (IK1) but is never printed, because of D23 rule 3 — [doc L802, L1295]

**Nouns.** Tokens/groups: 13 suit cards plus 3 extras' TOKENS-type uses (Stakes, Exit, Showdown). Sway (your cubes on the board): marks, Take Control, Wake the Dead, Showdown, and the SWAY uses of 4 extras. Standing: the STAND uses of 4 extras (Favours, Stakes, Exit, Switch). D34 cites the gather example ("one gather mark, with a token, sway or standing") — [doc L782]

**Multiple uses.** 5 of 21 cards start "Choose one." (Favours 2, Stakes 3, Exit 3, Switch 2, Playbook 2). Showdown and all 15 suit cards have one printed action. Every suit card also has two readings, and the unprinted +N and BACK plays.

**LOC / FAC readings (all 15 suit cards).** Four formulas repeat:
- "a group at a [glyph] location." / "a/an [Suit] group anywhere.": 6 shifts and strikes (Spoof, Bait, Draw Them Away, Big Chase, Cut the Powerlines, Light of the Cross). The "any group" vs "a group" wording varies.
- "[glyph] locations." / "locations holding the [Suit faction].": the 3 marking signatures.
- "a fight at a [glyph] location" / "a fight the [Suit] are in": Plough Through, Take Control (with a second-step note).
- Destination readings, where the reading changes who comes or how: Invite Them In, Perform the Ritual, Wake the Dead. The Gate's two readings are the same set listed in the other order.
- Principle 14 requires a card to say which counts as the target "when its effect involves two" — [doc L855]. Two cards print a two-step target: Ritual ("the centre, then the faction called") and Take Control ("the fight, then the faction hit").

**Strings repeated verbatim in printed text**
- "Target: …" ends the text of 16 cards (all 15 suit cards and Showdown). Target nouns used: "the group" ×4 (Draw Them Away, Cut the Powerlines, Light of the Cross, Showdown), "the locations marked" ×3, "the group chased", "the group fooled", "the herd", "the fight", "the two ends", "where they’re invited", "where they rise", "the centre, then the faction called", "the fight, then the faction hit".
- "Mark up to the card’s sway of locations, 1 sway on each." ×3 (the marking signatures); "This round, at a marked location’s fight," ×2 (Study, Spill Blood).
- "up to the card’s sway" ×5 (all signatures). "X is the cards in your hand, this one included." ×4 (Favours, Stakes, Exit, Switch). Both are the same quantity, the hand size (D24 and the unsuited X), worded two ways — [doc L1286; L73–80]
- "goes back to your supply" ×2 (Take Control, Showdown).
- "1 token to each of … neighbours" ×2 (Draw Them Away, Cover Every Exit TOKENS).
- "a lone group of another faction" ×3 in text and readings (Spoof, Bait, Invite FAC); "lone group" also in Showdown and Cut the Powerlines.
- Slayer-group openers: AV Club ×3 (Spoof, Cut, Take Control); Kids on Bikes ×2 (Big Chase, Study); Slayerettes ×2 (Plough, Night Terrors); Father and the Flock ×2 (Ritual, Spill Blood); The Watch ×2 (Draw Them Away, Wake). So 11 of 15 suit cards name their slayer group. Principle 11: "Cards are written from the slayer group's point of view" — [doc L848]

**Rules already moved off the cards.** D23 exists because "the new cards were averaging 72 words, mostly repeating shared rules"; after it the text was "shortened to about 44 words on average" — [doc L1304, L1309]. Exceptions that stay printed: The Gate's 1 sway, Take Control's spend, Plough Through's half rounded up and split sway, Cut the Powerlines' exactly half — [doc L1302]

**Length** (words, spec text / text plus readings)
- All 21: average 47.0 / 56.8. Suit cards: 46.3 / 60.1. Extras: 48.5 / 48.5 (no readings).
- Longest: Wake the Dead 87, The Gate 84, Take Control 80, Perform the Ritual 68, Plough Through 65, Night Terrors 64. Shortest: Showdown 35, Call in Favours 36, Light of the Cross 38.
- Flavour sentences, where separable: 6–19 words (Draw Them Away 19; Take Control 14; Wake the Dead 13; Study the Bodies 13; Plough Through 12; Spill Blood 9; Ritual 8; Night Terrors 8; Cut the Powerlines 6; Bait the Herd 5). On Spoof the Signal, The Big Chase and Light of the Cross the flavour is woven into the rule sentence. Invite Them In, The Gate and all 6 extras carry no flavour text.

### Inferences
- Candidates for a keyword or general rule, because they repeat across many cards. These are observations only; I have not proposed any rule.
  - **Mark** ("Mark up to [X] locations, 1 sway on each"): 3 cards print it identically, and IK1 already lists Mark as a verb and a noun.
  - **X = cards in hand**: printed on 4 extras as a sentence and implied on 5 signatures as "the card's sway". One symbol could carry both, but whether to merge the wording is the designer's call (D24 already defines signature sway as hand size).
  - **The LOC/FAC formula pair** "a group at a [glyph] location / a [Suit] group anywhere" repeats on 6 cards. The marking and fight pairs repeat on 3 and 2 cards. The readings column could carry these as icons (glyph plus group, faction plus group).
  - **"Target: X"** on 16 cards could become a labelled field, since the readings already appear as LOC/FAC rows.
  - **Burned sway back to the supply** (2 cards). The supply rule in the glossary may already cover it ("a player's cubes return to that player") — [doc glossary, Supply].
- The multi-use extras compress well: one verb across 2–3 nouns, which is the case IK1 and D34 were made for, and the assets page already drafts them that way. The suit cards that use a single common verb also compress well into a topline plus targets: Draw Them Away, Light of the Cross, the three marking signatures, Raise the Stakes and Cover Every Exit.
- Hard to compress, because the unique rules are the card: The Gate (4–5 separate rules; join is not a movement verb), Wake the Dead (third-side fight, sway per risen token), Take Control (two-step target, spend replaces the bid, trophies at once), Plough Through (two printed exceptions), The Big Chase (the list of what it passes through), Cut the Powerlines (round-robin plus exact half), Steal Their Playbook (the last-card rule), and Invite Them In (the readings change the effect's shape, and the readings outnumber the effect text).
- On the marking signatures the topline ("Mark up to X locations") is identical, so the specifics line carries the whole difference between three cards.

### Gaps
- No source assigns one primary verb per card. Where a card has two verbs (mark + bend, burn + slay, raise + place sway), the primary choice above is mine. IK1 lists the cards under each verb but does not rank them.
- No source counts which unprinted rules a player needs to read each card (D22, D23, D33, BACK, the three-way fight). A writer judging layout may need that list. It is in §3's notes for each card, but no tally is recorded.

## 5. Mismatches and wording inconsistencies to be aware of

### Takeaway
Small naming differences between the doc and the spec affect use labels and readings. They don't affect rules, but they matter for a fixed tag vocabulary.

### Cited Findings
- Call in Favours: the doc names its uses *Location* and *Faction* — [doc L80]. The spec and the rendered tags call them `Sway` and `Standing` — [spec `favours`]
- Raise the Stakes, Cover Every Exit, Switch Allegiance: the doc's use name is *Board sway* — [doc L76–78]. The spec and the tag say `Sway` — [spec]
- Faction readings say "a Sentient group" (Spoof the Signal) and "a Sentients group" (Cut the Powerlines). They also say "a group" (most cards) against "any group" (Cut the Powerlines, Light of the Cross LOC) — [spec]
- Perform the Ritual prints "as many as you choose if it’s in a fight" — [spec]. The doc gives the bound: "any number up to half, rounded down" (D22) — [doc L39]
- The spec prints `sway: 4` for all signatures, but D24 makes it the hand size. The table shows `view.printed`, the seat's actual value — [spec; cards.js `printed`; doc L1286]
- Showdown prints "Target: the group." but has no LOC/FAC readings. The doc says "Location only" — [spec; doc L79]
- Light of the Cross has no `round` field in the spec, unlike the other 20 cards — [spec]

### Inferences
- A fixed tag set (STAND / SWAY / TOKENS / THEIRS / YOURS) would make "Sway" the label for two different things on a suit card, if suit cards ever got use rows: the board-sway use and the +N spend. Today they never meet on one card (see §2).

### Gaps
- No decision is recorded on the high-level line for each multi-use card. IK1 lists it as open, and the assets page gists are a draft — [doc L782; assets.js]
