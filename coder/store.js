// Shared usage/session store — backends write into this after each run.
let _lastUsage = { cost: 0, input: '0', output: '0' };
let _lastSessionId = null;

module.exports = {
  get lastUsage() { return _lastUsage; },
  get lastSessionId() { return _lastSessionId; },
  setUsage(u) { _lastUsage = u; },
  setSessionId(id) { _lastSessionId = id; },
};
