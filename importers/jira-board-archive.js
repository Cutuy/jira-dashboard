const fs = require('node:fs');
const path = require('node:path');
const { boardSource } = require('./atlassian-source');
const { jiraBoardLayout, jiraTicketPlacement } = require('./jira-board');

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

function directories(folder) {
  if (!statIfPresent(folder)?.isDirectory()) return [];
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name);
}

function readRecord(file) {
  if (!statIfPresent(file)?.isFile()) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return null;
  }
}

function restoreArchivedJiraBoards(projectDir, db) {
  // The original importer saved Jira's layout and issue statuses in Files.
  // Restore placement for those existing tickets without downloading again.
  const projectData = path.join(projectDir, '.jira-dashboard');
  const reference = path.join(projectData, 'reference');
  if (!statIfPresent(projectData)?.isDirectory() || !statIfPresent(reference)?.isDirectory()) return;
  const archives = path.join(reference, 'Atlassian');
  const known = new Set(db.getJiraBoards().map(board => board.id));
  for (const hostname of directories(archives)) {
    if (!/^[a-z0-9.-]+\.atlassian\.net$/i.test(hostname)) continue;
    const site = path.join(archives, hostname);
    for (const archive of directories(site)) {
      const match = archive.match(/^([A-Z][A-Z0-9_-]*) board ([1-9][0-9]*)$/);
      if (!match) continue;
      const source = boardSource('https://' + hostname + '/jira/software/projects/' + match[1] + '/boards/' + match[2]);
      const boardId = source.cloudId + ':' + source.boardId;
      if (known.has(boardId)) continue;
      const jira = path.join(site, archive, 'Jira');
      if (!statIfPresent(jira)?.isDirectory()) continue;
      const board = readRecord(path.join(jira, 'Board.json'));
      if (Number(board?.id) !== source.boardId || !Array.isArray(board?.columnConfig?.columns)) continue;
      const tickets = [];
      for (const name of directories(jira)) {
        if (!/^[A-Z][A-Z0-9_-]*-[0-9]+$/i.test(name)) continue;
        const issue = readRecord(path.join(jira, name, 'Issue.json'))?.issue;
        if (issue?.key === name) tickets.push(jiraTicketPlacement(issue, source, board));
      }
      db.restoreJiraBoard(jiraBoardLayout(source, board), tickets);
      known.add(boardId);
    }
  }
}

module.exports = { restoreArchivedJiraBoards };
