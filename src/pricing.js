// Prices come from LiteLLM's public model price list (MIT licensed):
// https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
// Fetched at most once per 24h and cached in ~/.cache/contexttax; --offline uses the
// bundled snapshot in prices-fallback.json. Only the fetch of this file touches the network.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './lib/fs.js';

export const PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const DAY = 24 * 60 * 60 * 1000;
const FALLBACK = join(dirname(fileURLToPath(import.meta.url)), 'prices-fallback.json');

const KEY = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)(_above_\d+k_tokens|_above_1hr)?$/;

/** Keep only chat models and the per-token list-price fields we use. */
export function slimPrices(raw) {
  const out = {};
  for (const [model, v] of Object.entries(raw || {})) {
    if (!v || typeof v !== 'object' || typeof v.input_cost_per_token !== 'number') continue;
    if (v.mode && v.mode !== 'chat' && v.mode !== 'responses' && v.mode !== 'completion') continue;
    const e = {};
    for (const [k, val] of Object.entries(v)) if (KEY.test(k) && typeof val === 'number') e[k] = val;
    out[model] = e;
  }
  return out;
}

export function cacheDir(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(home(env), '.cache'), 'contexttax');
}

/**
 * Load the price table. Returns { table, source, fetchedAt, note? }.
 * Never throws: falls back to a stale cache, then to the bundled snapshot.
 */
export async function loadPrices({ offline = false, env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const cacheFile = join(cacheDir(env), 'prices.json');
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    // no cache yet
  }
  const fallback = () => {
    const f = JSON.parse(readFileSync(FALLBACK, 'utf8'));
    return { table: f.prices, source: 'LiteLLM (bundled)', fetchedAt: f.fetchedAt };
  };
  if (offline) return fallback();
  if (cached?.prices && now - cached.fetchedAt < DAY) {
    return { table: cached.prices, source: 'LiteLLM (cached)', fetchedAt: cached.fetchedAt };
  }
  try {
    if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
    const res = await fetchImpl(PRICES_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = slimPrices(await res.json());
    if (Object.keys(table).length < 50) throw new Error('unexpected price file');
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ fetchedAt: now, url: PRICES_URL, prices: table }));
    } catch {
      // cache is optional
    }
    return { table, source: 'LiteLLM', fetchedAt: now };
  } catch (err) {
    if (cached?.prices) {
      return { table: cached.prices, source: 'LiteLLM (stale cache)', fetchedAt: cached.fetchedAt, note: `price fetch failed (${err.message}); using cached prices` };
    }
    return { ...fallback(), note: `price fetch failed (${err.message}); using bundled snapshot` };
  }
}

// Model ids that are gateway/router aliases rather than a vendor model. Listed as unpriced.
const GATEWAY_IDS = /standardcompute|^auto$|^router$|openrouter\/auto/i;
export const VENDOR_PREFIX = /^(anthropic|openai|google|gemini|vertex_ai|deepseek|xai|x-ai|mistral|mistralai|moonshot|moonshotai|zai|z-ai|qwen|meta-llama|minimax|openrouter)\//i;

const MAKERS = [
  [/^gemini/, 'gemini'],
  [/^glm/, 'zai'],
  [/^kimi/, 'moonshot'],
  [/^deepseek/, 'deepseek'],
  [/^grok/, 'xai'],
  [/^(mistral|codestral|devstral|magistral)/, 'mistral'],
  [/^qwen/, 'dashscope'],
  [/^minimax/, 'minimax'],
];

function candidates(model, provider) {
  const m = String(model).trim();
  const list = [m, m.toLowerCase()];
  let bare = m;
  while (VENDOR_PREFIX.test(bare)) bare = bare.replace(VENDOR_PREFIX, '');
  bare = bare.replace(/^models\//, ''); // gemini "models/gemini-2.5-pro"
  list.push(bare, bare.toLowerCase());
  if (provider) list.push(`${provider}/${bare}`);
  for (const b of [...new Set(list)]) {
    const noDate = b.replace(/[-@](\d{8}|\d{4}-\d{2}-\d{2})$/, '');
    if (noDate !== b) list.push(noDate);
    if (/claude/i.test(b)) list.push(b.replace(/(\d)\.(\d)/g, '$1-$2')); // claude-sonnet-4.5 -> claude-sonnet-4-5
  }
  // the model maker's own list price for ids served through another provider
  const lower = bare.toLowerCase();
  for (const [re, vendor] of MAKERS) if (re.test(lower)) list.push(`${vendor}/${lower}`, `${vendor}/${lower.replace(/[-@](\d{8})$/, '')}`);
  return [...new Set(list)];
}

/** Find list prices for a model id, or null when unknown / a gateway alias. */
export function findPrice(table, model, provider) {
  if (!model || model === 'unknown' || GATEWAY_IDS.test(model)) return null;
  for (const c of candidates(model, provider)) {
    const p = table[c];
    if (p && typeof p.input_cost_per_token === 'number') return { key: c, ...p };
  }
  return null;
}
