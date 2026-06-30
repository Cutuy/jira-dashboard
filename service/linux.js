const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const SERVICE_TEMPLATE = `[Unit]
Description=Jira Dashboard (port ${'${PORT}'}) — ${'${NAME}'}
After=network.target

[Service]
Type=simple
WorkingDirectory=${'${PROJECT_DIR}'}
ExecStart=${'${NODE}'} ${'${ROOT}'}/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

function unitName(port) { return `jira-dashboard-${port}`; }

function unitPath(port) {
  const home = os.homedir();
  return path.join(home, '.config/systemd/user', `${unitName(port)}.service`);
}

async function install({ port, root, projectDir, projectName, nodeBin }) {
  const uPath = unitPath(port);
  const uDir = path.dirname(uPath);
  const uName = unitName(port);

  fs.mkdirSync(uDir, { recursive: true });

  const content = SERVICE_TEMPLATE
    .replace(/\$\{PORT\}/g, port)
    .replace(/\$\{ROOT\}/g, root)
    .replace(/\$\{PROJECT_DIR\}/g, projectDir)
    .replace(/\$\{NAME\}/g, projectName)
    .replace(/\$\{NODE\}/g, nodeBin);

  fs.writeFileSync(uPath, content, 'utf-8');
  console.log(`  Created ${uPath}`);

  execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
  execSync(`systemctl --user enable ${uName}.service`, { stdio: 'inherit' });
  execSync(`systemctl --user restart ${uName}.service`, { stdio: 'inherit' });
}

async function uninstall({ port }) {
  const uName = unitName(port);
  const uPath = unitPath(port);
  try { execSync(`systemctl --user stop ${uName}.service`, { stdio: 'pipe' }); } catch {}
  try { execSync(`systemctl --user disable ${uName}.service`, { stdio: 'pipe' }); } catch {}
  try { fs.unlinkSync(uPath); } catch {}
  try { execSync('systemctl --user daemon-reload', { stdio: 'pipe' }); } catch {}
}

async function start({ port }) {
  execSync(`systemctl --user start ${unitName(port)}.service`, { stdio: 'inherit' });
}

async function stop({ port }) {
  execSync(`systemctl --user stop ${unitName(port)}.service`, { stdio: 'inherit' });
}

async function restart({ port }) {
  execSync(`systemctl --user restart ${unitName(port)}.service`, { stdio: 'inherit' });
}

async function status({ port }) {
  execSync(`systemctl --user status ${unitName(port)}.service`, { stdio: 'inherit' });
}

function manageHelp({ port }) {
  const uName = unitName(port);
  return [
    `Manage:  systemctl --user ${uName}.service {start|stop|restart|status}`,
    `Logs:    journalctl --user -u ${uName}.service -f`,
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
