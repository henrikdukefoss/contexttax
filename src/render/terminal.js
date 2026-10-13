import { agentOrder, agentShort } from '../agents.js';
import { fmtInt, JSON_CHARS_PER_TOKEN, TEXT_CHARS_PER_TOKEN } from '../tokens.js';

const W = 78;

export function wrap(text, width = W, indent = '') {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (indent + line + ' ' + word).length > width) {
      out.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out;
}

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s, n) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const clip = (s, n) => (s.length <= n ? s : '...' + s.slice(s.length - n + 3));
const pct = (x) => (x > 0 && x < 0.0005 ? '<0.1%' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const usd = (x) => (x >= 100 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toFixed(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(it, report) {
  const subs = [];
  let label = it.label;
  switch (it.kind) {
    case 'import':
      subs.push(`@-imported by ${it.importedBy}`);
      break;
    case 'memory':
      subs.push(`${it.path.replace(/projects\/[^/]+\/memory/, 'projects/<this repo>/memory')}, first 200 lines`);
      break;
    case 'rules':
    case 'skills':
    case 'commands':
    case 'subagents': {
      const unit = { rules: 'rule', skills: 'skill', commands: 'command', subagents: 'subagent' }[it.kind];
      label = `${it.label} (${plural(it.count, unit)})`;
      if (it.onDemand) subs.push(`plus ${it.onDemand} that load${it.onDemand === 1 ? 's' : ''} on demand only`);
      break;
    }
    case 'mcp': {
      label = `MCP ${it.label}${it.tools ? ` (${plural(it.tools.length, 'tool')})` : ''}`;
      const s = it.server;
      let status;
      if (it.tools) status = 'probed';
      else if (it.probeError) status = `probe failed: ${it.probeError}`;
      else if (s.transport !== 'stdio') status = `remote (${s.transport}), not probed`;
      else status = 'not measured, see --probe-mcp';
      subs.push(`${it.path}, ${status}`);
      if (it.tools && deferredFor(it, report)) subs.push(`Claude Code: ${fmtInt(it.deferredTokens)} tokens per request, tool search loads the schemas on demand`);
      break;
    }
  }
  for (const n of it.notes || []) subs.push(n);
  if (it.scope === 'user' && !label.startsWith('~') && !subs.some((s) => s.startsWith('~'))) subs.push('your user config, not the repo');
  return { label, subs };
}

const deferredFor = (it, report) => it.kind === 'mcp' && it.tokens != null && it.agents.has('claude-code') && !report.toolSearchOff;

// column layout, 78 wide: label | tokens | loaded by
const C1 = 38;
const C2 = 8;
const GAP = '   ';
const C3 = W - C1 - C2 - GAP.length;

export function renderTerminal(report, { color = false } = {}) {
  const b = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const out = [];
  const head = report.headline;
  const tag = `contexttax ${report.version}`;
  out.push(`${b('CONTEXT TAX')}  ${report.repo.name}${' '.repeat(Math.max(2, W - 13 - report.repo.name.length - tag.length))}${dim(tag)}`);
  out.push('');

  if (!head || (!head.tokens && !report.items.length)) {
    out.push(...wrap("No agent instruction files, rules, skills or MCP servers found for this folder. Every request starts with only the agent's own system prompt."));
    out.push('');
    out.push(...footer(report, dim));
    return out.join('\n') + '\n';
  }

  const lead = `${head.name} adds an estimated ${b(fmtInt(head.tokens))} tokens of instructions, tool schemas and descriptions to every request in this repo, before your prompt. That is ${b(pct(head.share))} of a typical coding-agent request.`;
  out.push(...wrapAnsi(lead));
  out.push('');

  out.push(b(`${pad('AGENT', C1)}${lpad('TOKENS', C2)}${GAP}SHARE OF A TYPICAL REQUEST`));
  for (const a of report.agents) {
    out.push(`${pad(a.name, C1)}${lpad(fmtInt(a.tokens), C2)}${GAP}${pad(pct(a.share), 6)}${a.unmeasured ? dim(`  + ${plural(a.unmeasured, 'MCP server')} not measured`) : ''}`.trimEnd());
  }
  out.push('');

  out.push(b(`${pad('LARGEST FIRST', C1)}${lpad('TOKENS', C2)}${GAP}LOADED BY`));
  for (const it of report.items) {
    const { label, subs } = describe(it, report);
    let ids = [...it.agents].sort((x, y) => agentOrder(x) - agentOrder(y));
    if (deferredFor(it, report)) ids = ids.filter((id) => id !== 'claude-code');
    const by = wrap(ids.length ? ids.map(agentShort).join(', ') : 'Claude Code, on demand', C3);
    out.push(`${pad(clip(label, C1 - 2), C1)}${lpad(it.tokens == null ? '?' : fmtInt(it.tokens), C2)}${GAP}${by[0]}`);
    for (const more of by.slice(1)) out.push(`${' '.repeat(C1 + C2)}${GAP}${more}`);
    for (const s of subs) out.push(...wrap(s, W, '  ').map(dim));
  }
  out.push('');

  if (report.costs.length && head.tokens) {
    out.push(b(`COST PER 1,000 REQUESTS (${head.name.toUpperCase()}, ${fmtInt(head.tokens)} TOKENS EACH)`));
    out.push(b(`${pad('MODEL', C1)}${lpad('CACHE READ', 12)}${lpad('UNCACHED', 12)}`));
    for (const c of report.costs) out.push(`${pad(c.model, C1)}${lpad(usd(c.cacheReadPer1k), 12)}${lpad(usd(c.freshInputPer1k), 12)}`);
    out.push(...wrap('List prices for input tokens. Cache read: the prefix is served from the provider cache. Uncached: a cold start or a changed prefix.').map(dim));
    out.push('');
  }

  if (report.tips.length) {
    out.push(b('WHAT TO DO'));
    report.tips.forEach((t, i) => {
      const lines = wrap(t, W, '   ');
      lines[0] = `${i + 1}. ${lines[0].slice(3)}`;
      out.push(...lines);
    });
    out.push('');
  }

  out.push(...footer(report, dim));
  return out.join('\n') + '\n';
}

function wrapAnsi(text) {
  // wrap on visible width; bold markers do not take up columns
  const plain = text.replace(/\x1b\[\d+m/g, '');
  if (plain === text) return wrap(text);
  const words = text.split(' ');
  const out = [];
  let line = '';
  let vis = 0;
  for (const w of words) {
    const len = w.replace(/\x1b\[\d+m/g, '').length;
    if (line && vis + 1 + len > W) {
      out.push(line);
      line = w;
      vis = len;
    } else {
      line = line ? `${line} ${w}` : w;
      vis += (vis ? 1 : 0) + len;
    }
  }
  if (line) out.push(line);
  return out;
}

function footer(report, dim) {
  const date = new Date(report.prices.fetchedAt).toISOString().slice(0, 10);
  const t = report.typical;
  const lines = [
    `Token counts are estimates: about ${TEXT_CHARS_PER_TOKEN} characters per token for text and ${JSON_CHARS_PER_TOKEN.toFixed(1)} for JSON schemas. The agent's own system prompt and built-in tools come on top.`,
    `Typical request: ${fmtInt(t.inputTokens)} input tokens, the median coding-agent request.`,
    `Source: ${t.source}, ${t.url.replace('https://', '')}`,
    `Prices: ${report.prices.source}, ${date}. Read on this machine; nothing was uploaded.`,
  ];
  if (report.repoOnly) lines.unshift('Only files in this repo are counted (--repo-only).');
  return [...lines.flatMap((l) => wrap(l)).map(dim), '', dim('contexttax, made by Standard Compute (standardcompute.com)')];
}
