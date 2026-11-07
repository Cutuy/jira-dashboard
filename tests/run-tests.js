// Run every backend test in its own process so mocks/config cannot leak across files.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort();
if (files.length === 0) throw new Error('No backend test files found');
for (const file of files) {
  console.log(`\nRunning ${file}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${file} failed${result.signal ? ` (${result.signal})` : ''}`);
    process.exit(result.status || 1);
  }
}
console.log(`\nAll ${files.length} backend test files passed`);
