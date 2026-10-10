// Lightweight secret scan: fails if tracked-looking files contain obvious credentials.
// Run: node scripts/check-secrets.js   (also wired as a git pre-commit hook via scripts/install-hooks.js)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.claude']);
const SKIP_FILES = /(package-lock\.json|\.png|\.jpg|\.jpeg|\.gif|\.ico|\.woff2?|\.pdf|check-secrets\.js)$/i;

const RULES = [
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { name: 'Google/Gemini API key', re: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: 'JWT (Supabase key / token)', re: /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Postgres URL with password', re: /postgres(?:ql)?:\/\/[^:\s/]+:(?!\[|<|\$|YOUR|password|xxxx)[^@\s]{6,}@[^/\s]+/i },
  {
    name: 'Assigned secret value',
    re: /(?:SERVICE_ROLE_KEY|GEMINI_API_KEY|SMTP_PASS|JWT_SECRET|ADMIN_PASSWORD|DEMO_PASSWORD)\s*=\s*['"]?[A-Za-z0-9_\-./+=]{12,}/,
  },
];

const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (SKIP_FILES.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const rel = path.relative(ROOT, file);
    if (/(^|[\/])\.env(\.[^\/]*)?$/.test(rel) && !rel.endsWith('.env.example')) {
      hits.push(`${rel}: a real .env file exists in the working tree (must stay untracked/ignored)`);
      continue;
    }
    if (/\.pem$|\.key$/i.test(entry.name)) {
      hits.push(`${rel}: key file in repository tree`);
      continue;
    }
    let text;
    try {
      if (fs.statSync(file).size > 1_500_000) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      for (const rule of RULES) if (rule.re.test(line)) hits.push(`${rel}:${i + 1}: ${rule.name}`);
    });
  }
}
walk(ROOT);

if (hits.length) {
  console.error('Possible secrets found:\n' + hits.map((h) => `  - ${h}`).join('\n'));
  console.error('\nRemove them or move them to an ignored .env file.');
  process.exit(1);
}
console.log('Secret scan passed: no obvious credentials found.');
