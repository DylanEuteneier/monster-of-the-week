// @ts-nocheck
/**
 * The design document's links (designer, 2026-11-08: clear links between the nodes, so a decision made or changed
 * leads back to everything it touches). Run by `npm run check`; fails on a broken link, a one-way link or a suspect
 * link.
 *
 *   node scripts/doc-check.js                 check (exit 1 on any problem)
 *   node scripts/doc-check.js report          every problem, grouped, without failing
 *   node scripts/doc-check.js confirm D22     after reviewing every node D22 links to: record them as up to date
 *   node scripts/doc-check.js confirm all     the same for every decision (first adoption only)
 *
 * Nodes are the document's numbered headings: decision areas and sections (3.13, 1.4, F.9, H.0), decision records
 * (D22), and the appendices (H). A decision record's **Affects:** line links it to nodes: any section number in it,
 * and any card or variant id from spec.json in backticks. Each link needs its back-link: the linked section names the
 * decision (D22) somewhere in its text. Card and variant ids must exist in spec.json, decision ids and slot codes
 * must exist in the document.
 *
 * Suspect links (after Doorstop): docs/links.json keeps a fingerprint of each decision's text as it was when its
 * links were last confirmed. Edit a decision and its links turn suspect: the check lists the nodes to review, and
 * `confirm D22` clears them once they agree with it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs/motw-design.md');
const LINKS = join(ROOT, 'docs/links.json');
const spec = JSON.parse(readFileSync(join(ROOT, 'public/spec.json'), 'utf8'));
const cardIds = new Set([...(spec.cards ?? []), ...(spec.testCards ?? [])].map((c) => c.id));
const variantIds = new Set(Object.keys(spec.variants ?? {}).length ? Object.keys(spec.variants) : (spec.variants ?? []).map?.((v) => v.id) ?? []);
const lines = readFileSync(DOC, 'utf8').split('\n');

/** The nodes: every heading with an id, its text running to the next heading at its level or above. */
const nodes = new Map();
const heads = [];
lines.forEach((l, i) => {
  const m = l.match(/^(#{2,4}) (.*)$/);
  if (!m) return;
  const t = m[2];
  const id = (t.match(/^D(\d+)\./) && `D${t.match(/^D(\d+)\./)[1]}`) || (t.match(/^([A-J]\.\d+|\d+\.\d+)\b/) ?? [])[1] || (t.match(/^Appendix ([A-J])\b/) ?? [])[1] || null;
  heads.push({ level: m[1].length, id, line: i });
});
heads.forEach((h, k) => {
  if (!h.id) return;
  const end = heads.slice(k + 1).find((x) => x.level <= h.level)?.line ?? lines.length;
  if (nodes.has(h.id)) nodes.get(h.id).dupe = true;
  else nodes.set(h.id, { id: h.id, line: h.line + 1, text: lines.slice(h.line, end).join('\n') });
});
const decisions = [...nodes.values()].filter((n) => /^D\d+$/.test(n.id));
// Slot codes: every backticked code in Appendix D's tables.
const codes = new Set((nodes.get('D')?.text ?? lines.slice(lines.findIndex((l) => l.startsWith('## Appendix D')), lines.findIndex((l) => l.startsWith('## Appendix E'))).join('\n')).match(/`[A-Z]{2}\d+`/g)?.map((c) => c.slice(1, -1)) ?? []);

const problems = [];
const add = (kind, where, what) => problems.push({ kind, where, what });

// Decisions linked: every Dn mentioned exists; every decision appears once.
for (const n of nodes.values()) if (n.dupe) add('duplicate node', n.id, `two headings share the id ${n.id}`);
lines.forEach((l, i) => {
  for (const m of l.matchAll(/\bD(\d{1,3})\b/g)) if (!nodes.has(`D${m[1]}`)) add('broken link', `line ${i + 1}`, `D${m[1]} is not a decision record`);
});
// Slot codes mentioned (backticked) exist in Appendix D.
lines.forEach((l, i) => {
  for (const m of l.matchAll(/`([A-Z]{2}\d+)`/g)) if (!codes.has(m[1])) add('broken link', `line ${i + 1}`, `${m[1]} is not in Appendix D`);
});

/** A decision's links: the nodes its Affects line names. */
function linksOf(d) {
  const aff = d.text.split('\n').find((l) => /^- \*\*Affects/.test(l)) ?? '';
  const ids = new Set();
  for (const m of aff.matchAll(/\b([A-J]\.\d+|\d+\.\d+)\b/g)) ids.add(m[1]);
  for (const m of aff.matchAll(/\bAppendix ([A-J])\b/g)) ids.add(m[1]);
  for (const m of aff.matchAll(/`([^`]+)`/g)) {
    if (cardIds.has(m[1])) ids.add(`card:${m[1]}`);
    else if (variantIds.has(m[1])) ids.add(`variant:${m[1]}`);
  }
  return { aff, ids: [...ids] };
}
const fingerprint = (s) => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
const decisionText = (d) => d.text.split('\n').filter((l) => !/^- \*\*(Affects|Date)/.test(l)).join('\n');

for (const d of decisions) {
  const { aff, ids } = linksOf(d);
  if (!aff) { add('no links', d.id, 'no Affects line'); continue; }
  if (!ids.length) add('no links', d.id, `its Affects line names no node: "${aff.slice(14, 90)}"`);
  for (const id of ids) {
    if (id.startsWith('variant:') || id.startsWith('card:')) continue; // checked against spec.json above
    const n = nodes.get(id);
    if (!n) add('broken link', d.id, `${id} is not a section`);
    else if (!new RegExp(`\\b${d.id}\\b`).test(n.text)) add('one-way link', d.id, `${id} doesn't name ${d.id}`);
  }
}

// Suspect links: a decision whose text changed since its links were confirmed.
const store = existsSync(LINKS) ? JSON.parse(readFileSync(LINKS, 'utf8')) : {};
const [mode, which] = process.argv.slice(2);
if (mode === 'confirm') {
  const targets = which === 'all' ? decisions : decisions.filter((d) => d.id === which);
  if (!targets.length) { console.error(`no decision ${which}`); process.exit(1); }
  for (const d of targets) store[d.id] = { text: fingerprint(decisionText(d)), links: linksOf(d).ids };
  writeFileSync(LINKS, JSON.stringify(Object.fromEntries(Object.keys(store).sort((a, b) => a.slice(1) - b.slice(1)).map((k) => [k, store[k]])), null, 1) + '\n');
  console.log(`confirmed ${targets.map((d) => d.id).join(', ')}`);
  process.exit(0);
}
for (const d of decisions) {
  const s = store[d.id];
  if (!s) { add('unconfirmed', d.id, 'never confirmed: review its links, then confirm'); continue; }
  if (s.text !== fingerprint(decisionText(d))) add('suspect', d.id, `changed since confirmed: review ${linksOf(d).ids.join(', ') || 'its links'}, then confirm ${d.id}`);
}

const kinds = [...new Set(problems.map((p) => p.kind))];
console.log(`Design document links: ${decisions.length} decisions, ${nodes.size} nodes, ${codes.size} slot codes · ${problems.length ? `${problems.length} problems` : 'all good'}`);
for (const k of kinds) {
  const ps = problems.filter((p) => p.kind === k);
  console.log(`\n${k} (${ps.length})`);
  for (const p of ps) console.log(`  ${p.where.padEnd(9)} ${p.what}`);
}
if (problems.length && mode !== 'report') process.exit(1);
