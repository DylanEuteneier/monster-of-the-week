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
 *   node scripts/doc-check.js fix            write each linked node's back-link line ("*Decisions: D8, D27.*")
 *
 * Nodes are the document's headings with an id: sections and decision areas (3.13, 1.4, F.9, H.0), decision records
 * (D22), appendices (H). A decision record's **Affects:** line links it to nodes: every section number and appendix
 * letter in it, and every spec.json card or variant id in backticks. The rules:
 *   - broken link: a decision id, slot code (backticked), section, card or variant that doesn't exist;
 *   - one-way link: a linked section doesn't name the decision back;
 *   - no links: a decision record with no Affects line, or one naming no node;
 *   - superseded: a record with `- **Status:** superseded by Dn` takes no links, and only decision records and the
 *     changelog (A.2) may name it;
 *   - suspect: the decision's text or a linked node's text changed since the link was confirmed (docs/links.json);
 *   - rulebook: a rule in Appendix G tagged "(D42 · trial)" whose level isn't one of the levels from Trial up (1.1),
 *     or doesn't match its decision's Status; a superseded decision can't be in the rulebook.
 *   - enforcement: a decision at Trial or above names, on its **Enforced by:** line, the Rust tests that fail if the
 *     engine stops playing it (`test_fn_name`), and the spec defaults it sets (`threshold=20`). Each test named must
 *     exist and name the decision in its body; a test naming a decision must be listed on that decision's line; no
 *     test names a superseded decision; each default must match spec.json.
 *   - stale: a document (README.md, CLAUDE.md, docs/, scripts/measure/README.md, assets/README.md) or spec.json names a
 *     file, npm script, section or superseded decision that no longer exists; the changelog (A.2) is history and
 *     exempt. The README's layout names every source file.
 * A node's back-link line sits under its heading and lists every decision linking to it; `fix` writes it, and it is
 * left out of the node's fingerprint, so adding a decision's back-link doesn't make the node's other links suspect.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEVELS = ['trial', 'measured', 'playtested', 'locked'];
const BACKLINK = /^\*Decisions: [^*]*\*$/;
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

/** A node's text for its fingerprint: without its back-link line. */
const nodeText = (n) => n.text.split('\n').filter((l) => !BACKLINK.test(l)).join('\n');

/** A decision record's own text (what its links depend on): everything but its Affects, Status and Date lines. */
export const decisionText = (n) => n.text.split('\n').filter((l) => !/^- \*\*(Affects|Status|Date|Enforced by):/.test(l)).join('\n');

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
export function checkDoc({ doc, spec, store = {}, tests = null }) {
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
      if (n && s.links?.[id] && s.links[id] !== fingerprint(nodeText(n))) add('suspect', d.id, `${id} changed: check it still agrees with ${d.id}, then confirm ${d.id}`);
      else if (n && !s.links?.[id]) add('suspect', d.id, `new link to ${id}: check it, then confirm ${d.id}`);
    }
  }
  // The rulebook: every level tag names live decisions whose Status matches.
  const G = nodes.get('G');
  if (G) G.text.split('\n').forEach((l, k) => {
    for (const m of l.matchAll(/\(([^()]*?) · (\w+)\)/g)) {
      const level = m[2];
      const ds = m[1].match(/\bD\d+\b/g) ?? [];
      const where = `line ${G.line + k}`;
      if (!LEVELS.includes(level)) add('rulebook', where, `"${level}" is not a rulebook level (${LEVELS.join(', ')})`);
      if (!ds.length) add('rulebook', where, `"(${m[1]} · ${level})" names no decision`);
      for (const id of ds) {
        const d = nodes.get(id);
        if (!d) continue;
        if (supersededBy.has(id)) { add('rulebook', where, `${id} is superseded by ${supersededBy.get(id)}`); continue; }
        const st = (field(d.text, 'Status') ?? '').replace('- **Status:**', '').trim();
        if (st !== level) add('rulebook', where, `tagged ${id} · ${level}, but ${id}'s Status is ${st || 'missing'}`);
      }
    }
  });
  // Enforcement: Trial and above name their tests and defaults.
  if (tests) {
    const variants = new Map((spec.variants ?? []).map((v) => [v.id, String(v.default)]));
    const listed = new Map();
    for (const d of decisions) {
      if (supersededBy.has(d.id)) continue;
      const st = (field(d.text, 'Status') ?? '').replace('- **Status:**', '').trim();
      const line = field(d.text, 'Enforced by');
      if (!LEVELS.includes(st)) { if (line) add('enforcement', d.id, `has an Enforced by line but no level from Trial up`); continue; }
      if (!line) { add('enforcement', d.id, `at ${st} with no Enforced by line: name the tests that fail if the engine stops playing it`); continue; }
      const names = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      const fns = names.filter((n) => !n.includes('='));
      if (!fns.length) add('enforcement', d.id, 'its Enforced by line names no test');
      for (const n of names) {
        if (n.includes('=')) {
          const [id, val] = n.split('=');
          if (!variants.has(id)) add('enforcement', d.id, `\`${id}\` is not a spec.json variant`);
          else if (variants.get(id) !== val) add('enforcement', d.id, `${id} defaults to ${variants.get(id)} in spec.json, but ${d.id} sets ${val}`);
          continue;
        }
        if (!tests.has(n)) { add('enforcement', d.id, `no Rust test \`${n}\``); continue; }
        if (!new RegExp(`\\b${d.id}\\b`).test(tests.get(n))) add('enforcement', d.id, `test \`${n}\` doesn't name ${d.id} in its body`);
        listed.set(`${d.id} ${n}`, true);
      }
    }
    for (const [n, body] of tests) for (const m of new Set(body.match(/\bD\d+\b/g) ?? [])) {
      if (supersededBy.has(m)) add('enforcement', `test ${n}`, `names ${m}, superseded by ${supersededBy.get(m)}`);
      else if (!nodes.has(m)) add('enforcement', `test ${n}`, `names ${m}, which is not a decision record`);
      else if (!listed.has(`${m} ${n}`)) add('enforcement', `test ${n}`, `names ${m}, but ${m}'s Enforced by line doesn't list it`);
    }
  }
  return { problems, decisions, nodes, codes, ids };
}

/** Rust tests by name, each with its body: every #[test] function in the given sources. */
export function rustTests(sources) {
  const tests = new Map();
  for (const src of sources) {
    const parts = src.split(/#\[test\]/).slice(1);
    for (const p of parts) { const m = p.match(/fn ([a-z0-9_]+)/); if (m) tests.set(m[1], p); }
  }
  return tests;
}

const GENERATED = new Set(['run.json', 'report.txt', 'links.json']);
/**
 * Stale references: files, npm scripts, sections and superseded decisions named in the documents and spec.json that
 * no longer exist. `docs` maps a path to its text; `files` is every tracked path; the design document's changelog
 * (A.2) is history and skipped.
 */
export function staleRefs({ docs, files, scripts, nodes, superseded, spec }) {
  const problems = [];
  const add = (where, what) => problems.push({ kind: 'stale', where, what });
  const exists = (p) => files.has(p) || [...files].some((f) => f.endsWith('/' + p)) || GENERATED.has(p.split('/').pop()) || p.startsWith('.tuning/');
  for (const [path, text] of Object.entries(docs)) {
    let skip = false;
    text.split('\n').forEach((l, i) => {
      if (path.endsWith('motw-design.md')) {
        if (/^#{2,4} /.test(l)) skip = /^### A\.2 /.test(l);
        if (skip) return;
      }
      const where = `${path}:${i + 1}`;
      for (const m of l.matchAll(/`([\w./-]+\.(?:js|mjs|rs|json|py|md|ts|html|css|toml))`/g)) if (!exists(m[1])) add(where, `${m[1]} doesn't exist`);
      for (const m of l.matchAll(/npm run ([\w:-]+)/g)) if (!scripts.has(m[1])) add(where, `npm run ${m[1]} isn't a script`);
      if (!path.endsWith('motw-design.md')) for (const m of l.matchAll(/\b(D\d+)\b/g)) if (superseded.has(m[1])) add(where, `names ${m[1]}, superseded by ${superseded.get(m[1])}`);
    });
  }
  const texts = [...(spec.variants ?? []).map((v) => [`variant ${v.id}`, `${v.label ?? ''} ${v.description ?? ''} ${(v.choices ?? []).map((c) => c.description ?? '').join(' ')}`]), ...(spec.cards ?? []).map((c) => [`card ${c.id}`, JSON.stringify(c)])];
  for (const [where, s] of texts) {
    for (const m of s.matchAll(/\b(D\d+)\b/g)) if (superseded.has(m[1])) add(`spec.json ${where}`, `names ${m[1]}, superseded by ${superseded.get(m[1])}`); else if (!nodes.has(m[1])) add(`spec.json ${where}`, `names ${m[1]}, which is not a decision record`);
    for (const m of s.matchAll(/(?<![\w.])([A-J]\.\d+)(?![\w.]*\d)/g)) if (!nodes.has(m[1])) add(`spec.json ${where}`, `names ${m[1]}, which is not a section`);
  }
  return problems;
}

/** Source files the README's layout must name (by file name). */
export function layoutGaps(readme, files) {
  const want = [...files].filter((f) => /^(rust\/src\/[^/]+\.rs|rust\/src\/bin\/[^/]+\.rs|public\/[^/]+\.(js|html|css)|scripts\/[^/]+\.(js|mjs)|src\/[^/]+\.ts)$/.test(f));
  return want.filter((f) => !new RegExp(`(^|[\\s/(,])${f.split('/').pop().replace('.', '\\.')}\\b`).test(readme)).map((f) => ({ kind: 'stale', where: 'README.md', what: `the layout doesn't name ${f}` }));
}

/** The document with each linked node's back-link line written: every live decision linking to it, in order. */
export function fixBacklinks({ doc, spec }) {
  const { lines, nodes, decisions, ids } = (() => { const r = checkDoc({ doc, spec }); return { ...r, lines: doc.split('\n') }; })();
  const back = new Map();
  for (const d of decisions) {
    if (/superseded by/.test(field(d.text, 'Status') ?? '')) continue;
    for (const id of linksOf(d, ids).links) if (!id.includes(':') && nodes.has(id)) back.set(id, [...(back.get(id) ?? []), d.id]);
  }
  // Bottom up, so earlier line numbers stay right.
  const targets = [...nodes.values()].filter((n) => !/^D\d+$/.test(n.id)).sort((a, b) => b.start - a.start);
  for (const n of targets) {
    const ds = back.get(n.id);
    const at = n.start + 1;
    const has = lines[at] === '' && BACKLINK.test(lines[at + 1] ?? '');
    if (has) {
      if (ds) lines[at + 1] = `*Decisions: ${ds.join(', ')}.*`;
      else lines.splice(at, 2);
    } else if (ds) lines.splice(at, 0, '', `*Decisions: ${ds.join(', ')}.*`);
  }
  return lines.join('\n');
}

/** The fingerprints to store for a decision: its own text and each linked section's text. */
export function confirmed(d, nodes, ids) {
  const links = {};
  for (const id of linksOf(d, ids).links) if (!id.includes(':') && nodes.has(id)) links[id] = fingerprint(nodeText(nodes.get(id)));
  return { text: fingerprint(decisionText(d)), links };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const LINKS = join(ROOT, 'docs/links.json');
  const doc = readFileSync(join(ROOT, 'docs/motw-design.md'), 'utf8');
  const spec = JSON.parse(readFileSync(join(ROOT, 'public/spec.json'), 'utf8'));
  const store = existsSync(LINKS) ? JSON.parse(readFileSync(LINKS, 'utf8')) : {};
  const [mode, which] = process.argv.slice(2);
  const files = new Set(execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean));
  const rs = [...files].filter((f) => /^rust\/(src|tests)\/.*\.rs$/.test(f) && existsSync(join(ROOT, f)));
  const tests = rustTests(rs.map((f) => readFileSync(join(ROOT, f), 'utf8')));
  const { problems, decisions, nodes, codes, ids } = checkDoc({ doc, spec, store, tests });
  const superseded = new Map(decisions.map((d) => [d.id, (field(d.text, 'Status')?.match(/superseded by (D\d+)/) ?? [])[1]]).filter(([, s]) => s));
  const docPaths = ['README.md', 'CLAUDE.md', 'scripts/measure/README.md', 'assets/README.md', ...[...files].filter((f) => /^docs\/.*\.md$/.test(f))];
  const docs = Object.fromEntries(docPaths.filter((p) => existsSync(join(ROOT, p))).map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]));
  const scripts = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts));
  problems.push(...staleRefs({ docs, files, scripts, nodes, superseded, spec }), ...layoutGaps(docs['README.md'], files));
  if (mode === 'fix') {
    writeFileSync(join(ROOT, 'docs/motw-design.md'), fixBacklinks({ doc, spec }));
    console.log('back-link lines written');
    process.exit(0);
  }
  if (mode === 'confirm') {
    const targets = decisions.filter((d) => which === 'all' || d.id === which);
    if (!targets.length) { console.error(`no decision ${which}`); process.exit(1); }
    for (const d of targets) store[d.id] = confirmed(d, nodes, ids);
    const sorted = Object.fromEntries(Object.keys(store).filter((k) => nodes.has(k)).sort((a, b) => a.slice(1) - b.slice(1)).map((k) => [k, store[k]]));
    writeFileSync(LINKS, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`confirmed ${targets.map((d) => d.id).join(', ')}`);
    process.exit(0);
  }
  console.log(`Design document links and enforcement: ${decisions.length} decisions, ${nodes.size} nodes, ${codes.size} slot codes · ${problems.length ? `${problems.length} problems` : 'all good'}`);
  for (const k of [...new Set(problems.map((p) => p.kind))]) {
    const ps = problems.filter((p) => p.kind === k);
    console.log(`\n${k} (${ps.length})`);
    for (const p of ps) console.log(`  ${p.where.padEnd(9)} ${p.what}`);
  }
  if (problems.length && mode !== 'report') process.exit(1);
}
