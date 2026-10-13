import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandVars, listTools, probeAll } from '../src/probe.js';
import { makeContext, scan } from '../src/scan.js';
import { fixture, fixtureEnv, fixtureRepo } from './helpers.js';

test('listTools: initialize + paginated tools/list against the fixture server', async () => {
  const tools = await listTools({ command: process.execPath, args: [fixture('repo/tools/tracker-mcp.mjs')] }, { timeoutMs: 10000 });
  assert.equal(tools.length, 18);
  assert.ok(tools.every((t) => t.name && t.inputSchema));
});

test('listTools: missing command, early exit and timeout are errors, not hangs', async () => {
  await assert.rejects(listTools({ command: 'contexttax-missing-server', args: [] }, { timeoutMs: 5000 }), /not found|exited/);
  await assert.rejects(listTools({ command: process.execPath, args: ['-e', 'process.exit(3)'] }, { timeoutMs: 5000 }), /exited with code 3/);
  await assert.rejects(listTools({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, { timeoutMs: 300 }), /no answer/);
});

test('expandVars: ${VAR}, ${VAR:-default}, {env:VAR}', () => {
  assert.equal(expandVars('${A}/${B:-b}/{env:A}', { A: 'a' }), 'a/b/a');
});

test('probeAll: measures stdio servers once, leaves remote ones alone', async () => {
  const repo = fixtureRepo();
  try {
    const { items } = scan(makeContext({ dir: repo.dir, env: fixtureEnv() }));
    await probeAll(items, { cwd: repo.dir, env: fixtureEnv(), timeoutMs: 10000 });
    const tracker = items.find((i) => i.label === 'tracker');
    assert.equal(tracker.tools.length, 18);
    assert.ok(tracker.tokens > 1500 && tracker.tokens < 6000, String(tracker.tokens));
    assert.ok(tracker.deferredTokens > 0 && tracker.deferredTokens < tracker.tokens / 5);
    assert.equal(items.find((i) => i.label === 'docs-search').tokens, null);
    assert.match(items.find((i) => i.label === 'notes').probeError, /not found/);
  } finally {
    repo.cleanup();
  }
});
