const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const windows = process.platform === 'win32';

function gitBash() {
  if (!windows) return 'bash';
  const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000 }).trim();
  return path.resolve(gitExecPath, '../../..', 'bin', 'bash.exe');
}

function coderCommand(file, args, { cwd, env }) {
  if (/\.[cm]?js$/i.test(file)) return [process.execPath, [path.resolve(cwd, file), ...args]];
  if (!windows) return [file, args];
  if (/\.(exe|com)$/i.test(file)) return [file, args];

  const dirs = path.basename(file) === file
    ? [cwd, ...(env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)]
    : [cwd];
  const explicitlyBatch = /\.cmd$/i.test(file);
  for (const dir of dirs) {
    const candidate = path.resolve(dir, file);
    if (!explicitlyBatch && fs.existsSync(`${candidate}.exe`)) return [`${candidate}.exe`, args];
    const shim = explicitlyBatch ? candidate.slice(0, -4) : candidate;
    if (fs.existsSync(`${shim}.cmd`) && fs.existsSync(shim)) {
      // npm installs a shell shim alongside its .cmd file. Use it to keep
      // multiline prompts and shell characters out of cmd.exe command strings.
      return [gitBash(), ['-c', 'export MSYS2_ARG_CONV_EXCL="*"; exec bash "$@"', '--', shim, ...args]];
    }
  }
  return [file, args];
}

function killProcessTree(proc) {
  if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return false;
  if (windows) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore', timeout: 3000, windowsHide: true,
      });
    } catch { try { proc.kill(); } catch {} }
    return true;
  }

  const signal = sig => {
    try { process.kill(-proc.pid, sig); }
    catch { try { proc.kill(sig); } catch {} }
  };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), 2000).unref();
  return true;
}

function spawnManaged(file, args, { timeout, ...options }) {
  const proc = spawn(file, args, { ...options, detached: !windows, windowsHide: true });
  if (timeout > 0) {
    const timer = setTimeout(() => {
      proc.timedOut = killProcessTree(proc);
    }, timeout);
    proc.once('close', () => clearTimeout(timer));
  }
  return proc;
}

function spawnShell(command, options) {
  if (windows) return spawnManaged(command, [], { ...options, shell: true });
  return spawnManaged('bash', ['-lc', command], options);
}

module.exports = { coderCommand, gitBash, killProcessTree, spawnManaged, spawnShell };
