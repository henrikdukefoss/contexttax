# contexttax

Every request a coding agent sends starts with the same block of text: your CLAUDE.md or
AGENTS.md, the files they import, skill and subagent descriptions, and the tool schemas of the
MCP servers you have configured. contexttax measures that block for each agent in a repo, lists
the largest pieces first and prices it per 1,000 requests.

```sh
npx github:henrikdukefoss/contexttax
```

Run it in a repo, or pass a folder. Needs Node 18 or newer and has no dependencies.
It reads files on your machine and sends nothing anywhere.

## Sample output

Rendered with `--probe-mcp` from the synthetic repo in `test/fixtures/repo`.

```text
CONTEXT TAX  sample-app                                       contexttax 0.1.0

Cursor adds an estimated 3,313 tokens of instructions, tool schemas and
descriptions to every request in this repo, before your prompt. That is 3.3%
of a typical coding-agent request.

AGENT                                   TOKENS   SHARE OF A TYPICAL REQUEST
Cursor                                   3,313   3.3%
OpenCode                                 3,298   3.3%
Claude Code                              2,148   2.2%    + 1 MCP server not measured
Codex CLI                                  384   0.4%
Gemini CLI                                  67   0.1%
GitHub Copilot                              45   <0.1%
Aider                                       19   <0.1%
Cline                                       18   <0.1%

LARGEST FIRST                           TOKENS   LOADED BY
MCP tracker (18 tools)                   2,867   OpenCode, Cursor
  .mcp.json, .cursor/mcp.json, opencode.json, probed
  Claude Code: 181 tokens per request, tool search loads the schemas on demand
docs/architecture.md                     1,193   Claude Code
  @-imported by CLAUDE.md
AGENTS.md                                  384   Claude Code, Codex CLI,
                                                 OpenCode, Cursor
  @-imported by CLAUDE.md
CLAUDE.md                                  163   Claude Code
.claude/skills (2 skills)                   91   Claude Code
  plus 1 that loads on demand only
.claude/rules (1 rule)                      55   Claude Code
  plus 1 that loads on demand only
.claude/agents (1 subagent)                 54   Claude Code
docs/style-guide.md                         47   OpenCode, Gemini CLI
  instructions in opencode.json
  @-imported by GEMINI.md
.github/copilot-instructions.md             45   Copilot
.cursor/rules (2 rules)                     44   Cursor
  plus 1 that loads on demand only
.claude/commands (1 command)                27   Claude Code
GEMINI.md                                   20   Gemini CLI
CONVENTIONS.md                              19   Aider
  only when passed with --read
.clinerules (1 rule)                        18   Cline
.cursorrules                                18   Cursor
MCP docs-search                              ?   Claude Code
  .mcp.json, remote (http), not probed

COST PER 1,000 REQUESTS (CURSOR, 3,313 TOKENS EACH)
MODEL                                   CACHE READ    UNCACHED
claude-opus-5-5                              $0.66      $13.25
claude-sonnet-5-5                            $0.33       $6.63
gpt-6-sol                                    $0.66       $6.63
gpt-6-luna                                   $0.03       $0.33
glm-5.3                                      $0.86       $4.64
List prices for input tokens. Cache read: the prefix is served from the
provider cache. Uncached: a cold start or a changed prefix.

WHAT TO DO
1. The tracker MCP server adds 2.9K tokens to every OpenCode and Cursor
   request (18 tools). If this repo rarely needs it, remove it from
   .cursor/mcp.json and opencode.json. Claude Code already loads it on demand
   with tool search.
2. docs/architecture.md is @-imported by CLAUDE.md and adds 1.2K tokens to
   every Claude Code request. Mention the path without the @ and the agent
   opens it only when it needs it.
3. AGENTS.md and CLAUDE.md repeat about 67 tokens of the same lines, and
   Claude Code loads both. Keep one copy.

Token counts are estimates: about 3.7 characters per token for text and 3.0
for JSON schemas. The agent's own system prompt and built-in tools come on
top.
Typical request: 99,554 input tokens, the median coding-agent request.
Source: Standard Compute, The Agent Burn Index, October 2026,
standardcompute.com/agent-burn-index
Prices: LiteLLM (bundled), 2026-10-13. Read on this machine; nothing was
uploaded.

contexttax, made by Standard Compute (standardcompute.com)
```

## Usage

```sh
npx github:henrikdukefoss/contexttax                  # this folder
npx github:henrikdukefoss/contexttax path/to/repo     # another folder
npx github:henrikdukefoss/contexttax --probe-mcp      # also count MCP tool schemas
npx github:henrikdukefoss/contexttax --badge          # write context-tax.svg for your README
npx github:henrikdukefoss/contexttax --json           # data only
```

| Option | Meaning |
| --- | --- |
| `--probe-mcp` | start each configured stdio MCP server locally, ask it for its tools, stop it, and count the tool schemas |
| `--probe-timeout <s>` | seconds to wait for each server (default 20) |
| `--badge [file]` | write an SVG badge (default `context-tax.svg` in the repo root) and print the Markdown to paste |
| `--badge-theme <name>` | `calm` (default) or `navy` |
| `--json` | print everything as JSON |
| `--agent <id>` | one agent only: `claude-code`, `codex`, `opencode`, `cursor`, `gemini-cli`, `cline`, `copilot`, `aider` |
| `--models <ids>` | models for the cost table, comma separated (default `claude-opus-5-5,claude-sonnet-5-5,gpt-6-sol,gpt-6-luna,glm-5.3`) |
| `--repo-only` | leave out your user-level config (`~/.claude`, `~/.codex`, ...) |
| `--offline` | use the bundled price table and make no network request |
| `--no-color` | plain terminal output |

Progress and notes go to stderr, so `--json` output stays clean.

## What it counts

Only what an agent loads into every request. Files an agent opens on demand are not part of
the tax and are left out.

| Agent | Loaded with every request |
| --- | --- |
| Claude Code | see the list below |
| Codex CLI | `AGENTS.md` (or `AGENTS.override.md`) from the repo root down to this folder, `~/.codex/AGENTS.md`, MCP servers from `~/.codex/config.toml` and `.codex/config.toml` |
| OpenCode | `AGENTS.md` (or `CLAUDE.md` when there is none), `~/.config/opencode/AGENTS.md` (or `~/.claude/CLAUDE.md`), files listed in `instructions`, MCP servers from `opencode.json(c)` |
| Cursor | `.cursorrules`, `AGENTS.md`, `.cursor/rules` with `alwaysApply: true` (whole rule) or a description and no globs (description only), MCP servers from `.cursor/mcp.json` and `~/.cursor/mcp.json` |
| Gemini CLI | `GEMINI.md` from this folder up to the repo root, `~/.gemini/GEMINI.md`, `@path` imports, MCP servers from `.gemini/settings.json` and `~/.gemini/settings.json` |
| Cline | `.clinerules` (a file, or a folder of rules without `paths:` frontmatter) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Aider | `CONVENTIONS.md` and files listed under `read:` in `.aider.conf.yml` (Aider loads them only when they are passed with `--read` or listed there) |

Claude Code, following its [memory](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills),
[subagents](https://code.claude.com/docs/en/sub-agents) and [MCP](https://code.claude.com/docs/en/mcp) docs:

- `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` in this folder and every folder above it,
  `~/.claude/CLAUDE.md` and the managed policy file
- `@path` imports in those files, up to four hops, ignoring code spans and code blocks
- `.claude/rules/**/*.md` and `~/.claude/rules` without `paths:` frontmatter
- the first 200 lines of the project's auto memory `MEMORY.md`
- skill names and descriptions from `.claude/skills/*/SKILL.md` and `~/.claude/skills`, capped
  at 1,536 characters each, skipping skills with `disable-model-invocation: true`
- descriptions of custom commands in `.claude/commands`
- subagent descriptions from `.claude/agents` and `~/.claude/agents`
- MCP servers from `.mcp.json` and `~/.claude.json` (user and local scope)

A file several agents load, such as `AGENTS.md`, is one row with all of them listed. Files from
your user config are counted in the report and marked as such. Subfolder `CLAUDE.md` files,
path-scoped rules, Cursor rules with globs and full skill bodies load on demand and are not
counted.

Not counted yet: plugins and their skills, Claude.ai connectors, Cline's global rules, Windsurf,
Amp, Goose and Continue. Pull requests with a fixture are welcome.

## MCP servers

By default contexttax lists the MCP servers configured for the repo and for you, and runs
nothing. Their tool schemas can be the largest part of the tax, so `--probe-mcp` measures them:
it starts each stdio server with the command, arguments and environment from your config, sends
`initialize` and `tools/list`, and stops it. That runs the same commands your agent would run.
Remote (http and sse) servers are never contacted and stay unmeasured.

Claude Code defers MCP tool definitions with tool search by default: each request carries the
tool names, and a full schema is loaded when a tool is needed. contexttax counts Claude Code's
share that way, and counts the full schemas when `ENABLE_TOOL_SEARCH=false` is set in the
environment or in `.claude/settings.json`. Other agents are counted with the full schemas, as
they send them with each request.

## Badge

```sh
npx github:henrikdukefoss/contexttax --probe-mcp --badge
```

<p>
  <img src="docs/sample-badge.svg" alt="context tax: 3.3K tokens/request">
  <img src="docs/sample-badge-navy.svg" alt="context tax: 3.3K tokens/request, navy theme">
</p>

The badge shows tokens per request for the agent that loads the most, counting only files that
are in the repo. Your own `~/.claude` and `~/.codex` setup is left out. Without `--probe-mcp`
the repo's MCP tool schemas are not included. In the default theme the value is green below
5K, brass up to 20K and brick red above; `--badge-theme navy` is navy and brass at every size.
Commit the SVG and paste the printed Markdown into your README:

```md
[![context tax: 3.3K tokens/request](context-tax.svg)](https://github.com/henrikdukefoss/contexttax)
```

Run it again after you trim your instructions to update the number.

## How the numbers are worked out

- Token counts are estimates. No tokenizer is bundled, to stay dependency free and because each
  model family tokenizes differently. contexttax counts about 3.7 characters per token for text,
  3.0 for JSON structure and one token per CJK character. Exact counts for your model will differ.
- MCP tools are counted as an agent sends them: name, description and input schema.
- The agent's own system prompt and built-in tools come on top and are not counted.
- Share of a typical request divides by 99,554 input tokens: the median coding-agent request
  measured on Standard Compute's gateway, published in
  [The Agent Burn Index, October 2026](https://standardcompute.com/agent-burn-index).
- Cost per 1,000 requests is the token count times each model's list price for cache reads
  (the prefix served from the provider cache; the same index finds 87% of coding-agent input
  tokens are cache reads) and for uncached input.
  Prices come from LiteLLM's public [model price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
  (MIT licensed), fetched at most once a day and cached in `~/.cache/contexttax`. `--offline`,
  or a failed fetch with no cache, uses a snapshot bundled in `src/prices-fallback.json`.

## Privacy

- Everything runs locally. Files are read and nothing is copied or uploaded.
- The one network request fetches the public price list from raw.githubusercontent.com.
  `--offline` makes no request at all.
- Nothing is executed unless you pass `--probe-mcp`, and then only the MCP servers in your own
  config, on your machine.
- `--json` leaves out MCP server arguments and environment values, which can hold keys.
- The badge contains one number. Check the report before you paste it anywhere: it shows file
  paths and MCP server names.

## Contributing

```sh
git clone https://github.com/henrikdukefoss/contexttax
cd contexttax
npm test                    # node:test, no install step
node bin/contexttax.js .
```

- Detection lives in `src/scan.js`, the MCP probe in `src/probe.js`, the report in
  `src/report.js`.
- `test/fixtures/repo` is a synthetic repo with every supported file type and a small MCP server
  (`tools/tracker-mcp.mjs`); `test/fixtures/home` is a synthetic home folder. Never commit real
  config.
- `npm run sample` rebuilds `docs/sample-output.txt` and the sample badges from the fixtures.
- `npm run update-prices` refreshes the bundled price snapshot.
- Keep it dependency free.

## License

MIT

---

Made by [Standard Compute](https://standardcompute.com), which sells flat monthly plans for agent
workloads. The report footer names Standard Compute; the measuring works the same whichever
provider you use.
