// @ts-nocheck
/** The design document's link check (scripts/doc-check.js), on small made-up documents. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDoc, confirmed, parseNodes } from '../scripts/doc-check.js';

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
