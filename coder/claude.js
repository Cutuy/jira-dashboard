const path = require('path');
const crypto = require('crypto');

module.exports = function claudeBackend(config, store) {
  return {
    name: 'claude',

    stats() { return store.lastUsage; },

    // Claude accepts a client-assigned session id (`--session-id <uuid>`), so
    // we mint one up front and persist it before spawning. That's what lets a
    // crashed/restarted run resume the same conversation (see coder/index.js).
    newSessionId() { return crypto.randomUUID(); },

    // `-r <id>` on a session that was never created exits non-zero with this on
    // stderr. Signals coder/index.js to retry as a fresh session under the id.
    isMissingSessionError(err) {
      return /no conversation found/i.test(err && err.message || '');
    },

    buildArgs(prompt, sessionId, title, runOpts = {}) {
      // NOTE: Claude Code uses `--output-format` (not `--format`). The latter
      // is an OpenCode flag and will be rejected by `claude` with
      //   error: unknown option '--format'
      // `--output-format stream-json` also requires `--verbose` to be passed
      // before it, or `claude` errors with
      //   "When using --print, --output-format=stream-json requires --verbose"
      // `--include-partial-messages` streams text_delta events so the live
      // view shows the coder's output as it's produced (see formatProgress).
      // `--dangerously-skip-permissions` is REQUIRED for the implement stage:
      // in headless `-p` mode there is no interactive prompt, so any Edit /
      // Write / Bash tool call that needs approval is auto-denied. Without this
      // flag the coder produces a text-only "I couldn't get permission" result,
      // makes zero file changes, and the commit is silently skipped
      // ("no uncommitted changes in worktree").
      // Session handling: `-r <id>` RESUMES an existing conversation, while
      // `--session-id <id>` STARTS a new one under a client-chosen id. The two
      // are not interchangeable — `-r` on a missing session errors ("no
      // conversation found") and `--session-id` on an existing one errors
      // ("already in use") — so pick based on runOpts.resume.
      const args = ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--dangerously-skip-permissions'];
      if (sessionId) {
        if (runOpts.resume) args.push('-r', sessionId);
        else args.push('--session-id', sessionId);
      }
      args.push(prompt);
      return args;
    },

    buildEnv() {
      return {
        HOME: process.env.HOME,
        PATH: `${config.venvBin()}:${process.env.PATH}`,
        VIRTUAL_ENV: path.join(config.projectDir, config.venv.dir),
      };
    },

    formatProgress(line) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta') {
          return evt.event.delta.text;
        }
      } catch {}
      return null;
    },

    parseOutput(stdout) {
      try {
        const trimmed = stdout.trim();
        if (!trimmed) return stdout;
        const lines = trimmed.split('\n');

        if (lines.length === 1) {
          const data = JSON.parse(trimmed);
          if (data.result !== undefined) {
            store.setUsage({
              cost: data.total_cost_usd || 0,
              input: String(data.usage?.input_tokens || 0),
              output: String(data.usage?.output_tokens || 0),
            });
            if (data.session_id) store.setSessionId(data.session_id);
            return String(data.result);
          }
          return stdout;
        }

        let text = '';
        let sessionId = null;
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
              sessionId = evt.session_id;
            }
            if (evt.type === 'assistant' && evt.message?.usage) {
              const content = evt.message.content || [];
              text = content.map(c => c.text || '').join('');
            }
            if (evt.type === 'result' && evt.subtype === 'success') {
              if (evt.total_cost_usd !== undefined) {
                store.setUsage({
                  cost: evt.total_cost_usd,
                  input: String(evt.usage?.input_tokens || 0),
                  output: String(evt.usage?.output_tokens || 0),
                });
              }
              if (evt.session_id) store.setSessionId(evt.session_id);
              else if (sessionId) store.setSessionId(sessionId);
              if (evt.result !== undefined) text = String(evt.result);
            }
          } catch {}
        }
        if (text) return text;
      } catch {}
      return stdout;
    },
  };
};
