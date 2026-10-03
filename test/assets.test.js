// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spec } from '../public/engine.js';
import art from '../public/assets/sprites.json' with { type: 'json' };

/** @typedef {{ width: number, height: number, src: string, rows: string[] }} Sprite */
const sprites = /** @type {Record<string, Sprite>} */ (art.sprites);
const tokens = /** @type {Record<string, Sprite>} */ (art.tokens);
const cubes = /** @type {Record<string, Sprite>} */ (art.cubes);
const groups = /** @type {const} */ ([['sprites', sprites], ['tokens', tokens], ['cubes', cubes]]);
const contentIds = new Set([...spec.archetypes, ...spec.factions, ...spec.locations, ...spec.slayerGroups].map((entry) => entry.id));

test('every sprite and token is named after content in spec.json; cubes after seats', () => {
  for (const id of [...Object.keys(sprites), ...Object.keys(tokens)]) assert.ok(contentIds.has(id), `${id} matches no content id`);
  for (const id of Object.keys(cubes)) assert.match(id, /^seat-\d+$/);
  assert.ok(Object.keys(cubes).length >= spec.meta.players.max, 'one influence cube per possible seat');
});

test('every sprite file the manifest points to is published under public/', () => {
  for (const [folder, group] of groups) {
    for (const [id, sprite] of Object.entries(group)) {
      assert.equal(sprite.src, `/assets/${folder}/${id}.png`);
      assert.ok(existsSync(new URL(`../public${sprite.src}`, import.meta.url)), `${sprite.src} is missing; run npm run assets`);
    }
  }
});

test('sprite rows match their size and only use palette keys', () => {
  const palette = new Set(Object.keys(art.palette));
  assert.ok(palette.size <= 17, 'at most 16 colours plus transparent');
  for (const [id, sprite] of groups.flatMap(([, group]) => Object.entries(group))) {
    assert.equal(sprite.rows.length, sprite.height, id);
    for (const row of sprite.rows) {
      assert.equal(row.length, sprite.width, id);
      for (const ch of row) assert.ok(palette.has(ch), `${id} uses ${ch}, which is not in the palette`);
    }
  }
});
