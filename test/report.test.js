import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPrices } from '../src/pricing.js';
import { probeAll } from '../src/probe.js';
import { buildReport, costRows, tokensFor, TYPICAL } from '../src/report.js';
import { makeContext, scan } from '../src/scan.js';
import { fixtureEnv, fixtureRepo } from './helpers.js';

async function sampleReport(opts = {}, { probe = true, mutate } = {}) {
  const repo = fixtureRepo();
  try {
    mutate?.(repo.dir);
    const ctx = makeContext({ dir: repo.dir, env: fixtureEnv() });
    const found = scan(ctx);
    if (probe) await probeAll(found.items, { cwd: repo.dir, env: fixtureEnv(), timeoutMs: 10000 });
    const prices = await loadPrices({ offline: true });
    return buildReport({ ctx, scan: found, prices, version: 'test', probed: probe, ...opts });
  } finally {
    repo.cleanup();
  }
}

test('the typical request is the Agent Burn Index median', () => {
  assert.equal(TYPICAL.inputTokens, 99554);
  assert.match(TYPICAL.url, /standardcompute\.com\/agent-burn-index/);
});

test('report: Claude Code defers MCP tools, other agents pay for full schemas', async () => {
  const r = await sampleReport();
  const tracker = r.items.find((i) => i.label === 'tracker');
  assert.equal(tokensFor(tracker, 'cursor', false), tracker.tokens);
  assert.equal(tokensFor(tracker, 'claude-code', false), tracker.deferredTokens);
  assert.equal(tokensFor(tracker, 'claude-code', true), tracker.tokens);
  const cursor = r.agents.find((a) => a.id === 'cursor');
  assert.ok(cursor.tokens > tracker.tokens);
  assert.equal(r.headline.id, r.agents[0].id);
  assert.ok(r.agents.every((a, i) => i === 0 || r.agents[i - 1].tokens >= a.tokens));
  assert.equal(r.agents.find((a) => a.id === 'claude-code').unmeasured, 2); // docs-search (http) + browser (sse)
  assert.ok(Math.abs(r.headline.share - r.headline.tokens / 99554) < 1e-12);
});

test('report: tips name the biggest offenders with numbers', async () => {
  const r = await sampleReport();
  assert.match(r.tips[0], /^The tracker MCP server adds \d\.\dK tokens to every OpenCode and Cursor request \(18 tools\)/);
  assert.match(r.tips[0], /remove it from \.cursor\/mcp\.json and opencode\.json\. Claude Code already loads it on demand/);
  assert.ok(r.tips.some((t) => /docs\/architecture\.md is @-imported by CLAUDE\.md/.test(t)));
  assert.ok(r.tips.some((t) => /(CLAUDE|AGENTS)\.md and (CLAUDE|AGENTS)\.md repeat about \d+ tokens/.test(t)));
  for (const t of r.tips) assert.doesNotMatch(t, /—/);
});

test('report: without probing, the tip says how to measure MCP servers', async () => {
  const r = await sampleReport({}, { probe: false });
  assert.ok(r.tips.some((t) => /--probe-mcp/.test(t)));
});

test('report: badge counts repo files only; --repo-only drops user config everywhere', async () => {
  const all = await sampleReport();
  const repoOnly = await sampleReport({ repoOnly: true });
  assert.equal(all.badge.tokens, repoOnly.badge.tokens);
  assert.ok(repoOnly.items.every((i) => i.scope === 'repo'));
  assert.ok(all.items.some((i) => i.scope === 'user'));
});

test('report: --agent keeps one agent', async () => {
  const r = await sampleReport({ agent: 'codex' });
  assert.deepEqual(r.agents.map((a) => a.id), ['codex']);
  assert.ok(r.items.every((i) => i.agents.has('codex')));
});

test('costRows: cache-read and fresh input prices per 1,000 requests', () => {
  const table = { 'm-1': { input_cost_per_token: 2e-6, cache_read_input_token_cost: 2e-7 }, 'm-2': { input_cost_per_token: 1e-6 } };
  const rows = costRows(10000, table, ['m-1', 'm-2', 'unknown']);
  assert.equal(rows.length, 2);
  assert.ok(Math.abs(rows[0].cacheReadPer1k - 2) < 1e-9);
  assert.ok(Math.abs(rows[0].freshInputPer1k - 20) < 1e-9);
  assert.ok(Math.abs(rows[1].cacheReadPer1k - 10) < 1e-9); // no cache price: input price
});
