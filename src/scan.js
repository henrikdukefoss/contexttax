// Finds everything an agent loads into every request in this repo: instruction files and
// their @imports, always-on rules, skill and subagent descriptions, and MCP servers.
// Reads files only. Nothing is executed here (see probe.js for the opt-in MCP probe).
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ancestors, displayPath, gitRoot, home, isDir, isFile, isInside, listDir, readText, real, walkFiles } from './lib/fs.js';
import { frontmatter, parseJsonc, parseToml } from './lib/parse.js';
import { estimateText } from './tokens.js';

export function makeContext({ dir = process.cwd(), env = process.env } = {}) {
  const target = real(resolve(dir));
  const homeDir = home(env);
  const claudeConfig = env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR.split(',')[0].trim() : null;
  const managedDefault =
    process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : '/etc/claude-code';
  return {
    env,
    target,
    root: gitRoot(target),
    homeDir,
    claudeDir: claudeConfig || join(homeDir, '.claude'),
    claudeJson: claudeConfig ? join(claudeConfig, '.claude.json') : join(homeDir, '.claude.json'),
    managedDir: env.CONTEXTTAX_MANAGED_DIR ?? managedDefault,
    codexHome: env.CODEX_HOME || join(homeDir, '.codex'),
    configHome: env.XDG_CONFIG_HOME || join(homeDir, '.config'),
    geminiHome: join(env.GEMINI_CLI_HOME || homeDir, '.gemini'),
  };
}

/** Collected items, deduplicated by real path so a file shared by several agents counts once per agent. */
class Items {
  constructor(ctx) {
    this.ctx = ctx;
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  put(item) {
    this.map.set(item.key, item);
    return item;
  }
  list() {
    return [...this.map.values()];
  }
  show(p) {
    return displayPath(p, { root: this.ctx.root, homeDir: this.ctx.homeDir });
  }
  scopeOf(p) {
    return isInside(p, this.ctx.root) ? 'repo' : 'user';
  }

  /**
   * Add a file one agent loads with every request.
   * opts: kind, scope, label, importedBy, imports (max hops, 0 = none), transform(text), note
   */
  file(abs, agent, opts = {}, depth = 0, seen = new Set()) {
    const raw = readText(abs);
    if (raw == null) return null;
    const key = real(abs);
    if (seen.has(key)) return null;
    seen.add(key);
    let item = this.get(key);
    if (!item) {
      const text = opts.transform ? opts.transform(raw) : raw;
      item = this.put({
        key,
        kind: opts.kind || 'instructions',
        label: opts.label || this.show(abs),
        path: this.show(abs),
        scope: opts.scope || this.scopeOf(abs),
        agents: new Set(),
        tokens: estimateText(text),
        chars: text.length,
        text,
        notes: [],
      });
      if (opts.importedBy) item.importedBy = opts.importedBy;
    } else if (opts.importedBy && item.importedBy !== opts.importedBy) {
      const n = `@-imported by ${opts.importedBy}`;
      if (!item.notes.includes(n)) item.notes.push(n);
    }
    if (opts.note && !item.notes.includes(opts.note)) item.notes.push(opts.note);
    item.agents.add(agent);
    if (opts.imports && depth < opts.imports) {
      for (const ref of findImports(raw)) {
        const target = resolveImport(ref, abs, this.ctx.homeDir);
        if (target && isFile(target)) {
          this.file(target, agent, { kind: 'import', importedBy: item.path, imports: opts.imports }, depth + 1, seen);
        }
      }
    }
    return item;
  }

  /** A folder of small entries (skills, subagents, rules) shown as one line with children. */
  group(key, agent, { kind, label, scope, children }) {
    if (!children.length) return null;
    let item = this.get(key);
    if (!item) {
      const always = children.filter((c) => !c.onDemand);
      item = this.put({
        key,
        kind,
        label,
        path: label,
        scope,
        agents: new Set(),
        tokens: always.reduce((n, c) => n + c.tokens, 0),
        count: always.length,
        onDemand: children.length - always.length,
        children: children.sort((a, b) => b.tokens - a.tokens),
        notes: [],
      });
    }
    item.agents.add(agent);
    return item;
  }
}

/** @path references in a CLAUDE.md / GEMINI.md, outside code spans and fenced blocks. */
export function findImports(text) {
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const clean = line.replace(/(`+)[\s\S]*?\1/g, ' ');
    for (const m of clean.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g)) {
      const p = m[1].replace(/\\ /g, ' ').replace(/[.,;:!?)\]}>'"]+$/, '');
      if (p && !p.startsWith('@')) out.push(p);
    }
  }
  return out;
}

function resolveImport(ref, fromFile, homeDir) {
  if (/^[a-z]+:\/\//i.test(ref)) return null;
  if (ref === '~' || ref.startsWith('~/')) return join(homeDir, ref.slice(2));
  if (isAbsolute(ref)) return ref;
  return resolve(dirname(fromFile), ref);
}

const stripFrontmatter = (t) => frontmatter(t).body;
const mdFiles = (dir) => walkFiles(dir, (n) => n.endsWith('.md'), 4);

// ---------------------------------------------------------------- Claude Code

function claudeCode(ctx, items) {
  const A = 'claude-code';
  const imports = 4; // "maximum depth of four hops" (code.claude.com/docs/en/memory)
  items.file(join(ctx.managedDir, 'CLAUDE.md'), A, { imports, scope: 'user', label: 'managed CLAUDE.md' });
  items.file(join(ctx.claudeDir, 'CLAUDE.md'), A, { imports, scope: 'user' });
  rulesGroup(items, A, join(ctx.claudeDir, 'rules'), 'user');
  // cwd and every directory above it, outermost first
  for (const d of ancestors(ctx.target).reverse()) {
    items.file(join(d, 'CLAUDE.md'), A, { imports });
    items.file(join(d, '.claude', 'CLAUDE.md'), A, { imports });
    items.file(join(d, 'CLAUDE.local.md'), A, { imports, scope: 'user' });
  }
  for (const d of new Set([ctx.root, ctx.target])) rulesGroup(items, A, join(d, '.claude', 'rules'), 'repo');
  autoMemory(ctx, items, A);
  for (const [dir, scope] of [
    [join(ctx.claudeDir, 'skills'), 'user'],
    [join(ctx.root, '.claude', 'skills'), 'repo'],
  ]) skillsGroup(items, A, dir, scope);
  for (const [dir, scope] of [
    [join(ctx.claudeDir, 'commands'), 'user'],
    [join(ctx.root, '.claude', 'commands'), 'repo'],
  ]) commandsGroup(items, A, dir, scope);
  subagentsGroups(items, A, [
    [join(ctx.claudeDir, 'agents'), 'user'],
    [join(ctx.root, '.claude', 'agents'), 'repo'],
  ]);
}

function rulesGroup(items, agent, dir, scope) {
  const children = mdFiles(dir).map((p) => {
    const raw = readText(p) || '';
    const { data, body } = frontmatter(raw);
    const onDemand = data.paths != null && data.paths !== '';
    return { name: items.show(p), tokens: estimateText(body), onDemand, note: onDemand ? 'paths: loads on demand' : undefined };
  });
  items.group(`group:${real(dir)}`, agent, { kind: 'rules', label: items.show(dir), scope, children });
}

// Auto memory: Claude Code loads the first 200 lines (or 25 KB) of the project's MEMORY.md.
function autoMemory(ctx, items, agent) {
  for (const d of new Set([ctx.root, ctx.target])) {
    const p = join(ctx.claudeDir, 'projects', d.replace(/[^a-zA-Z0-9]/g, '-'), 'memory', 'MEMORY.md');
    if (!isFile(p)) continue;
    items.file(p, agent, {
      kind: 'memory',
      scope: 'user',
      label: 'auto memory MEMORY.md',
      transform: (t) => t.split('\n').slice(0, 200).join('\n').slice(0, 25 * 1024),
    });
    return;
  }
}

const SKILL_CAP = 1536; // description + when_to_use, as listed (code.claude.com/docs/en/skills)

function skillsGroup(items, agent, dir, scope) {
  const children = [];
  for (const e of listDir(dir)) {
    const p = join(dir, e.name, 'SKILL.md');
    const raw = readText(p);
    if (raw == null) continue;
    const { data } = frontmatter(raw);
    const name = String(data.name || e.name);
    const off = data['disable-model-invocation'] === true;
    const desc = [data.description, data.when_to_use].filter(Boolean).join(' ').slice(0, SKILL_CAP);
    children.push({ name, tokens: off ? 0 : estimateText(`- ${name}: ${desc}`), onDemand: off, note: off ? 'disable-model-invocation' : undefined });
  }
  items.group(`group:${real(dir)}`, agent, { kind: 'skills', label: items.show(dir), scope, children });
}

function commandsGroup(items, agent, dir, scope) {
  const children = [];
  for (const p of mdFiles(dir)) {
    const { data, body } = frontmatter(readText(p) || '');
    const name = p.slice(dir.length + 1).replace(/\.md$/, '').split(/[\\/]/).join(':');
    const off = data['disable-model-invocation'] === true;
    const desc = String(data.description || body.trim().split('\n')[0] || '').slice(0, SKILL_CAP);
    children.push({ name, tokens: off ? 0 : estimateText(`- /${name}: ${desc}`), onDemand: off, note: off ? 'disable-model-invocation' : undefined });
  }
  items.group(`group:${real(dir)}`, agent, { kind: 'commands', label: items.show(dir), scope, children });
}

const SUBAGENT_CAP = 15000; // combined budget for custom subagent descriptions (code.claude.com/docs/en/sub-agents)

function subagentsGroups(items, agent, dirs) {
  let budget = SUBAGENT_CAP;
  for (const [dir, scope] of dirs) {
    const children = [];
    for (const p of mdFiles(dir)) {
      const { data } = frontmatter(readText(p) || '');
      const name = String(data.name || p.split(/[\\/]/).pop().replace(/\.md$/, ''));
      const tools = Array.isArray(data.tools) ? data.tools.join(', ') : data.tools || 'All tools';
      let tokens = estimateText(`- ${name}: ${data.description || ''} (Tools: ${tools})`);
      tokens = Math.min(tokens, budget);
      budget -= tokens;
      children.push({ name, tokens });
    }
    items.group(`group:${real(dir)}`, agent, { kind: 'subagents', label: items.show(dir), scope, children });
  }
}

// ---------------------------------------------------------------- AGENTS.md family

function codex(ctx, items) {
  const A = 'codex';
  const note = 'Codex reads at most 32 KiB of project instructions';
  const pick = (d) => (isFile(join(d, 'AGENTS.override.md')) ? join(d, 'AGENTS.override.md') : join(d, 'AGENTS.md'));
  items.file(pick(ctx.codexHome), A, { scope: 'user' });
  for (const d of ancestors(ctx.target, ctx.root).reverse()) {
    const it = items.file(pick(d), A);
    if (it && it.chars > 32 * 1024) it.notes.push(note);
  }
}

function opencode(ctx, items) {
  const A = 'opencode';
  const globalDir = join(ctx.configHome, 'opencode');
  items.file(join(globalDir, 'AGENTS.md'), A, { scope: 'user' }) || items.file(join(ctx.claudeDir, 'CLAUDE.md'), A, { scope: 'user' });
  for (const d of ancestors(ctx.target, ctx.root).reverse()) items.file(join(d, 'AGENTS.md'), A) || items.file(join(d, 'CLAUDE.md'), A);
  for (const cfg of opencodeConfigs(ctx)) {
    for (const pattern of Array.isArray(cfg.data.instructions) ? cfg.data.instructions : []) {
      for (const p of expandPattern(String(pattern), dirname(cfg.path), ctx)) items.file(p, A, { note: `instructions in ${items.show(cfg.path)}` });
    }
  }
}

function opencodeConfigs(ctx) {
  const out = [];
  for (const p of [
    join(ctx.configHome, 'opencode', 'opencode.json'),
    join(ctx.configHome, 'opencode', 'opencode.jsonc'),
    join(ctx.root, 'opencode.json'),
    join(ctx.root, 'opencode.jsonc'),
    join(ctx.root, '.opencode', 'opencode.json'),
    join(ctx.root, '.opencode', 'opencode.jsonc'),
  ]) {
    const data = parseJsonc(readText(p));
    if (data && typeof data === 'object') out.push({ path: p, data });
  }
  return out;
}

/** A path or simple glob (*, **, ?) from a config file, resolved to existing files. */
export function expandPattern(pattern, baseDir, ctx) {
  if (/^https?:\/\//.test(pattern)) return [];
  let p = pattern.startsWith('~/') ? join(ctx.homeDir, pattern.slice(2)) : isAbsolute(pattern) ? pattern : resolve(baseDir, pattern);
  if (!/[*?]/.test(p)) return isFile(p) ? [p] : [];
  const fixed = p.split(/[*?]/)[0];
  const start = fixed.endsWith('/') || fixed.endsWith('\\') ? fixed : dirname(fixed);
  const re = new RegExp(
    '^' +
      p
        .split(/(\*\*\/|\*\*|\*|\?)/)
        .map((s) => (s === '**/' ? '(?:.*/)?' : s === '**' ? '.*' : s === '*' ? '[^/]*' : s === '?' ? '[^/]' : s.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
  if (!isDir(start)) return [];
  return walkFiles(start, () => true, 6).filter((f) => re.test(f.split('\\').join('/')));
}

function cursor(ctx, items) {
  const A = 'cursor';
  items.file(join(ctx.root, '.cursorrules'), A);
  items.file(join(ctx.root, 'AGENTS.md'), A);
  const dir = join(ctx.root, '.cursor', 'rules');
  const children = walkFiles(dir, (n) => /\.mdc?$/.test(n), 4).map((p) => {
    const { data, body } = frontmatter(readText(p) || '');
    const name = items.show(p);
    if (data.alwaysApply === true) return { name, tokens: estimateText(body), note: 'alwaysApply' };
    const hasGlobs = data.globs != null && data.globs !== '' && !(Array.isArray(data.globs) && !data.globs.length);
    if (data.description && !hasGlobs) return { name, tokens: estimateText(String(data.description)), note: 'description only' };
    return { name, tokens: 0, onDemand: true, note: hasGlobs ? 'globs: on demand' : 'manual' };
  });
  items.group(`group:${real(dir)}`, A, { kind: 'rules', label: items.show(dir), scope: 'repo', children });
}

function gemini(ctx, items) {
  const A = 'gemini-cli';
  const imports = 5;
  items.file(join(ctx.geminiHome, 'GEMINI.md'), A, { imports, scope: 'user' });
  for (const d of ancestors(ctx.target, ctx.root).reverse()) items.file(join(d, 'GEMINI.md'), A, { imports });
}

function cline(ctx, items) {
  const A = 'cline';
  const p = join(ctx.root, '.clinerules');
  if (isFile(p)) return items.file(p, A);
  const children = walkFiles(p, (n) => /\.(md|txt)$/.test(n), 4).map((f) => {
    const { data, body } = frontmatter(readText(f) || '');
    const onDemand = data.paths != null && data.paths !== '';
    return { name: items.show(f), tokens: estimateText(body), onDemand, note: onDemand ? 'paths: on demand' : undefined };
  });
  items.group(`group:${real(p)}`, A, { kind: 'rules', label: items.show(p), scope: 'repo', children });
}

function copilot(ctx, items) {
  items.file(join(ctx.root, '.github', 'copilot-instructions.md'), 'copilot');
}

function aider(ctx, items) {
  // Aider loads conventions only when they are passed with --read (or `read:` in .aider.conf.yml).
  const conf = readText(join(ctx.root, '.aider.conf.yml')) || '';
  const listed = [...conf.matchAll(/^\s*(?:read:\s*|-\s+)["']?([^"'\s#]+\.(?:md|txt))/gm)].map((m) => m[1]);
  for (const f of listed) items.file(resolve(ctx.root, f), 'aider', { note: 'read: in .aider.conf.yml' });
  items.file(join(ctx.root, 'CONVENTIONS.md'), 'aider', { note: listed.length ? undefined : 'only when passed with --read' });
}

// ---------------------------------------------------------------- MCP servers

/** One configured MCP server, normalised across config formats. */
function server(items, agent, name, cfg, configPath, scope) {
  if (!cfg || typeof cfg !== 'object' || cfg.enabled === false || cfg.disabled === true) return;
  let command = cfg.command;
  let args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  if (Array.isArray(command)) [command, ...args] = command.map(String); // opencode: command is an array
  const url = cfg.url || cfg.httpUrl || cfg.serverUrl || null;
  const type = String(cfg.type || '').toLowerCase();
  const transport = command && type !== 'http' && type !== 'sse' && type !== 'remote' ? 'stdio' : url ? (type === 'sse' ? 'sse' : 'http') : null;
  if (!transport) return;
  const env = cfg.env || cfg.environment || {};
  // the same server configured for several agents is one row
  const key = `mcp:${name}:${JSON.stringify(url ? [url] : [String(command), args])}`;
  const shown = items.show(configPath);
  const existing = items.get(key);
  if (existing) {
    existing.agents.add(agent);
    existing.sources.push({ agent, path: shown });
    if (!existing.paths.includes(shown)) existing.paths.push(shown);
    existing.path = existing.paths.join(', ');
    if (scope === 'repo') existing.scope = 'repo';
    return;
  }
  items.put({
    key,
    kind: 'mcp',
    label: name,
    path: shown,
    paths: [shown],
    sources: [{ agent, path: shown }],
    scope,
    agents: new Set([agent]),
    tokens: null,
    notes: [],
    server: { name, transport, command: command ? String(command) : undefined, args, env, url, cwd: cfg.cwd },
  });
}

function mcpServers(ctx, items) {
  // Claude Code: project .mcp.json, user and local scopes in ~/.claude.json
  const claudeJson = parseJsonc(readText(ctx.claudeJson)) || {};
  const local = claudeJson.projects?.[ctx.root] || claudeJson.projects?.[ctx.target] || {};
  const disabled = new Set(local.disabledMcpjsonServers || []);
  for (const p of [join(ctx.root, '.claude', 'settings.json'), join(ctx.root, '.claude', 'settings.local.json')]) {
    for (const n of parseJsonc(readText(p))?.disabledMcpjsonServers || []) disabled.add(n);
  }
  const projectMcp = join(ctx.root, '.mcp.json');
  for (const [n, c] of Object.entries(parseJsonc(readText(projectMcp))?.mcpServers || {})) if (!disabled.has(n)) server(items, 'claude-code', n, c, projectMcp, 'repo');
  for (const [n, c] of Object.entries(claudeJson.mcpServers || {})) server(items, 'claude-code', n, c, ctx.claudeJson, 'user');
  for (const [n, c] of Object.entries(local.mcpServers || {})) server(items, 'claude-code', n, c, ctx.claudeJson, 'user');

  for (const [p, scope] of [
    [join(ctx.root, '.cursor', 'mcp.json'), 'repo'],
    [join(ctx.homeDir, '.cursor', 'mcp.json'), 'user'],
  ]) for (const [n, c] of Object.entries(parseJsonc(readText(p))?.mcpServers || {})) server(items, 'cursor', n, c, p, scope);

  for (const cfg of opencodeConfigs(ctx)) {
    for (const [n, c] of Object.entries(cfg.data.mcp || {})) server(items, 'opencode', n, c, cfg.path, items.scopeOf(cfg.path));
  }

  for (const [p, scope] of [
    [join(ctx.root, '.gemini', 'settings.json'), 'repo'],
    [join(ctx.geminiHome, 'settings.json'), 'user'],
  ]) for (const [n, c] of Object.entries(parseJsonc(readText(p))?.mcpServers || {})) server(items, 'gemini-cli', n, c, p, scope);

  for (const [p, scope] of [
    [join(ctx.root, '.codex', 'config.toml'), 'repo'],
    [join(ctx.codexHome, 'config.toml'), 'user'],
  ]) {
    const text = readText(p);
    if (text == null) continue;
    for (const [n, c] of Object.entries(parseToml(text).mcp_servers || {})) server(items, 'codex', n, c, p, scope);
  }
}

/** Is Claude Code's MCP tool search turned off in the environment or settings? */
export function claudeToolSearchOff(ctx) {
  const values = [ctx.env.ENABLE_TOOL_SEARCH];
  for (const p of [join(ctx.claudeDir, 'settings.json'), join(ctx.root, '.claude', 'settings.json'), join(ctx.root, '.claude', 'settings.local.json')]) {
    values.push(parseJsonc(readText(p))?.env?.ENABLE_TOOL_SEARCH);
  }
  const last = values.filter((v) => v != null).pop();
  return last != null && /^(false|0|off|no)$/i.test(String(last));
}

export function scan(ctx) {
  const items = new Items(ctx);
  claudeCode(ctx, items);
  codex(ctx, items);
  opencode(ctx, items);
  cursor(ctx, items);
  gemini(ctx, items);
  cline(ctx, items);
  copilot(ctx, items);
  aider(ctx, items);
  mcpServers(ctx, items);
  return { items: items.list(), toolSearchOff: claudeToolSearchOff(ctx) };
}
