const CONTENT_FORMATS = {
  page: 'markdown', live_doc: 'markdown', blogpost: 'markdown',
  whiteboard: 'svg', database: 'csv', embed: 'url', smart_link: 'url',
  slide: null, folder: null,
};

function boardSource(value, spaceKey) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid Atlassian Jira board URL.'); }
  const match = url.pathname.match(/^\/jira\/software\/(?:projects|c\/projects)\/([A-Z][A-Z0-9_-]*)\/boards\/([1-9][0-9]*)\/?$/i);
  if (!match || url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net') || url.port || url.username || url.password) {
    throw new Error('Use an HTTPS Jira Software project board URL on atlassian.net.');
  }
  const projectKey = match[1].toUpperCase();
  const boardId = Number(match[2]);
  if (!Number.isSafeInteger(boardId)) throw new Error('The Jira board number is out of range.');
  if (spaceKey !== undefined && (typeof spaceKey !== 'string' || !/^[A-Z0-9_~-]+$/i.test(spaceKey))) {
    throw new Error('Use a Confluence space key or numeric ID.');
  }
  return { cloudId: url.hostname, boardUrl: url.origin + url.pathname, boardId, projectKey, spaceKey: spaceKey ?? projectKey };
}

function readResult(result, name) {
  if (result?.isError) throw new Error(name + ' returned an MCP error.');
  let payload = result?.structuredContent;
  if (!payload) {
    const content = result?.content?.find(block => block.type === 'text')?.text;
    if (!content) throw new Error(name + ' returned no data.');
    try {
      payload = JSON.parse(content);
    } catch {
      // The connected Atlassian app can append a notice after its JSON.
      try { payload = JSON.parse(content.split('\n')[0]); }
      catch { throw new Error(name + ' returned invalid or truncated JSON.'); }
    }
  }
  const data = payload?.data ?? payload;
  if (!data || payload.error || data.error || data.ok === false) throw new Error(name + ' could not read this resource.');
  return data;
}

function rows(data, property) {
  if (!Array.isArray(data?.[property])) throw new Error('Atlassian returned no ' + property + ' list.');
  return data[property];
}

async function readPages(readPage, first) {
  const seen = new Set();
  const result = [];
  let cursor = first;
  do {
    if (seen.has(cursor)) throw new Error('Atlassian returned a repeated pagination cursor.');
    seen.add(cursor);
    const { items, next } = await readPage(cursor);
    result.push(...items);
    cursor = next;
  } while (cursor !== undefined && cursor !== null && cursor !== '');
  return result;
}

function offsetPages(read, property) {
  return readPages(async startAt => {
    const data = await read(startAt);
    const items = rows(data, property);
    const offset = startAt + items.length;
    const more = data.isLast === false || (Number.isInteger(data.total) && offset < data.total);
    if (more && !items.length) throw new Error('Atlassian stopped before returning all ' + property + '.');
    return { items, next: more ? offset : null };
  }, 0);
}

function confluencePages(read, property = 'results') {
  return readPages(async cursor => {
    const data = await read(cursor);
    const nextLink = data._links?.next ?? data.links?.next;
    const match = typeof nextLink === 'string' && nextLink.match(/[?&]cursor=([^&#]+)/);
    if (nextLink && !match && !data.nextCursor) throw new Error('Confluence returned an unrecognized next-page link.');
    return { items: rows(data, property), next: data.nextCursor ?? (match ? decodeURIComponent(match[1]) : null) };
  });
}

async function eachBatch(items, size, work) {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map((item, index) => work(item, start + index)));
  }
}

async function collectAtlassian(source, callTool, progress = () => {}) {
  const { cloudId, boardId, spaceKey } = source;
  const warnings = [];
  const files = [];
  let resumeAfter = 0;
  async function call(name, params) {
    for (let attempt = 0; ; attempt++) {
      while (resumeAfter > Date.now()) {
        await new Promise(resolve => setTimeout(resolve, resumeAfter - Date.now()));
      }
      const result = await callTool(name, { cloudId, ...params }).catch(err => err);
      const failure = result instanceof Error ? result.message
        : result?.isError ? result.content?.find(block => block.type === 'text')?.text : '';
      if (/too many requests|rate.?limit|\b429\b/i.test(failure) && attempt < 3) {
        resumeAfter = Math.max(resumeAfter, Date.now() + 10_000 * 2 ** attempt);
        continue;
      }
      if (result instanceof Error) throw result;
      return readResult(result, params.name ?? name);
    }
  }
  const read = (name, inputs, view) => call('executeRead', { name, inputs, ...(view && { view }) });

  async function optional(label, work, fallback) {
    try { return await work(); }
    catch (err) {
      warnings.push(label + ': ' + err.message);
      return fallback;
    }
  }

  async function addAttachment(owner, attachment, name) {
    if (!attachment?.id || !name) throw new Error('Atlassian returned an attachment without an ID or filename.');
    const api = owner.type === 'jira' ? 'downloadJiraIssueAttachment' : 'downloadConfluenceAttachment';
    const downloadUrl = await optional('Attachment ' + owner.id + '/' + name, async () => {
      const result = await read(api, { attachmentId: String(attachment.id) });
      if (typeof result.downloadUrl !== 'string') throw new Error('Atlassian returned no download URL.');
      return result.downloadUrl;
    }, null);
    files.push({
      owner, id: String(attachment.id), name, size: attachment.size ?? attachment.fileSize,
      downloadUrl,
    });
  }

  const [board, space, pagedIssues] = await Promise.all([
    read('getJiraBoardConfig', { boardId }),
    read('getConfluenceSpace', { spaceIdOrKey: spaceKey }),
    readPages(async token => {
      const page = await read('getJiraBoardIssueData', {
        boardId, dataset: 'all', maxResults: 10, fields: ['*all'],
        ...(token && { nextPageToken: token }),
      }, 'full');
      if (page.isLast === false && !page.nextPageToken) throw new Error('Jira returned an incomplete board issue list.');
      return { items: rows(page, 'issues'), next: page.nextPageToken };
    }),
  ]);
  if (Number(board.id) !== boardId || !space.id || !space.key) throw new Error('Atlassian did not resolve the requested board and space.');
  const issues = [...new Map(pagedIssues.map(issue => [issue.id ?? issue.key, issue])).values()];
  progress('Read ' + issues.length + ' Jira issues from ' + board.name + '.');

  const listed = new Map();
  const hierarchy = new Map();
  const contentTypes = Object.keys(CONTENT_FORMATS);
  await eachBatch(contentTypes, 4, async type => {
    for (const status of ['current', 'archived']) {
      const fetchList = () => confluencePages(cursor => read('listConfluenceContent', {
        spaceId: String(space.id), type, status, limit: 100, ...(cursor && { cursor }),
      }));
      const list = status === 'current' ? await fetchList() : await optional('Archived ' + type, fetchList, []);
      for (const item of list) listed.set(String(item.id), { ...item, type: item.type ?? type });
    }
  });
  if (space.homepageId) {
    const children = await optional('Confluence page tree', () => confluencePages(cursor => read(
      'getConfluenceContentDescendants', {
        contentId: String(space.homepageId), depth: 10, limit: 250, ...(cursor && { cursor }),
      },
    )), []);
    for (const item of children) hierarchy.set(String(item.id), item);
  }

  const issueDetails = new Array(issues.length);
  await eachBatch(issues, 4, async (issue, index) => {
    const key = issue.key;
    if (!key || !issue.fields?.summary) throw new Error('A Jira issue has no key or summary.');
    const issueIdOrKey = key;
    const { comment, worklog, attachment } = issue.fields;
    const embeddedComments = comment?.comments ?? [];
    const embeddedWorklogs = worklog?.worklogs ?? [];
    const [comments, worklogs, history] = await Promise.all([
      comment?.total > embeddedComments.length
        ? optional(key + ' comments', () => offsetPages(startAt => call('listJiraIssueComments', {
          issueIdOrKey, startAt, maxResults: 20, view: 'full',
        }), 'comments'), embeddedComments)
        : embeddedComments,
      worklog?.total > embeddedWorklogs.length
        ? optional(key + ' worklogs', () => offsetPages(startAt => read('listJiraIssueWorklogs', {
          issueIdOrKey, startAt, maxResults: 20,
        }), 'worklogs'), embeddedWorklogs)
        : embeddedWorklogs,
      optional(key + ' change history', () => offsetPages(startAt => read('listJiraIssueChangelogs', {
        issueIdOrKey, startAt, maxResults: 20,
      }), 'values'), []),
    ]);
    for (const file of attachment ?? []) await addAttachment({ type: 'jira', id: key }, file, file.filename);
    issueDetails[index] = { issue, comments, worklogs, history };
  });

  const entries = [...listed.values()];
  const documents = new Array(entries.length);
  await eachBatch(entries, 4, async (entry, index) => {
    const { id, type, title } = entry;
    const format = CONTENT_FORMATS[type];
    const document = {
      entry, parentId: hierarchy.get(String(id))?.parentId ?? entry.parentId ?? null,
    };
    documents[index] = document;
    if (type === 'folder') return;
    const inputs = { content_id: String(id), ...(format && { content_format: format }), ...(format === 'markdown' && { detail: 'full' }) };
    document.content = await optional('Confluence ' + title, () => call('getConfluenceContent', inputs), null);
    if (format === 'markdown') {
      if (document.content?.body?.lossyConversion) {
        document.html = await optional('Confluence HTML ' + title, () => call('getConfluenceContent', {
          ...inputs, content_format: 'html',
        }), null);
      }
      const attachmentList = await optional('Confluence attachments for ' + title, () => confluencePages(
        cursor => read('listConfluenceAttachments', { contentId: String(id), limit: 100, ...(cursor && { cursor }) }),
      ), []);
      document.attachments = attachmentList;
      for (const file of attachmentList) await addAttachment({ type: 'confluence', id: String(id) }, file, file.title);
      if (entry.status === 'current') {
        document.comments = {};
        for (const kind of ['footer', 'inline']) {
          document.comments[kind] = await optional('Confluence ' + kind + ' comments for ' + title, () => confluencePages(
            cursor => read('listConfluenceComments', {
              'content-id': String(id), 'content-type': type === 'blogpost' ? 'blogpost' : 'page',
              'comment-type': kind, 'body-format': 'markdown', 'include-replies': true, limit: 50,
              ...(cursor && { cursor }),
            }), 'comments',
          ), []);
        }
      }
    }
  });
  progress('Read ' + documents.filter(doc => doc.entry.type !== 'folder').length + ' documents from ' + space.name + '.');

  return { version: 1, source, board, space, issues: issueDetails, documents, files, warnings };
}

module.exports = { boardSource, collectAtlassian, readResult };
