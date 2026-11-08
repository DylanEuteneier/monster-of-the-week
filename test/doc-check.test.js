// @ts-nocheck
/** The design document's link check (scripts/doc-check.js), on small made-up documents. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDoc, confirmed, parseNodes, fixBacklinks, rustTests, staleRefs, layoutGaps } from '../scripts/doc-check.js';

const spec = { cards: [{ id: 'bait-trail' }], variants: [{ id: 'fightHalf' }] };
const doc = (area, decision, extra = '') => `# Doc

## 3. Design decisions

#### 3.13 Conflict resolution · *Ideas*

${area}

## Appendix A: Design decisions

### A.1 Decision records

#### D22. Half from a fight

${decision}

### A.2 Changelog

| 2026-10-17 | D22 |
${extra}
## Appendix D: Candidate codes

| \`FR5\` | Half |
`;
const DEC = '- **Decided:** at most half leaves a fight.\n- **Affects:** 3.13, `fightHalf`, `bait-trail`.\n- **Date:** 2026-10-17';
const AREA = 'At most half leaves a fight (D22, `FR5`).';
const kinds = (r) => r.problems.map((p) => p.kind).sort();
const store = (text) => { const r = checkDoc({ doc: text, spec }); const d = r.nodes.get('D22'); return { D22: confirmed(d, r.nodes, r.ids) }; };

test('nodes are headings with ids, each running to the next heading at its level', () => {
  const { nodes } = parseNodes(doc(AREA, DEC));
  assert.deepEqual([...nodes.keys()], ['3.13', 'A', 'A.1', 'D22', 'A.2', 'D']);
  assert.match(nodes.get('3.13').text, /D22/);
  assert.doesNotMatch(nodes.get('D22').text, /Changelog/);
});

test('a linked, back-linked, confirmed decision passes', () => {
  const text = doc(AREA, DEC);
  assert.deepEqual(checkDoc({ doc: text, spec, store: store(text) }).problems, []);
});

test('a one-way link fails: the section must name the decision', () => {
  const text = doc('At most half leaves a fight.', DEC);
  assert.deepEqual(kinds(checkDoc({ doc: text, spec, store: store(text) })), ['one-way link']);
});

test('broken links fail: a missing decision, slot code, section or variant', () => {
  const text = doc(`${AREA} See D99 and \`ZZ9\`.`, DEC.replace('3.13, `fightHalf`', '3.13, 9.9, `roundBar`'));
  const r = checkDoc({ doc: text, spec, store: store(text) });
  assert.deepEqual(r.problems.map((p) => p.what).sort(), ['9.9 is not a section', 'D99 is not a decision record', 'ZZ9 is not in Appendix D', '`roundBar` is not a spec.json variant']);
});

test('editing the decision makes its links suspect until confirmed again', () => {
  const before = doc(AREA, DEC);
  const after = doc(AREA, DEC.replace('at most half', 'at most a third'));
  const s = store(before);
  assert.deepEqual(kinds(checkDoc({ doc: after, spec, store: s })), ['suspect']);
  assert.deepEqual(checkDoc({ doc: after, spec, store: store(after) }).problems, []);
});

test('editing a linked section makes the link suspect too', () => {
  const s = store(doc(AREA, DEC));
  const r = checkDoc({ doc: doc(`${AREA} A group of 1 can't leave.`, DEC), spec, store: s });
  assert.deepEqual(r.problems.map((p) => p.what), ['3.13 changed: check it still agrees with D22, then confirm D22']);
});

test('unconfirmed decisions and records without links are reported', () => {
  assert.deepEqual(kinds(checkDoc({ doc: doc(AREA, DEC), spec })), ['unconfirmed']);
  const text = doc(AREA, '- **Decided:** at most half leaves a fight.\n- **Date:** 2026-10-17');
  assert.deepEqual(kinds(checkDoc({ doc: text, spec })), ['no links']);
});

test('a superseded decision takes no links, and only records and the changelog may name it', () => {
  const text = doc(AREA, `${DEC}\n- **Status:** superseded by D22`, '').replace('#### D22. Half from a fight', '#### D21. Old\n\n- **Status:** superseded by D22\n\n#### D22. Half from a fight') + 'Elsewhere D21.\n';
  const r = checkDoc({ doc: text.replace(`${DEC}\n- **Status:** superseded by D22`, DEC), spec, store: store(text.replace(`${DEC}\n- **Status:** superseded by D22`, DEC)) });
  assert.deepEqual(r.problems.map((p) => p.what), ['D21 is superseded by D22: name that instead']);
});

test('fix writes the back-link line, which mends a one-way link without making the node suspect', () => {
  const before = doc('At most half leaves a fight.', DEC);
  const s = store(before);
  const after = fixBacklinks({ doc: before, spec });
  assert.match(after, /#### 3\.13 Conflict resolution · \*Ideas\*\n\n\*Decisions: D22\.\*\n/);
  assert.deepEqual(checkDoc({ doc: after, spec, store: s }).problems, []);
  assert.equal(fixBacklinks({ doc: after, spec }), after);
});

test('the rulebook: a level tag must match its decision\'s Status', () => {
  const G = (tag) => `\n## Appendix G: The rulebook\n\n- Half leaves a fight (${tag}).\n`;
  const dec = `${DEC}\n- **Status:** trial`;
  const ok = doc(AREA, dec) + G('D22 · trial');
  assert.deepEqual(checkDoc({ doc: ok, spec, store: store(ok) }).problems, []);
  const wrong = doc(AREA, dec) + G('FR5, D22 · measured');
  assert.deepEqual(checkDoc({ doc: wrong, spec, store: store(wrong) }).problems.map((p) => p.what), ["tagged D22 · measured, but D22's Status is trial"]);
  const draft = doc(AREA, dec) + G('D22 · draft');
  assert.deepEqual(kinds(checkDoc({ doc: draft, spec, store: store(draft) })), ['rulebook', 'rulebook']);
});

test('enforcement: a Trial decision names tests that exist and name it, and spec defaults that match', () => {
  const sp = { ...spec, variants: [{ id: 'fightHalf', default: 'on' }] };
  const dec = (line) => `${DEC}\n${line}\n- **Status:** trial`;
  const tests = rustTests(['#[test]\nfn half_moves() {\n    // D22\n}\n#[test]\nfn other() {\n    // D21\n}\n']);
  const run = (line) => { const text = doc(AREA, dec(line)); return checkDoc({ doc: text, spec: sp, store: store(text), tests }).problems.map((p) => p.what); };
  assert.deepEqual(run('- **Enforced by:** `half_moves`, `fightHalf=on`.'), ['names D21, which is not a decision record']);
  assert.ok(run('- **Enforced by:** `half_moves`, `fightHalf=off`.').includes('fightHalf defaults to on in spec.json, but D22 sets off'));
  assert.ok(run('- **Enforced by:** `missing_test`.').includes('no Rust test `missing_test`'));
  assert.ok(run('- **Enforced by:** `other`.').some((w) => /doesn't name D22/.test(w)));
  const none = doc(AREA, `${DEC}\n- **Status:** trial`);
  assert.ok(checkDoc({ doc: none, spec: sp, store: store(none), tests }).problems.some((p) => /no Enforced by line/.test(p.what)));
});

test('stale references: files, npm scripts and superseded decisions named in documents and spec.json', () => {
  const files = new Set(['scripts/measure.js', 'README.md']);
  const nodes = new Map([['D22', {}], ['G.5', {}]]);
  const ps = staleRefs({
    docs: { 'README.md': 'Run `scripts/measure.js` and `scripts/gone.js`; npm run check; npm run old. D7 is old.', 'docs/motw-design.md': '### A.1 x\n`scripts/gone.js`\n### A.2 Changelog\n| `scripts/gone.js` |\n' },
    files, scripts: new Set(['check']), nodes, superseded: new Map([['D7', 'D48']]),
    spec: { variants: [{ id: 'a', description: 'From G.7 and D22.' }], cards: [] },
  }).map((p) => `${p.where} ${p.what}`);
  assert.deepEqual(ps, ['README.md:1 scripts/gone.js doesn\'t exist', 'README.md:1 npm run old isn\'t a script', 'README.md:1 names D7, superseded by D48', 'docs/motw-design.md:2 scripts/gone.js doesn\'t exist', 'spec.json variant a names G.7, which is not a section']);
  assert.deepEqual(layoutGaps('scripts/\n  measure.js  the tool', new Set(['scripts/measure.js', 'scripts/new.js'])).map((p) => p.what), ['the layout doesn\'t name scripts/new.js']);
});
