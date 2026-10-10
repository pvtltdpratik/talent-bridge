// Installs a git pre-commit hook that runs the secret scan. Run once: node scripts/install-hooks.js
import fs from 'node:fs';
import path from 'node:path';

const hooks = path.resolve('.git', 'hooks');
if (!fs.existsSync(hooks)) {
  console.error('No .git/hooks directory here. Run this from the repository root.');
  process.exit(1);
}
const file = path.join(hooks, 'pre-commit');
fs.writeFileSync(file, '#!/bin/sh\nnode scripts/check-secrets.js || exit 1\n', { mode: 0o755 });
console.log(`Installed ${file}`);
