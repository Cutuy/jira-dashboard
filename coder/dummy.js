module.exports = function dummyBackend(config, store) {
  return {
    name: 'dummy',
    stats() { return { cost: 0, input: '0', output: '0' }; },
    async runDummy(prompt) { return `[dummy output] Received prompt: ${prompt.slice(0, 80)}`; },
    formatProgress(line) { return null; },
    buildArgs(prompt) { return []; },
    buildEnv() { return { ...process.env }; },
  };
};
