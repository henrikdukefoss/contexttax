import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AGENTS, agentName } from './agents.js';
import { isDir } from './lib/fs.js';
import { loadPrices } from './pricing.js';
import { probeAll } from './probe.js';
import { renderBadge, badgeMarkdown, THEMES } from './render/badge.js';
import { renderTerminal } from './render/terminal.js';
import { buildReport, DEFAULT_MODELS } from './report.js';
import { makeContext, scan } from './scan.js';
import { fmtK, JSON_CHARS_PER_TOKEN, TEXT_CHARS_PER_TOKEN } from './tokens.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `contexttax ${VERSION} - the tokens every coding-agent request carries before you type

Usage: npx github:henrikdukefoss/contexttax [dir] [options]

Options:
  --probe-mcp          start configured stdio MCP servers locally and count their tool schemas
                       (runs the commands in your MCP config; off by default)
  --probe-timeout <s>  seconds to wait for each MCP server (default 20)
  --badge [file]       write an SVG README badge (default context-tax.svg in the repo root)
  --badge-theme <name> calm (default) or navy
  --json               print the data as JSON
  --agent <id>         one agent only (${AGENTS.map((a) => a.id).join(', ')})
  --models <ids>       models for the cost table, comma separated
                       (default ${DEFAULT_MODELS.join(',')})
  --repo-only          ignore your user-level config (~/.claude, ~/.codex, ...)
  --offline            use the bundled price table (no network at all)
  --no-color           plain output
  -h, --help           show this help
  -v, --version        show version

Reads files on this machine only and uploads nothing. The only network request is the
public LiteLLM price list (cached 24h in ~/.cache/contexttax).`;

export function parseArgs(argv) {
  const o = { json: false, offline: false, color: true, probe: false, probeTimeout: 20, repoOnly: false, badgeTheme: 'calm' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v == null || v === '') throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--json': o.json = true; break;
      case '--badge':
        if (inline != null) o.badge = inline;
        else if (argv[i + 1] && !argv[i + 1].startsWith('-') && /\.svg$/i.test(argv[i + 1])) o.badge = argv[++i];
        else o.badge = true;
        break;
      case '--badge-theme': o.badgeTheme = value(); break;
      case '--probe-mcp': o.probe = true; break;
      case '--probe-timeout': {
        o.probeTimeout = Number(value());
        if (!(o.probeTimeout > 0)) throw new Error('--probe-timeout needs a number of seconds');
        break;
      }
      case '--agent': o.agent = value(); break;
      case '--models': o.models = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--repo-only': o.repoOnly = true; break;
      case '--offline': o.offline = true; break;
      case '--no-color': o.color = false; break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      default:
        if (a.startsWith('-') || o.dir) throw new Error(`unknown option ${a} (see --help)`);
        o.dir = a;
    }
  }
  return o;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    console.error(`contexttax: ${err.message}`);
    return 2;
  }
  if (o.help) return console.log(HELP), 0;
  if (o.version) return console.log(VERSION), 0;
  const fail = (msg) => (console.error(`contexttax: ${msg}`), 2);
  if (o.agent && !AGENTS.some((a) => a.id === o.agent)) return fail(`unknown agent ${o.agent} (known: ${AGENTS.map((a) => a.id).join(', ')})`);
  if (!THEMES[o.badgeTheme]) return fail(`unknown badge theme "${o.badgeTheme}" (use ${Object.keys(THEMES).join(' or ')})`);
  const dir = resolve(o.dir || '.');
  if (!isDir(dir)) return fail(`not a folder: ${dir}`);

  const log = (s) => console.error(s);
  const ctx = makeContext({ dir, env });
  const found = scan(ctx);
  const pricesP = loadPrices({ offline: o.offline, env });

  if (o.probe) {
    const n = found.items.filter((it) => it.kind === 'mcp' && it.server.transport === 'stdio').length;
    if (n) log(`probing ${n} MCP server${n > 1 ? 's' : ''} (starting them locally, timeout ${o.probeTimeout}s each)...`);
    await probeAll(found.items, {
      cwd: ctx.root,
      env,
      timeoutMs: o.probeTimeout * 1000,
      version: VERSION,
      onResult: (it) => log(it.tools ? `  ${it.label}: ${it.tools.length} tools, ~${fmtK(it.tokens)} tokens` : `  ${it.label}: ${it.probeError}`),
    });
  }

  const prices = await pricesP;
  if (prices.note) log(`note: ${prices.note}`);
  const report = buildReport({ ctx, scan: found, prices, models: o.models, repoOnly: o.repoOnly, agent: o.agent, version: VERSION, probed: o.probe });

  if (o.json) {
    console.log(JSON.stringify(toJson(report), null, 2));
  } else {
    const color = o.color && process.stdout.isTTY && !env.NO_COLOR;
    process.stdout.write('\n' + renderTerminal(report, { color }) + '\n');
  }

  if (o.badge) {
    const file = o.badge === true ? join(ctx.root, 'context-tax.svg') : resolve(o.badge);
    writeFileSync(file, renderBadge(report.badge.tokens, { theme: o.badgeTheme }));
    const rel = relative(ctx.root, file);
    const link = !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : file;
    log(`wrote ${file}`);
    log(`badge: ${report.badge.agent ? `${agentName(report.badge.agent)}, ` : ''}files in this repo only (your user config is left out)`);
    log('paste into your README:');
    log(`  ${badgeMarkdown(link, report.badge.tokens)}`);
  }
  return 0;
}

export function toJson(report) {
  const round = (n) => (n == null ? null : Math.round(n * 1e6) / 1e6);
  return {
    version: report.version,
    repo: report.repo,
    estimate: {
      method: 'character ratio, no tokenizer',
      textCharsPerToken: TEXT_CHARS_PER_TOKEN,
      jsonCharsPerToken: JSON_CHARS_PER_TOKEN,
    },
    typicalRequest: report.typical,
    claudeCodeToolSearch: !report.toolSearchOff,
    mcpProbed: report.probed,
    repoOnly: report.repoOnly,
    headline: report.headline && { ...report.headline, share: round(report.headline.share) },
    badge: report.badge,
    agents: report.agents.map((a) => ({ ...a, share: round(a.share) })),
    items: report.items.map((it) => ({
      kind: it.kind,
      label: it.label,
      path: it.path,
      scope: it.scope,
      tokens: it.tokens,
      agents: [...it.agents],
      ...(it.importedBy && { importedBy: it.importedBy }),
      ...(it.children && { count: it.count, onDemand: it.onDemand, children: it.children }),
      ...(it.server && {
        server: { name: it.server.name, transport: it.server.transport, command: it.server.command, url: it.server.url },
        tools: it.tools ?? null,
        deferredTokens: it.deferredTokens ?? null,
        probeError: it.probeError ?? null,
      }),
      ...(it.notes?.length && { notes: it.notes }),
    })),
    costPer1000Requests: report.costs.map((c) => ({ ...c, cacheReadPer1k: round(c.cacheReadPer1k), freshInputPer1k: round(c.freshInputPer1k) })),
    prices: { source: report.prices.source, fetchedAt: new Date(report.prices.fetchedAt).toISOString() },
    tips: report.tips,
  };
}
