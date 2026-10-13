import { AGENTS, agentName, agentOrder } from './agents.js';
import { findPrice } from './pricing.js';
import { estimateText, fmtK } from './tokens.js';

// Standard Compute, The Agent Burn Index, October 2026: median input tokens per coding-agent request.
export const TYPICAL = {
  inputTokens: 99554,
  source: 'Standard Compute, The Agent Burn Index, October 2026',
  url: 'https://standardcompute.com/agent-burn-index',
};

export const DEFAULT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6-sol', 'gpt-6-luna', 'glm-5.3'];

const INSTRUCTION_KINDS = new Set(['instructions', 'import', 'memory']);

/** What one item costs one agent per request. MCP tools are deferred in Claude Code unless tool search is off. */
export function tokensFor(item, agent, toolSearchOff) {
  if (item.kind === 'mcp' && agent === 'claude-code' && !toolSearchOff && item.tokens != null) return item.deferredTokens ?? 0;
  return item.tokens;
}

function totals(items, toolSearchOff) {
  const out = [];
  for (const { id } of AGENTS) {
    const mine = items.filter((it) => it.agents.has(id));
    if (!mine.length) continue;
    const tokens = mine.reduce((n, it) => n + (tokensFor(it, id, toolSearchOff) ?? 0), 0);
    const unmeasured = mine.filter((it) => it.kind === 'mcp' && it.tokens == null).length;
    out.push({ id, name: agentName(id), tokens, share: tokens / TYPICAL.inputTokens, unmeasured, items: mine.length });
  }
  return out.sort((a, b) => b.tokens - a.tokens || agentOrder(a.id) - agentOrder(b.id));
}

export function costRows(tokens, table, models) {
  const rows = [];
  for (const model of models) {
    const p = findPrice(table, model);
    if (!p) continue;
    const fresh = p.input_cost_per_token;
    const cached = p.cache_read_input_token_cost ?? fresh;
    rows.push({ model, priceKey: p.key, cacheReadPer1k: tokens * cached * 1000, freshInputPer1k: tokens * fresh * 1000 });
  }
  return rows;
}

export function buildReport({ ctx, scan, prices, models = DEFAULT_MODELS, repoOnly = false, agent, version, probed = false }) {
  const { toolSearchOff } = scan;
  const items = (repoOnly ? scan.items.filter((it) => it.scope === 'repo') : scan.items).filter((it) => !agent || it.agents.has(agent));
  const agents = totals(items, toolSearchOff).filter((a) => !agent || a.id === agent);
  const headline = agents[0] || null;
  const repoAgents = totals(
    items.filter((it) => it.scope === 'repo'),
    toolSearchOff,
  ).filter((a) => !agent || a.id === agent);
  const badge = repoAgents[0] ? { agent: repoAgents[0].id, tokens: repoAgents[0].tokens } : { agent: null, tokens: 0 };
  const sorted = [...items].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.label.localeCompare(b.label));
  return {
    version,
    repo: { name: ctx.root.split(/[\\/]/).pop(), root: ctx.root, dir: ctx.target },
    typical: TYPICAL,
    toolSearchOff,
    probed,
    repoOnly,
    agents,
    headline,
    badge,
    items: sorted,
    costs: headline ? costRows(headline.tokens, prices.table, models) : [],
    prices: { source: prices.source, fetchedAt: prices.fetchedAt },
    tips: tips(sorted, toolSearchOff, probed),
  };
}

const and = (list) => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
const names = (ids) => and([...ids].sort((a, b) => agentOrder(a) - agentOrder(b)).map(agentName));

/** Actionable lines, biggest saving first. */
export function tips(items, toolSearchOff, probed) {
  const out = [];
  const add = (tokens, text) => out.push({ tokens, text });

  for (const it of items.filter((i) => i.kind === 'mcp' && i.tokens != null && i.tokens >= 1000)) {
    const full = [...it.agents].filter((a) => tokensFor(it, a, toolSearchOff) === it.tokens);
    const tools = it.tools ? ` (${it.tools.length} tools)` : '';
    if (full.length) {
      const files = [...new Set(it.sources.filter((s) => full.includes(s.agent)).map((s) => s.path))];
      const deferred = it.agents.has('claude-code') && !full.includes('claude-code') ? ' Claude Code already loads it on demand with tool search.' : '';
      add(it.tokens, `The ${it.label} MCP server adds ${fmtK(it.tokens)} tokens to every ${names(full)} request${tools}. If this repo rarely needs it, remove it from ${and(files)}.${deferred}`);
    } else {
      add(it.tokens / 10, `The ${it.label} MCP server has ${fmtK(it.tokens)} tokens of tool schemas${tools}. Claude Code loads them on demand with tool search, so keep ENABLE_TOOL_SEARCH on.`);
    }
  }
  const unmeasured = items.filter((i) => i.kind === 'mcp' && i.tokens == null);
  const stdio = unmeasured.filter((i) => i.server.transport === 'stdio' && !i.probeError);
  if (stdio.length && !probed) {
    add(5000, `${stdio.length} MCP server${stdio.length > 1 ? 's are' : ' is'} configured but not measured (${stdio.map((i) => i.label).join(', ')}). Run again with --probe-mcp to start ${stdio.length > 1 ? 'them' : 'it'} locally and count the tool schemas.`);
  }

  for (const it of items.filter((i) => INSTRUCTION_KINDS.has(i.kind) && i.tokens >= (i.kind === 'import' ? 1000 : 1500))) {
    // only Claude Code and Gemini CLI follow @imports; a file other agents load directly gets the general tip
    if (it.kind === 'import' && [...it.agents].every((a) => a === 'claude-code' || a === 'gemini-cli')) {
      add(it.tokens, `${it.path} is @-imported by ${it.importedBy} and adds ${fmtK(it.tokens)} tokens to every ${names(it.agents)} request. Mention the path without the @ and the agent opens it only when it needs it.`);
    } else if (it.kind === 'memory') {
      add(it.tokens, `Claude Code's auto memory adds ${fmtK(it.tokens)} tokens (the first 200 lines of MEMORY.md). Prune entries you no longer need with /memory.`);
    } else {
      add(it.tokens, `${it.path} adds ${fmtK(it.tokens)} tokens to every ${names(it.agents)} request. Keep the rules every task needs there and move reference material into docs the agent opens on demand.`);
    }
  }

  for (const g of items.filter((i) => i.kind === 'rules' && i.tokens >= 1000)) {
    const isCursor = g.label.includes('.cursor');
    add(g.tokens, isCursor
      ? `${g.count} Cursor rules in ${g.label} load on every request (${fmtK(g.tokens)} tokens). Set alwaysApply: false and give each rule a description or globs so it loads when relevant.`
      : `${g.count} rule files in ${g.label} load on every request (${fmtK(g.tokens)} tokens). Add paths: frontmatter to rules that apply to some files only; they then load on demand.`);
  }
  for (const g of items.filter((i) => (i.kind === 'skills' || i.kind === 'commands' || i.kind === 'subagents') && i.tokens >= 800)) {
    const top = g.children[0];
    const what = g.kind === 'subagents' ? 'subagent descriptions' : g.kind === 'skills' ? 'skill descriptions' : 'command descriptions';
    add(g.tokens, `${g.count} ${what} in ${g.label} add ${fmtK(g.tokens)} tokens. The longest is ${top.name} (${fmtK(top.tokens)}). A description only needs to say what it does and when to use it.`);
  }

  // the same lines loaded twice by one agent
  const docs = items.filter((i) => INSTRUCTION_KINDS.has(i.kind) && i.text);
  for (let a = 0; a < docs.length; a++) {
    for (let b = a + 1; b < docs.length; b++) {
      const both = [...docs[a].agents].filter((x) => docs[b].agents.has(x));
      if (!both.length) continue;
      const shared = sharedLines(docs[a].text, docs[b].text);
      const t = estimateText(shared.join('\n'));
      if (t >= 50) add(t, `${docs[a].path} and ${docs[b].path} repeat about ${fmtK(t)} tokens of the same lines, and ${names(both)} loads both. Keep one copy.`);
    }
  }
  return out.sort((x, y) => y.tokens - x.tokens).slice(0, 6).map((t) => t.text);
}

function sharedLines(a, b) {
  const norm = (t) => new Set(t.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l.length >= 30));
  const sb = norm(b);
  return [...norm(a)].filter((l) => sb.has(l));
}
