# Fix the target field, keep the topline

The evidence from twenty-odd card and board games supports the designer's four-part structure (topline, targets, specifics, flavour) almost exactly, with three amendments. First, the topline works best as a short verb with its amount attached ("Scry 1", "Assault 2", "Capture 3"), paired with the D34 icon block and never as the icon alone. Second, the targets part should become a fixed, labelled field that absorbs the card's current "Target:" sentence and its LOC/FAC readings, in the way Spirit Island's range-and-target bar lets the effect text say "the target land" and stop. Third, flavour belongs last, in italics, as the one thing a player may skip, but on three of our cards it is woven into the rule sentence, so separating it is a wording job only the designer can do. No game in the set uses exactly this four-part stack. The nearest are Lorcana (a named ability on every line), Spirit Island (a fixed targeting bar above the effect) and MTG (keyword first, one ability per paragraph, italic flavour at the bottom). The strongest fit for our 15 suit cards is the seeded structure with a Spirit Island-style target field. For the five "Choose one." extras it is the seeded topline over MTG/Netrunner-style mode rows, which the prototype already draws. The structure helps least on the cards whose unique rules *are* the card (The Gate, Wake the Dead, Take Control, Invite Them In) and on the three marking signatures, which share a topline, so the specifics line carries their whole identity. Every rewritten card below is an illustrative draft. Each one uses only words already printed on the card, rearranged into the layout, and none is proposed card text.

## Players glance at cards, so the first line must stand alone

There is almost no research on how people read individual game cards, but the little there is points one way. Eye-tracking of tabletop play found gaze jumping between people and components, with **fixations typically well under a second**, even during other players' turns ([University of Melbourne, Rogerson et al. 2017](https://findanexpert.unimelb.edu.au/scholarlywork/1280384-what-can-we-learn-from-eye-tracking-boardgame-play%3F)). A card in our game is read the same way: across the table, between turns, while weighing which of several cards to play. Whatever sits on the first line has to answer "what kind of play is this?" without the rest.

Designers who have written about this agree on what the first read must achieve. The Hearthstone team simplifies text so a player gets what a card does "in the majority case on first read", and refuses words that push a card to a fourth line, because the smaller font makes that first read harder ([outof.games dev tracker](https://outof.games/devtracker/hearthstone/twitter/twitter-hearthstone/38276)). Rosewater gives an acceptance test: **if a player has to read a card more than once to understand it, it has comprehension problems** ([Wizards, Lenticular Design](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31)). NN/g's progressive-disclosure finding explains why a topline works: "the very fact that something appears on the initial display tells users that it's important", and the split between first and second layers should follow how often each piece is used ([NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)). Consistent placement matters as much as styling. An accessibility review of Race for the Galaxy counts it as a strength that "the key data for phases is almost always in a reliable place" ([Meeple Like Us](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)), and Dune: Imperium is praised for fixed zones: where an agent may go at the top, the reveal effect in its own area ([Meeple Mountain](https://www.meeplemountain.com/reviews/dune-imperium/)).

Our cards make this pressing. The 21 cards average **about 57 words including readings**, and the longest, Wake the Dead, The Gate and Take Control, run 80 to 87 ([our cards inventory](../research_notes/Card%20text%20layouts%20at%20a%20glance/our_cards.md)). D23 already showed the cheapest route to shorter cards: moving shared rules off the card took the new cards from **about 72 words to about 44** ([design doc, D23](../docs/motw-design.md)). That is exactly how Spirit Island ("all effects apply to the single target land unless stated otherwise"), Pax Pamir ("resolve each impact icon … from top to bottom") and Gloomhaven ("top of one, bottom of the other") keep their card text short ([RulesPal, Spirit Island](https://rulespal.com/spirit-island/rulebook); [Rally the Troops, Pax Pamir](https://rally-the-troops.com/pax-pamir/info/rules.html); [Gloomhaven rulebook](https://mahmati.kapsi.fi/bg/gloomhaven/gloomhaven_rulebook.html)). A layout cannot do the work of a missing general rule, but it can make the remaining words easy to find.

## Every part of the seeded structure has a precedent

### The topline is a keyword with its number attached

Every game in the set opens an ability with a short label from a small closed set. Some labels carry rules meaning: KeyForge's "Play:" and "Reap:", Hearthstone's "Battlecry:", Snap's "On Reveal:", Arkham's action icons ([Decks of KeyForge API](https://decksofkeyforge.com/api/cards); [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json); [ArkhamDB](https://arkhamdb.com/api/public/cards/)). Others only name the ability: MTG's italic ability words such as "*Landfall* —", which by the rules have "no special rules meaning", and Lorcana's ALL-CAPS ability names ([MTG Comprehensive Rules 207.2c](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt); [Lorcast API](https://api.lorcast.com/v0/cards/search?q=set:1)). Rosewater's reason for ability words is the case for our topline: "many players don't tend to see connection unless we make an effort to point them out", and "players will invent a name if we don't, but then we have no control over what that name is" ([Making Magic, 2008](https://magic.wizards.com/en/news/making-magic/ability-word-your-mother-2008-07-28)). Our closest relative is The King Is Dead, an area-control game whose eight action cards are named for their verb (Assemble, Manoeuvre, Outmanoeuvre, Negotiate) and whose whole action set comes from three verbs and three region qualifiers ([RulesPal, The King Is Dead 2e](https://rulespal.com/the-king-is-dead-second-edition/rulebook)).

The densest form of topline puts a number on the verb: "Scry 1", KeyForge's "Assault 2" and "Capture 3", Netrunner's "Draw 3 cards", Runeterra's "Deal 2 to anything" ([Scryfall](https://api.scryfall.com/cards/named?exact=Opt); [Decks of KeyForge](https://decksofkeyforge.com/api/cards); [NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards); [Riot Data Dragon](https://dd.b.pvp.net/latest/set1-lite-en_us.zip)). One glance gives both what and how much. The seeded topline ("split, scatter, concentrate") names the verb but not the amount, and the amount is often the most decision-relevant fact on our cards: "up to X", "1 to each of at least two", "half, rounded up". The D34 draft already has amount badges (1, X, ½, all) that "sit beside" a block ([assets.js](../public/assets.js)), so attaching the amount to the topline costs nothing new.

There are two cautions. Peter Whalen of the Hearthstone team asks whether Enrage is "actually any easier to understand" than "Has +5 Attack while damaged": a label that only renames a short plain sentence adds a word to learn without saving one ([Hearthstone Designer Insights](https://hearthstone.blizzard.com/en-us/news/21614307)). On Light of the Cross (38 words) or Call in Favours (36), a topline earns its place by matching the icon and sorting the card among its siblings, not by shortening anything. The second caution is that a topline sorts cards by verb, so it cannot tell apart cards that share a verb. Night Terrors, Study the Bodies and Spill Blood on the Altar all open "Mark up to the card's sway of locations, 1 sway on each", so on those three the topline is identical and the specifics carry the difference.

### Targets deserve a fixed field, not a sentence

Spirit Island is the strongest single precedent for the seeded "targets" part. Its power cards carry a labelled bar (cost, speed, range, target) above the effect, with restrictions such as terrain shown to the left of the range icon, and the rules say effects apply to "the single target land unless stated otherwise". The effect text can therefore assume its location and read as a bare verb and object ([RulesPal, Spirit Island](https://rulespal.com/spirit-island/rulebook)). The text-only games reach the same separation through a sentence pattern: "Choose 1 installed card you can advance. Move up to 2 advancement counters … to the chosen card" (Netrunner), or MTG's "Choose a creature you control. It gains indestructible", where the choice and the effect are separate sentences ([NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards); [Scryfall, Final Showdown](https://api.scryfall.com/cards/named?exact=Final%20Showdown)). When one card involves several choices, MTG makes the player announce how many before naming them ([MTG CR 601.2c](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)), the same order our two-step targets follow.

Our cards already hold a target field, but it is split in two. Every suit card ends its text with "Target: …" and then shows LOC and FAC reading rows below ([spec.json](../public/spec.json)). The first names *which thing* is the target ("the herd", "the group fooled", "the centre, then the faction called"). The second says *which ones qualify* on each reading. A player has to join the two in their head. Merging them into one labelled field, ordered as steps (the group, then where it goes), is the Spirit Island move, and principle 14 already requires a card to say which thing counts as the target "when its effect involves two" ([design doc](../docs/motw-design.md)). The six strikes and shifts that use the formula "a group at a [glyph] location / a [Suit] group anywhere" would read identically, which makes the formula learnable by position in the way Root and Pax Pamir make a card's suit or region its target ([Law of Root](https://m102.nthu.edu.tw/~s102061202/ROOT/Root_Base_Law_of_Root_web_Oct_15_2020.pdf); [Rally the Troops, Pax Pamir](https://rally-the-troops.com/pax-pamir/info/rules.html)).

The seeded wording "each possible target and how it works" matters on the cards where the reading changes the shape of the effect, not just which pieces qualify. On Invite Them In the LOC reading brings two groups of different factions into an empty location, while the FAC reading brings only the Nocturnals into a location held by a lone rival. The readings (29 words) are longer than the effect text (17). A fixed field shaped as a small grid, steps down the side and readings across the top, holds this without prose.

### Specifics read best one rule per line

MTG's rules make a paragraph a rules unit: "each paragraph break in a card's text marks a separate ability" ([MTG CR 113.2c](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)). A player can count what a card does by counting its lines, and the same pattern runs through Hearthstone, Lorcana, KeyForge and the FFG LCGs. The evidence also says where explanatory text goes: reminder text "usually appears on the same line as the ability it's relevant to" ([MTG CR 207.2a](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)). No game collects explanations in a separate block. For our specifics part, that means one printed exception per line. The stated exceptions to D23 are The Gate's single sway, Take Control's spend, Plough Through's "half, rounded up" and split sway payment, and Cut the Powerlines' "exactly half" ([design doc, D23](../docs/motw-design.md)). Each sits on its own line, and a reminder of the common rule it overrides, if the designer ever wants one, sits on the same line.

### Flavour goes last and in italics, but ours is tangled into the rules

The seeded "smaller type, separated" is the documented convention. MTG's rules call flavour text italic, with "no game function", appearing "below the rules text" ([MTG CR 207.2b](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)). Typographer Matt Paquette goes further: "Italics should never be used for anything mechanically important" ([Colorblind Games](https://colorblindgames.com/2026/03/22/readability-and-typography-with-matt-paquette/)). That argues for keeping italics for flavour alone, and against MTG's own habit of italic reminder text. The more targeting-heavy games print no flavour text at all. Spirit Island's eight-region anatomy has no flavour region, and Pax Pamir lets the card's historical name carry the theme ([RulesPal, Spirit Island](https://rulespal.com/spirit-island/rulebook); [Rally the Troops, Pax Pamir](https://rally-the-troops.com/pax-pamir/info/rules.html)). Lorcana's designer describes its ability names as one of the places the theme lives ([Game Rant](https://gamerant.com/disney-lorcana-interview-ryan-miller-early-days-accuracy-source-material/)).

Our cards complicate this. Eleven of the 15 suit cards open with the slayer group (principle 11: "cards are written from the slayer group's point of view"), and on ten cards the flavour separates cleanly as a sentence of 5 to 19 words. On Spoof the Signal, The Big Chase and Light of the Cross, though, the flavour is the subject of the rule sentence ("The Kids on Bikes lead a group on a chase from neighbour to neighbour …"). Moving those cards' flavour to the bottom means rewording the rule. Some target nouns are also thematic ("the herd", "the group fooled"), so flavour leaks into the target field too. None of this is a reason to drop the seeded part. It means the split is a per-card wording decision for the designer, not a typesetting step.

### The seeded structure has no slot for the icon block or the play options

The seeded structure leaves two things without a home. The first is the D34 icon block. Direction B draws each verb as a mini board diagram with the noun as the piece moving through it ([icons.js](../public/icons.js)), and that has a close precedent in Gloomhaven's area-of-effect hexes, where "grey indicates the hex on which the figure is currently located" and red marks the affected hexes ([Gloomhaven rulebook](https://mahmati.kapsi.fi/bg/gloomhaven/gloomhaven_rulebook.html)). The HCI evidence is clear that outside a few universal symbols "most icons continue to be ambiguous", that "a text label must be present alongside an icon", and that labels should not hide behind hover ([NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)). Race for the Galaxy is the warning: its symbol language is called the game's most inaccessible feature, one that "takes a long time before the iconography becomes second nature" ([Meeple Like Us](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)). The icon block therefore belongs inside the topline, next to the verb word, not in place of it. The prototype's own decision to drop tooltips because "the card itself shows the text" points the same way ([cards.js](../public/cards.js)).

The second is the alternative plays. Every suit card can also be spent for sway (+N) or used to bring its faction back. Twilight Struggle (Ops star), Unmatched (boost value) and Root (suit) all put the generic alternative in a small corner value and give the specific effect the large text area ([Zatu, Twilight Struggle](https://zatu.com/blogs/how-to-play/how-to-play-twilight-struggle); [the-unmatched.club](https://www.the-unmatched.club/rules/glossary); [Law of Root](https://m102.nthu.edu.tw/~s102061202/ROOT/Root_Base_Law_of_Root_web_Oct_15_2020.pdf)). Our option column already does this, so the four-part structure only has to govern the text area.

## Three alternative layouts each solve one problem and break another

The games suggest three alternatives worth comparing with the seeded structure. They are offered as suggestions for comparison, not as recommendations to adopt.

**Alternative A, the Spirit Island header bar.** A fixed band above the text holds the verb block and amount, then one target cell per reading, and the prose below assumes "the target". This is the best fit for suit cards, because LOC and FAC map directly onto two cells, and it is the source of the target-field amendment above. Used whole, it has no place for a topline in words, and it struggles with multi-step targets (Ritual's centre then faction, Take Control's fight then faction hit), which Spirit Island avoids by targeting one land.

**Alternative B, label-colon paragraphs (KeyForge, Hearthstone, Lorcana).** Every ability is one paragraph led by a bold label ("GATHER: …"). It is the most compact layout and needs no grid. But it puts the targets back into prose, where our two readings are hardest to compare, and it does nothing for flavour. It suits the extras and short cards. It is also roughly what the card text already does with "Target:" as a trailing label.

**Alternative C, icon-first with text as backup (Pax Pamir, Gloomhaven, Race for the Galaxy).** The diagram is the effect, and a small text box covers the exceptions. Pax Pamir shows this works when "text is the exception and icons are the default" ([Rally the Troops, Pax Pamir](https://rally-the-troops.com/pax-pamir/info/rules.html)). Our cards are the opposite case: most of their words are exceptions and conditions. The icon code already defines 17 verb and 18 noun marks ([icons.js](../public/icons.js)), well past the 8 to 12 keywords one card-game designer suggests for a base game, a figure he offers as opinion, not data ([Game Developer, Kinstler](https://www.gamedeveloper.com/game-platforms/card-games-what-s-in-a-keyword)). Icon-first would put the RftG learning cost on every card.

| Layout | Suit cards (one action, two readings) | "Choose one." extras | Hard cards (Gate, Wake, Take Control) | Flavour | Icon block |
|---|---|---|---|---|---|
| Seeded four parts | Good, but targets split from readings | Good: topline plus targets per use | Specifics carry it; long | Separate, last | No slot |
| A: Spirit Island bar | Best: readings are cells | Weak: no mode list | Weak on two-step targets | Off card or last | In the bar |
| B: Label-colon paragraphs | Readings back in prose | Good | Prose, as now | Not addressed | Before the label |
| C: Icon-first | Exceptions overflow | Fair | Poor | Off card | Is the card |

For multi-use cards the evidence converges on one form. MTG standardised modal cards in 2014 as an instruction ending in an em dash and one bullet per mode, and issued errata so that older modal cards read the same way. Later mechanics replaced the bullet with a cost ("+ {1} —"), so cost and effect read as one menu row ([MTG CR 700.2, 700.2h](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt); [Scryfall, Final Showdown](https://api.scryfall.com/cards/named?exact=Final%20Showdown)). Netrunner uses "Resolve N of the following" with bullets, and Flesh and Blood uses "Choose 1;" with dashes. Only Hearthstone keeps modes inline, and only for two short options ([NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards); [the-fab-cube](https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json); [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json)). In every case the count comes before the list, so the reader knows the budget first. The prototype's STAND / SWAY / TOKENS rows, with a tag where MTG puts a bullet or cost, are this pattern, and IK1 already asks for "the action at a high level before each use's details" ([design doc, IK1](../docs/motw-design.md)). So the seeded topline sits naturally above the mode rows.

**Suggestion 1 (suit cards):** the seeded four parts, with the topline as icon block plus verb word plus amount, and the targets part as Alternative A's fixed field that merges "Target:" with the LOC/FAC readings, ordered by step. **Suggestion 2 (extras):** the seeded topline over MTG-style mode rows, which is the current prototype layout with a topline added. Both are suggestions for the designer to accept, change or reject.

## How six of our cards would read under Suggestions 1 and 2

Every rendering below is an **illustrative draft, not proposed card text**. Each uses only words already on the card in `public/spec.json`, sometimes moved or split, plus layout labels (TOPLINE, TARGET, LOC, FAC, rows). None changes what a card does or adds a rule. In the drafts, "[split·group]" stands for the D34 block, ⟶ marks the order of target steps, and italic text is flavour. Where a draft would need a wording decision to work, the note under it says so and leaves the decision open.

**Light of the Cross** (⎈ Demons, Shift): the easy case.

```
SPLIT [split·group]  a group, evenly in two
TARGET   the group                         ⟶ two neighbours
  LOC    any group at a ⎈ location
  FAC    a Demon group anywhere
A group of 1 can't be split.
— The cross is raised and the target group falls back from its light.   (italic)
```

The printed sentence fuses flavour and rule ("…falls back from its light, split evenly between two neighbours"). The draft keeps the flavour clause as printed and moves "split evenly between two neighbours" into the topline and target field. Whether the shortened flavour line still reads well is the designer's call.

**Draw Them Away** (☾ Undead, Shift): the separable-flavour case.

```
SPREAD [spread·token]  1 to each of at least two neighbours
TARGET   the group                         ⟶ at least two neighbours
  LOC    a group at a ☾ location
  FAC    an Undead group anywhere
The rest stay.
— The Watch sets out distractions all round the location, and one of the dead shambles off to check each.
```

The card's 19-word flavour sentence lifts off whole. The rule text left behind is three short fragments.

**Invite Them In** (◐ Nocturnals, Strike): the case where the readings change the effect.

```
GATHER [gather·group]  into one location, next door
            WHERE                                   ⟶ WHO COMES
  LOC    an empty ◐ location                         any two groups next to it, of different factions
  FAC    a location held by a lone group of          only the Nocturnals
         another faction, next to a Nocturnal group
```

The grid shows something the paragraph hides. The printed effect text says groups are invited "into an empty location", but the FAC reading's destination is held by a lone group, so the main sentence describes only the LOC reading. The grid states each reading's destination without contradiction. This is a reading of the current text, not a rules change, and the designer should confirm it matches intent.

**Spill Blood on the Altar** (⎈ Demons, Signature): the shared-topline case.

```
MARK [mark·location]  up to the card's sway of locations, 1 sway on each
TARGET   the locations marked
  LOC    ⎈ locations
  FAC    locations holding the Demons
This round, at a marked location's fight, the winner loses as many as the loser.
— Father and the Flock spill blood on the altar.
```

Night Terrors and Study the Bodies would show the same topline. Their identity sits in the specifics line, so on these three cards the specifics line, not the topline, is what a glance needs. D34 lists a "bend" verb ([icons.js](../public/icons.js)) that could mark the second effect, if the designer wants a second block there. The draft keeps "the card's sway" rather than "X", because unifying the two wordings of hand size is the designer's decision (see the mismatches below).

**The Gate** (ↂ 80's Sci-Fi, Strike): the case where the specifics are the card.

```
JOIN [join·location]  two locations, for the rest of the round
TARGET   the two ends: each an ↂ location, or a location holding the Sci-Fi faction
  LOC/FAC  (the readings list the same two kinds of end, in opposite order)
They count as a single location for movement.
They fight as one: strength and sway added across both; a true tie scorches both.
Never three factions across them.
Only 1 sway, at one end.
```

One rule per line turns a 60-word paragraph into four countable lines, but the card stays long. Collapsing the two readings into one row is only presentation if nothing else depends on which reading is played. The draft does not assume that, and the designer should decide it.

**Raise the Stakes** (Unsuited, Marked B): Suggestion 2.

```
GATHER [gather]  up to X into one — choose one:
  STAND   [·standing]  take 1 standing from each of up to X factions, all into one.
  SWAY    [·sway]      gather up to X of your sway from next door into one location.
  TOKENS  [·token]     up to X tokens of one faction come in from its groups next door,
                       to a location where you have sway.
X is the cards in your hand, this one included.
```

The topline here is the gist the assets page drafted ("Gather up to X into one"), which is itself a draft that the designer has not accepted ([assets.js](../public/assets.js)). IK1 says this card's paragraph form prompted the whole icon effort ([design doc, IK1](../docs/motw-design.md)).

## Doc and spec mismatches to settle before fixing a layout

A fixed layout depends on fixed labels, and the sources currently disagree in small ways. None of these changes a rule, but each is a choice the designer will meet when labels become fixed. Call in Favours' uses are *Location* and *Faction* in the design doc but `Sway` and `Standing` in the spec and on the rendered tags. Raise the Stakes, Cover Every Exit and Switch Allegiance call their board use *Board sway* in the doc and `Sway` in the spec. If suit cards ever got use rows, "SWAY" would then label both board sway and the +N spend. Faction readings say both "a Sentient group" (Spoof the Signal) and "a Sentients group" (Cut the Powerlines), and both "a group" and "any group". The hand-size quantity is printed two ways: "up to the card's sway" on the five signatures and "X is the cards in your hand, this one included" on four extras. Meanwhile the spec stores `sway: 4` for every signature, although D24 makes it the hand size. Perform the Ritual prints "as many as you choose if it's in a fight", while the doc bounds it at half, rounded down (D22). Showdown prints "Target: the group." but has no LOC/FAC readings ("location only" in the doc). Wake the Dead states its LOC rule twice, once in the text and once in the reading. Invite Them In's effect text says "an empty location", which the FAC reading contradicts. Light of the Cross alone lacks a `round` field in the spec. The Appendix H tables (H.1 to H.6) still list round 1 to 13 ideas and the replaced unsuited cards, not the current 21. Direction B, the icon direction the designer chose, is recorded only in code comments, the assets page and commit `7c77554`, while D34 still lists "the look of each mark" as open ([our cards inventory](../research_notes/Card%20text%20layouts%20at%20a%20glance/our_cards.md); [spec.json](../public/spec.json); [design doc](../docs/motw-design.md)).

## Conclusion

The research mostly confirms the seed. What it adds is that the part needing the most design is the target field, not the topline. Our cards already carry their targets in two places, a trailing "Target:" sentence and the LOC/FAC rows, and Spirit Island shows that one labelled field lets every other line drop its "where". The topline is cheap to add and well supported, provided it carries its amount and its icon is never printed without the word. The flavour split is right in principle but, on several cards, it is a wording decision rather than a typesetting one. The cards that resist any layout (The Gate, Wake the Dead, Take Control) are a hint that their length comes from rules, which only the designer can choose to generalise, as D23 did.

There is a cheap way to choose between layouts, and it needs no new research: Rosewater's read-it-once test and NN/g's "what do you think this means?" check. Show a playtester one drafted card for a few seconds and ask what it does. Then ask again a week later about the icon block alone. Those two answers will separate the suggestions faster than more precedent will. Because the prototype renders card text from `spec.json` through a presentation layer whose rule is "Presentation only: the words are the card's" ([cards.js](../public/cards.js)), each suggestion can be shown side by side on the table without touching a rule.
