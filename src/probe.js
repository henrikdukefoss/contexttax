// --probe-mcp: start each configured stdio MCP server on this machine, ask it for its tools
// (initialize, then tools/list) and stop it. Only runs when the flag is given, because it
// executes the commands in your MCP config. Remote (http/sse) servers are never contacted.
import { spawn } from 'node:child_process';
import { estimateJson, JSON_CHARS_PER_TOKEN } from './tokens.js';

const PROTOCOL = '2025-06-18';

/** Expand ${VAR}, ${VAR:-default} (Claude Code, Cursor) and {env:VAR} (OpenCode). */
export function expandVars(s, env) {
  return String(s)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, k, d) => env[k] ?? d ?? '')
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => env[k] ?? '');
}

/** Run one stdio server and return its tool list. Rejects on timeout or exit. */
export function listTools(server, { cwd, env = process.env, timeoutMs = 20000, version = '0' } = {}) {
  return new Promise((resolveAll, rejectAll) => {
    const extra = Object.fromEntries(Object.entries(server.env || {}).map(([k, v]) => [k, expandVars(v, env)]));
    const fullEnv = { ...env, ...extra };
    let child;
    try {
      child = spawn(expandVars(server.command, fullEnv), (server.args || []).map((a) => expandVars(a, fullEnv)), {
        cwd: server.cwd ? expandVars(server.cwd, fullEnv) : cwd,
        env: fullEnv,
        stdio: ['pipe', 'pipe', 'ignore'],
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch (err) {
      return rejectAll(err);
    }
    let done = false;
    let nextId = 0;
    let buf = '';
    const pending = new Map();
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const p of pending.values()) p.reject(err || new Error('stopped'));
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1500).unref();
      child.unref();
      child.stdout.destroy();
      err ? rejectAll(err) : resolveAll(value);
    };
    const timer = setTimeout(() => finish(new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    const write = (msg) => {
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
      } catch {
        // the exit handler reports it
      }
    };
    const request = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        write({ id, method, params });
      });

    child.on('error', (err) => finish(new Error(err.code === 'ENOENT' ? `command not found: ${server.command}` : err.message)));
    child.on('exit', (code) => finish(new Error(`exited with code ${code} before listing tools`)));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // servers sometimes log to stdout
        }
        if (msg.method && msg.id != null) {
          // a request from the server (ping, roots/list): answer minimally
          if (msg.method === 'ping') write({ id: msg.id, result: {} });
          else if (msg.method === 'roots/list') write({ id: msg.id, result: { roots: [] } });
          else write({ id: msg.id, error: { code: -32601, message: 'not supported' } });
        } else if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message || 'error')) : p.resolve(msg.result);
        }
      }
    });

    (async () => {
      await request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'contexttax', version } });
      write({ method: 'notifications/initialized' });
      const tools = [];
      let cursor;
      for (let page = 0; page < 50; page++) {
        const res = await request('tools/list', cursor ? { cursor } : {});
        tools.push(...(res?.tools || []));
        cursor = res?.nextCursor;
        if (!cursor) break;
      }
      finish(null, tools);
    })().catch((err) => finish(err));
  });
}

/** Estimated tokens of tool definitions as an agent sends them: name, description, input schema. */
export function toolTokens(tools) {
  return tools.reduce((n, t) => n + estimateJson({ name: t.name, description: t.description || '', input_schema: t.inputSchema || {} }), 0);
}

/** With Claude Code's tool search, each request lists deferred tool names only. */
export function deferredTokens(serverName, tools) {
  return tools.reduce((n, t) => n + Math.ceil(`mcp__${serverName}__${t.name}`.length / JSON_CHARS_PER_TOKEN) + 1, 0);
}

/** Probe every stdio server item in place (a few at a time); identical servers run once. */
export async function probeAll(items, { cwd, env, timeoutMs, version, concurrency = 4, onResult } = {}) {
  const runs = new Map();
  const targets = items.filter((it) => it.kind === 'mcp' && it.server.transport === 'stdio');
  const queue = [...targets];
  const sig = (s) => JSON.stringify([s.command, s.args, s.env, s.cwd]);
  const worker = async () => {
    for (let it; (it = queue.shift()); ) {
      const k = sig(it.server);
      if (!runs.has(k)) runs.set(k, listTools(it.server, { cwd, env, timeoutMs, version }).then((tools) => ({ tools }), (error) => ({ error })));
      const r = await runs.get(k);
      if (r.error) {
        it.probeError = r.error.message;
      } else {
        it.tools = r.tools.map((t) => ({ name: t.name, tokens: toolTokens([t]) })).sort((a, b) => b.tokens - a.tokens);
        it.tokens = toolTokens(r.tools);
        it.deferredTokens = deferredTokens(it.server.name, r.tools);
      }
      onResult?.(it);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
}
