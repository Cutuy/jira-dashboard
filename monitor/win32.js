const { execFile } = require('child_process');
const os = require('os');

function create(pid, onProgress) {
  const ncores = os.cpus().length;
  let peakMem = 0;
  const startTime = Date.now();
  let sampling = false;
  let closed = false;

  function poll() {
    if (closed || sampling) return;
    sampling = true;
    const cmd = `Get-Process -Id ${pid} -ErrorAction Stop | Select-Object CPU,WorkingSet64,@{Name='ThreadCount';Expression={$_.Threads.Count}} | ConvertTo-Json -Compress`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      encoding: 'utf8', timeout: 2000, windowsHide: true,
    }, (err, out) => {
      sampling = false;
      if (err || closed) return;
      let sample;
      try { sample = JSON.parse(out); } catch { return; }
      const cpuSec = (sample.CPU || 0).toFixed(1);
      const memMB = sample.WorkingSet64 / (1024 * 1024);
      peakMem = Math.max(peakMem, memMB);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      onProgress?.({ cpuSec, memMB: memMB.toFixed(1), threads: sample.ThreadCount, elapsed, ncores });
    });
  }
  const interval = setInterval(poll, 3000);
  return {
    poll,
    peakMem: () => peakMem,
    close() {
      closed = true;
      clearInterval(interval);
    },
  };
}

module.exports = { create };
