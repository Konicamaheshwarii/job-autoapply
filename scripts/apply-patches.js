// Re-applies community fixes for whatsapp-web.js 1.34.7 after `npm install`.
// WhatsApp Web (July 2026) renamed internal id fields, which crashes getChats() with "r: r".
// Remove once an official release includes wwebjs PRs #201910 and #201871.
const { execSync } = require('child_process');
const path = require('path');

const lib = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const patches = [
  ['01-getchats-r-r.diff', ''],
  ['02-wid-dollar1-fallback.diff', "--exclude=src/util/Injected/Utils.js"], // Utils.js already covered by 01
];

for (const [file, extra] of patches) {
  const p = path.join(__dirname, '..', 'patches', file);
  const run = (args) => execSync(`git apply ${extra} ${args} "${p}"`, { cwd: lib, stdio: 'pipe' });
  try {
    run('--reverse --check');
    console.log(`patch ${file}: already applied`);
  } catch {
    run('');
    console.log(`patch ${file}: applied`);
  }
}
