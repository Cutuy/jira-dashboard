const path = require('path');
const fs = require('fs');
const { runProcess } = require('./process-runner');
const config = require('./config');

const activeTests = new Map();
const stoppingTickets = new Set();

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function pythonSourcePath(worktreePath) {
  return (config.venv.pythonpath || 'src').split(path.delimiter).map(source => {
    if (!path.isAbsolute(source)) return path.resolve(worktreePath, source);
    const relative = path.relative(config.projectDir, source);
    // A source path inside the main checkout refers to its worktree equivalent.
    return relative !== '..' && !relative.startsWith('..' + path.sep)
      ? path.resolve(worktreePath, relative) : source;
  }).join(path.delimiter);
}

function detectTestFramework(worktreePath) {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;

  const has = (p) => fs.existsSync(path.join(worktreePath, p));
  const read = (p) => { try { return fs.readFileSync(path.join(worktreePath, p), 'utf-8'); } catch { return ''; } };

  if (config.test.commandOverride) {
    return { framework: 'custom', command: config.test.commandOverride };
  }

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(read('package.json'));
      if (pkg.scripts && pkg.scripts.test && pkg.scripts.test.trim() !== 'echo "Error: no test specified" && exit 1') {
        return { framework: 'npm', command: 'npm test --silent' };
      }
    } catch {}
  }

  if (has('go.mod')) {
    return { framework: 'go', command: 'go test ./...' };
  }

  if (has('Cargo.toml')) {
    return { framework: 'cargo', command: 'cargo test --quiet' };
  }

  if (has('pyproject.toml')) {
    const pyproject = read('pyproject.toml');
    const nameMatch = pyproject.match(/name\s*=\s*["']([^"']+)["']/);
    const pkgName = nameMatch ? nameMatch[1] : null;
    const isKnownProject = pkgName === config.projectName;

    if (isKnownProject) {
      const py = config.venvPython();
      const cmd = `${shellQuote(py)} -m ${shellQuote(config.projectName + '.test')}`;
      return { framework: 'pytest', command: cmd };
    }
  }

  if (has('pyproject.toml') || has('pytest.ini') || has('setup.py') || has('tests/') || has('test/')) {
    const py = config.venvPython();
    return { framework: 'pytest', command: `${shellQuote(py)} -m pytest -x --tb=short -q` };
  }

  if (has('scripts/test.sh')) return { framework: 'shell', command: 'bash scripts/test.sh' };
  if (has('scripts/run-tests.sh')) return { framework: 'shell', command: 'bash scripts/run-tests.sh' };

  return null;
}

async function execTestCommand(command, cwd, timeoutMs, opts = {}) {
  const result = await runProcess('bash', ['-lc', command], {
    cwd,
    env: { ...process.env, PYTHONPATH: pythonSourcePath(cwd) },
    timeoutMs,
    signal: opts.signal,
    // stdout + stderr fit the database's existing 64 KiB output contract,
    // including diagnostic markers. Keep the tails during execution too.
    maxStdoutBytes: 31 * 1024,
    maxStderrBytes: 31 * 1024,
  });
  const diagnostics = [];
  if (result.error) diagnostics.push('process error: ' + result.error.message);
  if (result.timedOut) diagnostics.push(`Tests timed out after ${timeoutMs}ms.`);
  if (result.cancelled) diagnostics.push('Tests cancelled.');
  if (result.stdoutTruncated) diagnostics.push('[stdout truncated; showing last 31744 bytes]');
  if (result.stderrTruncated) diagnostics.push('[stderr truncated; showing last 31744 bytes]');
  return {
    status: result.error || result.timedOut || result.cancelled ? 'error'
      : result.exitCode === 0 ? 'pass' : 'fail',
    exit_code: result.exitCode,
    output: [...diagnostics, result.stdout,
      result.stderr ? '--- stderr ---\n' + result.stderr : ''].filter(Boolean).join('\n'),
    duration_ms: result.durationMs,
  };
}

function parseTestSummary(output) {
  if (!output) return null;
  const m = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+error(?:ed|s)?)?(?:.*?(\d+)\s+skipped)?/i);
  if (m && (m[1] || m[2])) {
    return {
      passed: parseInt(m[1] || '0', 10),
      failed: parseInt(m[2] || '0', 10),
      errored: parseInt(m[3] || '0', 10),
      skipped: parseInt(m[4] || '0', 10),
    };
  }
  const goOk = (output.match(/^ok\s/gm) || []).length;
  const goFail = (output.match(/^FAIL\s/gm) || []).length;
  if (goOk + goFail > 0) return { passed: goOk, failed: goFail, errored: 0, skipped: 0 };
  const cargoPass = (output.match(/test result: ok\.\s+(\d+)\s+passed/) || [])[1];
  if (cargoPass) return { passed: parseInt(cargoPass, 10), failed: 0, errored: 0, skipped: 0 };
  return null;
}

function formatSummary(parsed, status) {
  if (!parsed) return status === 'pass' ? 'All tests passed' : (status === 'fail' ? 'Tests failed' : status);
  const parts = [];
  if (parsed.passed)  parts.push(`${parsed.passed} passed`);
  if (parsed.failed)  parts.push(`${parsed.failed} failed`);
  if (parsed.errored) parts.push(`${parsed.errored} errored`);
  if (parsed.skipped) parts.push(`${parsed.skipped} skipped`);
  return parts.length ? parts.join(', ') : status;
}

function runTicketTests(ticketId, triggeredBy = 'auto') {
  const db = require('./db');
  const { sseBroadcast } = require('./sse');

  if (stoppingTickets.has(ticketId)) return null;
  const existing = activeTests.get(ticketId);
  if (existing) return existing.runId;
  const ticket = db.getTicket(ticketId);
  if (!ticket || ticket.stage === 'done') return null;

  if (triggeredBy === 'auto' && !config.test.enabled) return null;

  const wt = ticket.worktree_path;
  if (!wt || !fs.existsSync(wt)) {
    const runId = db.createTestRun(ticketId, null, null, triggeredBy);
    db.finalizeTestRun(runId, {
      status: 'skip', output: 'No worktree available — tests skipped.',
      summary: 'skipped (no worktree)',
    });
    sseBroadcast(ticketId, 'test_status', { run_id: runId, status: 'skip' });
    return runId;
  }

  const det = detectTestFramework(wt);
  if (!det) {
    const runId = db.createTestRun(ticketId, null, null, triggeredBy);
    db.finalizeTestRun(runId, {
      status: 'skip',
      output: 'No recognized test framework in worktree (looked for npm/go/cargo/pytest).',
      summary: 'skipped (no framework detected)',
    });
    sseBroadcast(ticketId, 'test_status', { run_id: runId, status: 'skip' });
    return runId;
  }

  const runId = db.createTestRun(ticketId, det.framework, det.command, triggeredBy);
  sseBroadcast(ticketId, 'test_status', { run_id: runId, status: 'running', framework: det.framework });

  const controller = new AbortController();
  const active = { runId, controller, done: null };
  activeTests.set(ticketId, active);
  active.done = (async () => {
    try {
      const result = await execTestCommand(det.command, wt, config.test.timeout, { signal: controller.signal });
      // Deletion cascades test rows. A completed deleted ticket has nothing left
      // to persist or broadcast, and must not produce an unhandled rejection.
      if (!db.getTicket(ticketId)) return;
      const parsed = result.status === 'error' ? null : parseTestSummary(result.output);
      const summary = controller.signal.aborted ? 'Tests cancelled'
        : formatSummary(parsed, result.status);
      const row = db.finalizeTestRun(runId, { ...result, summary });
      if (!row) return;
      db.logActivity(ticketId, 'test_' + result.status,
        `${det.framework}: ${summary} (${Math.round((result.duration_ms || 0) / 100) / 10}s)`);
      sseBroadcast(ticketId, 'test_status', {
        run_id: runId, status: row.status, framework: det.framework,
        summary: row.summary, exit_code: row.exit_code, duration_ms: row.duration_ms,
      });
    } catch (err) {
      if (!db.getTicket(ticketId)) return;
      const row = db.finalizeTestRun(runId, { status: 'error', output: 'runner crash: ' + err.message });
      if (row) sseBroadcast(ticketId, 'test_status', { run_id: runId, status: 'error' });
    } finally {
      if (activeTests.get(ticketId) === active) activeTests.delete(ticketId);
    }
  })();

  return runId;
}

async function stopTicketTests(ticketId) {
  stoppingTickets.add(ticketId);
  try {
    const active = activeTests.get(ticketId);
    if (active) {
      active.controller.abort();
      await active.done;
    }
  } finally {
    stoppingTickets.delete(ticketId);
  }
}

function recoverInterruptedTestRuns() {
  return require('./db').recoverInterruptedTestRuns();
}

function buildTestContextForPrompt(ticketId) {
  const db = require('./db');
  const latest = db.getLatestTestRun(ticketId);
  if (!latest) return '';
  if (latest.status === 'running') return '';
  const lines = [];
  lines.push(`Last unit-test run (${latest.triggered_by || 'auto'}, ${new Date(latest.started_at).toISOString()}):`);
  lines.push(`  framework: ${latest.framework || '(unknown)'}`);
  lines.push(`  command:   ${latest.command || '(unknown)'}`);
  lines.push(`  status:    ${latest.status}`);
  if (latest.summary) lines.push(`  summary:   ${latest.summary}`);
  if (latest.exit_code != null) lines.push(`  exit_code: ${latest.exit_code}`);
  if (latest.output && latest.status !== 'pass') {
    const tail = latest.output.split('\n').slice(-60).join('\n');
    lines.push('  output (last 60 lines):');
    lines.push(tail.split('\n').map(l => '    ' + l).join('\n'));
  }
  if (latest.status === 'fail' || latest.status === 'error') {
    lines.push('');
    lines.push('The previous implementation FAILED these tests. You may either:');
    lines.push('  (a) ask clarifying questions about the failures, OR');
    lines.push('  (b) propose a fix and proceed to implementation directly.');
  }
  return lines.join('\n');
}

module.exports = {
  detectTestFramework,
  execTestCommand,
  parseTestSummary,
  formatSummary,
  runTicketTests,
  stopTicketTests,
  recoverInterruptedTestRuns,
  buildTestContextForPrompt,
};
