#!/usr/bin/env node
// Renders docs/sample-output.txt and the sample badges from the synthetic fixture repo in
// test/fixtures/repo, with an empty home folder, bundled prices and the fixture MCP server.
// Never reads your real config.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrices } from '../src/pricing.js';
import { probeAll } from '../src/probe.js';
import { renderBadge } from '../src/render/badge.js';
import { renderTerminal } from '../src/render/terminal.js';
import { buildReport } from '../src/report.js';
import { makeContext, scan } from '../src/scan.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const base = realpathSync(mkdtempSync(join(tmpdir(), 'contexttax-sample-')));
const dir = join(base, 'sample-app');
const home = join(base, 'home');
try {
  cpSync(fileURLToPath(new URL('../test/fixtures/repo', import.meta.url)), dir, { recursive: true });
  mkdirSync(join(dir, '.git'));
  mkdirSync(home);
  const env = { PATH: process.env.PATH, CONTEXTTAX_HOME: home, CONTEXTTAX_MANAGED_DIR: '/nonexistent' };
  const ctx = makeContext({ dir, env });
  const found = scan(ctx);
  await probeAll(found.items, { cwd: dir, env, timeoutMs: 10000, version });
  const prices = await loadPrices({ offline: true });
  prices.fetchedAt = Date.parse('2026-10-13T12:00:00Z');
  const report = buildReport({ ctx, scan: found, prices, version, probed: true });
  const docs = (f) => fileURLToPath(new URL(`../docs/${f}`, import.meta.url));
  const text = renderTerminal(report);
  writeFileSync(docs('sample-output.txt'), text);
  writeFileSync(docs('sample-badge.svg'), renderBadge(report.badge.tokens));
  writeFileSync(docs('sample-badge-navy.svg'), renderBadge(report.badge.tokens, { theme: 'navy' }));
  console.log(text);
} finally {
  rmSync(base, { recursive: true, force: true });
}
