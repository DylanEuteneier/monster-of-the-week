# Measuring the cards (and the game) with bots

`scripts/measure.js` is the one measuring tool (designer, 2026-11-08). It plays bot games with the live game's
configuration, or reads a run already played, and prints **one set of reports**. Each report opens with a header
saying how the run was made, and the sections follow from it: the probe's figures appear only when the run probed.

```sh
node scripts/measure.js baseline=1              # the baseline: the accepted configuration, every measure (~35 min)
npm run measure -- games=40 players=3,4,5 o.threshold=22   # a change: read against the baseline automatically
node scripts/measure.js logs=.tuning/measure-…   # the same reports again from a run's folder, no games
node scripts/measure.js logs=before=DIR logs=after=DIR   # a change: two runs side by side
node scripts/measure.js logs=DIR report=cards card=bait-herd   # any mix of reports, any time, from the same run
```

**What's kept.** Each run is a folder, `.tuning/measure-<time>/` (or `out=`): one log per player count (gzipped, about 2–3 MB for 40 games), `run.json`
(how it was made) and `report.txt` (the reports as printed). It stays until deleted, but `.tuning/` is local and not
in git, so a run worth keeping should be named (`out=.tuning/baseline-2026-11-08`) and copied somewhere safe if it
must outlive the machine. Reading a folder back with other reports saves them beside it (`report-cards.txt`).

**One run, every report.** The reports don't need different runs: they all read the same games. A run logs everything
every report reads (the card study, the big-play diagnosis, the tie checks: all on by default), and `report=` only
picks which reports print and in what order (default `game,cards,agreement,bots`). So play once, then read the folder
back as often as you like with any mix. Only two things change a run itself, and the header names both: the probe
(`probe=`, it adds tests) and stronger bots (`think=`).

| Report | File | What it answers |
|---|---|---|
| `game` | `game.js` | the designer's preferences: balance, agency, tension, every round mattering ([below](#questions-about-the-game)) |
| `cards` | `cards.js` | each card: can it act, is it wanted, do its readings differ, its strength, which ending, when, its uses |
| `agreement` | `cards.js` | how far each card stat can be trusted (split halves) |
| `bots` | `bots.js` | what each kind of seat attends to, round by round, and why it wins or loses ([below](#questions-about-the-bots)) |

The tool answers three families of questions: **about the game** (balance, agency, tension, whether every round
matters: the game report, which has measured the designer's preferences since 2026-10-31 and is kept whole here)
**about the cards** (the card report, added 2026-11-08) and **about the bots** (the bot report, since 2026-11-05). This README is organised by those questions. For each: where the answer is, how to read it,
what run it needs, and what it can't tell you. Bots are the players throughout, so every answer is about how strong,
consistent players use the cards. Whether a card is fun, readable or thematic is for playtesting. The ✗ and ✓ marks
and every target are Claude's working lines: they say where to look, never what to change.

## Contents

1. [The baseline](#the-baseline)
2. [Questions about the game](#questions-about-the-game)
3. [Questions about the bots](#questions-about-the-bots)

Questions about the cards:

4. [Does a hand give real choices?](#does-a-hand-give-real-choices)
5. [Can this card act?](#can-this-card-act)
6. [Does the player want its action?](#does-the-player-want-its-action)
7. [Do its readings offer different plays?](#do-its-readings-offer-different-plays)
8. [How strong is it against the rest of the hand?](#how-strong-is-it-against-the-rest-of-the-hand)
9. [What is it worth, all else equal? (the probe)](#what-is-it-worth-all-else-equal-the-probe)
10. [Which ending does it serve?](#which-ending-does-it-serve)
11. [When in the round is it played?](#when-in-the-round-is-it-played)
12. [Is it automatic?](#is-it-automatic)
13. [What does it do to the board?](#what-does-it-do-to-the-board)
14. [Which cards go together?](#which-cards-go-together)
15. [Can I trust this number?](#can-i-trust-this-number)
16. [Did a change help?](#did-a-change-help)
17. [Options](#options)
18. [Adding a measure](#adding-a-measure)

## The baseline

**The baseline is the current measure against which everything is compared** (designer, 2026-11-08): one run of
the complete set of measures under the accepted best configuration.

```sh
node scripts/measure.js baseline=1     # rebuild it: about 80 minutes on 8 cores
```

- **What it plays:** the live game's bots (one bot with dials, its lean spread over the table as the live game does)
  and the live game's rules (`spec.json` defaults), 100 games at each of 3, 4 and 5 players (designer, 2026-11-08: about ±4.5 points on an ending share at each count), seed 7101, every log on
  and the strength probe at 5% of turns, so every report and every column has its figures. The configuration is
  `BASELINE` at the top of `measure.js`. It changes only when a decision changes what is accepted; `baseline=1`
  refuses other settings.
- **Where it lives:** `.tuning/baseline/` (logs, `run.json`, `report.txt`). Rebuilding moves the old one to
  `.tuning/baseline-previous/`, so one step back is always there.
- **How much it can tell:** an ending share at one player count is good to about ±4.5 points (one standard error),
  ±3 pooled. A 40-game comparison run is good to about ±7 points a count, so against the baseline only moves of
  roughly 20 points or more are flagged; anything close gets a 100-game run before it's believed. Card rates are
  counted over thousands of held turns and are much tighter; the strength probe samples 5% of turns and is the
  noisiest card measure.
- **When to rebuild:** after any accepted rule, card or bot change. A comparison warns when committed rule, card or
  bot code has changed since the baseline was played.
- **How it's used:** every other run, played or read back, is compared with it automatically (`compare=0` skips
  it). The header shows both runs. The game report puts baseline and run side by side for each player count
  (`4p base`, `4p run`). The card report is followed by *Cards against the baseline*: the turns summary and each
  card's Can act, Wants to, Readings, Strength (and Probe when both probed), baseline → run for each side, ▲▼ where
  a change is over three standard errors. The bot report covers the run alone.

To test a change, run it the same way as the baseline and change only the thing being tested: the same seed plays
the same deals, so the difference is the change. Every scorecard cell reads **invader backers · trophy hunters**.
The first is from turns where the seat played for the invaders' ending, the second from turns where it played for
the island's (trophies), each from that goal's turns alone. ◆ marks the two sides 20 or more points apart. The rank
in brackets (1 healthiest) is on the weaker side, since a card that fails one ending needs work. Under the
scorecard, every use (each reading, each unsuited use) has its own figures.

## Questions about the game

**Where:** the game report (`report=game`): one row per measure, grouped by the designer's preference it serves
(design document 1.2–1.4, RV1, 3.15), with ✓/✗ against provisional targets (Claude's working numbers, set in
`TARGETS` in `game.js`; never decisions). One run prints a column per player count; runs side by side print a column
per run. The game report's columns use every log the runner writes; the tool turns them all on by default
(`swing=1`, `ties=1`, `cards=1`), so no row comes out blank unless the rules make it so (the vote rows need round
votes on).

| Question | Section | What it reads |
|---|---|---|
| Is the ending a knife's edge, with push and pull? | *Push and pull* | invaders' share of endings (D33: about 40%), the final count against the bar, sides changing, how certain the forecast is after round 3 |
| Does every round matter? | *Every round matters* | games settled early, comebacks, round 5 flipping or deciding the ending, each round's lean |
| Is the invaders' ending more than a sway race? | *Invader ending* | the faction race staying open, late plays that only build sway, players backing different factions, winners cutting a rival |
| Is the island's ending a trophy race to the end? | *Island ending* | winning scores, the player in front after round 3 winning, trophies spread over factions, margins |
| Do players have agency; can they come back? | *Agency and comebacks* | the leader after rounds 2, 3, 4 going on to win, last place winning, the gap at the top, the lead changing hands |
| Are games close? | *Close games* | margins, games won by 1 or tied, last place within reach |
| Is the board alive? | *Dynamic board* | presence and fights per round, locations occupied, monsters moved, fight losses against the refill |
| Do the cards matter? | *Cards matter* | plays with no effect, plays that change the board, cards that rarely do (the card report goes further) |
| Few choices, huge consequences? | *Few choices, huge consequences* | monsters moved per play, big plays (4+), forecasts flipping |
| Why so few big plays? | *Big plays: why so few* | A too few tokens, B groups too small, C no legal big play or the sway cost, D which held cards could swing 4+ |
| Is it about the board, not an economy? | *Not economy-focused*, *Light* | plays that only build sway or standing, cards spent for sway, unspent supply, plays per seat |
| Do players read the table? | *Read the table* | seats chasing one ending, switching endings, split tables |
| Are fights contested? | *Contesting fights* | trophies at stake and left on the table, fights nobody swayed, ties and denial, ties a player could have broken |
| Are the bots good enough to trust? | *Bot quality* | forecast calibration and skill, goals matching the ending, goal-consistent play |
| Is it fair? | *Fair* | win spread between seats, the round 1 first player, Steal Their Playbook players, wins by bot profile |

Before and after any rule or card change, read the whole game report side by side: a change aimed at one card can
move any of these, and the report exists so no side effect goes unseen.

## Questions about the bots

**Where:** the bot report (`report=bots`): one column per kind of seat. In the baseline that is each lean on the
table; `by=hfrom` (any setting) groups seats by one setting instead, for runs that mix bot settings; `rounds=0`
hides the round-by-round sections.

| Question | Section |
|---|---|
| Why does a kind of seat win or lose? | *Diagnosis*: win share by ending, its score against the winner's, its rank after each round on both endings' scoring, whether its last goal matched the ending, when it committed |
| What does it attend to each round? | *Focus, round N*: its goal, what it played (action, sway, way back; card verbs), sway and tokens placed, standing and trophies from its plays against the rest of the round, fights it was in |
| Where does its effort go? | *Effort*: its plays by what they led to that round (trophies, standing, both, nightfall, nothing) |
| Does it hunt trophies evenly? | *Trophy hunting by archetype* |
| When it backs the invaders, does it back the right faction? | *Backing a losing faction* |

The bots measure the game and the cards, so read this report whenever a game or card finding looks odd: it says
whether the bots played that seat sensibly.

## Does a hand give real choices?

**Where:** the card report's first section, *Turns*.

**Reads:** on how many turns one card is clearly best (a third of the turn's spread of values ahead of the next),
the top two are close (within a tenth), or nothing stands out (every card within a tenth); how many cards in hand
are live (within a tenth of the best); by round and by player count. Gaps are a share of each turn's own spread,
because the bots' values have no fixed scale.

**Healthy looks like:** close decisions common, a clear best not most of the time, more than one live card.
First card run (2026-11-07, 120 games): clear 40%, close 27%, nothing stands out 10%, 1.3 live cards of 3.5.

**Can't tell you:** whether a choice *feels* hard to a person, or whether the alternatives are interesting rather
than merely close in value.

## Can this card act?

**Where:** scorecard, **Can act**: the share of turns held with at least one legal target; `e`: the share of its
plays that had no target and did nothing (the engine logs "has nothing to act on").

**Points at:** its targeting conditions. A card that is often dead has a "when it works" problem, not a power
problem. Under *Uses*, **open** shows which reading or use is the one that's rarely legal.

**Why it's trustworthy:** it's the engine's own count of legal targets, not a bot's opinion. Agreement 0.96–0.98.

**Watch:** a dead card is still played every round (passing is off): as sway, or as a play that does nothing when
the seat's supply is empty. So deadness costs tempo and sway, not a lost card.

## Does the player want its action?

**Where:** scorecard, **Wants to**: of its plays while its action had a legal target, the share played for the
action instead of spent for sway.

**Points at:** the action's power against the card's printed sway (2, 3 or 4). Low means its action, when
available, is usually worth less than the sway. Read it beside Can act: "can't" and "won't" need different fixes.

**Watch:** this is bot judgement, so it's as good as the bots' sense of what the action is worth. Agreement
0.73–0.90: trust the extremes, not a few points' difference.

## Do its readings offer different plays?

**Where:** scorecard, **Readings**: on turns with two or more of its readings or uses open, the share where their
best plays differ. *Uses* shows, per reading, how often it's open, how often it's taken when open, and its strength.

**Points at:** rewriting a reading. Low means the readings mostly reach the same play: in practice one choice, not
two. A reading that's open but rarely taken is the one to rewrite.

**Watch:** "the same best play" partly reflects how the bots list targets. Before rewriting a reading, check on a few
real boards that the two readings truly reach the same moves.

## How strong is it against the rest of the hand?

**Where:** scorecard, **Strength**: its best play's value against the best of the rest of the hand that turn, as a
share of the turn's spread (0: level with the best of the rest; negative: behind it). Per use under *Uses*.

**Points at:** its numbers (how many tokens, how far, how much sway), once it can act and is wanted.

**Watch:** it depends on what else was in the hand, so it's a relative measure; and it's least reliable among the
bunched suit cards (agreement 0.82–0.89). For a fair, absolute answer, use the probe (below).

## What is it worth, all else equal? (the probe)

**Where:** a **Probe** column in the scorecard and a *Probe* section, only in runs with `probe=` on.

**What it does:** the controlled card test (the measure that orders printed sway: D12, decided 2026-10-08). On a share
of turns it takes a sample of the deck and, for each card, sets up two versions of the same moment: the seat to act
holds the card, or doesn't. The seat's own bot decides in each version, and each decision is played out to the
round's end on the same random seeds, so both versions meet the same luck. The card's worth is the seat's value
holding it minus not. The probe never changes the games: they, their plays and the card log come out identical with
it on or off.

**Reads:** worth (mean; the bots' value scale, so compare cards with each other), the share of tests where holding
it helped, and how often the bot played it when it had it.

**Run:** `probe=0.05` (5% of turns, 4 cards a test, 4 play-outs a side). Each card gets about one test a game, split
over the two goals, so plan **200+ games** (`games=70 players=3,4,5`) and check the Probe column under
`report=agreement` before ranking cards by it. It makes games slower (each card tested costs up to two full bot
decisions and their play-outs): about 1.4× at `probe=0.05` (2026-11-08, 4 players, 96 s a game against 67 s), so
210 games take about an hour on 8 cores.

## Which ending does it serve?

**Where:** every scorecard cell (invader backers · trophy hunters) and ◆ where they differ by 20 points or more;
*Uses* per side.

**Reads:** a card can be fine for one ending and poor for the other: dead for trophy hunters but wanted by invader
backers, or one use per ending (the standing use for backers, the tokens use for trophy hunters). That may be
intended. If it isn't, it points at a reading for the side it fails.

## When in the round is it played?

**Where:** scorecard, **Timing**: its most common third of the seat's round (early, mid, late), ● when consistent (at
least half its plays there, and 1.5× the usual share); *Detail* gives first, middle and last in full, and its plays
by round.

**Points at:** nothing alone. It becomes a finding against the card's intended job (an opener, a closer, an answer).
Passing is off, so every dealt card is played each round: played over another means played earlier, never skipped.

## Is it automatic?

**Where:** scorecard, **Swing**: how much its place in the hand's ranking moves turn to turn (under 0.2: it's in
the same place almost every turn, so holding it is no decision).

**Watch:** among suit cards it's noise (they all sit near 0.39; agreement 0.43 for trophy hunters); it mostly
separates the unsuited cards. Read it with Timing: always best and always first is automatic.

## What does it do to the board?

**Where:** card report, *Detail*: how often its action changed the board, monsters moved or removed per change, and
plays that did nothing. The game report's *Cards* tables give the same per player count, with the biggest swing a
card could make when held.

## Which cards go together?

**Where:** card report, *Pairs*: cards a seat plays back to back more often than chance would have (the lift; 8 or
more chances), and the draft rate in *Detail* (picked when offered, against chance).

## Can I trust this number?

**Where:** `report=agreement` (on by default): each stat ranks the cards on even games and on odd games; 1 means
the same order. Under about 0.7, read with care. First card run (120 games): Can act 0.96–0.98, Readings 0.93–0.96,
Timing 0.89–0.93, Strength 0.82–0.89, Wants to 0.73–0.90, Swing 0.86 (backers) and 0.43 (trophy hunters).

Rules of thumb: the engine-counted stats (Can act, the uses' open rates) are facts; the bot-judged ones (Wants to,
Strength, Probe) are as good as the bots; a difference of a few points in the middle of a column is noise; the
outliers are the findings.

## Did a change help?

Run the change the way the baseline was run, changing only the thing tested (a variant with `o.<name>=`, or the
edited card or rule in the working tree), and read it against the baseline, which happens automatically:

```sh
node scripts/measure.js games=40 players=3,4,5 o.threshold=22
```

The game report shows baseline and run side by side for each player count (every designer preference with ✓/✗),
and *Cards against the baseline* marks each card stat that moved beyond chance. Change one or two cards at a time:
Strength and Wants to compare a card with the rest of the hand, so one change moves other cards' numbers too. For a
quick look at one changed card, one player count with every core (`games=40 players=4`, about 6 minutes) is enough
for Can act and Wants to; confirm with all three counts. Once a change is accepted, rebuild the baseline. Two runs
of your own side by side: `logs=a=DIR logs=b=DIR`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `games=` | 40 | games at each player count |
| `players=` | 3,4,5 | player counts, each with the live game's spread of leans |
| `seed=` | 7101 | the run's seed (the same seed plays the same deals) |
| `workers=` | every core | cores in all, shared between the counts by their seats |
| `o.<variant>=` | spec default | a rule variant, e.g. `o.threshold=22` (the header says so) |
| `probe=` | off | the controlled card test on that share of turns (see the probe); `probeSample=4`, `probePlayouts=4` |
| `out=` | `.tuning/measure-<time>/` | the run's folder: one log per player count and `run.json` (its configuration) |
| `logs=` | – | report on a run's folder (or log files); `logs=label=DIR` names it; repeat to compare |
| `report=` | game,cards,agreement | which reports, in order |
| `card=` | – | one card in detail |
| `bar=` | spec default | the presence bar the game report reads |
| `cards=0` `swing=0` `ties=0` | all on | turn a log off for a faster run: the card study, the big-play diagnosis, the tie checks (their rows come out blank) |
| `think=` | – | extra bot settings for every seat, e.g. `think=playouts=12` (see below) |
| `profiles=` | – | the seats outright (one count), instead of `players=` |

**Stronger bots (`think=`)** only answer one question: does a finding hold up when the bots play better? They are
not the live game's bots, so a run with `think=` is a deep run and compares only with another deep run of the same
settings. The settings: `playouts=` (6: play-outs per shortlisted move), `keep=` (8–12 by lean: moves on the
shortlist), `planBudget=` (450: play-outs spent planning the hand), `planDepth=` (2: cards ahead it plans). Cost at 4
players (2026-11-08): `playouts=12` about 1.1×, `planBudget=900` about 1.65×.

## Adding a measure

Add it to the tool, never as a new script: `game.js` (a row in `MEASURES`), `cards.js` (`analyse` gathers it,
`cardReport` prints it) or `bots.js`, and to the README under the question it answers. If it needs data the logs don't have, add
it to the runner's log (`rust/src/tournament.rs`, and the `tournament` command in `rust/src/bin/motw.rs`) behind an
option, then check the runner still plays the same games with it on: the fingerprints pass, and a short run with
and without it gives identical plays. Run `report=agreement` on the baseline before leaning on a new card stat.
