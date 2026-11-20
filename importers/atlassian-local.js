const { COPYFILE_EXCL } = require('node:fs').constants;
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { boardSource } = require('./atlassian-source');
const { jiraBoardLayout, jiraTicketPlacement, stageFor } = require('./jira-board');

function safeName(value, length = 65) {
  return String(value || 'Untitled').normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, length)
    .replace(/^[ .]+|[ .]+$/g, '') || 'Untitled';
}

function textBody(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value.value === 'string') return value.value;
  return JSON.stringify(value);
}

function toTicket(record, source, board) {
  const { issue, comments } = record;
  const { key, fields } = issue;
  if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_-]*-[0-9]+$/i.test(key) || !fields?.summary) {
    throw new Error('A source issue is missing a valid Jira key or summary.');
  }
  const sourceUrl = 'https://' + source.cloudId + '/browse/' + key;
  const originalStatus = fields.status?.name;
  const metadata = [
    'Jira: ' + sourceUrl,
    originalStatus && 'Status: ' + originalStatus,
    fields.issuetype?.name && 'Type: ' + fields.issuetype.name,
    fields.priority?.name && 'Priority: ' + fields.priority.name,
    fields.assignee?.displayName && 'Assignee: ' + fields.assignee.displayName,
    fields.labels?.length && 'Labels: ' + fields.labels.join(', '),
    fields.parent?.key && 'Parent: ' + fields.parent.key,
  ].filter(Boolean).join('\n');
  const commentText = comments.map(comment => {
    const author = comment.author?.displayName || comment.author?.name || 'Jira comment';
    const date = comment.created ? ' (' + comment.created + ')' : '';
    return author + date + '\n' + textBody(comment.body);
  }).join('\n\n');
  const now = new Date().toISOString();
  const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : now;
  return {
    ...jiraTicketPlacement(issue, source, board),
    title: key + ' — ' + fields.summary, sourceUrl, status: 'idle',
    content: [textBody(fields.description), metadata, commentText && 'Jira comments\n\n' + commentText].filter(Boolean).join('\n\n'),
    created_at: timestamp(fields.created), updated_at: timestamp(fields.updated || fields.created),
  };
}

function validateSnapshot(snapshot, source) {
  if (snapshot?.version !== 1 || snapshot.source?.boardUrl !== source.boardUrl
      || snapshot.source?.cloudId !== source.cloudId || snapshot.source?.spaceKey !== source.spaceKey
      || Number(snapshot.board?.id) !== source.boardId || !snapshot.space?.key
      || !['issues', 'documents', 'files', 'warnings'].every(key => Array.isArray(snapshot[key]))) {
    throw new Error('The import snapshot does not match this Jira board and Confluence space.');
  }
}

async function makeDirectory(root, parts) {
  for (const part of parts) {
    root = path.join(root, part);
    try { await fs.mkdir(root); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
    if (!(await fs.lstat(root)).isDirectory()) throw new Error('The import destination contains a linked folder or file.');
  }
  return root;
}

function documentPath(doc, entries, home) {
  const parts = [];
  const seen = new Set();
  while (doc) {
    const { id, title } = doc.entry;
    if (seen.has(String(id))) throw new Error('The Confluence folder tree contains a cycle.');
    seen.add(String(id));
    parts.unshift(safeName(id, 25) + ' ' + safeName(title, 45));
    const parentId = String(doc.parentId);
    doc = parentId === home ? undefined : entries.get(parentId);
  }
  return parts;
}

async function downloadFile(url, filename, expectedSize, source, fetchFile) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const trusted = url.hostname === source.cloudId || /(?:^|\.)atlassian\.com$|\.atl-paas\.net$/.test(url.hostname);
    if (!trusted || url.protocol !== 'https:' || url.port || url.username || url.password) {
      throw new Error('The download URL is outside Atlassian.');
    }
    const response = await fetchFile(url, { redirect: 'manual', signal: AbortSignal.timeout(180_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const destination = response.headers.get('location');
      if (!destination) throw new Error('Atlassian returned an empty redirect.');
      url = new URL(destination, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error('Atlassian download returned HTTP ' + response.status + '.');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filename));
    if (Number.isSafeInteger(expectedSize) && (await fs.stat(filename)).size !== expectedSize) {
      throw new Error('Downloaded file size differs from the attachment metadata.');
    }
    return;
  }
  throw new Error('The attachment exceeded Atlassian’s redirect limit.');
}

function attachmentName(file) {
  const safeExtension = safeName(path.extname(file.name).slice(1), 15);
  const name = safeName(path.parse(file.name).name);
  return safeName(file.id, 25) + ' ' + name + (path.extname(file.name) ? '.' + safeExtension : '');
}

async function importAtlassian(snapshot, projectDir, db, { fetchFile = fetch } = {}) {
  const source = boardSource(snapshot.source.boardUrl, snapshot.source.spaceKey);
  validateSnapshot(snapshot, source);
  const tickets = snapshot.issues.map(record => toTicket(record, source, snapshot.board));
  const project = await fs.realpath(projectDir);
  const data = await makeDirectory(project, ['.jira-dashboard']);
  const archive = await makeDirectory(data, ['reference', 'Atlassian', source.cloudId, source.projectKey + ' board ' + source.boardId]);
  const confluence = 'Confluence ' + safeName(snapshot.space.key, 40);
  const warnings = [...snapshot.warnings];
  const docsById = new Map(snapshot.documents.map(doc => [String(doc.entry.id), doc]));
  const scratch = await fs.mkdtemp(path.join(data, '.atlassian-import-'));
  let writtenFiles = 0;
  let skippedFiles = 0;
  let downloaded = 0;

  async function publish(parts, name, write) {
    const folder = await makeDirectory(archive, parts);
    const destination = path.join(folder, name);
    const staged = path.join(scratch, 'pending');
    try {
      const existing = await fs.lstat(destination).catch(err => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      if (existing) {
        if (!existing.isFile()) throw new Error('A file destination is a link or directory.');
        skippedFiles++;
        return false;
      }
      await write(staged);
      await fs.copyFile(staged, destination, COPYFILE_EXCL);
      writtenFiles++;
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      skippedFiles++;
      return false;
    } finally {
      await fs.rm(staged, { force: true });
    }
  }

  const writeFile = (parts, name, content) => publish(parts, name, dest => fs.writeFile(dest, content, { mode: 0o600 }));
  const writeJson = (parts, name, content) => writeFile(parts, name, JSON.stringify(content, null, 2) + '\n');
  const spacePath = [confluence];
  const home = String(snapshot.space.homepageId);
  try {
    await writeJson(['Jira'], 'Board.json', snapshot.board);
    await writeJson(spacePath, 'Space.json', snapshot.space);
    for (const record of snapshot.issues) {
      await writeJson(['Jira', safeName(record.issue.key)], 'Issue.json', record);
    }
    for (const doc of snapshot.documents) {
      const parts = [confluence, ...documentPath(doc, docsById, home)];
      await writeJson(parts, 'Source.json', doc);
      const body = doc.content?.body;
      if (typeof body?.value !== 'string') continue;
      if (body.format === 'markdown') {
        const link = 'https://' + source.cloudId + '/wiki/pages/viewpage.action?pageId=' + encodeURIComponent(doc.entry.id);
        await writeFile(parts, 'Content.md', '[Open in Confluence](' + link + ')\n\n' + body.value + '\n');
      } else if (['html', 'csv', 'svg'].includes(body.format)) {
        await writeFile(parts, 'Content.' + body.format, body.value);
      } else if (body.format === 'url') {
        await writeFile(parts, 'Link.txt', body.value + '\n');
      }
      if (typeof doc.html?.body?.value === 'string') await writeFile(parts, 'Content.html', doc.html.body.value);
    }

    for (const file of snapshot.files) {
      if (!file.downloadUrl) continue;
      const confluenceDoc = docsById.get(String(file.owner.id));
      const parts = file.owner.type === 'jira'
        ? ['Jira', safeName(file.owner.id), 'Attachments']
        : [confluence, ...documentPath(confluenceDoc, docsById, home), 'Attachments'];
      try {
        const saved = await publish(parts, attachmentName(file), dest =>
          downloadFile(new URL(file.downloadUrl), dest, file.size, source, fetchFile));
        if (saved) downloaded++;
      } catch (err) {
        warnings.push('Attachment ' + file.owner.id + '/' + file.name + ': ' + err.message);
      }
    }
    const ticketsResult = db.importNewTickets(tickets, jiraBoardLayout(source, snapshot.board));
    return { ...ticketsResult, writtenFiles, skippedFiles, downloaded, archive, warnings };
  } finally {
    await fs.rmdir(scratch);
  }
}

module.exports = { importAtlassian, stageFor, validateSnapshot };
