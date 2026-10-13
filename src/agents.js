// Agents in report order. `short` is used in narrow table columns.
export const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', short: 'Claude Code' },
  { id: 'codex', name: 'Codex CLI', short: 'Codex CLI' },
  { id: 'opencode', name: 'OpenCode', short: 'OpenCode' },
  { id: 'cursor', name: 'Cursor', short: 'Cursor' },
  { id: 'gemini-cli', name: 'Gemini CLI', short: 'Gemini CLI' },
  { id: 'cline', name: 'Cline', short: 'Cline' },
  { id: 'copilot', name: 'GitHub Copilot', short: 'Copilot' },
  { id: 'aider', name: 'Aider', short: 'Aider' },
];

export const agentName = (id) => AGENTS.find((a) => a.id === id)?.name ?? id;
export const agentShort = (id) => AGENTS.find((a) => a.id === id)?.short ?? id;
export const agentOrder = (id) => {
  const i = AGENTS.findIndex((a) => a.id === id);
  return i < 0 ? 99 : i;
};
