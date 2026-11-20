const fs = require('node:fs/promises');
const { parseArgs } = require('node:util');
const { boardSource, collectAtlassian } = require('../importers/atlassian-source');
const { importAtlassian, validateSnapshot } = require('../importers/atlassian-local');

const USAGE = 'Usage: npm run import:jira -- <jira-board-url> [--project-dir PATH] [--space KEY] [--dry-run] [--snapshot FILE]';

function authorization(env) {
  if (env.ATLASSIAN_MCP_ACCESS_TOKEN) return 'Bearer ' + env.ATLASSIAN_MCP_ACCESS_TOKEN;
  if (env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN) {
    return 'Basic ' + Buffer.from(env.ATLASSIAN_EMAIL + ':' + env.ATLASSIAN_API_TOKEN).toString('base64');
  }
  throw new Error('Set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN, or use ATLASSIAN_MCP_ACCESS_TOKEN.');
}

async function readAtlassian(source) {
  const auth = authorization(process.env);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'jira-dashboard-importer', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.atlassian.com/v2/mcp'), {
    requestInit: { headers: { Authorization: auth } },
  });
  try {
    await client.connect(transport);
    return await collectAtlassian(source, (name, args) => client.callTool({ name, arguments: args }), console.log);
  } finally {
    await client.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      'project-dir': { type: 'string' },
      space: { type: 'string' },
      'dry-run': { type: 'boolean' },
      snapshot: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help) { console.log(USAGE); return; }
  if (positionals.length !== 1) throw new Error(USAGE);
  const source = boardSource(positionals[0], values.space);
  const snapshot = values.snapshot
    ? JSON.parse(await fs.readFile(values.snapshot, 'utf8'))
    : await readAtlassian(source);
  validateSnapshot(snapshot, source);

  let warnings = snapshot.warnings;
  const documents = snapshot.documents.filter(doc => doc.content?.body?.value !== undefined).length;
  console.log(snapshot.issues.length + ' issues, ' + documents + ' Confluence documents, ' + snapshot.files.length + ' attachments.');
  if (!values['dry-run']) {
    if (values['project-dir']) process.env.JIRA_DASHBOARD_PROJECT_DIR = await fs.realpath(values['project-dir']);
    const { projectDir } = require('../config');
    const db = require('../db');
    try {
      const result = await importAtlassian(snapshot, projectDir, db);
      console.log('Imported ' + result.created + ' tickets, kept ' + result.skipped + ' existing tickets.');
      console.log('Wrote ' + result.writtenFiles + ' files (' + result.downloaded + ' attachments), kept ' + result.skippedFiles + ' existing files.');
      console.log('Files: ' + result.archive);
      warnings = result.warnings;
    } finally {
      db.close();
    }
  }

  for (const warning of warnings) console.error('Import warning: ' + warning);
  if (warnings.length) process.exitCode = 2;
}

main().catch(err => {
  console.error('Import failed: ' + err.message);
  process.exitCode = 1;
});
