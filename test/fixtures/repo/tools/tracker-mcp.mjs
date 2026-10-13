#!/usr/bin/env node
// Synthetic stdio MCP server for contexttax tests and the README sample.
// Speaks just enough MCP (initialize, tools/list) and exposes 18 made-up issue-tracker tools.
import { createInterface } from 'node:readline';

const id = { type: 'string', description: 'The issue key, for example SAMPLE-123. Case-insensitive.' };
const project = { type: 'string', description: 'Project key. Defaults to the project configured for this repository when omitted.' };
const text = (d) => ({ type: 'string', description: d });
const page = {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'Maximum number of results to return in one page.' },
  cursor: { type: 'string', description: 'Opaque cursor from a previous response to fetch the next page of results.' },
};
const filters = {
  status: { type: 'array', items: { type: 'string', enum: ['open', 'in_progress', 'in_review', 'blocked', 'done', 'closed'] }, description: 'Only issues in one of these workflow states.' },
  assignee: text('Username or email of the assignee. Use "me" for the current user and "none" for unassigned issues.'),
  labels: { type: 'array', items: { type: 'string' }, description: 'Only issues that carry all of these labels.' },
  updatedSince: { type: 'string', format: 'date-time', description: 'Only issues updated at or after this ISO 8601 timestamp.' },
};
const tool = (name, description, properties, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });

const tools = [
  tool('create_issue', 'Create a new issue in the tracker. Returns the created issue with its key, URL and initial status. Use this when the user asks to file a bug, task or feature request.', { project, title: text('Short summary of the issue, shown in lists.'), body: text('Full description in Markdown. Include steps to reproduce for bugs.'), type: { type: 'string', enum: ['bug', 'task', 'feature', 'chore'], description: 'Issue type.' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Priority. Defaults to medium.' }, labels: filters.labels, assignee: filters.assignee }, ['title']),
  tool('get_issue', 'Fetch one issue by key, including description, status, assignee, labels, linked pull requests and the latest comments.', { id, includeComments: { type: 'boolean', default: true, description: 'Include the 20 most recent comments.' } }, ['id']),
  tool('update_issue', 'Update fields on an existing issue. Only the fields you pass are changed. Returns the updated issue.', { id, title: text('New title.'), body: text('New Markdown description. Replaces the old one entirely.'), priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'New priority.' }, dueDate: { type: 'string', format: 'date', description: 'Due date as YYYY-MM-DD, or an empty string to clear it.' } }, ['id']),
  tool('search_issues', 'Search issues with a free-text query and optional filters. Results are sorted by relevance, then by last update. Use list_issues instead when there is no text query.', { query: text('Free-text query matched against titles, descriptions and comments.'), project, ...filters, ...page }, ['query']),
  tool('list_issues', 'List issues in a project with optional filters, newest first.', { project, ...filters, ...page }),
  tool('add_comment', 'Add a Markdown comment to an issue. Mentions like @username notify that user.', { id, body: text('Comment text in Markdown.'), internal: { type: 'boolean', default: false, description: 'Visible to team members only.' } }, ['id', 'body']),
  tool('list_comments', 'List comments on an issue, oldest first.', { id, ...page }, ['id']),
  tool('assign_issue', 'Assign an issue to a user, or unassign it.', { id, assignee: filters.assignee }, ['id', 'assignee']),
  tool('transition_issue', 'Move an issue to another workflow state. Fails when the transition is not allowed from the current state; the error lists the allowed states.', { id, status: { type: 'string', enum: ['open', 'in_progress', 'in_review', 'blocked', 'done', 'closed'], description: 'Target state.' }, resolution: text('Required when closing: fixed, duplicate, wont_fix or cannot_reproduce.') }, ['id', 'status']),
  tool('add_labels', 'Add one or more labels to an issue. Unknown labels are created.', { id, labels: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Labels to add.' } }, ['id', 'labels']),
  tool('remove_label', 'Remove a label from an issue.', { id, label: text('Label to remove.') }, ['id', 'label']),
  tool('link_pull_request', 'Link a pull request to an issue so its status shows on the issue.', { id, url: { type: 'string', format: 'uri', description: 'Full URL of the pull request.' } }, ['id', 'url']),
  tool('list_projects', 'List projects the current user can see, with their keys and default workflows.', { ...page }),
  tool('get_project', 'Fetch a project by key, including its workflow states, labels and members.', { project }, ['project']),
  tool('list_milestones', 'List milestones in a project with their due dates and progress.', { project, state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open', description: 'Which milestones to include.' }, ...page }),
  tool('create_milestone', 'Create a milestone in a project.', { project, title: text('Milestone title.'), dueDate: { type: 'string', format: 'date', description: 'Due date as YYYY-MM-DD.' }, description: text('Optional Markdown description.') }, ['title']),
  tool('get_user', 'Look up a user by username or email. Returns display name, username, email and team memberships.', { user: text('Username or email.') }, ['user']),
  tool('log_time', 'Log time spent on an issue for timesheets.', { id, minutes: { type: 'integer', minimum: 1, description: 'Minutes spent.' }, note: text('What the time was spent on.'), date: { type: 'string', format: 'date', description: 'Day the work happened, as YYYY-MM-DD. Defaults to today.' } }, ['id', 'minutes']),
];

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
console.error('tracker-mcp: ready'); // servers log to stderr
process.stdout.write('tracker-mcp starting\n'); // and some misbehave on stdout
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'tracker', version: '1.0.0' } } });
  else if (msg.method === 'tools/list') {
    // two pages, to exercise pagination
    const start = msg.params?.cursor ? 10 : 0;
    send({ id: msg.id, result: { tools: tools.slice(start, start + 10), ...(start ? {} : { nextCursor: 'p2' }) } });
  } else if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'not supported' } });
});
