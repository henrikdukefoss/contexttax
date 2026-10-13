import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatter, parseJsonc, parseToml } from '../src/lib/parse.js';

test('frontmatter: plain, quoted, folded blocks and lists', () => {
  const { data, body } = frontmatter(
    ['---', 'name: db-migrate', 'description: >', '  Writes a migration', '  and a rollback.', 'quoted: "a: b"', 'off: true', 'paths:', '  - "web/**/*.tsx"', '  - api/*.ts', 'tools: [Read, Grep]', '---', 'Body'].join('\n'),
  );
  assert.equal(data.name, 'db-migrate');
  assert.equal(data.description, 'Writes a migration and a rollback.');
  assert.equal(data.quoted, 'a: b');
  assert.equal(data.off, true);
  assert.deepEqual(data.paths, ['web/**/*.tsx', 'api/*.ts']);
  assert.deepEqual(data.tools, ['Read', 'Grep']);
  assert.equal(body, 'Body');
  assert.deepEqual(frontmatter('# no frontmatter').data, {});
});

test('parseJsonc: comments, trailing commas, strings with slashes', () => {
  assert.deepEqual(parseJsonc('{\n// c\n"a": "http://x/*y*/", /* b */ "b": [1,2,],\n}'), { a: 'http://x/*y*/', b: [1, 2] });
  assert.equal(parseJsonc('{nope'), null);
  assert.equal(parseJsonc(null), null);
});

test('parseToml: Codex mcp_servers tables', () => {
  const t = parseToml(
    [
      'model = "gpt-6-sol" # comment',
      '[mcp_servers.docs]',
      'command = "npx"',
      'args = ["-y", "docs-mcp"]',
      'env = { API_KEY = "x", MODE = "ro" }',
      '[mcp_servers."with.dot"]',
      'url = "https://example.com/mcp"',
      'args = [',
      '  "--a",',
      '  "--b",',
      ']',
      'enabled = false',
    ].join('\n'),
  );
  assert.equal(t.model, 'gpt-6-sol');
  assert.deepEqual(t.mcp_servers.docs, { command: 'npx', args: ['-y', 'docs-mcp'], env: { API_KEY: 'x', MODE: 'ro' } });
  assert.deepEqual(t.mcp_servers['with.dot'], { url: 'https://example.com/mcp', args: ['--a', '--b'], enabled: false });
});
