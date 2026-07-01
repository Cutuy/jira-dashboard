const monitors = {
  linux: require('./linux'),
  darwin: require('./darwin'),
  win32: require('./win32'),
};

function createResourceMonitor(pid, onProgress) {
  const impl = monitors[process.platform];
  if (!impl) return null;
  return impl.create(pid, onProgress);
}

module.exports = { createResourceMonitor };
