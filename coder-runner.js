const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config');
const coder = require('./coder');
const db = require('./db');
const { terminateProcess } = require('./process-runner');

const runningProcs = new Map();
const activeRuns = new Map();
const runContext = new AsyncLocalStorage();

function cancellationError() {
  const err = new Error('Ticket operation was cancelled');
  err.code = 'TICKET_CANCELLED';
  return err;
}

function ticketGone(ticketId) {
  const ticket = db.getTicket(ticketId);
  const run = runContext.getStore();
  return !ticket || ticket.stage === 'done' ||
    (run?.ticketId === ticketId && (run.controller.signal.aborted || activeRuns.get(ticketId) !== run));
}

function assertTicketActive(ticketId) {
  if (ticketGone(ticketId)) throw cancellationError();
}

// Reserve the ticket before any await (including worktree acquisition), and keep
// ownership until output parsing and all workflow continuations have settled.
async function runTicketOperation(ticketId, fn) {
  const parent = runContext.getStore();
  if (parent?.ticketId === ticketId && activeRuns.get(ticketId) === parent) {
    assertTicketActive(ticketId);
    return fn(parent);
  }
  if (activeRuns.has(ticketId)) {
    const err = new Error('Already processing, wait for completion');
    err.code = 'TICKET_BUSY';
    throw err;
  }
  let settle;
  const run = { ticketId, controller: new AbortController(), done: new Promise(resolve => { settle = resolve; }) };
  activeRuns.set(ticketId, run);
  try {
    return await runContext.run(run, () => fn(run));
  } finally {
    if (activeRuns.get(ticketId) === run) activeRuns.delete(ticketId);
    settle();
  }
}

async function killTicketProcess(ticketId, pgid, sessionId) {
  const proc = runningProcs.get(ticketId);
  if (proc) {
    await terminateProcess(proc);
    return true;
  }
  if (pgid) {
    try { process.kill(-pgid, 'SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
    try { process.kill(-pgid, 'SIGKILL'); } catch {}
    return true;
  }
  if (sessionId) {
    // Session IDs are data, never shell syntax. Exclude our own process.
    const { execFileSync } = require('child_process');
    try {
      const pids = execFileSync('pgrep', ['-f', '--', sessionId], { encoding: 'utf-8', timeout: 5000 })
        .trim().split('\n').map(Number).filter(n => n && n !== process.pid);
      for (const n of pids) { try { process.kill(-n, 'SIGTERM'); } catch {} }
      await new Promise(resolve => setTimeout(resolve, 250));
      for (const n of pids) { try { process.kill(-n, 'SIGKILL'); } catch {} }
      return pids.length > 0;
    } catch {}
  }
  return false;
}

async function cancelTicketOperation(ticketId, pgid, sessionId) {
  const run = activeRuns.get(ticketId);
  run?.controller.abort();
  const killed = await killTicketProcess(ticketId, pgid, sessionId);
  if (run) await run.done;
  return killed;
}

function isClosed(ticketId) {
  return ticketGone(ticketId) || db.getTicket(ticketId)?.stage === 'pr_opened';
}

async function runCoder(ticketId, prompt, opts = {}) {
  const run = runContext.getStore();
  if (!run || run.ticketId !== ticketId) {
    return runTicketOperation(ticketId, () => runCoder(ticketId, prompt, opts));
  }
  assertTicketActive(ticketId);
  const ticket = db.getTicket(ticketId);
  let proc;
  try {
    const result = await coder.run(prompt, {
      sessionId: ticket?.ocode_session,
      title: `ticket-${ticketId}`,
      timeout: opts.timeout ?? config.coder.timeouts.clarify,
      signal: run.controller.signal,
      onProgress: line => { if (!ticketGone(ticketId)) opts.onProgress?.(line); },
      cwd: opts.cwd,
      onSpawn: child => {
        proc = child;
        runningProcs.set(ticketId, child);
        if (child.pid && !ticketGone(ticketId)) db.updateTicketField(ticketId, 'coder_pgid', child.pid);
      },
    });
    assertTicketActive(ticketId);
    if (result.sessionId) db.updateTicketField(ticketId, 'ocode_session', result.sessionId);
    return result;
  } catch (err) {
    if (!ticketGone(ticketId) && err.partialResult) {
      const partial = err.partialResult;
      if (partial.sessionId) db.updateTicketField(ticketId, 'ocode_session', partial.sessionId);
      db.logActivity(ticketId, 'coder_partial', JSON.stringify({
        exit_code: err.exitCode, signal: err.signal, timed_out: !!err.timedOut,
        stdout_truncated: !!err.stdoutTruncated, stderr_truncated: !!err.stderrTruncated,
        text: (partial.text || err.stdout || '').slice(-4000), stderr: (err.stderr || '').slice(-2000),
      }));
    }
    throw err;
  } finally {
    if (runningProcs.get(ticketId) === proc) runningProcs.delete(ticketId);
    if (!ticketGone(ticketId)) db.updateTicketField(ticketId, 'coder_pgid', null);
  }
}

function captureSessionId(ticketId, sessionId) {
  if (ticketGone(ticketId)) return null;
  const sid = sessionId;
  if (sid) db.updateTicketField(ticketId, 'ocode_session', sid);
  return sid || null;
}

function waitForTicket(ticketId, ms) {
  const signal = runContext.getStore()?.controller.signal;
  assertTicketActive(ticketId);
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(cancellationError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

module.exports = {
  runningProcs, killTicketProcess, cancelTicketOperation, runTicketOperation,
  assertTicketActive, waitForTicket, isClosed, ticketGone, runCoder, captureSessionId,
};
