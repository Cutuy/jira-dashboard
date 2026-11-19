const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const bootstrap = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'bootstrap.ps1')];

async function freePort() {
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  listener.close();
  await once(listener, 'close');
  return port;
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error('Timed out waiting for the dashboard');
}

async function smokeTest() {
  assert.equal(process.platform, 'win32', 'Run this smoke test on Windows');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jira dashboard smoke '));
  const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const psArgs = [...bootstrap, '-ProjectDir', project];
  let dashboard;

  function start() {
    dashboard = spawn('powershell.exe', [...psArgs, '-Mode', 'Start'], { stdio: 'inherit', windowsHide: true });
    return waitFor(async () => {
      if (dashboard.exitCode !== null) throw new Error(`Dashboard exited with code ${dashboard.exitCode}`);
      try { return (await fetch(base + '/api/config', { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    });
  }

  async function stop() {
    if (!dashboard) return;
    if (dashboard.exitCode === null) {
      const exited = once(dashboard, 'exit');
      try {
        execFileSync('taskkill.exe', ['/PID', String(dashboard.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true });
      } catch (err) {
        // A child can exit while taskkill enumerates the process tree.
        const didExit = await Promise.race([exited.then(() => true), delay(2000).then(() => false)]);
        if (!didExit) throw err;
      }
      await exited;
    }
    await waitFor(async () => {
      try {
        await fetch(base + '/api/config', { signal: AbortSignal.timeout(1000) });
        return false;
      } catch { return true; }
    });
    dashboard = undefined;
  }

  async function api(url, method = 'GET', body, expected = 200) {
    const options = body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const response = await fetch(base + url, { method, ...options });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }

  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'windows-smoke@example.test');
    git('config', 'user.name', 'Windows Smoke');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(project, '.gitignore'), '/.jira-dashboard/\n/.worktrees/\n/fixture.cjs\n');
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "require(\'node:fs\').accessSync(\'smoke.txt\')"' },
    }));
    git('add', '.gitignore', 'package.json');
    git('commit', '-qm', 'Set up the test project');
    const fixture = path.join(project, 'fixture.cjs');
    fs.writeFileSync(fixture, String.raw`
const fs = require('node:fs');
const prompt = process.argv.at(-1);
const outputPath = prompt.match(/^Write your JSON output to: (.+)$/m)?.[1];
if (outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify({ questions: [], ready: true, plan: 'Create smoke.txt' }));
} else if (prompt.includes('Suggest 5 tickets.')) {
  console.log('{"tickets":[]}');
} else {
  setTimeout(() => {
    fs.writeFileSync('smoke.txt', 'Windows smoke test\n');
    console.log('Created smoke.txt');
  }, 6000);
}
`);
    execFileSync('powershell.exe', [...psArgs, '-Mode', 'Setup', '-Port', String(port),
      '-Coder', 'codex', '-CoderBin', fixture, '-Worktrees', '1'], { cwd: root, stdio: 'inherit' });
    const configPath = path.join(project, '.jira-dashboard', '.env');
    assert.ok(fs.existsSync(path.join(project, '.jira-dashboard', 'clarification.schema.json')));
    fs.appendFileSync(configPath, 'JIRA_TEST_ENABLED=true\n');

    await start();
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const bundle = (await page.text()).match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(bundle, 'The board references its built JavaScript bundle');
    const script = await fetch(base + bundle);
    assert.match(script.headers.get('content-type'), /javascript/);
    await script.arrayBuffer();

    const referenceFolder = 'Design notes';
    await api('/api/files/folders', 'POST', { name: referenceFolder }, 201);
    const reference = 'overview.md';
    const document = '# Windows dashboard\n\nFile viewer smoke test.';
    const uploaded = await fetch(base + '/api/files/content?' + new URLSearchParams({ folder: referenceFolder, name: reference }), {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: document,
    });
    assert.equal(uploaded.status, 201, await uploaded.text());
    const referenceUrl = base + '/api/files/content?' + new URLSearchParams({ path: referenceFolder + '/' + reference });
    assert.equal(await (await fetch(referenceUrl)).text(), document);

    const { id } = await api('/api/tickets', 'POST', { title: 'Windows ticket', content: 'Create smoke.txt' }, 201);
    const ticketUrl = `/api/tickets/${id}`;
    await waitFor(async () => (await api(ticketUrl)).stage === 'implementation');
    const implemented = await api(ticketUrl + '/implement', 'POST');
    assert.equal(implemented.ticket.stage, 'review');
    assert.ok(implemented.ticket.activity.some(entry => entry.action === 'resource'), 'The Windows process monitor reports resource usage');
    assert.equal(path.basename(implemented.worktree_path), 'pool-0');
    assert.match((await api(ticketUrl + '/diff')).files.join(), /smoke\.txt/);
    const test = await waitFor(async () => {
      const { latest } = await api(ticketUrl + '/tests');
      return latest?.status !== 'running' && latest;
    });
    assert.equal(test.status, 'pass', test.output);
    assert.equal(git('status', '--porcelain'), '', 'The main checkout stays clean');
    assert.equal((await api(ticketUrl + '/close', 'POST')).ticket.stage, 'done');
    assert.equal(git('branch', '--list', implemented.branch_name), '', 'Closing releases the feature branch');

    await stop();
    await start();
    assert.equal((await api(ticketUrl)).stage, 'done', 'SQLite retains the closed ticket after restart');
    assert.equal(await (await fetch(referenceUrl)).text(), document, 'Reference files persist after restart');
  } finally {
    await stop();
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  }
  console.log('PASS: Windows bootstrap, board assets, reference files, ticket workflow, tests, worktree release, and persistence');
}

smokeTest().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
