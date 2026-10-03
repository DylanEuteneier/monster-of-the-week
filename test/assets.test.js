// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spec } from '../public/engine.js';
import art from '../public/assets/sprites.json' with { type: 'json' };

/** @typedef {{ width: number, height: number, src: string, rows: string[] }} Sprite */
const sprites = /** @type {Record<string, Sprite>} */ (art.sprites);
/** @typedef {{ pad: number, width: number, height: number, src: string, art: string }} Token */
const tokens = /** @type {Record<string, Token>} */ (art.tokens);
const contentIds = new Set([...spec.archetypes, ...spec.factions, ...spec.locations, ...spec.slayerGroups].map((entry) => entry.id));

test('every sprite and token is named after content in spec.json', () => {
  for (const id of [...Object.keys(sprites), ...Object.keys(tokens)]) assert.ok(contentIds.has(id), `${id} matches no content id`);
});

test('every token has its die-cut outline and art published, sized to fit the art', () => {
  for (const [id, token] of Object.entries(tokens)) {
    assert.equal(token.src, `/assets/tokens/${id}.svg`);
    assert.equal(token.art, sprites[id]?.src, `${id} token art is not a published sprite`);
    assert.ok(existsSync(new URL(`../public${token.src}`, import.meta.url)), `${token.src} is missing; run npm run assets`);
    assert.equal(token.width, sprites[id].width + 2 * token.pad);
  }
});

test('every sprite file the manifest points to is published under public/', () => {
  for (const [id, sprite] of Object.entries(sprites)) {
    assert.equal(sprite.src, `/assets/sprites/${id}.png`);
    assert.ok(existsSync(new URL(`../public${sprite.src}`, import.meta.url)), `${sprite.src} is missing; run npm run assets`);
  }
});

test('sprite rows match their size and only use palette keys', () => {
  const palette = new Set(Object.keys(art.palette));
  assert.equal(palette.size, 33, 'the 32-colour palette plus transparent');
  for (const [id, sprite] of Object.entries(sprites)) {
    assert.equal(sprite.rows.length, sprite.height, id);
    for (const row of sprite.rows) {
      assert.equal(row.length, sprite.width, id);
      for (const ch of row) assert.ok(palette.has(ch), `${id} uses ${ch}, which is not in the palette`);
    }
  }
});
