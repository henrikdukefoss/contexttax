import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { findPrice, loadPrices, slimPrices } from '../src/pricing.js';

const offlinePrices = () => JSON.parse(readFileSync(new URL('../src/prices-fallback.json', import.meta.url), 'utf8')).prices;

const table = {
  'claude-sonnet-4-5': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 3.75e-6,
    cache_creation_input_token_cost_above_1hr: 6e-6,
  },
  'gemini/gemini-2.5-pro': {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 1.25e-7,
    input_cost_per_token_above_200k_tokens: 2.5e-6,
    output_cost_per_token_above_200k_tokens: 15e-6,
    cache_read_input_token_cost_above_200k_tokens: 2.5e-7,
  },
  'zai/glm-4.6': { input_cost_per_token: 6e-7, output_cost_per_token: 2.2e-6, cache_read_input_token_cost: 1.1e-7, cache_creation_input_token_cost: 0 },
  'gpt-4o': { input_cost_per_token: 2.5e-6, output_cost_per_token: 10e-6 },
};

test('findPrice: exact, vendor prefix, date suffix, dotted claude ids, maker fallback', () => {
  assert.equal(findPrice(table, 'claude-sonnet-4-5').key, 'claude-sonnet-4-5');
  assert.equal(findPrice(table, 'anthropic/claude-sonnet-4.5').key, 'claude-sonnet-4-5');
  assert.equal(findPrice(table, 'claude-sonnet-4-5-20250929').key, 'claude-sonnet-4-5');
  assert.equal(findPrice(table, 'gemini-2.5-pro').key, 'gemini/gemini-2.5-pro');
  assert.equal(findPrice(table, 'z-ai/glm-4.6').key, 'zai/glm-4.6');
  assert.equal(findPrice(table, 'glm-4.6', 'zai').key, 'zai/glm-4.6');
});

test('findPrice: unknown models and gateway ids stay unpriced', () => {
  assert.equal(findPrice(table, 'some-new-model'), null);
  assert.equal(findPrice(table, 'standardcompute'), null);
  assert.equal(findPrice(table, 'anthropic/claude-standardcompute'), null);
  assert.equal(findPrice(table, 'StandardCompute'), null);
  assert.equal(findPrice(table, 'unknown'), null);
});

test('slimPrices keeps chat models and per-token list prices only', () => {
  const slim = slimPrices({
    sample_spec: { input_cost_per_token: 0 },
    'm-chat': { mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 2e-6, input_cost_per_token_batches: 5e-7, max_tokens: 10 },
    'm-embed': { mode: 'embedding', input_cost_per_token: 1e-6 },
    'm-image': { mode: 'image_generation', output_cost_per_image: 0.04 },
  });
  assert.deepEqual(Object.keys(slim).sort(), ['m-chat', 'sample_spec']);
  assert.deepEqual(slim['m-chat'], { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 });
});

test('loadPrices: --offline uses the bundled table without network', async () => {
  const res = await loadPrices({ offline: true, fetchImpl: () => assert.fail('network used') });
  assert.equal(res.source, 'LiteLLM (bundled)');
  assert.ok(Object.keys(res.table).length > 100);
  assert.ok(findPrice(offlinePrices(), 'claude-sonnet-4-5'));
});

test('loadPrices: fetch once, then serve from the 24h cache; failures fall back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'contexttax-cache-'));
  const env = { XDG_CACHE_HOME: dir };
  const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, { mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 }]));
  let calls = 0;
  const fetchImpl = async () => (calls++, { ok: true, json: async () => big });
  try {
    const a = await loadPrices({ env, fetchImpl, now: 1000 });
    assert.equal(a.source, 'LiteLLM');
    const b = await loadPrices({ env, fetchImpl, now: 2000 });
    assert.equal(b.source, 'LiteLLM (cached)');
    assert.equal(calls, 1);
    const failing = async () => {
      throw new Error('offline');
    };
    const c = await loadPrices({ env, fetchImpl: failing, now: 1000 + 2 * 86400000 });
    assert.equal(c.source, 'LiteLLM (stale cache)');
    const d = await loadPrices({ env: { XDG_CACHE_HOME: join(dir, 'empty') }, fetchImpl: failing });
    assert.equal(d.source, 'LiteLLM (bundled)');
    assert.match(d.note, /offline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
