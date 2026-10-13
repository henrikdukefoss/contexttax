import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandPattern, findImports, makeContext, scan } from '../src/scan.js';
import { fixture, fixtureEnv, fixtureRepo } from './helpers.js';

const byPath = (items, p) => items.find((i) => i.path === p);
const agentsOf = (it) => [...it.agents].sort();

test('findImports: @paths outside code, not emails, code spans or fences', () => {
  const md = ['@AGENTS.md', 'Read @docs/a.md, then @~/x.md.', 'Mail team@example.com', 'Inline `@not-this.md` here', '```', '@fenced.md', '```', 'Space: @My\\ Docs/b.md'].join('\n');
  assert.deepEqual(findImports(md), ['AGENTS.md', 'docs/a.md', '~/x.md', 'My Docs/b.md']);
});

test('scan: instruction files and which agents load them', () => {
  const repo = fixtureRepo();
  try {
    const { items } = scan(makeContext({ dir: repo.dir, env: fixtureEnv() }));
    assert.deepEqual(agentsOf(byPath(items, 'AGENTS.md')), ['claude-code', 'codex', 'cursor', 'opencode']);
    assert.equal(byPath(items, 'AGENTS.md').importedBy, 'CLAUDE.md');
    assert.deepEqual(agentsOf(byPath(items, 'CLAUDE.md')), ['claude-code']);
    const arch = byPath(items, 'docs/architecture.md');
    assert.equal(arch.kind, 'import');
    assert.ok(arch.tokens > 1000);
    assert.equal(byPath(items, 'docs/never-loaded.md'), undefined);
    assert.deepEqual(agentsOf(byPath(items, 'docs/style-guide.md')), ['gemini-cli', 'opencode']); // GEMINI.md import + opencode.json glob
    assert.deepEqual(agentsOf(byPath(items, '.cursorrules')), ['cursor']);
    assert.deepEqual(agentsOf(byPath(items, '.github/copilot-instructions.md')), ['copilot']);
    assert.deepEqual(agentsOf(byPath(items, 'CONVENTIONS.md')), ['aider']);
    assert.deepEqual(agentsOf(byPath(items, '.clinerules')), ['cline']);
    // user level
    assert.equal(byPath(items, '~/.claude/CLAUDE.md').scope, 'user');
    assert.deepEqual(agentsOf(byPath(items, '~/.claude/CLAUDE.md')), ['claude-code', 'opencode']); // opencode falls back to it
    assert.deepEqual(agentsOf(byPath(items, '~/.codex/AGENTS.md')), ['codex']);
  } finally {
    repo.cleanup();
  }
});

test('scan: rules, skills, subagents and commands', () => {
  const repo = fixtureRepo();
  try {
    const { items } = scan(makeContext({ dir: repo.dir, env: fixtureEnv() }));
    const rules = byPath(items, '.claude/rules');
    assert.equal(rules.count, 1);
    assert.equal(rules.onDemand, 1); // paths: frontmatter
    const skills = byPath(items, '.claude/skills');
    assert.equal(skills.count, 2);
    assert.equal(skills.onDemand, 1); // disable-model-invocation
    assert.deepEqual(skills.children.map((c) => c.name).sort(), ['db-migrate', 'manual-only', 'release-notes']);
    assert.equal(byPath(items, '~/.claude/skills').count, 1);
    assert.equal(byPath(items, '.claude/agents').count, 1);
    assert.equal(byPath(items, '.claude/commands').count, 1);
    const cursor = byPath(items, '.cursor/rules');
    assert.equal(cursor.count, 2); // alwaysApply + description-only; the globs rule is on demand
    assert.equal(cursor.onDemand, 1);
    const perf = cursor.children.find((c) => c.name.endsWith('perf.mdc'));
    assert.equal(perf.note, 'description only');
  } finally {
    repo.cleanup();
  }
});

test('scan: MCP servers across agents, merged by command; disabled ones skipped', () => {
  const repo = fixtureRepo();
  try {
    const { items } = scan(makeContext({ dir: repo.dir, env: fixtureEnv() }));
    const mcp = items.filter((i) => i.kind === 'mcp');
    const tracker = mcp.find((i) => i.label === 'tracker');
    assert.deepEqual(agentsOf(tracker), ['claude-code', 'cursor', 'opencode']);
    assert.deepEqual(tracker.paths, ['.mcp.json', '.cursor/mcp.json', 'opencode.json']);
    assert.equal(tracker.server.transport, 'stdio');
    assert.equal(tracker.tokens, null); // nothing runs without --probe-mcp
    assert.equal(mcp.find((i) => i.label === 'docs-search').server.transport, 'http');
    assert.equal(mcp.find((i) => i.label === 'browser').server.transport, 'sse');
    assert.deepEqual(agentsOf(mcp.find((i) => i.label === 'notes')), ['codex']);
    assert.equal(mcp.find((i) => i.label === 'old-server'), undefined);
    assert.equal(mcp.find((i) => i.label === 'disabled-one'), undefined);
  } finally {
    repo.cleanup();
  }
});

test('scan: CLAUDE.local.md, auto memory, disabled .mcp.json servers and tool search setting', () => {
  const repo = fixtureRepo();
  const home = mkdtempSync(join(tmpdir(), 'contexttax-home-'));
  try {
    writeFileSync(join(repo.dir, 'CLAUDE.local.md'), 'My local notes.');
    mkdirSync(join(repo.dir, '.claude'), { recursive: true });
    writeFileSync(join(repo.dir, '.claude', 'settings.local.json'), JSON.stringify({ disabledMcpjsonServers: ['docs-search'], env: { ENABLE_TOOL_SEARCH: 'false' } }));
    const memDir = join(home, '.claude', 'projects', repo.dir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'MEMORY.md'), Array.from({ length: 300 }, (_, i) => `- memory line ${i}`).join('\n'));
    const res = scan(makeContext({ dir: repo.dir, env: fixtureEnv({ CONTEXTTAX_HOME: home }) }));
    assert.equal(byPath(res.items, 'CLAUDE.local.md').scope, 'user');
    const mem = res.items.find((i) => i.kind === 'memory');
    assert.equal(mem.text.split('\n').length, 200);
    assert.equal(res.items.find((i) => i.label === 'docs-search'), undefined);
    assert.equal(res.toolSearchOff, true);
  } finally {
    repo.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test('scan: a subfolder still finds the repo-root files and parent CLAUDE.md', () => {
  const repo = fixtureRepo();
  try {
    const sub = join(repo.dir, 'api', 'src');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(repo.dir, 'api', 'AGENTS.md'), 'API-specific notes.');
    const { items } = scan(makeContext({ dir: sub, env: fixtureEnv() }));
    assert.ok(byPath(items, 'CLAUDE.md'));
    assert.deepEqual(agentsOf(byPath(items, 'api/AGENTS.md')), ['codex', 'opencode']);
    assert.ok(items.some((i) => i.label === 'tracker'));
  } finally {
    repo.cleanup();
  }
});

test('expandPattern: plain paths and globs, relative to the config file', () => {
  const ctx = makeContext({ dir: fixture('repo'), env: fixtureEnv() });
  assert.deepEqual(expandPattern('docs/style-*.md', fixture('repo'), ctx), [fixture('repo/docs/style-guide.md')]);
  assert.equal(expandPattern('docs/**/*.md', fixture('repo'), ctx).length, 2);
  assert.deepEqual(expandPattern('missing.md', fixture('repo'), ctx), []);
  assert.deepEqual(expandPattern('https://example.com/x.md', fixture('repo'), ctx), []);
});
