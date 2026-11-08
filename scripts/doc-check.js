// @ts-nocheck
/**
 * The design document's links (designer, 2026-11-08: links between the nodes, so a decision made or changed leads
 * back to everything it touches; a lint step that makes us check each linked node and recompute the fingerprint once
 * satisfied). Built to the semantics of Doorstop's suspect links (review and clear), lightweight, on the one document.
 * Run by `npm run check`; its own tests are test/doc-check.test.js.
 *
 *   node scripts/doc-check.js                check: exit 1 on any problem
 *   node scripts/doc-check.js report         every problem, grouped, without failing
 *   node scripts/doc-check.js confirm D22    after checking D22 against every node it links to: fingerprint both ends
 *   node scripts/doc-check.js confirm all    the same for every decision (first adoption only)
 *
 * Nodes are the document's headings with an id: sections and decision areas (3.13, 1.4, F.9, H.0), decision records
 * (D22), appendices (H). A decision record's **Affects:** line links it to nodes: every section number and appendix
 * letter in it, and every spec.json card or variant id in backticks. The rules:
 *   - broken link: a decision id, slot code (backticked), section, card or variant that doesn't exist;
 *   - one-way link: a linked section doesn't name the decision back;
 *   - no links: a decision record with no Affects line, or one naming no node;
 *   - superseded: a record with `- **Status:** superseded by Dn` takes no links, and only decision records and the
 *     changelog (A.2) may name it;
 *   - suspect: the decision's text or a linked node's text changed since the link was confirmed (docs/links.json).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fingerprint = (s) => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);

/** The document's nodes: each heading with an id, its text running to the next heading at its level or above. */
export function parseNodes(doc) {
  const lines = doc.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{2,4}) (.*)$/);
    if (!m) return;
    const t = m[2];
    const d = t.match(/^D(\d+)\./);
    const id = (d && `D${d[1]}`) || (t.match(/^([A-J]\.\d+|\d+\.\d+)(?=[\s:.]|$)/) ?? [])[1] || (t.match(/^Appendix ([A-J])\b/) ?? [])[1] || null;
    heads.push({ level: m[1].length, id, line: i });
  });
  const nodes = new Map();
  const dupes = [];
  heads.forEach((h, k) => {
    if (!h.id) return;
    const end = heads.slice(k + 1).find((x) => x.level <= h.level)?.line ?? lines.length;
    if (nodes.has(h.id)) dupes.push(h.id);
    else nodes.set(h.id, { id: h.id, line: h.line + 1, start: h.line, end, text: lines.slice(h.line, end).join('\n') });
  });
  return { lines, nodes, dupes };
}

const field = (text, name) => text.split('\n').find((l) => l.startsWith(`- **${name}:**`)) ?? null;

/** A decision record's own text (what its links depend on): everything but its Affects, Status and Date lines. */
export const decisionText = (n) => n.text.split('\n').filter((l) => !/^- \*\*(Affects|Status|Date):/.test(l)).join('\n');

/** A decision's links: the node ids its Affects line names (sections, appendices, card:id, variant:id). */
export function linksOf(n, ids) {
  const aff = field(n.text, 'Affects');
  if (!aff) return { aff: null, links: [] };
  const body = aff.slice('- **Affects:**'.length);
  const links = new Set();
  for (const m of body.matchAll(/(?<![\w.])([A-J]\.\d+|\d+\.\d+)(?![\w.]*\d)/g)) links.add(m[1]);
  for (const m of body.matchAll(/\bAppendix ([A-J])\b/g)) links.add(m[1]);
  for (const m of body.matchAll(/`([^`]+)`/g)) {
    if (ids.cards.has(m[1])) links.add(`card:${m[1]}`);
    else if (ids.variants.has(m[1])) links.add(`variant:${m[1]}`);
  }
  return { aff, links: [...links] };
}

/** Every problem in the document, given spec.json and the confirmed fingerprints. */
export function checkDoc({ doc, spec, store = {} }) {
  const { lines, nodes, dupes } = parseNodes(doc);
  const ids = { cards: new Set((spec.cards ?? []).map((c) => c.id)), variants: new Set((spec.variants ?? []).map((v) => v.id)) };
  const decisions = [...nodes.values()].filter((n) => /^D\d+$/.test(n.id));
  const supersededBy = new Map(decisions.map((d) => [d.id, (field(d.text, 'Status')?.match(/superseded by (D\d+)/) ?? [])[1]]).filter(([, s]) => s));
  const startD = lines.findIndex((l) => l.startsWith('## Appendix D')), endD = lines.findIndex((l, i) => i > startD && l.startsWith('## Appendix'));
  const codes = new Set(startD < 0 ? [] : lines.slice(startD, endD < 0 ? undefined : endD).join('\n').match(/`[A-Z]{2}\d+`/g)?.map((c) => c.slice(1, -1)) ?? []);
  const problems = [];
  const add = (kind, where, what) => problems.push({ kind, where, what });
  const inRecordOrChangelog = (i) => [...nodes.values()].some((n) => (/^D\d+$/.test(n.id) || n.id === 'A.2') && i >= n.start && i < n.end);

  for (const id of dupes) add('duplicate node', id, `two headings share the id ${id}`);
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\bD(\d{1,3})\b/g)) {
      const id = `D${m[1]}`;
      if (!nodes.has(id)) add('broken link', `line ${i + 1}`, `${id} is not a decision record`);
      else if (supersededBy.has(id) && !inRecordOrChangelog(i)) add('superseded', `line ${i + 1}`, `${id} is superseded by ${supersededBy.get(id)}: name that instead`);
    }
    if (startD >= 0 && codes.size) for (const m of l.matchAll(/`([A-Z]{2}\d+)`/g)) if (!codes.has(m[1])) add('broken link', `line ${i + 1}`, `${m[1]} is not in Appendix D`);
  });

  for (const d of decisions) {
    if (supersededBy.has(d.id)) {
      const by = supersededBy.get(d.id);
      if (!nodes.has(by) || supersededBy.has(by)) add('broken link', d.id, `superseded by ${by}, which is not a current decision`);
      continue;
    }
    const { aff, links } = linksOf(d, ids);
    if (!aff) { add('no links', d.id, 'no Affects line'); continue; }
    if (!links.length) add('no links', d.id, `its Affects line names no node: "${aff.slice(14, 90)}"`);
    for (const m of aff.matchAll(/`([a-z][\w-]*)`/g)) if (!ids.cards.has(m[1]) && !ids.variants.has(m[1]) && /[A-Z]/.test(m[1])) add('broken link', d.id, `\`${m[1]}\` is not a spec.json variant`);
    for (const id of links) {
      if (id.includes(':')) continue;
      const n = nodes.get(id);
      if (!n) add('broken link', d.id, `${id} is not a section`);
      else if (!new RegExp(`\\b${d.id}\\b`).test(n.text)) add('one-way link', d.id, `${id} doesn't name ${d.id}`);
    }
    // Suspect: either end changed since the link was confirmed.
    const s = store[d.id];
    if (!s) { add('unconfirmed', d.id, `never confirmed: check it against ${links.join(', ') || 'its links'}, then confirm ${d.id}`); continue; }
    if (s.text !== fingerprint(decisionText(d))) add('suspect', d.id, `the decision changed: check ${links.join(', ')} still agree, then confirm ${d.id}`);
    for (const id of links) {
      if (id.includes(':')) continue;
      const n = nodes.get(id);
      if (n && s.links?.[id] && s.links[id] !== fingerprint(n.text)) add('suspect', d.id, `${id} changed: check it still agrees with ${d.id}, then confirm ${d.id}`);
      else if (n && !s.links?.[id]) add('suspect', d.id, `new link to ${id}: check it, then confirm ${d.id}`);
    }
  }
  return { problems, decisions, nodes, codes, ids };
}

/** The fingerprints to store for a decision: its own text and each linked section's text. */
export function confirmed(d, nodes, ids) {
  const links = {};
  for (const id of linksOf(d, ids).links) if (!id.includes(':') && nodes.has(id)) links[id] = fingerprint(nodes.get(id).text);
  return { text: fingerprint(decisionText(d)), links };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const LINKS = join(ROOT, 'docs/links.json');
  const doc = readFileSync(join(ROOT, 'docs/motw-design.md'), 'utf8');
  const spec = JSON.parse(readFileSync(join(ROOT, 'public/spec.json'), 'utf8'));
  const store = existsSync(LINKS) ? JSON.parse(readFileSync(LINKS, 'utf8')) : {};
  const [mode, which] = process.argv.slice(2);
  const { problems, decisions, nodes, codes, ids } = checkDoc({ doc, spec, store });
  if (mode === 'confirm') {
    const targets = decisions.filter((d) => which === 'all' || d.id === which);
    if (!targets.length) { console.error(`no decision ${which}`); process.exit(1); }
    for (const d of targets) store[d.id] = confirmed(d, nodes, ids);
    const sorted = Object.fromEntries(Object.keys(store).filter((k) => nodes.has(k)).sort((a, b) => a.slice(1) - b.slice(1)).map((k) => [k, store[k]]));
    writeFileSync(LINKS, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`confirmed ${targets.map((d) => d.id).join(', ')}`);
    process.exit(0);
  }
  console.log(`Design document links: ${decisions.length} decisions, ${nodes.size} nodes, ${codes.size} slot codes · ${problems.length ? `${problems.length} problems` : 'all good'}`);
  for (const k of [...new Set(problems.map((p) => p.kind))]) {
    const ps = problems.filter((p) => p.kind === k);
    console.log(`\n${k} (${ps.length})`);
    for (const p of ps) console.log(`  ${p.where.padEnd(9)} ${p.what}`);
  }
  if (problems.length && mode !== 'report') process.exit(1);
}
