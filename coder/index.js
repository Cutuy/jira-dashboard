// coder/index.js — Coder CLI abstraction layer
// Decouples the dashboard from any specific AI coding tool.
// New backends: add a file under coder/<name>.js and register it below.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const config = require('../config');
const store = require('./store');

const opencode = require('./opencode')(config, store);
const claude = require('./claude')(config, store);
const codex = require('./codex')(config, store);
const dummy = require('./dummy')(config, store);

const backends = { opencode, claude, codex, dummy };

function resolveBackend() {
  const type = config.coder.type;
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

function run(prompt, opts = {}) {
  const backend = resolveBackend();
  const { sessionId, title, timeout = 180_000, onProgress } = opts;

  if (backend.runDummy) {
    return backend.runDummy(prompt);
  }

  return new Promise((resolve, reject) => {
    const args = backend.buildArgs(prompt, sessionId, title);
    const env = { ...process.env, ...backend.buildEnv() };

    const proc = spawn(config.coder.bin, args, {
      cwd: config.projectDir,
      env,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const resMonitor = startResourceMonitor(proc.pid, onProgress);

    proc.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      if (onProgress) {
        chunk.split('\n').filter(l => l.trim()).forEach(l => {
          const formatted = backend.formatProgress ? backend.formatProgress(l) : null;
          onProgress(formatted !== null ? formatted : l);
        });
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      clearInterval(resMonitor.interval);
      const raw = stdout.trim();
      const output = backend.parseOutput ? backend.parseOutput(raw) : raw;
      if (code === 0) {
        if (!output && stderr.trim()) {
          reject(new Error(`Coder produced no output: ${stderr.slice(-500)}`));
        } else {
          resolve(output);
        }
      } else if (output) {
        resolve(output);
      } else {
        const reason = code === null ? 'killed (signal/timeout)' : `exited ${code}`;
        reject(new Error(`Coder ${reason}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', err => {
      clearInterval(resMonitor.interval);
      reject(err);
    });
  });
}

function startResourceMonitor(pid, onProgress) {
  const clkTck = 100;
  const ncores = os.cpus().length;
  const PAGE_SIZE = 4096;
  let peakMem = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const afterParen = raw.slice(raw.lastIndexOf(')') + 2);
      const fields = afterParen.split(' ');
      const utime = parseInt(fields[11]) || 0;
      const stime = parseInt(fields[12]) || 0;
      const rss = parseInt(fields[21]) || 0;
      const threads = parseInt(fields[17]) || 1;
      const cpuSec = ((utime + stime) / clkTck).toFixed(1);
      const memMB = rss * PAGE_SIZE / (1024 * 1024);
      const memStr = memMB.toFixed(1);
      if (memMB > peakMem) peakMem = memMB;
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      let tokensIn = '', tokensOut = '', runCost = '';
      try {
        const s = resolveBackend().stats();
        tokensIn = s.input || '';
        tokensOut = s.output || '';
        runCost = String(s.cost || '');
      } catch {}
      let tokensStr = '';
      if (tokensIn) tokensStr = ` tokens_in=${tokensIn} tokens_out=${tokensOut} cost=$${runCost}`;

      const resStr = `cpu=${cpuSec}s mem=${memStr}MB threads=${threads} elapsed=${elapsed}s ncores=${ncores}${tokensStr}`;
      if (onProgress) onProgress(`[resource] ${resStr}`);
    } catch { /* proc gone */ }
  }, 3000);

  return { interval, peakMem: () => peakMem };
}

module.exports = { run, getStats, getLastSessionId, startResourceMonitor };
