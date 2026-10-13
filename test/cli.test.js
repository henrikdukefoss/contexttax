import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { fixtureEnv, fixtureRepo } from './helpers.js';

const bin = fileURLToPath(new URL('../bin/contexttax.js', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { env: fixtureEnv(env), encoding: 'utf8' });

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['repo', '--json', '--offline', '--probe-mcp', '--badge', 'b.svg', '--models=a,b']), {
    dir: 'repo',
    json: true,
    offline: true,
    color: true,
    probe: true,
    probeTimeout: 20,
    repoOnly: false,
    badgeTheme: 'calm',
    badge: 'b.svg',
    models: ['a', 'b'],
  });
  assert.equal(parseArgs(['--badge']).badge, true);
  assert.equal(parseArgs(['--badge', '--json']).badge, true);
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--probe-timeout', 'x']));
  assert.throws(() => parseArgs(['a', 'b']));
});

test('cli: report text over the fixture repo, offline, no MCP execution by default', () => {
  const repo = fixtureRepo();
  try {
    const r = run([repo.dir, '--offline']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CONTEXT TAX {2}sample-app/);
    assert.match(r.stdout, /adds an estimated [\d,]+ tokens of instructions/);
    assert.match(r.stdout, /MCP tracker +\? +Claude Code, OpenCode, Cursor/);
    assert.match(r.stdout, /not measured, see --probe-mcp/);
    assert.match(r.stdout, /99,554 input tokens/);
    assert.match(r.stdout, /The Agent Burn Index, October 2026/);
    assert.match(r.stdout, /Token counts are estimates/);
    assert.match(r.stdout, /made by Standard Compute/);
    assert.doesNotMatch(r.stdout, /—/);
    assert.doesNotMatch(r.stderr, /probing/);
  } finally {
    repo.cleanup();
  }
});

test('cli: --json --probe-mcp', () => {
  const repo = fixtureRepo();
  try {
    const r = run([repo.dir, '--offline', '--json', '--probe-mcp']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /tracker: 18 tools/);
    const out = JSON.parse(r.stdout);
    assert.equal(out.typicalRequest.inputTokens, 99554);
    assert.equal(out.mcpProbed, true);
    const tracker = out.items.find((i) => i.label === 'tracker');
    assert.equal(tracker.tools.length, 18);
    assert.equal(tracker.server.args, undefined); // args can hold secrets; never printed
    assert.ok(out.costPer1000Requests.some((c) => c.model === 'claude-sonnet-5-5'));
    assert.equal(out.prices.source, 'LiteLLM (bundled)');
    assert.ok(out.items.every((i) => !('text' in i)));
  } finally {
    repo.cleanup();
  }
});

test('cli: --badge writes the SVG and prints the markdown', () => {
  const repo = fixtureRepo();
  try {
    const r = run([repo.dir, '--offline', '--json', '--badge']);
    assert.equal(r.status, 0, r.stderr);
    const svg = readFileSync(join(repo.dir, 'context-tax.svg'), 'utf8');
    const value = JSON.parse(r.stdout).badge.tokens;
    assert.ok(value > 0);
    assert.match(svg, /tokens\/request/);
    assert.match(r.stderr, /\[!\[context tax: [\d.K]+ tokens\/request\]\(context-tax\.svg\)\]\(https:\/\/github\.com\/henrikdukefoss\/contexttax\)/);
    const custom = join(repo.base, 'badge.svg');
    assert.equal(run([repo.dir, '--offline', '--badge', custom, '--badge-theme', 'navy']).status, 0);
    assert.match(readFileSync(custom, 'utf8'), /#c9a158/);
  } finally {
    repo.cleanup();
  }
});

test('cli: an empty folder is not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contexttax-empty-'));
  try {
    const r = run([dir, '--offline'], { CONTEXTTAX_HOME: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No agent instruction files/);
    assert.ok(!existsSync(join(dir, 'context-tax.svg')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: bad input exits 2', () => {
  assert.equal(run(['--agent', 'nope']).status, 2);
  assert.equal(run(['--badge-theme', 'neon']).status, 2);
  assert.equal(run(['/nonexistent/folder']).status, 2);
  assert.match(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }), /--probe-mcp/);
});
