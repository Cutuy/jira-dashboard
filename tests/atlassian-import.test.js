const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { boardSource, collectAtlassian } = require('../importers/atlassian-source');
const { importAtlassian } = require('../importers/atlassian-local');
const { restoreArchivedJiraBoards } = require('../importers/jira-board-archive');

const boardUrl = 'https://example.atlassian.net/jira/software/projects/ABC/boards/42?filter=&groupBy=none';
const source = boardSource(boardUrl);
const board = {
  id: 42,
  name: 'ABC board',
  columnConfig: { columns: [
    { name: 'Automated review', statuses: [{ id: '2', category: 'indeterminate' }] },
    { name: 'Manual review', statuses: [{ id: '3', category: 'new' }] },
    { name: 'Empty column', statuses: [] },
  ] },
};
const space = { id: '10', key: 'ABC', name: 'ABC docs', homepageId: '11' };
const issue = i => ({
  id: String(i), key: 'ABC-' + i, fields: {
    summary: 'Check item ' + i,
    status: { id: '3', name: 'Manual review', statusCategory: { key: 'new' } },
    description: 'Issue text',
    comment: i === 1 ? { total: 2, comments: [] } : { total: 0, comments: [] },
  },
});

test('collects all pages, concurrent issue batches and their history through MCP reads', async () => {
  const first = Array.from({ length: 6 }, (_, i) => issue(i + 1));
  const entries = Array.from({ length: 5 }, (_, i) => ({ id: String(i + 11), title: 'Page ' + i, type: 'page', status: 'current' }));
  const calls = [];
  const callTool = async (tool, args) => {
    const { name = tool, inputs = args } = args;
    calls.push([name, inputs]);
    let data;
    switch (name) {
      case 'getJiraBoardConfig': data = board; break;
      case 'getConfluenceSpace': data = space; break;
      case 'getJiraBoardIssueData':
        data = inputs.nextPageToken ? { issues: [issue(7)], isLast: true }
          : { issues: first, nextPageToken: 'page-2', isLast: false };
        break;
      case 'listJiraIssueChangelogs':
        data = { values: [{ id: inputs.issueIdOrKey + '-change' }], total: 1, isLast: true };
        break;
      case 'listJiraIssueComments':
        data = { comments: [{ id: String(inputs.startAt), body: 'Comment ' + inputs.startAt }], total: 2 };
        break;
      case 'listConfluenceContent':
        if (inputs.type !== 'page' || inputs.status === 'archived') data = { results: [] };
        else if (inputs.cursor) data = { results: entries.slice(2) };
        else data = { results: entries.slice(0, 2), _links: { next: '/wiki/api/v2/pages?cursor=second' } };
        break;
      case 'getConfluenceContentDescendants':
      case 'listConfluenceAttachments': data = { results: [] }; break;
      case 'listConfluenceComments': data = { comments: [] }; break;
      case 'getConfluenceContent':
        data = { body: { format: 'markdown', value: 'Document ' + inputs.content_id } };
        break;
      default: throw new Error('Unexpected MCP call: ' + name);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ data }) + '\n\nConnector notice' }] };
  };
  const snapshot = await collectAtlassian(source, callTool);
  assert.deepEqual(snapshot.issues.map(record => record.issue.key), first.map(item => item.key).concat('ABC-7'));
  assert.equal(snapshot.issues[0].comments.length, 2);
  assert.equal(snapshot.issues[6].history[0].id, 'ABC-7-change');
  assert.deepEqual(snapshot.documents.map(doc => doc.content.body.value), entries.map(entry => 'Document ' + entry.id));
  assert.ok(calls.some(([name, inputs]) => name === 'getJiraBoardIssueData' && inputs.boardId === 42 && inputs.dataset === 'all'));
  assert.deepEqual(snapshot.warnings, []);
});

test('imports tickets, nested documents and attachment bytes, preserving existing data on repeat', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard Jira import '));
  const oldProject = process.env.JIRA_DASHBOARD_PROJECT_DIR;
  process.env.JIRA_DASHBOARD_PROJECT_DIR = project;
  const db = require('../db');
  t.after(async () => {
    db.close();
    if (oldProject === undefined) delete process.env.JIRA_DASHBOARD_PROJECT_DIR;
    else process.env.JIRA_DASHBOARD_PROJECT_DIR = oldProject;
    await fs.rm(project, { recursive: true, force: true });
  });
  const bytes = Buffer.from('%PDF-1.4\nfixture');
  const snapshot = {
    version: 1, source, board, space, warnings: [],
    issues: [{ issue: issue(1), comments: [{ body: 'A reviewed comment' }], worklogs: [], history: [{ id: 'change-1' }] }],
    documents: [
      { entry: { id: '12', title: 'Planning', type: 'folder' }, parentId: '11' },
      { entry: { id: '13', title: 'Release notes', type: 'page' }, parentId: '12', content: { body: { format: 'markdown', value: '# Release notes' } } },
    ],
    files: [{ id: 'att14', owner: { type: 'confluence', id: '13' }, name: 'Guide.pdf', size: bytes.length, downloadUrl: 'https://api.media.atlassian.com/file/example' }],
  };
  let requests = 0;
  const fetchFile = async url => {
    assert.equal(url.hostname, 'api.media.atlassian.com');
    requests++;
    return new Response(bytes);
  };
  const result = await importAtlassian(snapshot, project, db, { fetchFile });
  assert.equal(result.created, 1);
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.warnings, []);
  const doc = path.join(result.archive, 'Confluence ABC', '12 Planning', '13 Release notes');
  assert.match(await fs.readFile(path.join(doc, 'Content.md'), 'utf8'), /# Release notes/);
  assert.deepEqual(await fs.readFile(path.join(doc, 'Attachments', 'att14 Guide.pdf')), bytes);
  const record = JSON.parse(await fs.readFile(path.join(result.archive, 'Jira', 'ABC-1', 'Issue.json'), 'utf8'));
  assert.equal(record.history.length, 1);
  const [ticket] = db.getAllTickets();
  assert.equal(ticket.stage, 'review');
  const [layout] = db.getJiraBoards();
  assert.deepEqual(layout.columns.map(column => column.name), ['Automated review', 'Manual review', 'Empty column']);
  assert.equal(layout.tickets[0].ticketId, ticket.id);
  assert.equal(layout.tickets[0].statusId, '3');
  assert.match(db.getTicket(ticket.id).content, /A reviewed comment/);
  db.updateTicket(ticket.id, { title: 'Locally edited' });

  const repeated = await importAtlassian(snapshot, project, db, { fetchFile });
  assert.equal(repeated.created, 0);
  assert.equal(repeated.skipped, 1);
  assert.equal(repeated.writtenFiles, 0);
  assert.equal(db.getTicket(ticket.id).title, 'Locally edited');
  assert.equal(requests, 1);

  // Simulate a dashboard that imported the archive before layout storage existed.
  const Database = require('better-sqlite3');
  const metadata = new Database(path.join(project, '.jira-dashboard', 'store.db'));
  metadata.pragma('foreign_keys = ON');
  metadata.exec('DELETE FROM jira_boards');
  metadata.close();
  assert.deepEqual(db.getJiraBoards(), []);
  restoreArchivedJiraBoards(project, db);
  restoreArchivedJiraBoards(project, db);
  assert.deepEqual(db.getJiraBoards(), [layout]);
  assert.equal(db.getTicket(ticket.id).title, 'Locally edited');

  const changedBoard = { ...board, columnConfig: { columns: [
    { name: 'Ready for release', statuses: [] },
    ...board.columnConfig.columns,
  ] } };
  await importAtlassian({ ...snapshot, board: changedBoard }, project, db, { fetchFile });
  assert.equal(db.getJiraBoards()[0].columns[0].name, 'Ready for release');
  assert.equal(db.getTicket(ticket.id).title, 'Locally edited');
});
