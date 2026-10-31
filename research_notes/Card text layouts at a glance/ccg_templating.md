# How collectible and living card games lay out and template card rules text

Method note: exact card text below was pulled on 2026-10-30 from each game's public card database or API, not paraphrased. The sources are Scryfall (MTG Oracle text), NetrunnerDB API 2.0, HearthstoneJSON, Riot Data Dragon (Legends of Runeterra set 1), Lorcast API (Lorcana set 1), marvelsnapzone card API, the-fab-cube JSON on GitHub (Flesh and Blood), decksofkeyforge API, ArkhamDB, MarvelCDB and RingsDB.

These databases show bold and italics as markup (`<b>`, `<strong>`, `<i>`, `<em>`), so the bolding claims below come from that markup. Where a database stores current errata'd text (MTG Oracle, NetrunnerDB), the text may differ from the first printing. Several designer sources could not be fetched (mtg.fandom.com returned 402, mtg.wiki and Tumblr returned 403, and the original 2011 New World Order article returned 404). They are listed under Gaps rather than quoted from memory.

## 1. How a text box is structured and ordered

### Takeaway
MTG has the most formal ordering, and its Comprehensive Rules codify it:
- keyword abilities, strung together on one line, come first;
- each paragraph after that is one ability;
- italic reminder text in parentheses sits on the same line as the ability it explains;
- italic flavour text comes below the rules text.

Every other game uses a lighter version of "labelled lines, one ability per line." The biggest variation is where keywords live. Runeterra moves them out of the text into a keyword strip. Hearthstone and Lorcana keep them inline but bold. Arkham and the other FFG LCGs put traits on a separate italic line above the text.

### Cited findings

**Magic: The Gathering (rules)**
- CR 207.1: "The text box is printed on the lower half of the card. It usually contains rules text defining the card's abilities." CR 207.2: "The text box may also contain italicized text that has no game function." — [MTG Comprehensive Rules, 2026-09-25](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 207.2a: "Reminder text is italicized text within parentheses that summarizes a rule that applies to that card. It usually appears on the same line as the ability it's relevant to, but it may appear on its own line if it applies to an aspect of the card other than an ability." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 207.2b: "Flavor text is italicized text that, like the illustration, adds artistic appeal to the game. It usually appears below the rules text." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 113.2c: "aside from certain defined abilities that may be strung together on a single line (see rule 702, 'Keyword Abilities'), each paragraph break in a card's text marks a separate ability." So in MTG a paragraph is a rules unit, not just layout. — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 702.1: "Some [abilities], though, are very common or would require too much space to define on the card. In these cases, the object lists only the name of the ability as a 'keyword'; sometimes reminder text summarizes the game rule." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)

**Magic: The Gathering (card examples)**
- *Serra Angel* (Foundations) puts each keyword on its own line, and only the less familiar one gets reminder text: "Flying / Vigilance (Attacking doesn't cause this creature to tap.)" — [Scryfall](https://api.scryfall.com/cards/named?exact=Serra%20Angel)
- *Ainok Bond-Kin* shows the order keyword, then reminder text, then a new paragraph for the static ability: "Outlast {1}{W} ({1}{W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.) / Each creature you control with a +1/+1 counter on it has first strike." — [Scryfall](https://api.scryfall.com/cards/named?exact=Ainok%20Bond-Kin)
- *Into the Roil*: an additional-cost keyword goes first and the effect follows. "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.) / Return target nonland permanent to its owner's hand. If this spell was kicked, draw a card." — [Scryfall](https://api.scryfall.com/cards/named?exact=Into%20the%20Roil)
- *Sorin, Vengeful Bloodlord* (planeswalker): the static ability comes first, then the loyalty abilities, each led by its cost: "During your turn, creatures and planeswalkers you control have lifelink. / +2: Sorin deals 1 damage to target player or planeswalker. / −X: Return target creature card with mana value X from your graveyard to the battlefield…" — [Scryfall](https://api.scryfall.com/cards/named?exact=Sorin,%20Vengeful%20Bloodlord)
- Self-reference: from Foundations (released 2024-11-15), MTG replaced a permanent's own name in its rules text with "this creature", "this artifact" and so on. Aetherdrift then updated about 13,000 older cards. The stated intent was to "make it more clear that such references only refer to one particular object." Spells keep their name ("Lightning Strike deals 3 damage to any target"), as do legendary permanents and characteristic-defining abilities. — [Magic Judges: Name the Rule, 2025-04-02](https://blogs.magicjudges.org/nametherule/this-object/); [Foundations Release Notes](https://magic.wizards.com/en/news/feature/foundations-release-notes)
  - Example: *Thraben Inspector* now reads "When this creature enters, investigate. (Create a Clue token. It's an artifact with "{2}, Sacrifice this token: Draw a card.")" — [Scryfall](https://api.scryfall.com/cards/named?exact=Thraben%20Inspector)

**Hearthstone**
- Keywords are bolded inline, and evergreen keywords are comma-strung on one line. *Tirion Fordring*: "**Divine Shield**, **Taunt** **Deathrattle:** Equip a 5/3 Ashbringer." *Azure Drake* puts the static keyword on the first line and the trigger on the next: "**Spell Damage +1** / **Battlecry:** Draw a card." — [HearthstoneJSON collectible cards](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json)
- The text data contains hand-typesetting markers: a leading `[x]` (manual line-break mode), explicit `\n` breaks, and non-breaking spaces (e.g. "+2\xa0Attack", "enemy\xa0hero"). These show line breaks are chosen by hand for each card so a number stays with its noun. For example, *Druid of the Claw* is stored as "[x]**Choose One -** Transform\ninto a 7/6 with **Rush**;\nor a 4/9 with **Taunt**." — [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json)
- Flavour text is stored separately ("ADD ME TO YOUR DECK, MAGGOT!" for *Abusive Sergeant*) and is not printed in the card's text box. — [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json)

**Legends of Runeterra**
- Keywords are a separate data field (e.g. *Darius*: keywords ["Overwhelm"], empty description), and the description holds only non-keyword text. Keywords are shown as icon plus name in a strip above the description. Inline keyword references carry a sprite icon (`<sprite name=Barrier>`). Labels such as "Play", "Attack" and "Nexus Strike" use a distinct "Vocab" style, separate from the "Keyword" style. — [Riot Data Dragon set1](https://dd.b.pvp.net/latest/set1-lite-en_us.zip)

**Arkham Horror LCG**
- Traits are a separate field ("Item. Weapon. Melee.") shown as an italic line above the text. Each ability starts with a timing icon: [action], [reaction], [fast] or [free]. *Flashlight*: "Uses (3 supplies). / [action] Spend 1 supply: **Investigate.** Your location gets -2 shroud for this investigation." — [ArkhamDB API](https://arkhamdb.com/api/public/cards/)

**Lord of the Rings LCG**
- A keyword stands alone with a full stop on line one, then bold-labelled abilities follow. *Legolas*: "Ranged. / **Response:** After Legolas participates in an attack that destroys an enemy, place 2 progress tokens on the current quest." Flavour carries a `<cite>` attribution: "…<cite>The Fellowship of the Ring</cite>". — [RingsDB API](https://ringsdb.com/api/public/cards/)

**Lorcana**
- Keyword plus reminder text comes first, then named abilities. *Mickey Mouse – Musketeer*: "Bodyguard (This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.) / ALL FOR ONE Your other Musketeer characters get +1 {S}." — [Lorcast API, set 1](https://api.lorcast.com/v0/cards/search?q=set:1)

**Flesh and Blood**
- The keyword "Go again" sits on its own line: *Head Jab* has the functional text "Go again". Additional costs come first. *Bloodrush Bellow*: "As an additional cost to play this, discard a random card. / Your Brute attacks get +2{p} this turn. / If the discarded card has 6 or more {p}, draw 2 cards and this gets go again." — [the-fab-cube card.json](https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json)

### Inferences
- The shared order across games is: keywords, then cost and setup lines, then labelled abilities, then flavour at the bottom (or off the card). Reminder text attaches to the line it explains. It is never collected in a separate block.
- MTG's rule that a paragraph is a rules unit is a strong glanceability device: a player can count abilities by counting paragraphs.
- Moving self-reference from the card name to "this creature" shortens lines and makes a card's text read like a template.

### Gaps
- No official MTG style guide for font sizes or the flavour-text separator was found. The rule line between rules and flavour text is visible on real cards but is not specified in the CR.
- Physical typesetting rules for Lorcana, FaB and the FFG LCGs (font sizes, separator glyphs) were not documented in any source fetched.

## 2. Keywords, keyword actions and reminder text

### Takeaway
Every game in the set compresses recurring effects into a keyword: a bolded or capitalised term, sometimes with a number. The keyword carries reminder text in italic parentheses while it is new or rare, and goes bare once it is evergreen (Flying, Taunt, Go again). Keyword actions (verbs such as Scry, Explore, Discover, Expose, Capture) compress procedures, so a card can be a one-line sentence.

### Cited findings

**Magic: The Gathering**
- CR 701.1 says keyword actions are "specialized verbs … whose meanings may not be clear. These 'keywords' are game terms; sometimes reminder text summarizes their meanings." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
  - CR 701.22a: "To 'scry N' means to look at the top N cards of your library, then put any number of them on the bottom of your library in any order and the rest on top…"
  - CR 701.25a: "To 'surveil N' means… put any number of them into your graveyard and the rest on top…"
  - CR 701.44a defines explore.
- Card examples, from [Scryfall](https://api.scryfall.com/):
  - *Opt*: "Scry 1. (Look at the top card of your library. You may put that card on the bottom.) / Draw a card." The reminder text is customised to N=1, not generic.
  - *Jadelight Ranger*: "When this creature enters, it explores, then it explores again. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard. Then repeat this process.)" This is an example of the downside: the reminder text is longer than the rules text.
- Rosewater (Making Magic, "Ability Word to Your Mother", 2008-07-28): "When the mechanic in question can be keyworded, we keyword it. When it can't be keyworded, we try other means." He also says self-referential mechanics like flanking must be keyworded. — [magic.wizards.com](https://magic.wizards.com/en/news/making-magic/ability-word-your-mother-2008-07-28)
- New World Order: Rosewater introduced it in a 2011-12-05 column (the concept was in use from about 2008). As quoted by SCG: "we have to be very careful about what we put at common… We had to redraw the line for what level of complexity was acceptable." SCG notes that Innistrad commons have "no more than two abilities or functions." — [StarCityGames, 2011-12-07](https://articles.starcitygames.com/articles/new-world-order-and-complexity-creep/)
  - The MTG wiki summary (via search snippet) says NWO was introduced in 2008 against complexity creep, and that Play Boosters (2024) made R&D raise complexity at common again. — [mtg.wiki NWO](https://mtg.wiki/page/New_World_Order) (snippet only; page fetch blocked)

**Netrunner**
- Keyword actions are short imperatives: *Diesel*: "Draw 3 cards." The subtype keyword is bolded inside text, as in *Mimic*: "Break 1 **sentry** subroutine." — [NetrunnerDB API](https://netrunnerdb.com/api/2.0/public/cards)
- Null Signal Games added the keyword *Interface* in March 2021 (Comprehensive Rules 1.5) to make explicit that an icebreaker ability needs strength at least the ice's. Before that it was implicit "interacting with ice." *Persistent* (March 2021) "codifies an ability previously seen on cards like Strongbox and Red Herrings."
  - Other NSG templating changes, March 2019 (CR 1.2): "they" is the default pronoun; "Make a run on X" became "Run X"; Trace is written "Trace[X]".
  - From System Gateway onward, modifiers use "gets" instead of "has" to avoid ambiguity with negative values.
  - Source: [NSG Major Changes](https://nullsignal.games/players/major-changes/); [NSG SU21 rules changes](https://nullsignal.games/blog/susg-rules-changes/)
- Reminder text as italics in parentheses also exists in Netrunner. *Red Herrings*: "Persistent → As an additional cost to steal an agenda from this server or its root, the Runner must pay 5[credit]. *(If the Runner trashes this card while accessing it, this ability still applies for the remainder of this run.)*" — [NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards)

**Hearthstone**
- Keywords are bolded with no reminder text on the card. Rules explanations live in hover tooltips in the client. Examples, from [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json):
  - *Primordial Glyph*: "**Discover** a spell. Reduce its Cost by (2)."
  - *Keeper of the Grove*: "…or **Silence** a minion."
  - *Leper Gnome*: "**Deathrattle:** Deal 2 damage to the enemy hero."
- Ben Brode (Designer Insights video, about 2016, via secondary coverage) argued that text consistency matters most on physical cards, where an unclear card stops the game. In digital the client enforces the rules, so knowing exactly how a card works from its text is "important… but not critical." He said existing text should be changed only when it regularly confuses players. — [Icy Veins coverage](https://www.icy-veins.com/forums/topic/14965-hearthstone-lead-designer-ben-brode-on-card-text-consistency/) and [HearthPwn](https://www.hearthpwn.com/news/1143-ben-brode-on-card-text-consistency) (search snippets; pages blocked)

**Legends of Runeterra**
- Keywords appear as icon plus word, and inline references embed the icon. *Deny*: "Stop a [Fast icon] Fast spell, [Slow icon] Slow spell, or [Skill icon] Skill." — [Data Dragon](https://dd.b.pvp.net/latest/set1-lite-en_us.zip)

**Lorcana**
- Keyword plus reminder text:
  - *Hercules – True Hero*: "Bodyguard (This character may enter play exerted…)"
  - *Simba – Returned King*: "Challenger +4 (While challenging, this character gets +4 {S}.)"
  - *Mickey – Brave Little Tailor*: "Evasive (Only characters with Evasive can challenge this character.)"
  - Songs carry a reminder line first. *Let It Go*: "(A character with cost 5 or more can {E} to sing this song for free.) / Put chosen character into their player's inkwell facedown and exerted."
  - Source: [Lorcast](https://api.lorcast.com/v0/cards/search?q=set:1)
- Ryan Miller (Player2 interview, 2024-08) describes a layer of "Keyworded abilities" across sets, such as Resist, Evasive and Ward, sitting above per-card named abilities. — [Player2](https://www.player2.net.au/2024/08/exclusive-we-interview-lorcana-designer-ryan-miller/) (search snippet)

**KeyForge**
- Keyword plus number plus reminder text. *Ancient Bear*: "Assault 2. (Before this creature attacks, deal 2<D> to the attacked enemy.)" The keyword action "Capture" is used as a verb: *Charette* "Play: Capture 3<A>." — [Decks of KeyForge API](https://decksofkeyforge.com/api/cards)

**Arkham Horror LCG**
- Keyword actions are bold with a full stop, acting as a named action: "[action]: **Fight.** You get +1 [combat] for this attack…" on *Machete*, and "**Investigate.**" and "**Parley.**". Encounter keywords stand alone on a line: "Hunter." — [ArkhamDB](https://arkhamdb.com/api/public/cards/)

### Inferences
- Reminder text is gradual: it is present on first use and at low rarity, then dropped once a keyword is evergreen (Serra Angel keeps it for Vigilance but not Flying; Hearthstone never prints it and relies on tooltips).
- Digital games move the reminder off the card. Physical games pay for it in text-box space.
- A keyword with a number ("Scry 1", "Assault 2", "Challenger +4", "Trace[3]") is the densest pattern: one glance tells you both what the effect is and how big it is.

### Gaps
- No primary-source quotes on Rosewater's "red flag" rule (a share of commons allowed complex "red flags") or on NWO's three complexity types (comprehension, board, strategic) could be fetched. The original 2011-12-05 article returned 404 and the archive had no snapshot. These are commonly cited but are not verified here.
- No primary source was found on a published keyword threshold, i.e. how often an effect must recur before it gets a keyword. Rosewater's 2008 column defers the criteria: "I'll cover that soon enough."
- No GDC talk on Hearthstone card text was found in searches.

## 3. Modal cards: modes, costs and bullets

### Takeaway
MTG standardised modal cards in 2014 (Khans of Tarkir): an instruction ending in an em dash, then one bullet per mode. Later variants put a cost in place of the bullet (Spree "+ {cost} —", pawprints {P}). Netrunner (NSG) uses "Resolve N of the following" with a bulleted list. Hearthstone keeps modes inline: "**Choose One -** X; or Y." FaB uses "Choose 1;" with dashes. The LotR LCG puts "(choose 1):" inline with commas and "or".

### Cited findings

**Magic: The Gathering (rules)**
- CR 700.2: "A spell or ability is modal if it has two or more options in a bulleted list preceded by instructions for a player to choose a number of those options, such as 'Choose one —.' … Modal cards printed prior to the Khans of Tarkir set didn't use bulleted lists for the modes; these cards have received errata in the Oracle card reference so the modes do appear in a bulleted list." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 700.2h: "Some modal spells have one or more modes with a cost listed before the effect of that mode." CR 700.2i covers pawprint symbols ({P}) used instead of bullets. — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- Escalate (CR 702.120a): "For each mode you choose beyond the first as you cast this spell, you pay an additional [cost]." Spree (CR 702.172a): "Choose one or more modes. As an additional cost to cast this spell, pay the costs associated with those modes." Entwine (CR 702.42a): "You may choose all modes of this spell instead of just the number specified." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)

**Magic: The Gathering (card examples)**, all from [Scryfall](https://api.scryfall.com/):
- *Cryptic Command*:
  > Choose two —
  > • Counter target spell.
  > • Return target permanent to its owner's hand.
  > • Tap all creatures your opponents control.
  > • Draw a card.
- *Collective Defiance* (escalate puts the keyword first, then "Choose one or more —"):
  > Escalate {1} (Pay this cost for each mode chosen beyond the first.)
  > Choose one or more —
  > • Target player discards all the cards in their hand, then draws that many cards.
  > • Collective Defiance deals 4 damage to target creature.
  > • Collective Defiance deals 3 damage to target opponent or planeswalker.
- *Final Showdown* (Spree, Outlaws of Thunder Junction, 2024-04-19; each mode's cost replaces the bullet):
  > Spree (Choose one or more additional costs.)
  > + {1} — All creatures lose all abilities until end of turn.
  > + {1} — Choose a creature you control. It gains indestructible until end of turn.
  > + {3}{W}{W} — Destroy all creatures.
- *Season of the Burrow* (Bloomburrow, 2024-08-02; pawprint weights):
  > Choose up to five {P} worth of modes. You may choose the same mode more than once.
  > {P} — Create a 1/1 white Rabbit creature token.
  > {P}{P} — Exile target nonland permanent. Its controller draws a card.
  > {P}{P}{P} — Return target permanent card…
- *Charming Prince* (modal triggered ability; the trigger leads into "choose one —"):
  > When this creature enters, choose one —
  > • Scry 2.
  > • You gain 3 life.
  > • Exile another target creature you own…
- Split card *Fire // Ice*: two named halves, each with its own cost and text. "Fire {1}{R} Instant: Fire deals 2 damage divided as you choose among one or two targets." / "Ice {1}{U} Instant: Tap target permanent. Draw a card." CR 709.4a says a split card "has two names."
- Adventure *Bonecrusher Giant // Stomp*: the adventure half "Stomp {1}{R} Instant — Adventure: Damage can't be prevented this turn. Stomp deals 2 damage to any target." sits in an inset box beside the creature's own text.

**Netrunner**, from [NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards):
- Newer NSG cards use bulleted lists:
  - *Red Level Clearance*: "Resolve 2 of the following in any order: • Draw 2 cards. • Gain 2[credit]. • Install 1 non-agenda card from HQ. • Gain [click]."
  - *Reverse Infection*: "Choose one: • Purge virus counters… • Gain 2[credit]."
  - *Wildcat Strike*: "Resolve 1 of the following of the Corp's choice: • Gain 6[credit]. • Draw 4 cards."
  - *Predictive Planogram* (condition upgrades the count): "Resolve 1 of the following. If the Runner is tagged, you may resolve both instead."
- FFG-era *Deuces Wild*: "Resolve two of the following in any order:" followed by a list.

**Hearthstone**, from [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json):
- *Ancient of Lore*: "**Choose One -** Draw 2 cards; or Restore #7 Health." *Keeper of the Grove*: "**Choose One -** Deal 2 damage; or **Silence** a minion."
- Modes are inline, separated by "; or", with a hyphen rather than an em dash.

**Flesh and Blood**, from [the-fab-cube card.json](https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json):
- *Pummel*: "Choose 1; / - Target club or hammer weapon attack gets +4{p}. / - Target attack action card with cost 2 or more gets +4{p} and…"
- *Art of War*: "Choose 2;" followed by four mode lines.

**LotR LCG**
- *Gandalf* has an inline mode list: "**Response:** After Gandalf enters play, (choose 1): draw 3 cards, deal 4 damage to 1 enemy in play, or reduce your threat by 5." — [RingsDB](https://ringsdb.com/api/public/cards/)

### Inferences
- A vertical bulleted list is the shared answer for modes once there are more than two options or the options are long. Inline "X; or Y" works only for two short options (Hearthstone).
- Putting the cost where the bullet goes (Spree, pawprints) lets the eye read cost and effect as a single row, like a menu.
- The count instruction ("Choose two —", "Resolve 2 of the following") always comes before the list, so the reader knows the budget before reading the options.

### Gaps
- No designer article on why Khans of Tarkir introduced bullets, or on the readability goals of Spree, could be fetched (mtg.fandom.com and mtg.wiki were blocked).

## 4. Targeting language: separating the choice from the effect

### Takeaway
MTG reserves the word "target" as a rules term: only "target [something]" marks a target, and the choice is made at cast time, separate from resolution. Other games use plainer words: Lorcana says "chosen", Netrunner "Choose 1", Hearthstone and Runeterra use bare articles ("a minion", "an ally", "anything"), and FaB uses "Target" with a capital in modes. "Up to N" is the standard optional multi-choice phrasing (MTG, Lorcana, Netrunner).

### Cited findings

**Magic: The Gathering**
- CR 115.1a: a spell is targeted "if its spell ability identifies something it will affect by using the phrase 'target [something]'." CR 115.10a: "Unless that object or player is identified by the word 'target'… it's not a target." CR 115.10b: "the word 'you' in an object's text doesn't indicate a target." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 601.2c: "If the spell has a variable number of targets, the player announces how many targets they will choose before they announce those targets… The same target can't be chosen multiple times for any one instance of the word 'target' on the spell. However, if the spell uses the word 'target' in multiple places, the same object or player can be chosen once for each instance." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- Examples, from [Scryfall](https://api.scryfall.com/):
  - *Lightning Bolt*: "Lightning Bolt deals 3 damage to any target." ("any target" is the catch-all.)
  - *Decimate*, a multi-target spell with reminder text for the legality rule: "Destroy target artifact, target creature, target enchantment, and target land. (You can't cast this spell unless you have legal choices for all its targets.)"
  - *Fire*, which divides damage: "Fire deals 2 damage divided as you choose among one or two targets."
- Choosing without targeting uses "choose": *Final Showdown*'s mode "Choose a creature you control. It gains indestructible until end of turn." The choice and the effect are in separate sentences, and "It" refers back to the choice. — [Scryfall](https://api.scryfall.com/cards/named?exact=Final%20Showdown)

**Lorcana**, from [Lorcast](https://api.lorcast.com/v0/cards/search?q=set:1):
- "chosen" is the targeting word:
  - *Dragon Fire*: "Banish chosen character."
  - *Elsa – Spirit of Winter*: "exert up to 2 chosen characters. They can't ready at the start of their next turn."
  - *Hades – Infernal Schemer*: "you may put chosen opposing character into their player's inkwell facedown."

**Netrunner**, from [NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards):
- The choice comes first as its own sentence, then the effect refers back to it:
  - *Forged Activation Orders*: "Choose 1 unrezzed piece of ice. The Corp may rez that ice. If they do not, they trash it."
  - *Trick of Light*: "Choose 1 installed card you can advance. Move up to 2 advancement counters from 1 other card to the chosen card."
- Numerals are used instead of number words ("Choose 1", "Draw 3 cards").

**Hearthstone**, from [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json):
- No "target" word at all. The client prompts for the choice:
  - *Elven Archer*: "**Battlecry:** Deal 1 damage."
  - *Abusive Sergeant*: "**Battlecry:** Give a minion +2 Attack this turn."
  - *Shield Slam*: "Deal 1 damage to a minion for each Armor you have."
  - Random effects say "random" explicitly. *Sylvanas Windrunner*: "**Deathrattle:** Take control of a random enemy minion."

**Legends of Runeterra**, from [Data Dragon](https://dd.b.pvp.net/latest/set1-lite-en_us.zip):
- *Mystic Shot*: "Deal 2 to anything." *Vengeance*: "Kill a unit." *Elixir of Iron*: "Give an ally +0|+2 this round."
- Runeterra drops "damage" after the number and uses "ally" and "enemy" as the side markers.

**Marvel Snap**, from [marvelsnapzone API](https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true):
- Location stands in for a target. *Elektra*: "**On Reveal**: Destroy an enemy 1-Cost card here." *Shang-Chi*: "…Destroy an enemy card here that has 10 or more Power."

**Flesh and Blood**
- Modes use a capitalised "Target". *Pummel*: "- Target club or hammer weapon attack gets +4{p}." — [the-fab-cube](https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json)

**Marvel Champions and LotR LCG**
- These use "an enemy", "1 enemy" or "Choose an enemy":
  - *Swinging Web Kick*: "Deal 8 damage to an enemy."
  - *Feint*: "**Combat Action:** Choose an enemy engaged with a player. That enemy cannot attack that player this phase."
  - Sources: [MarvelCDB](https://marvelcdb.com/api/public/cards/); [RingsDB](https://ringsdb.com/api/public/cards/)

### Inferences
- There are two schools:
  - MTG and FaB treat "target" as a technical keyword because responses and "hexproof"-style effects depend on it.
  - Digital games and cooperative LCGs, which have no targeting-matters rules, use plain articles. The interface or the players resolve the choice.
- "Choose [descriptor]. [Effect] that/it/the chosen…" is the clearest way to separate choice from effect, and it appears in MTG, Netrunner and the LotR LCG alike.

### Gaps
- No designer writing on Lorcana's choice of "chosen" over "target" was found.

## 5. Cost, trigger and effect structure, and labels (the "topline" analogue)

### Takeaway
All the games mark the kind of ability with a label at the start of the line:
- a cost before a colon (MTG, Netrunner, FaB, Arkham);
- a trigger word (When, Whenever, At, After);
- a bold timing word with a colon (Hearthstone "Battlecry:", KeyForge "Play:", Snap "On Reveal:", Runeterra "Play:", LCG "Action:", "Response:", "Forced -", "Revelation -").

Purely naming labels with no rules meaning exist in MTG (italic ability words and flavor words such as "*Landfall* —"), Lorcana (ALL-CAPS named abilities, e.g. "DRAGON FIRE When you play…"), Marvel Champions (quoted names, e.g. ""Widowmaker" —") and NSG Netrunner (label and arrow, e.g. "Interface →", "Persistent →", "Once per turn →"). These are the closest analogues to a topline label.

### Cited findings

**Magic: The Gathering (rules)**
- CR 602.1: activated abilities "are written as '[Cost]: [Effect.] [Activation instructions (if any).]' … The activation cost is everything before the colon (:)." CR 603.1: triggered abilities "are written as '[When/Whenever/At] [trigger condition or event], [effect]. [Instructions (if any).]'" CR 113.3d: "Static abilities are written as statements. They're simply true." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- CR 207.2c: "An ability word appears in italics at the beginning of some abilities. Ability words are similar to keywords in that they tie together cards that have similar functionality, but they have no special rules meaning." The current list has about 55 entries, from adamant and landfall to threshold and will of the council. CR 207.2d: "flavor words appear in italics at the beginning of some abilities… While an ability word ties together several abilities with similar functionality, each flavor word is tailored to the specific ability it appears with." — [MTG CR](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt)
- Rosewater, 2008-07-28: "Ability words are a marker that we use to let you know that multiple cards share a similar mechanic… many players don't tend to see connection unless we make an effort to point them out." "Yes, players will invent a name if we don't, but then we have no control over what that name is." "It turns a bunch of similar cards into a single element that can be highlighted and sold." Ability words are "italicized implying that they have more in common with flavor text than rules text." — [Making Magic, "Ability Word to Your Mother"](https://magic.wizards.com/en/news/making-magic/ability-word-your-mother-2008-07-28)
- Threshold was a keyword in Odyssey and was redefined as an ability word with no rules meaning in Time Spiral. — [Wikipedia, List of MTG keywords](https://en.wikipedia.org/wiki/List_of_Magic:_The_Gathering_keywords) (search snippet)
- Downside: players report that ability words and flavor words are hard to tell apart at a glance. The visible cue is capitalisation: ability words capitalise only the first word, flavor words use title case. — [Rosewater Tumblr Q&A](https://markrosewater.tumblr.com/post/778119647975309312/its-not-easy-to-differentiate-ability-words-and) (search snippet; page 403)

**Magic: The Gathering (card examples)**, from [Scryfall](https://api.scryfall.com/):
- *Lotus Cobra*: "*Landfall* — Whenever a land you control enters, add one mana of any color."
- *Llanowar Elves*: "{T}: Add {G}." *Mishra's Bauble*: "{T}, Sacrifice this artifact: Look at the top card of target player's library…"

**Netrunner**, from [NetrunnerDB](https://netrunnerdb.com/api/2.0/public/cards):
- The paid-ability cost is bold and ends in a colon. *Corroder*: "Interface → **1[credit]:** Break 1 **barrier** subroutine. / **1[credit]:** +1 strength."
- Hosted-counter costs are bold. *Data Raven*: "**Hosted power counter:** Give the Runner 1 tag."
- Ice subroutines start with a glyph. *Enigma*: "[subroutine] The Runner loses [click]. / [subroutine] End the run."
- Arrow labels in current card text, counted across NetrunnerDB:
  - "Interface →" on 175 cards
  - "Once per turn →" on 63
  - "Persistent →" on 13
  - "Access →" on 6
  - *Doppelgänger*: "Once per turn → When a successful run ends, you may run any server."
- NSG says "Certain cards have abilities that are flagged with 'Threat N →'" (June 2023, CR 23.08). — [NSG Major Changes](https://nullsignal.games/players/major-changes/)
- The NSG Comprehensive Rules define paid abilities (1.16.9 in the version fetched) as a cost "followed by a colon (:) and then the ability's effect", and the trash symbol as "a self-referential cost." — [rules.nullsignal.games](https://rules.nullsignal.games)

**Hearthstone**, from [HearthstoneJSON](https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json):
- Bold trigger keywords with a colon: "**Battlecry:**", "**Deathrattle:**".
- Variables are marked in data: *Fireball* "Deal $6 damage." (the $ marks a value modified by spell damage), and *Ancient of Lore* "Restore #7 Health." (the # marks a modified heal).

**KeyForge**, from [Decks of KeyForge API](https://decksofkeyforge.com/api/cards):
- Every effect is labelled with its trigger, even on action cards:
  - *Anger*: "Play: Ready and fight with a friendly creature."
  - *Troll*: "Reap: Troll heals 3 damage."
  - *Dextre*: "Play: Capture 1<A>. / Destroyed: Put Dextre on top of your deck."
  - *Bad Penny*: "Destroyed: Return Bad Penny to your hand."
- Non-standard triggers fall back to prose. *Krump*: "After an enemy creature is destroyed fighting Krump, its controller loses 1<A>."

**Marvel Snap**, from [marvelsnapzone API](https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true):
- The data marks "On Reveal" and "Ongoing" as styled spans:
  - *Iron Man*: "**Ongoing**: Your total Power is doubled here."
  - *Medusa*: "**On Reveal**: If this is at the middle location, +3 Power."
- Other triggers are plain prose labels or sentences:
  - *Sunspot*: "End of Turn: Gain +1 Power for each unspent Energy."
  - *Wolverine*: "When Discarded or Destroyed: …"
  - *Angela*: "After you play a card here, +1 Power."
- Many cards have no text at all (*Hulk*: "").
- Brode on Snap: "We have less numbers on a card than in any other card game. We have less card types than any other card game." He also said the team doesn't "have to spell it out on the card," because the art carries part of the explanation. — [Apple Developer, Behind the Design: Marvel Snap](https://developer.apple.com/news/?id=sosm2p7q); [GamesBeat](https://gamesbeat.com/ben-brode-bets-super-speed-will-make-marvel-snap-stand-out/) (search snippets)

**Legends of Runeterra**, from [Data Dragon](https://dd.b.pvp.net/latest/set1-lite-en_us.zip):
- Vocab labels with a colon:
  - *Brightsteel Protector*: "**Play**: Give an ally [Barrier icon] Barrier this round."
  - *Zed*: "**Attack**: Summon an attacking Living Shadow with my stats and positive keywords."
  - *Chempunk Pickpocket*: "**Nexus Strike**: Create in hand an exact copy of a random spell from the enemy deck."
- Units speak in the first person: *Kalista* "the first time I attack… we're bonded and it takes damage for me."

**Lorcana**, from [Lorcast](https://api.lorcast.com/v0/cards/search?q=set:1):
- Each non-keyword ability has an ALL-CAPS name (printed bold) followed directly by its rules text, with no colon:
  - *Maleficent – Monstrous Dragon*: "DRAGON FIRE When you play this character, you may banish chosen character."
  - *Stitch – Carefree Surfer*: "OHANA When you play this character, if you have 2 or more other characters in play, you may draw 2 cards."
  - *Mickey Mouse – Wayward Sorcerer* has two named abilities on two lines: "ANIMATE BROOM You pay 1 {I} less to play Broom characters. / CEASELESS WORKER Whenever one of your Broom characters is banished in a challenge, you may return that card to your hand."
- Activated abilities add a cost and an em dash. *Elsa – Snow Queen*: "FREEZE {E} — Exert chosen opposing character."
- Ryan Miller (Game Rant interview) said ability names are one way the game shows its Disney theme: "Showing the details in the art, the gameplay, and even the names we choose for the abilities." — [Game Rant](https://gamerant.com/disney-lorcana-interview-ryan-miller-early-days-accuracy-source-material/) (search snippet)

**Arkham Horror LCG**, from [ArkhamDB](https://arkhamdb.com/api/public/cards/):
- An icon plus a trigger condition plus a colon:
  - *Roland Banks*: "[reaction] After you defeat an enemy: Discover 1 clue at your location. (Limit once per round.)"
  - *Stray Cat*: "[fast] Discard Stray Cat: Automatically evade a non-[[Elite]] enemy at your location."
- Encounter cards use a bold label and a dash. *Amnesia*: "**Revelation** - Choose and discard all but 1 card from your hand."
- *Cover Up* combines three label types:
  > **Revelation** - Put Cover Up into play in your threat area, with 3 clues on it.
  > [reaction] When you would discover 1 or more clues at your location: Discard that many clues from Cover Up instead.
  > **Forced** - When the game ends, if there are any clues on Cover Up: You suffer 1 mental trauma.

**Marvel Champions**, from [MarvelCDB](https://marvelcdb.com/api/public/cards/):
- A bold timing label, an optional italic qualifier, then a colon:
  - *Swinging Web Kick*: "**Hero Action** *(attack)*: Deal 8 damage to an enemy."
  - *Backflip*: "**Interrupt** *(defense)*: When you would take any amount of damage from an attack, prevent all of that damage."
- The cost and effect inside an action are split by an arrow. *Avengers Mansion*: "**Action**: Exhaust Avengers Mansion → choose a player. That player draws 1 card."
- Named hero abilities use a quoted name and a dash. *Black Widow*: "\"Widowmaker\" — **Response**: After you trigger the ability of a [[Preparation]] card you control, deal 1 damage to an enemy."

**LotR LCG**, from [RingsDB](https://ringsdb.com/api/public/cards/):
- "**Action:**", "**Response:**", "**Combat Action:**".
- *Steward of Gondor*: "Attach to a hero. / Attached hero gains the ***Gondor*** trait. / **Action:** Exhaust Steward of Gondor to add 2 resources to attached hero's resource pool." The cost is in prose with "to", not a colon.

**Flesh and Blood**, from [the-fab-cube](https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json):
- *Dawnblade*: "Once per Turn Action - {r}: Attack". The limit and type label come first, then a dash, then cost, colon and effect.
- Triggers are short: *Snatch* "When this hits, draw a card."

### Inferences
- Three layers of labelling recur across these games:
  1. a **timing or trigger label**, which carries rules meaning (Play:, Battlecry:, On Reveal:, Forced -, [reaction] icon, Interface →);
  2. a **naming label**, with no rules meaning (MTG ability or flavor word in italics with an em dash; Lorcana ALL-CAPS name; Marvel Champions quoted name);
  3. the **cost:effect** body.
- The most glanceable cards (KeyForge, Snap, Hearthstone) open every ability with a one- or two-word bold label from a tiny closed set. Readers learn about five labels and can then sort any card by when it acts.
- Lorcana is the clearest precedent for a topline name on every ability. MTG's ability words are the precedent for a shared label that groups cards. Rosewater's 2008 column gives the rationale: players miss connections unless they are named. The italics deliberately signal "no rules meaning."
- Netrunner's arrow (→) separates a qualifier or condition label from the ability itself, which keeps the cost:effect syntax uncluttered.

### Gaps
- No NSG design article explaining the choice of the arrow glyph was found. Major Changes gives no reason for the "Threat N →" format.
- No designer source on why Lorcana uses ALL CAPS rather than italics, or on Runeterra's first-person voice, was found.

## 6. Designer writing on readability, glanceability, word limits and hierarchy

### Takeaway
Primary designer statements that could be verified are thin but consistent:
- Rosewater: name connections players would otherwise miss; keyword what can be keyworded; keep commons simple (NWO).
- Brode: physical cards need stricter text consistency than digital ones; Snap deliberately has fewer numbers and less text, with the art doing explanatory work.
- Netrunner (NSG): templating changes are made to make implicit rules explicit (Interface) and to remove ambiguity ("gets" over "has").

No source found gives a hard words-per-card limit for any of these games.

### Cited findings
- Rosewater, 2008-07-28, on ability words as connection markers and marketing hooks. — [Making Magic](https://magic.wizards.com/en/news/making-magic/ability-word-your-mother-2008-07-28)
- NWO (column 2011-12-05): careful control of complexity at common. Innistrad commons have at most two abilities or functions. — [StarCityGames, 2011-12-07](https://articles.starcitygames.com/articles/new-world-order-and-complexity-creep/)
- Rosewater also wrote "New New World Order" (2013-03-29) and an April Fools follow-up (2013-04-01). — [magic.wizards.com](https://magic.wizards.com/en/articles/archive/making-magic/new-new-world-order-2013-03-29) (not fetched)
- Brode, Hearthstone Designer Insights (about 2016): consistency matters most for physical cards. In digital, knowing from the text exactly how a card works is "important… but not critical". Text changes should be reserved for cases of regular player confusion. — [Icy Veins](https://www.icy-veins.com/forums/topic/14965-hearthstone-lead-designer-ben-brode-on-card-text-consistency/) (snippet)
- Brode, Marvel Snap (2022): "We have less numbers on a card than in any other card game." Simplicity was meant to maximise "the depth of the complexity we chose to add." — [Apple Developer](https://developer.apple.com/news/?id=sosm2p7q) (snippet)
- MTG made the 2024 "this creature" templating change for clarity about which single object is referred to. — [Name the Rule](https://blogs.magicjudges.org/nametherule/this-object/)
- NSG made templating changes for explicitness and to avoid ambiguity. — [NSG Major Changes](https://nullsignal.games/players/major-changes/)
- Lorcana's Ryan Miller frames the game as "every game is someone's first" (interview headline, Shimmering Skies era, 2024). — [Sifter](https://www.sifter.com.au/post/disney-lorcana-interview-ryan-miller-shimmering-skies) (headline only; not fetched)

### Inferences
- Keeping text short in practice comes from systemic choices rather than word caps:
  - a closed set of labels;
  - numerals instead of number words (Netrunner "Draw 3 cards", Runeterra "Deal 2");
  - dropping redundant nouns (Runeterra "Deal 2 to anything");
  - letting the interface or icons carry reminders (Hearthstone tooltips, Runeterra keyword sprites, Arkham action icons).

### Gaps
- No verified source for:
  - Rosewater's "red flag" quota at common;
  - his three-part complexity model (comprehension, board, strategic);
  - any official MTG words-per-card guideline.
- No Hearthstone GDC talk specifically on card text or UI was located. GDC Vault was not searched directly.
- No Null Signal Games or ANCUR internal style guide was found to be public. NSG says its Rules team "formats the text of new cards to ensure clarity."
- No Lorcana, Flesh and Blood or KeyForge designer article on text-box hierarchy was found.
- Runeterra developer commentary on keyword icons or the first-person voice was not found.
