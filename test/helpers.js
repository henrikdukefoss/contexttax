import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixture = (p = '') => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

/** An env that points every lookup at the fixture home and nothing else. */
export const fixtureEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  CONTEXTTAX_HOME: fixture('home'),
  CONTEXTTAX_MANAGED_DIR: '/nonexistent',
  XDG_CACHE_HOME: join(tmpdir(), 'contexttax-test-cache'),
  NO_COLOR: '1',
  ...extra,
});

/**
 * Copy the fixture repo to a temp folder with its own .git marker (a nested .git can't be
 * committed). Returns { dir, cleanup }.
 */
export function fixtureRepo(name = 'sample-app') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'contexttax-')));
  const dir = join(base, name);
  cpSync(fixture('repo'), dir, { recursive: true });
  mkdirSync(join(dir, '.git'));
  return { dir, base, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
