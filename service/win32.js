const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Jira Dashboard (port ${'${PORT}'}) — ${'${NAME}'}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${'${NODE}'}</Command>
      <Arguments>${'${ROOT}'}\\server.js</Arguments>
      <WorkingDirectory>${'${PROJECT_DIR}'}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

function taskName(port) { return `JiraDashboard-${port}`; }

function taskXmlPath(port) {
  const home = os.homedir();
  return path.join(home, '.jira-dashboard', `${taskName(port)}.xml`);
}

function findPidByPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf-8', timeout: 3000, stdio: 'pipe',
    });
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[1] && parts[1].endsWith(`:${port}`)) {
        return parts[4];
      }
    }
  } catch {}
  return null;
}

async function install({ port, root, projectDir, projectName, nodeBin }) {
  const name = taskName(port);
  const xmlPath = taskXmlPath(port);
  const xmlDir = path.dirname(xmlPath);

  fs.mkdirSync(xmlDir, { recursive: true });

  const content = XML_TEMPLATE
    .replace(/\$\{PORT\}/g, port)
    .replace(/\$\{ROOT\}/g, root)
    .replace(/\$\{PROJECT_DIR\}/g, projectDir)
    .replace(/\$\{NAME\}/g, projectName)
    .replace(/\$\{NODE\}/g, nodeBin);

  fs.writeFileSync(xmlPath, content, 'utf-8');
  console.log(`  Created ${xmlPath}`);

  execSync(`schtasks /Create /TN "${name}" /XML "${xmlPath}" /F`, { stdio: 'inherit' });
  console.log(`  Registered schtasks task: ${name}`);

  execSync(`schtasks /RUN /TN "${name}"`, { stdio: 'inherit' });
}

async function uninstall({ port }) {
  const name = taskName(port);
  const xmlPath = taskXmlPath(port);

  try {
    const pid = findPidByPort(port);
    if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
  } catch {}

  try { execSync(`schtasks /End /TN "${name}"`, { stdio: 'pipe' }); } catch {}
  try { execSync(`schtasks /Delete /TN "${name}" /F`, { stdio: 'pipe' }); } catch {}
  try { fs.unlinkSync(xmlPath); } catch {}
}

async function start({ port }) {
  execSync(`schtasks /RUN /TN "${taskName(port)}"`, { stdio: 'inherit' });
}

async function stop({ port }) {
  try { execSync(`schtasks /End /TN "${taskName(port)}"`, { stdio: 'pipe' }); } catch {}
  const pid = findPidByPort(port);
  if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
}

async function restart({ port }) {
  await stop({ port });
  await start({ port });
}

async function status({ port }) {
  const name = taskName(port);
  try {
    execSync(`schtasks /Query /TN "${name}"`, { stdio: 'pipe', encoding: 'utf-8' });
    console.log(`Task "${name}" exists.`);
  } catch {
    console.log(`Task "${name}" not found.`);
    return;
  }
  const pid = findPidByPort(port);
  if (pid) {
    console.log(`Process running on port ${port} (PID: ${pid}).`);
  } else {
    console.log(`No process detected on port ${port}.`);
  }
}

function manageHelp({ port }) {
  const name = taskName(port);
  return [
    `Manage:  schtasks /RUN /TN "${name}"           # start`,
    `         schtasks /End /TN "${name}"           # stop`,
    `         taskkill /F /PID <pid>                # force stop`,
    `Logs:    ${os.homedir()}\\.jira-dashboard\\${name}.log  (if configured)`,
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
