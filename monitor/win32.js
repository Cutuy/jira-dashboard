const { execFileSync } = require('child_process');
const os = require('os');

function create(pid, onProgress) {
  const ncores = os.cpus().length;
  let peakMem = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    try {
      const out = execFileSync('wmic', [
        'process', 'where', `ProcessId=${pid}`,
        'get', 'KernelModeTime,UserModeTime,WorkingSetSize,ThreadCount',
        '/VALUE',
      ], { encoding: 'utf-8', timeout: 2000 });
      const kt = extract(out, 'KernelModeTime');
      const ut = extract(out, 'UserModeTime');
      const ws = extract(out, 'WorkingSetSize');
      const tc = extract(out, 'ThreadCount');
      if (kt == null || ut == null) return;
      const cpuSec = ((parseInt(kt) + parseInt(ut)) / 10000000).toFixed(1);
      const memMB = (parseInt(ws) || 0) / (1024 * 1024);
      if (memMB > peakMem) peakMem = memMB;
      const threads = parseInt(tc) || 1;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (onProgress) onProgress({ cpuSec, memMB: memMB.toFixed(1), threads, elapsed, ncores });
    } catch {}
  }, 3000);

  return { interval, peakMem: () => peakMem, close: () => clearInterval(interval) };
}

function extract(output, key) {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + '=')) {
      return trimmed.slice(key.length + 1);
    }
  }
  return null;
}

module.exports = { create };
