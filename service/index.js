const services = {
  linux: require('./linux'),
  darwin: require('./darwin'),
  win32: require('./win32'),
};

function getImpl() {
  const impl = services[process.platform];
  if (!impl) throw new Error(`Unsupported platform: ${process.platform} (only linux/darwin/win32 supported)`);
  return impl;
}

async function install(opts) { return getImpl().install(opts); }
async function uninstall(opts) { return getImpl().uninstall(opts); }
async function start(opts) { return getImpl().start(opts); }
async function stop(opts) { return getImpl().stop(opts); }
async function restart(opts) { return getImpl().restart(opts); }
async function status(opts) { return getImpl().status(opts); }
function manageHelp(opts) { return getImpl().manageHelp(opts); }
function findAvailablePort(startPort) { return getImpl().findAvailablePort(startPort); }

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'find-port') {
    const start = parseInt(args[0]) || 3006;
    return findAvailablePort(start).then(p => { console.log(p); process.exit(0); });
  }

  const actions = { install, uninstall, start, stop, restart, status };
  const fn = actions[cmd];
  if (!fn) {
    console.error(`Usage: node service/index.js <${Object.keys(actions).join('|')}> <port> [root] [projectDir] [projectName]`);
    console.error('       node service/index.js find-port [startPort]');
    process.exit(1);
  }

  const [port, root, projectDir, projectName] = args;
  const nodeBin = process.execPath;

  fn({ port, root, projectDir, projectName, nodeBin })
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { install, uninstall, start, stop, restart, status, manageHelp, findAvailablePort };
