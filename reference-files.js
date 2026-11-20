const express = require('express');
const fs = require('node:fs/promises');
const { COPYFILE_EXCL } = require('node:fs').constants;
const path = require('node:path');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

function fileError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validName(name) {
  return typeof name === 'string' && name.length > 0
    && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
    && !/[. ]$/.test(name)
    && !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(name.split('.')[0].trimEnd());
}

function nameParts(relative = '') {
  if (relative === '') return [];
  if (typeof relative !== 'string') throw fileError(400, 'Invalid folder or file path.');
  const parts = relative.split('/');
  if (!parts.every(validName)) throw fileError(400, 'Invalid folder or file path.');
  return parts;
}

function previewType(name) {
  switch (path.extname(name).toLowerCase()) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.pdf':
      return 'pdf';
    case '.txt':
      return 'text';
    default:
      return null;
  }
}

async function copyIntoFolder(root, destination, bytes) {
  // Stage the payload outside the reference tree, then copy it exclusively.
  // Concurrent requests and files added through Explorer keep their contents.
  const staging = await fs.mkdtemp(path.join(path.dirname(root), '.reference-upload-'));
  try {
    const source = path.join(staging, 'upload');
    await fs.writeFile(source, bytes, { mode: 0o600 });
    await fs.copyFile(source, destination, COPYFILE_EXCL);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(err => {
      console.error('[files] Could not remove upload staging folder:', err.message);
    });
  }
}

function createReferenceFilesRouter(directory) {
  const root = path.resolve(directory);
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  async function resolveFolder(parts, createRoot = false) {
    if (createRoot) await fs.mkdir(root, { recursive: true });
    // lstat keeps linked folders and Windows junctions outside the library.
    let folder = root;
    if (!(await fs.lstat(folder)).isDirectory()) throw fileError(404, 'Folder not found.');
    for (const part of parts) {
      folder = path.join(folder, part);
      if (!(await fs.lstat(folder)).isDirectory()) throw fileError(404, 'Folder not found.');
    }
    return folder;
  }

  router.get('/', async (req, res) => {
    const folder = await resolveFolder(nameParts(req.query.folder), true);
    const contents = await fs.readdir(folder, { withFileTypes: true });
    const entries = contents
      .filter(item => validName(item.name) && (item.isDirectory() || item.isFile()))
      .map(item => item.isDirectory()
        ? { name: item.name, type: 'folder' }
        : { name: item.name, type: 'file', preview: previewType(item.name) })
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
    res.json({ folderPath: folder, entries });
  });

  router.post('/folders', async (req, res) => {
    const { folder, name } = req.body || {};
    if (!validName(name)) throw fileError(400, 'Enter a valid folder name.');
    const destination = await resolveFolder(nameParts(folder), true);
    await fs.mkdir(path.join(destination, name));
    res.status(201).json({ name });
  });

  router.put('/content', express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES, inflate: false }),
    async (req, res) => {
      if (!req.is('application/octet-stream') || !Buffer.isBuffer(req.body)) {
        throw fileError(415, 'Select a file to copy.');
      }
      const { folder, name } = req.query;
      if (!validName(name)) throw fileError(400, 'Enter a valid file name.');
      const destination = await resolveFolder(nameParts(folder), true);
      await copyIntoFolder(root, path.join(destination, name), req.body);
      res.status(201).json({ name });
    });

  router.get('/content', async (req, res, next) => {
    const parts = nameParts(req.query.path);
    const name = parts.pop();
    if (!name) throw fileError(400, 'Select a file.');
    const folder = await resolveFolder(parts);
    const file = path.join(folder, name);
    const info = await fs.lstat(file);
    if (!info.isFile()) throw fileError(404, 'File not found.');
    const preview = previewType(name);
    if (req.query.download === '1' || !preview) {
      res.attachment(name).type('application/octet-stream');
    } else if (preview === 'pdf') {
      res.type('application/pdf');
    } else {
      if (info.size > MAX_TEXT_PREVIEW_BYTES) throw fileError(413, 'This file is too large to preview. Download it to open it.');
      res.type('text/plain; charset=utf-8');
    }
    res.sendFile(file, { dotfiles: 'allow', cacheControl: false }, err => { if (err) next(err); });
  });

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Each file must be 50 MiB or smaller.' });
    if (err.code === 'EEXIST') return res.status(409).json({ error: 'A file or folder with this name already exists.' });
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return res.status(404).json({ error: 'File or folder not found.' });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('[files]', err);
    res.status(500).json({ error: 'The dashboard could not access the reference folder.' });
  });

  return router;
}

module.exports = { createReferenceFilesRouter };
