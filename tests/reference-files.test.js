const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const { createReferenceFilesRouter } = require('../reference-files');

async function dashboard(t) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard references '));
  const root = path.join(project, '.jira-dashboard', 'reference');
  const app = express();
  app.use(express.json());
  app.use('/api/files', createReferenceFilesRouter(root));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await fs.rm(project, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/api/files';
  const request = (endpoint, params = {}, options) => fetch(base + endpoint + '?' + new URLSearchParams(params), options);
  const copy = (folder, name, body) => request('/content', { folder, name }, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body,
  });
  return { root, project, request, copy };
}

test('opens local folders and copies, previews, and downloads files', async t => {
  const { root, request, copy } = await dashboard(t);
  assert.deepEqual(await (await request('')).json(), { folderPath: root, entries: [] });
  const folder = 'Release notes';
  const created = await request('/folders', {}, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folder }),
  });
  assert.equal(created.status, 201);

  const markdown = '# Release notes\n\nReady.';
  const name = 'Résumé & notes #1.md';
  assert.equal((await copy(folder, name, markdown)).status, 201);
  assert.equal((await copy(folder, 'empty.txt', '')).status, 201);
  assert.equal(await fs.readFile(path.join(root, folder, name), 'utf8'), markdown);
  assert.deepEqual((await (await request('', { folder })).json()).entries, [
    { name: 'empty.txt', type: 'file', preview: 'text' },
    { name, type: 'file', preview: 'markdown' },
  ]);
  const document = await request('/content', { path: folder + '/' + name });
  assert.equal(document.status, 200);
  assert.match(document.headers.get('content-type'), /^text\/plain/);
  assert.equal(await document.text(), markdown);

  // Existing files copied into the reference folder outside the dashboard are visible too.
  const pdf = Buffer.from('%PDF-1.7\nreference content');
  await fs.writeFile(path.join(root, folder, 'spec.PDF'), pdf);
  const preview = await request('/content', { path: folder + '/spec.PDF' }, { headers: { Range: 'bytes=0-7' } });
  assert.equal(preview.status, 206);
  assert.equal(preview.headers.get('content-type'), 'application/pdf');
  assert.equal(await preview.text(), '%PDF-1.7');
  const saved = await request('/content', { path: folder + '/spec.PDF', download: '1' });
  assert.match(saved.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await saved.arrayBuffer()), pdf);

  assert.equal((await copy(folder, 'page.html', '<script>alert(1)</script>')).status, 201);
  const html = await request('/content', { path: folder + '/page.html' });
  assert.match(html.headers.get('content-disposition'), /^attachment/);
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  await html.arrayBuffer();
});

test('keeps existing files intact when two copies use the same name', async t => {
  const { root, copy } = await dashboard(t);
  const responses = await Promise.all([copy('', 'notes.md', 'first'), copy('', 'notes.md', 'second')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const original = responses[0].status === 201 ? 'first' : 'second';
  assert.equal(await fs.readFile(path.join(root, 'notes.md'), 'utf8'), original);
  const conflict = await responses.find(response => response.status === 409).json();
  assert.match(conflict.error, /already exists/);
});

test('rejects paths outside the reference folder, including Windows junctions', async t => {
  const { root, project, request, copy } = await dashboard(t);
  await request('');
  const privateDir = path.join(project, 'private');
  await fs.mkdir(privateDir);
  await fs.writeFile(path.join(privateDir, 'private.md'), 'private notes');
  await fs.symlink(privateDir, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');

  assert.deepEqual((await (await request('')).json()).entries, []);
  assert.equal((await request('', { folder: 'link' })).status, 404);
  assert.equal((await request('/content', { path: 'link/private.md' })).status, 404);
  assert.equal((await copy('link', 'target.md', 'text')).status, 404);
  assert.equal((await request('/content', { path: '../.env' })).status, 400);
  assert.equal((await copy('..\\private', 'target.md', 'text')).status, 400);
  assert.equal((await copy('', 'notes.md:hidden', 'text')).status, 400);
  assert.equal((await copy('', 'NUL.txt', 'text')).status, 400);
  assert.deepEqual(await fs.readdir(privateDir), ['private.md']);
});
