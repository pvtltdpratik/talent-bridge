// Minimal structured JSON logger with secret redaction.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /(authorization|apikey|api_key|password|secret|token|service_role|cookie|key)/i;

let threshold = LEVELS.info;
export function setLogLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info;
}

export function redact(value, depth = 0) {
  if (value == null || depth > 5) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

function write(level, msg, meta) {
  if (process.env.NODE_ENV === 'test' && process.env.LOG_IN_TESTS !== '1') return;
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...redact(meta) });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (m, meta) => write('debug', m, meta),
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
};
