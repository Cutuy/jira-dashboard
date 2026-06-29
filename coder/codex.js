const path = require('path');

module.exports = function codexBackend(config, store) {
  return {
    name: 'codex',

    stats() { return store.lastUsage; },

    buildArgs(prompt, sessionId, title) {
      const args = sessionId
        ? ['exec', 'resume', sessionId, prompt, '--json']
        : ['exec', prompt, '--json'];
      return args;
    },

    buildEnv() {
      return {
        HOME: process.env.HOME,
        PATH: `${config.venvBin()}:${process.env.PATH}`,
        VIRTUAL_ENV: path.join(config.projectDir, config.venv.dir),
      };
    },

    parseOutput(stdout) {
      try {
        const lines = stdout.trim().split('\n');
        let text = '';
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'thread.started' && evt.thread_id) store.setSessionId(evt.thread_id);
            if (evt.type === 'turn.completed' && evt.usage) {
              store.setUsage({
                cost: 0,
                input: String(evt.usage.input_tokens || 0),
                output: String(evt.usage.output_tokens || 0),
              });
            }
            if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
              text += evt.item.text || '';
            }
          } catch {}
        }
        if (text) return text;
      } catch {}
      return stdout;
    },
  };
};
