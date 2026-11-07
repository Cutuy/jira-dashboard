const { spawn } = require('child_process');

const TERMINATE_GRACE_MS = 250;
const CLOSE_GRACE_MS = 250;
const managedProcesses = new WeakMap();

// Keep a byte-bounded tail while the process runs, rather than truncating only
// after it exits. Callers must expose truncation when interpreting the result.
function createOutputTail(maxBytes) {
  let tail = Buffer.alloc(0);
  let truncated = false;
  return {
    append(chunk) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (tail.length + data.length > maxBytes) truncated = true;
      tail = data.length >= maxBytes
        ? Buffer.from(data.subarray(data.length - maxBytes))
        : Buffer.concat([tail.subarray(Math.max(0, tail.length + data.length - maxBytes)), data]);
    },
    get text() { return tail.toString('utf8'); },
    get truncated() { return truncated; },
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function signalTree(proc, signal) {
  if (!proc.pid) return false;
  if (process.platform !== 'win32') {
    try { process.kill(-proc.pid, signal); return true; } catch (err) {
      if (err.code === 'ESRCH') return false;
    }
  }
  try { return proc.kill(signal); } catch { return false; }
}

async function terminateTree(proc) {
  if (!proc.pid) return;
  if (process.platform === 'win32') {
    // Windows does not support POSIX process groups. taskkill owns descendants
    // as well; bound its completion so a failed helper cannot hang cancellation.
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, TERMINATE_GRACE_MS);
      const finish = () => { clearTimeout(timer); resolve(); };
      killer.once('error', () => { signalTree(proc, 'SIGKILL'); finish(); });
      killer.once('close', finish);
    });
    return;
  }
  if (!signalTree(proc, 'SIGTERM')) return;
  // Even if the leader exits first, an ignoring descendant may still own the
  // worktree or output pipes. Always finish terminating its process group.
  await delay(TERMINATE_GRACE_MS);
  signalTree(proc, 'SIGKILL');
}

async function terminateProcess(proc) {
  if (!proc) return;
  const managed = managedProcesses.get(proc);
  if (managed) return managed.stop();
  await terminateTree(proc);
}

function runProcess(file, args, opts = {}) {
  const {
    timeoutMs = 180_000, signal, onSpawn, onStdout, onStderr,
    maxStdoutBytes = 64 * 1024, maxStderrBytes = 64 * 1024,
  } = opts;
  const stdout = createOutputTail(maxStdoutBytes);
  const stderr = createOutputTail(maxStderrBytes);
  const started = Date.now();

  return new Promise(resolve => {
    let proc;
    let closed = false;
    let settled = false;
    let exitCode = null;
    let exitSignal = null;
    let error = null;
    let stopped = null;
    let timeout;
    let closing;
    let termination;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(closing);
      signal?.removeEventListener('abort', abort);
      if (proc) managedProcesses.delete(proc);
      resolveStopped?.();
      resolve({
        stdout: stdout.text, stderr: stderr.text,
        stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated,
        exitCode, signal: exitSignal, error,
        timedOut: stopped === 'timeout', cancelled: stopped === 'cancelled',
        durationMs: Date.now() - started,
      });
    };
    const terminate = () => {
      if (!termination) termination = terminateTree(proc);
      return termination;
    };
    const settleAfterTermination = async () => {
      await terminate();
      if (closed) return finish();
      // Killed children normally close their pipes immediately. Bound waiting
      // even if a platform or escaped descendant keeps a pipe open.
      closing = setTimeout(() => {
        error ||= new Error('Process output streams did not close after termination');
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        finish();
      }, CLOSE_GRACE_MS);
    };
    let completion;
    const complete = () => {
      if (!completion) completion = settleAfterTermination();
      return completion;
    };
    let resolveStopped;
    const stoppedDone = new Promise(resolveStop => { resolveStopped = resolveStop; });
    const stop = reason => {
      if (!stopped) stopped = reason;
      complete().then(() => { if (settled) resolveStopped(); });
      return stoppedDone;
    };
    const abort = () => { stop('cancelled'); };
    const deliver = (capture, callback) => chunk => {
      capture.append(chunk);
      try { callback?.(chunk); } catch (err) { error = err; stop('error'); }
    };

    if (signal?.aborted) {
      stopped = 'cancelled';
      finish();
      return;
    }
    try {
      proc = spawn(file, args, {
        cwd: opts.cwd, env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      });
    } catch (err) {
      error = err;
      finish();
      return;
    }
    // Resolve external cancellation only after runProcess itself has settled.
    managedProcesses.set(proc, { stop: () => stop('cancelled') });
    proc.stdout.on('data', deliver(stdout, onStdout));
    proc.stderr.on('data', deliver(stderr, onStderr));
    proc.once('exit', (code, sig) => {
      exitCode = code;
      exitSignal = sig;
      complete();
    });
    proc.once('error', err => { error = err; complete(); });
    proc.once('close', (code, sig) => {
      closed = true;
      exitCode = code;
      exitSignal = sig;
      complete();
      termination?.then(() => { finish(); resolveStopped(); });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) timeout = setTimeout(() => stop('timeout'), timeoutMs);
    try { onSpawn?.(proc); } catch (err) { error = err; stop('error'); }
  });
}

module.exports = { runProcess, terminateProcess, createOutputTail };
