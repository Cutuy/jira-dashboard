const path = require('path');

module.exports = function claudeBackend(config, store) {
  return {
    name: 'claude',

    stats() { return store.lastUsage; },

    buildArgs(prompt, sessionId, title) {
      const args = sessionId
        ? ['-r', sessionId, '-p', prompt, '--output-format', 'json']
        : ['-p', prompt, '--output-format', 'json'];
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
        const data = JSON.parse(stdout);
        if (data.result !== undefined) {
          store.setUsage({
            cost: data.total_cost_usd || 0,
            input: String(data.usage?.input_tokens || 0),
            output: String(data.usage?.output_tokens || 0),
          });
          if (data.session_id) store.setSessionId(data.session_id);
          return String(data.result);
        }
      } catch {}
      return stdout;
    },
  };
};
