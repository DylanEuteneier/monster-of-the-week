# Card Readability and At-a-Glance Recognition: Principles and Evidence

Scope: general principles for structuring a card's text (headline, targets/details, unique rules, flavour), drawn from design writing, UX/HCI guidance and game graphic design practice. These are notes for a report writer. Opinions are marked as opinions. Where only secondary or summary sources were reachable, that is noted.

Overall evidence quality: there is **very little academic research specific to card readability**. Most game-specific material is practitioner writing (Wizards, Blizzard, accessibility reviewers, design blogs). General HCI evidence on icons and on progressive disclosure is stronger and transfers reasonably well.

---

## 1. Visual hierarchy on cards: what is read first, how size/weight/position/colour signal importance, scan patterns

### Takeaway
Practitioner consensus: put what matters most where the eye lands first, make it biggest and boldest, and keep each kind of information in the **same place on every card** so players learn where to look. Placement itself signals importance (an NN/g finding from software that transfers to cards). There is almost no card-specific eye-tracking evidence.

### Cited Findings
- Board game design guides recommend changes in font size, weight and style so players can find the most important information quickly, and note that consistent placement lets players learn where to look (search-result summary of practitioner guides; direct fetch was rate-limited) — [Mahtgician Games, Card Layout and Design: Tips and Tricks](https://mahtgiciangames.com/blogs/the-creative-workshop-game-design-blueprints/card-layout-and-design-tips-and-tricks)
- In Race for the Galaxy, "the key data for phases is almost always in a reliable place," which the accessibility reviewer counts as a strength even while grading the game's visual accessibility D — [Meeple Like Us, Race for the Galaxy accessibility teardown](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)
- Same review: phase symbols "are readable even if they're often very small" because they are highly contrasted against a letterbox background; small high-contrast marks in a fixed spot can still read — [Meeple Like Us](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)
- NN/g (Nielsen, 2006): "the very fact that something appears on the initial display tells users that it's important." Placement signals priority — [NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- An academic redesign case study of the card game *The Art of Batik* found that the cards had poor information arrangement and hierarchy; the redesign remapped information before changing the components' form (search-result summary only; full paper not read) — search result via [Mahtgician/related results](https://mahtgiciangames.com/blogs/the-creative-workshop-game-design-blueprints/card-layout-and-design-tips-and-tricks) (paper itself not located; treat as weak)
- Dune: Imperium is praised for a layout where the top portion of nearly every card shows where an agent can be sent, and a separate area shows the effect when the card is revealed. Fixed zones for different uses of one card — [Meeple Mountain, Dune: Imperium review](https://www.meeplemountain.com/reviews/dune-imperium/)
- A Dune: Imperium review credits the board's clarity to iconography that lets players "gather information at a glance," which speeds decisions for experienced players — [Zatu, Dune: Imperium review](https://zatu.com/dune-imperium-review/)
- Eye-tracking of co-located tabletop play (Rogerson et al., CHI PLAY 2017) found repeated short gaze jumps between people and components, with fixations typically well under a second, including during other players' turns. Card information is often taken in through brief glances, not sustained reading (search summary of abstract) — [University of Melbourne, "What can we learn from eye tracking boardgame play?"](https://findanexpert.unimelb.edu.au/scholarlywork/1280384-what-can-we-learn-from-eye-tracking-boardgame-play%3F)

### Inferences
- If players mostly glance at cards (sub-second fixations), the card's top line has to work on its own in a glance. That supports a short headline or summary line in a fixed, prominent spot, with details below.
- Consistent zones (cost here, type there, effect below) matter more than any single styling choice, because recognition comes from position memory.
- Hierarchy should follow how often information is used in play, not how complex it is (NN/g's frequency-of-use criterion, applied to cards).

### Gaps
- No eye-tracking study found that measures how players read individual cards (F-pattern, Z-pattern, or other).
- Could not fetch the Mahtgician layout article (HTTP 429); claims rest on the search summary.
- No published study found comparing hierarchy treatments (size vs weight vs colour) on game cards.

---

## 2. Icons vs text: when icons help and hurt; composable icon grammars; icon + word redundancy

### Takeaway
HCI evidence is fairly consistent: outside a handful of universal symbols, icons are ambiguous, and **icon + visible label** beats either alone for learning. In games, icon-heavy grammars (Race for the Galaxy is the standard example) are concise and fast for experts but are the main barrier for newcomers. Text backups and digital tap-to-explain reduce the cost.

### Cited Findings
**HCI evidence**
- NN/g (Harley, 2014): icons are "fast to recognize at a glance (if well designed)," but apart from home, print and search, "most icons continue to be ambiguous to users" — [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)
- Same: "a text label must be present alongside an icon"; "icon labels should be visible at all times"; "Don't rely on hover to reveal text labels" — [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)
- Same, 5-second rule: if it takes more than 5 seconds to think of an appropriate icon for a concept, the icon is unlikely to communicate it — [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)
- Same: test recognizability by asking users what they expect an icon to mean, and memorability by asking returning users after a few weeks; "Obscure icon = wasted feature" — [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)
- Wiedenbeck (1999), *Behaviour & Information Technology* 18(2):68–82, studied learning and retention with icons, labels and icon+label in an application. Koutsourelakis & Chorianopoulos (2010) cite it as showing that text + image outperforms either alone. **Secondary characterization only; original results not read** — [Koutsourelakis & Chorianopoulos 2010](https://users.ionio.gr/~choko/pdf/Koutsourelakis_2010.pdf)
- Dissent (opinion piece): a UX Collective article argues the claim that icons improve usability is a myth, and proposes "progressive reduction," dropping labels once users have learned a control — [UX Collective, Do Icons Need Labels?](https://uxdesign.cc/do-icons-need-labels-6cb4f4282c00)
- Hodent (Fortnite UX) found players spending effort working out what icons meant, and argued challenge should come from gameplay, not from interface confusion. She recommends testing icons early with paper prototypes for comprehension, not looks — [DigiPen News](https://news.digipen.edu/industry/dr-celia-hodent-brings-ux-insight-from-fortnite-to-digipen/); [IxDF](https://ixdf.org/literature/article/why-user-testing-is-the-only-reliable-way-to-verify-your-design)
- Hodent's *The Gamer's Brain* (2017) lists "Signs and Feedback" and "Clarity" (perceptible, unambiguous cues; readable fonts; contrast; Gestalt grouping) among its usability pillars (third-party summary, not the book) — [book summary](https://sobrief-staging.onrender.com/books/the-gamers-brain)

**Game practice: Race for the Galaxy as the reference case**
- Wikipedia: RftG uses iconography in place of language in some places, with complex powers also given a text description; experienced players like the concision, but some new players find the icons hard to learn and decipher — [Wikipedia, Race for the Galaxy](https://en.wikipedia.org/wiki/Race_for_the_Galaxy)
- Meeple Like Us calls the "intensely obscure symbolic language" the most inaccessible part of the game; learning it "adds a cognitive cost that can't be avoided to everything," and "takes a long time before the iconography becomes second nature." Icons are "small but information dense." Cognitive grades: Fluid Intelligence E, Memory E (subjective heuristic grades) — [Meeple Like Us](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)
- Reviews are split: critics cite a steep learning curve and "poor iconography," while defenders compare it to learning a foreign language. A Meeple Mountain reviewer who once criticized the symbology later wrote an "I Was Wrong" revisit. The digital version's tap-to-explain is credited with shortening the learning curve (search summaries of several reviews) — [Stately Play review](https://statelyplay.com/2017/05/03/review-race-for-the-galaxy/); [Meeple Mountain](https://www.meeplemountain.com/reviews/race-for-the-galaxy/); [I Slay the Dragon, interpreting icons](https://islaythedragon.com/misc/interpreting-icons-and-other-nonsense/)
- One blogger's criticism: many RftG icons are abstract shapes that don't suggest their effects (opinion) — [I Slay the Dragon](https://islaythedragon.com/misc/interpreting-icons-and-other-nonsense/)

**Practitioner guidance**
- Icons ease translation but may need an icon guide; whether to use icons or text depends on the game — [The Game Crafter, Board Game Blueprint ep. 12](https://news.thegamecrafter.com/post/762610301024780288/episode-12-of-board-game-blueprint-talks-about/amp)
- Include an icon glossary in the rules and on a player reference card when a game depends on icons — [League of Game Makers](https://www.leagueofgamemakers.com/whats-that-symbol-mean-again-building-clear-iconography-into-your-game/)
- Forum opinion: prefer icons when only a relatively small number of things are iconized — [BGDF forum thread](https://bgdf.com/forum/game-creation/design-theory/iconography-vs-quick-reference-vs-text)
- An icon system reduces reliance on text and helps players facing language barriers; icons should match the theme (opinion) — [Mahtgician Games, Developing an Iconography System](https://mahtgiciangames.com/blogs/the-creative-workshop-game-design-blueprints/developing-an-iconography-system-for-games)

### Inferences
- Icons pay off for **high-frequency, low-variety** information (costs, resource types, recurring verbs) that players see many times per game. They cost the most for **rare or unique** effects, where text is clearer.
- A composable grammar (verb mark + noun mark + number) keeps the vocabulary small, which addresses the main RftG complaint (too many marks to learn). The open risk is abstract marks that don't suggest their meaning, which NN/g's recognizability and memorability tests can check.
- Physical cards can't rely on hover, so the label has to be printed (word next to icon) or in a reference aid. NN/g's "labels visible at all times" maps to the card being self-sufficient. A digital table can add tap-to-explain on top, as RftG's app did.
- "Progressive reduction" (fewer labels as players learn) has a physical equivalent: an icon + word on the card plus a rules glossary, or a beginner edition with words and an expert edition with icons only. This is an inference, not a documented practice in sources found.

### Gaps
- No sources found on the reception of icon grammars in Through the Ages, Glory to Rome, Res Arcana or Gloomhaven; searches returned nothing usable.
- No source found on whether Dune: Imperium prints text redundantly alongside its icons.
- Wiedenbeck (1999) primary results (effect sizes, conditions) not verified.
- NN/g's "Icon Usability" is based on usability observation rather than controlled experiment; it is strong practitioner evidence, not a lab study.

---

## 3. Keywording and ability words: named verbs, reminder text, glossaries, the "topline" pattern

### Takeaway
Designers at Wizards and Blizzard treat keywords as compression: once learned, one word stands for a rule, cards look simpler, and other cards can reference the effect. The cost is up-front vocabulary, so keywords are only worth it for **frequent** effects, and the total number must stay small. Reminder text (italic parenthetical definition) bridges first exposure.

### Cited Findings
- Blizzard (Peter Whalen): keywords "can make learning cards easier"; they shorten text, which "leads to more readable cards that fit better in the frame"; "The best keywords appear a lot, are flavorful, and give us useful mechanical hooks"; but "Keywords aren't all upside." Whalen questions whether Enrage is "actually any easier to understand" than plain text such as "Has +5 Attack while damaged" — [Hearthstone, Designer Insights: Enrage Changes](https://hearthstone.blizzard.com/en-us/news/21614307)
- Hearthstone team member: the team simplifies text so that you get what the card does "in the majority case on first read"; one extra word that pushed a card to four lines would shrink the font and make it harder to read the first time (search summary of dev-tracker posts) — [outof.games dev tracker](https://outof.games/devtracker/hearthstone/twitter/twitter-hearthstone/38276)
- Kinstler (Game Developer, 2018): a keyword is "a word or set of words that acts as a substitute for rules text"; keywords reduce **perceived** complexity, since a full sentence about blocking "seems much more complicated" than "Flying"; designers should limit complexity "even if it's just perceived complexity"; keywords let other cards reference an effect (e.g., *Elder Scrolls: Legends*' "Last Gasp") — [Game Developer, Card Games: What's in a Keyword](https://www.gamedeveloper.com/game-platforms/card-games-what-s-in-a-keyword)
- Kinstler: good reasons to keyword are common effects (Magic's Deathtouch replaced four differently worded cards that caused confusion), flavour (Devour) and set identity (Innistrad's flashback/transform). Avoid keywords that are too specific, too generic, or add nothing ("Damage: 1 to creature"). He suggests **8–12 keywords** for a base game and **no more than 7** for an expansion (opinion, not data) — [Game Developer](https://www.gamedeveloper.com/game-platforms/card-games-what-s-in-a-keyword)
- MTG reminder text is italicized text in parentheses that summarizes a rule that applies to the card (Comprehensive Rules 207.2a), and is not part of the rules text for gameplay. Introduced in Mirage; Eighth Edition added it even for Flying. Some players saw it as "dumbing down." It is left off some premium treatments — [MTG Wiki, Reminder text](https://mtg.wiki/page/Reminder_text)
- Rosewater: vocabulary is a major comprehension barrier (e.g., "the stack" in rules text), and text that needs too many steps at once (Suspend) adds comprehension complexity. **Test: if a player has to read a card more than once to understand it, it has comprehension problems** — [Wizards, Making Magic: Lenticular Design (2014)](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31)
- Legends of Runeterra shows keywords as interactive yellow text with hyperlinks; Riot noted problems when such interactive text overlapped tappable region icons after a frame change (dev comments) — [outof.games, Riot comments on card frames](https://outof.games/news/2659-riot-comments-on-the-recent-changes-to-runeterras-card-frames/)
- Player suggestion (opinion): colour-code keywords and pair them with small inline icons to aid recognition and memory — [Klei forums, UX improvements](https://kleiforums.com/forums/topic/119490-ux-improvements-color-coding-and-icons-for-cards/)

### Inferences
- A "topline" (a bolded short label naming the effect type, then details) is a keyword pattern: it gives a reader who glances only once the gist and gives a reader who reads closely the specifics. It meets Whalen's "majority case on first read" goal.
- Keyword budget: Kinstler's 8–12 matches NN/g's warning about obscure symbols. Each new keyword or icon is a vocabulary item every player has to learn before the card reads at a glance.
- Whalen's Enrage reflection is a caution: a keyword that only renames a short plain-English condition may add a learning cost without much saving. Keywords pay off when the full text is **long** and **recurring**.
- Reminder text is progressive disclosure on the card itself: keyword first (for experts), definition second and visually weaker (italic, parenthetical) for newcomers. It is the physical version of a hover tooltip.

### Gaps
- No published data found on how many keywords players can hold at once, or how reminder text affects learning speed.
- Rosewater's "Jogging your memory" (The Duelist #23) on the origin of reminder text was not accessible.
- No official Riot or Marvel Snap design writing on keyword UI was found in this pass.

---

## 4. Progressive disclosure: summary first, detail second; digital tooltips vs physical cards

### Takeaway
Progressive disclosure (show the few most important things first and defer the rest) improves learnability in software, and placement up front itself signals importance. Digital card games defer detail to hover/tap; physical cards must carry everything, so disclosure happens **within** the card through hierarchy (headline → detail → reminder → flavour) and **outside** it through reference aids. Rosewater's lenticular design is a related idea about strategic depth rather than layout.

### Cited Findings
- Nielsen (NN/g, 2006): progressive disclosure "defers advanced or rarely used features to a secondary screen"; show the few most important options first; keep the primary set short; make the route to secondary options obvious; prioritizing features helps users understand the system better, not worse; decide the split from task analysis and frequency-of-use data — [NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- NN/g (Harley, 2014): don't rely on hover to reveal labels; hover adds cost and fails on touch devices — [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/)
- RftG's digital version offers tap-to-explain, which reviewers credit with cutting the learning curve the physical icons create — [Stately Play](https://statelyplay.com/2017/05/03/review-race-for-the-galaxy/)
- Rosewater's lenticular design: cards that are "simple to the beginner but more advanced to the experienced player." Rule 2: a card needs a surface value, and "the card cannot have any text that does something the player cannot understand." He separates comprehension complexity (what the card does), board complexity and strategic complexity, and says strategic complexity is the one hidden from newcomers — [Wizards, Lenticular Design (2014)](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31)
- Rosewater (2026 SDCC interview): the goal is cards beginners immediately understand while giving experienced players additional strategic depth — [Smashpad interview](https://smashpad.com/sdcc-2026-interview-magic-the-gathering-head-designer-mark-rosewater-talks-design-for-new-players-community/)
- MTG's New World Order (2008, Rosewater 2011 article): limit comprehension and board complexity at common, the rarity new players see most, e.g., commons shouldn't affect more than one other card on the battlefield; complexity allowed at higher rarities — [MTG Wiki, New World Order](https://mtg.wiki/page/New_World_Order); [Wizards, New New World Order (2013)](https://magic.wizards.com/en/articles/archive/making-magic/new-new-world-order-2013-03-29)

### Inferences
- On a physical card, the layers could be: (1) headline or icon line for a glance, (2) targets/amounts, (3) unique rule text, (4) reminder text, (5) flavour. Each layer is visually weaker than the one above, so a reader can stop at any layer.
- Lenticular design argues against putting strategic hints on the card: the card should state what it does plainly and leave how to use it well to the players.
- With a digital table, the card face can stay terse (icons + headline) because a tooltip can always give the full text. But if the physical card must work alone, the printed card is the binding constraint, and the digital version should mirror it rather than depend on hover (NN/g).
- Frequency of use (NN/g) is a principled way to decide what goes in the headline: the effect players need most often during play.

### Gaps
- No source found that measures progressive disclosure on cards specifically.
- No GDC talk on card UI (Hearthstone, Slay the Spire, Marvel Snap, LoR) was located in this pass, though such talks may exist.

---

## 5. Consistency and templating: same phrasing for same effect, fixed clause order, word limits

### Takeaway
Consistent templating is standard practice (Magic's Deathtouch exists because varied wording confused players), and short text is valued because length forces smaller type. No published hard word limits were found for MTG or Hearthstone. The practical limit is the text box: when text grows a line, the font shrinks and the first read gets harder.

### Cited Findings
- Deathtouch replaced four differently worded cards whose wording variation caused confusion: one effect, one phrase — [Game Developer, Kinstler 2018](https://www.gamedeveloper.com/game-platforms/card-games-what-s-in-a-keyword)
- Hearthstone: adding one word would have pushed a card to four lines and shrunk the text, making it harder to read the first time (dev-tracker summary) — [outof.games](https://outof.games/devtracker/hearthstone/twitter/twitter-hearthstone/38276)
- Kinstler: "fewer words just look better – especially if the text is centered" (opinion) — [Game Developer](https://www.gamedeveloper.com/game-platforms/card-games-what-s-in-a-keyword)
- Ben Brode (Hearthstone) has discussed consistency of card wording and why it is "less of a problem" in a digital game, where the engine enforces the rule (article title; content not fetched) — [PCGamesN](https://pcgamesn.com/hearthstone-heroes-of-warcraft/lead-designer-ben-brode-discusses-consistency-in-hearthstone-and-why-its-less-of-a-problem)
- Fan opinion: Hearthstone restricts itself heavily compared with Magic to keep card text short — [Riptide Lab forum](https://riptidelab.com/forum/goto/post?id=119926)
- Rosewater's "read more than once" test is a usable acceptance criterion for templated text — [Wizards, Lenticular Design](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31)

### Inferences
- A fixed clause order (headline verb → target → amount → condition → unique rider) means players learn where in the sentence to look, the textual counterpart of fixed layout zones.
- Fix a maximum line count for the text box at the minimum readable font size, and treat any card that overflows as a design problem rather than a typesetting one. That rule matches Hearthstone's practice.

### Gaps
- **No authoritative MTG or Hearthstone word-count limit found.** Figures sometimes quoted in the community could not be sourced and should not be used.
- Brode's consistency argument was not read in full.

---

## 6. Flavour text: placement, size and effect on reading

### Takeaway
Convention, documented in MTG and in typography guidance: flavour sits last, in italics, visually separated from rules, and italics are reserved for non-mechanical text so players can skip it. No reading-speed evidence was found.

### Cited Findings
- Typography guidance (Chandler, relaying Paquette): "Italics should never be used for anything mechanically important"; reserve them for flavour or decorative text — [Colorblind Games, Readability and Typography with Matt Paquette (2026)](https://colorblindgames.com/2026/03/22/readability-and-typography-with-matt-paquette/)
- MTG uses italics for both reminder text and flavour text; reminder text is explicitly non-rules text — [MTG Wiki, Reminder text](https://mtg.wiki/page/Reminder_text); [MTG Wiki, Flavor text](https://mtg.wiki/page/Flavor_text)

### Inferences
- Italic + last position + separating rule is a learned convention for "you may skip this." It keeps rules text dense and scannable.
- Note the tension: MTG uses italics for reminder text, which is mechanically relevant for newcomers, though not rules-binding. That partly conflicts with the "no italics for anything mechanical" guideline.
- When space is tight, flavour is the first thing to cut. Rosewater's surface-value principle suggests the card's name and art can carry flavour instead.

### Gaps
- No study found on whether flavour text slows rule reading or helps recall.
- MTG Wiki flavor text page not fetched in detail.

---

## 7. Accessibility: font size minimums, colourblindness, contrast

### Takeaway
No published font-size minimum specific to game cards was found. Practical guidance: high contrast, text on a solid field (not over art), wider fonts with a large x-height, slight letter spacing for caps, never colour alone, and greyscale-checking every component.

### Cited Findings
- Paquette's readability criteria, in order: sufficient contrast, readability over art, a solid background; place text on a "clean, uninterrupted color field rather than competing with imagery" — [Colorblind Games](https://colorblindgames.com/2026/03/22/readability-and-typography-with-matt-paquette/)
- Same: "Run every game component through a greyscale filter"; higher x-height improves readability; grotesque sans-serifs suit small text; thin-stroke serifs degrade at small sizes; add tracking, especially in ALL CAPS; card text is a fixed amount in a very small space, so slight extra letter spacing helps at the same point size; Paquette's "dark pub test" (read the cards in a dim bar) — [Colorblind Games](https://colorblindgames.com/2026/03/22/readability-and-typography-with-matt-paquette/)
- Legendary's second edition improved contrast by changing text/background opacity and simplifying colourful icons to black versions — [Colorblind Games](https://colorblindgames.com/2026/03/22/readability-and-typography-with-matt-paquette/)
- Meeple Like Us on RftG: "relying on colour information by itself is always going to be risky"; under tritanopia some colours "isn't enough to permit players to reliably tell them apart"; text "might occasionally be poorly contrasted against the background." Grades: colour blindness D, visual accessibility D — [Meeple Like Us](https://www.meeplelikeus.co.uk/race-for-the-galaxy-2007-accessibility-teardown/)
- General print guidance (not game-specific): Instantprint's minimum is 4pt for flat print and 6pt for large format; thin fonts need more — [Instantprint, Understanding Font Size for Print](https://www.instantprint.co.uk/printspiration/print-design-tips/understanding-font-size-for-print)
- Common guidance: pair every colour cue with a shape, icon, pattern or label (search-summary of practitioner guides) — [Mahtgician Games](https://mahtgiciangames.com/blogs/the-creative-workshop-game-design-blueprints/developing-an-iconography-system-for-games)
- Digital: Xbox Accessibility Guidelines (XAG 101) cover text display, size and contrast for games (not fetched) — [Xbox XAG 101](https://devdocs.xbox.com/gaming/accessibility/xbox-accessibility-guidelines/101)

### Inferences
- For icon grammars, distinguish icons by **shape** first and colour second. That makes them survive greyscale and colour blindness, and it fits NN/g's recognizability tests.
- Text over pixel art or busy illustration fails Paquette's criteria 2 and 3; rules text belongs on a solid panel.

### Gaps
- **No game-card-specific minimum point size found** from a publisher, printer or accessibility body. The 4pt figure is a general print minimum, not a readability target, and should not be presented as a game standard.
- XAG and WCAG contrast ratios not fetched in detail.

---

## 8. Studies on recognizability and reading speed in card games

### Takeaway
Direct empirical work is very thin. The nearest are general HCI icon/label studies (Wiedenbeck 1999; NN/g usability findings) and eye-tracking of whole-table board game play (Rogerson et al. 2017), which shows brief glances rather than sustained reading.

### Cited Findings
- Rogerson et al. (CHI PLAY 2017): gaze jumps repeatedly between people and components; fixations typically well under a second — [University of Melbourne record](https://findanexpert.unimelb.edu.au/scholarlywork/1280384-what-can-we-learn-from-eye-tracking-boardgame-play%3F)
- A matching-pairs card game eye-tracking study (18 adults) correlated saccade and fixation measures with game duration and cards flipped; it concerns memory play, not card reading — [Univ. of Florence, Eyetracking Correlated in the Matching Pairs Game](https://flore.unifi.it/retrieve/b832ceb1-a932-4882-ab03-5888c26f6968/Eyetracking_Correlated_in_the_Matching_Pairs_Game.pdf)
- Wiedenbeck (1999) on icon/label learning and retention — see Section 2 (secondary characterization) — [Koutsourelakis & Chorianopoulos 2010](https://users.ionio.gr/~choko/pdf/Koutsourelakis_2010.pdf)

### Inferences
- Without card-specific studies, designers rely on cheap direct tests: Rosewater's "read it once" test, NN/g's "what do you think this icon means" and a weeks-later memory test, Paquette's greyscale and dim-light tests, and timing how long a playtester takes to say what a card does.

### Gaps
- No controlled study found that compares icon vs keyword vs full text on game cards for speed or accuracy.
- No eye-tracking study of digital card game UI (Hearthstone, etc.) found.
