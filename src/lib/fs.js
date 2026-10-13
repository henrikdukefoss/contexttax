import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

export const home = (env = process.env) => env.CONTEXTTAX_HOME || homedir();

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export const MAX_BYTES = 2 * 1024 * 1024;

/** Read a UTF-8 text file, or null when missing, too large or binary. */
export function readText(p) {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const s = readFileSync(p, 'utf8');
    return s.includes('\u0000') ? null : s;
  } catch {
    return null;
  }
}

export function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Files under dir (recursive, depth-limited) whose name passes match. */
export function walkFiles(dir, match, depth = 4, out = []) {
  if (depth < 0) return out;
  for (const e of listDir(dir)) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory() || (e.isSymbolicLink() && isDir(p))) walkFiles(p, match, depth - 1, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}

/** The nearest ancestor (or dir itself) holding .git, else dir. */
export function gitRoot(dir) {
  let d = dir;
  for (;;) {
    try {
      statSync(join(d, '.git'));
      return d;
    } catch {
      // keep going
    }
    const up = dirname(d);
    if (up === d) return dir;
    d = up;
  }
}

/** dir, its parent, ... up to and including `stop` (or the filesystem root, excluded). */
export function ancestors(dir, stop) {
  const out = [];
  let d = dir;
  for (;;) {
    const up = dirname(d);
    if (up === d) break; // never the filesystem root itself
    out.push(d);
    if (stop && d === stop) break;
    d = up;
  }
  return out;
}

export function isInside(child, parent) {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[a-zA-Z]:/.test(r));
}

/** A short display path: repo-relative, ~/..., or absolute. */
export function displayPath(p, { root, homeDir }) {
  if (root && isInside(p, root)) return relative(root, p) || '.';
  if (homeDir && isInside(p, homeDir)) return '~/' + relative(homeDir, p).split(sep).join('/');
  return p;
}
