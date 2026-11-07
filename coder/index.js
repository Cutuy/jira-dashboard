// coder/index.js — Coder CLI abstraction layer
// Decouples the dashboard from any specific AI coding tool.
// New backends: add a file under coder/<name>.js and register it below.

const path = require('path');
const { runProcess } = require('../process-runner');
const config = require('../config');
const store = require('./store');
const { createResourceMonitor } = require('../monitor');

const opencode = require('./opencode')(config, store);
const claude = require('./claude')(config, store);
const codex = require('./codex')(config, store);
const dummy = require('./dummy')(config, store);

const backends = { opencode, claude, codex, dummy };

// ── Coder type autodetection ──────────────────────────────
// Prevents the common config mismatch where a user sets
// JIRA_CODER_BIN=claude (their machine's only AI CLI) but
// doesn't also set JIRA_CODER_TYPE=claude (the default from
// config.json is 'opencode').  Without detection, the opencode
// backend would be selected and emit `--format` flags, which
// the claude binary rejects with:
//   error: unknown option '--format'
function detectType(cfg) {
  const type = cfg.coder.type;
  const binName = path.basename(cfg.coder.bin).toLowerCase();

  // Only auto-detect when the configured type is 'opencode' —
  // the built-in default.  If the user explicitly chose a
  // different type we respect that choice.
  if (type !== 'opencode') return type;

  if (binName.startsWith('claude') || binName.includes('claude')) return 'claude';
  if (binName.startsWith('codex') || binName.includes('codex')) return 'codex';
  return 'opencode';
}

function resolveBackend() {
  const type = detectType(config);
  const backend = backends[type];
  if (!backend) {
    console.warn(`Unknown coder type "${type}" — using dummy backend`);
    return dummy;
  }
  return backend;
}

function getStats() {
  const backend = resolveBackend();
  if (backend.name === 'opencode') return backend.stats();
  return store.lastUsage;
}

function getLastSessionId() {
  return store.lastSessionId;
}

function buildSpawnOptions(backend, opts = {}) {
  const { timeout = 180_000 } = opts;
  return {
    cwd: opts.cwd || config.projectDir,
    env: { ...process.env, ...backend.buildEnv() },
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so the whole coder tree (the CLI plus any git /
    // language-server children it spawns) can be killed together when a
    // ticket is closed mid-run — a plain kill only hits the group leader.
    detached: true,
  };
}

function run(prompt, opts = {}) {
  const backend = resolveBackend();
  const { sessionId, title, onProgress } = opts;

  if (backend.runDummy) {
    return backend.runDummy(prompt).then(text => ({
      text, tokens: null, sessionId: null,
    }));
  }

  const args = backend.buildArgs(prompt, sessionId, title);
  const spawnOpts = buildSpawnOptions(backend, opts);
  // CLI event streams can be verbose. Retain at most 4 MiB of stdout and
  // 64 KiB of stderr; output overflow is an explicit incomplete-result error.
  const maxStdoutBytes = 4 * 1024 * 1024;
  let outputPrefix = Buffer.alloc(0);
  let lineBuffer = '';
  let resMonitor;
  return runProcess(config.coder.bin, args, {
    ...spawnOpts,
    timeoutMs: spawnOpts.timeout,
    signal: opts.signal,
    maxStdoutBytes,
    onSpawn(proc) {
      resMonitor = createResourceMonitor(proc.pid, data => {
        if (!onProgress) return;
        let tokensStr = '';
        try {
          const s = backend.stats();
          if (parseInt(s.input) > 0) tokensStr = ` tokens_in=${s.input} tokens_out=${s.output} cost=$${s.cost || ''}`;
        } catch {}
        onProgress(`[resource] cpu=${data.cpuSec}s mem=${data.memMB}MB threads=${data.threads} elapsed=${data.elapsed}s ncores=${data.ncores}${tokensStr}`);
      });
      opts.onSpawn?.(proc);
    },
    onStdout(data) {
      // Session initialization is normally the first event. Preserve a bounded
      // prefix too so an overflow error can still report its original session.
      if (outputPrefix.length < 64 * 1024) {
        outputPrefix = Buffer.concat([outputPrefix, data.subarray(0, 64 * 1024 - outputPrefix.length)]);
      }
      if (!onProgress) return;
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      // Bound an unterminated progress record as well as retained raw output.
      lineBuffer = (lines.pop() || '').slice(-maxStdoutBytes);
      for (const line of lines) {
        const formatted = backend.formatProgress ? backend.formatProgress(line) : null;
        if (formatted !== null) onProgress(formatted);
        else if (!/^\s*[{[]/.test(line)) onProgress(line);
      }
    },
  }).then(result => {
    let parsed;
    try {
      const prefix = outputPrefix.toString('utf8');
      const raw = (result.stdoutTruncated
        ? prefix.slice(0, Math.max(0, prefix.lastIndexOf('\n'))) + '\n' + result.stdout
        : result.stdout).trim();
      parsed = backend.parseOutput ? backend.parseOutput(raw) : { text: raw, tokens: null, sessionId: null };
    } finally {
      if (resMonitor) { resMonitor.poll(); resMonitor.close(); }
    }
    let message;
    if (result.error) message = `Coder process error: ${result.error.message}`;
    else if (result.cancelled) message = 'Coder cancelled';
    else if (result.timedOut) message = 'Coder timed out';
    else if (result.exitCode !== 0) message = result.signal
      ? `Coder killed (${result.signal})` : `Coder exited ${result.exitCode}`;
    else if (result.stdoutTruncated) message = `Coder output exceeded ${maxStdoutBytes} bytes (truncated)`;
    else if (!parsed.text && result.stderr.trim()) message = 'Coder produced no output';
    if (message) {
      const detail = (result.stderr || parsed.text || '').slice(-500);
      const err = new Error(message + (detail ? `: ${detail}` : ''), { cause: result.error || undefined });
      Object.assign(err, {
        partialResult: parsed, text: parsed.text,
        stdout: result.stdout, stderr: result.stderr,
        exitCode: result.exitCode, signal: result.signal,
        timedOut: result.timedOut, cancelled: result.cancelled,
        stdoutTruncated: result.stdoutTruncated, stderrTruncated: result.stderrTruncated,
      });
      throw err;
    }
    return parsed;
  });
}

module.exports = { run, getStats, getLastSessionId, buildSpawnOptions, detectType };
