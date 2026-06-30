const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jira-dashboard.${'${PORT}'}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${'${NODE}'}</string>
    <string>${'${ROOT}'}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${'${PROJECT_DIR}'}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${'${HOME}'}/Library/Logs/jira-dashboard-${'${PORT}'}.log</string>
  <key>StandardErrorPath</key>
  <string>${'${HOME}'}/Library/Logs/jira-dashboard-${'${PORT}'}.log</string>
</dict>
</plist>
`;

function label(port) { return `com.jira-dashboard.${port}`; }

function plistPath(port) {
  const home = os.homedir();
  return path.join(home, 'Library/LaunchAgents', `${label(port)}.plist`);
}

async function install({ port, root, projectDir, projectName, nodeBin }) {
  const home = os.homedir();
  const lPath = plistPath(port);
  const lDir = path.dirname(lPath);

  fs.mkdirSync(lDir, { recursive: true });

  const logDir = path.join(home, 'Library/Logs');
  fs.mkdirSync(logDir, { recursive: true });

  const content = PLIST_TEMPLATE
    .replace(/\$\{PORT\}/g, port)
    .replace(/\$\{ROOT\}/g, root)
    .replace(/\$\{PROJECT_DIR\}/g, projectDir)
    .replace(/\$\{NODE\}/g, nodeBin)
    .replace(/\$\{HOME\}/g, home);

  fs.writeFileSync(lPath, content, 'utf-8');
  console.log(`  Created ${lPath}`);

  execSync(`launchctl load -w ${lPath}`, { stdio: 'inherit' });
}

async function uninstall({ port }) {
  const lPath = plistPath(port);
  try { execSync(`launchctl unload -w ${lPath}`, { stdio: 'pipe' }); } catch {}
  try { fs.unlinkSync(lPath); } catch {}
}

async function start({ port }) {
  execSync(`launchctl load -w ${plistPath(port)}`, { stdio: 'inherit' });
}

async function stop({ port }) {
  execSync(`launchctl unload -w ${plistPath(port)}`, { stdio: 'inherit' });
}

async function restart({ port }) {
  const lPath = plistPath(port);
  execSync(`launchctl unload -w ${lPath}`, { stdio: 'pipe' });
  execSync(`launchctl load -w ${lPath}`, { stdio: 'inherit' });
}

async function status({ port }) {
  execSync(`launchctl list | grep ${label(port)} || echo "Service not running"`, { stdio: 'inherit' });
}

function manageHelp({ port }) {
  return [
    `Manage:  launchctl load -w ${plistPath(port)}  # start`,
    `         launchctl unload -w ${plistPath(port)}  # stop`,
    `Logs:    tail -f ${os.homedir()}/Library/Logs/jira-dashboard-${port}.log`,
  ];
}

async function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    function check(p) {
      const server = net.createServer();
      server.listen(p, '127.0.0.1', () => { server.close(); resolve(p); });
      server.on('error', () => check(p + 1));
    }
    check(startPort);
  });
}

module.exports = { install, uninstall, start, stop, restart, status, manageHelp, findAvailablePort };
