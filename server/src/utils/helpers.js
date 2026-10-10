import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** JSON.stringify with sorted keys so equal objects hash equally. */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export const hashInput = (obj) => sha256(stableStringify(obj));

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Parse ?page=&pageSize= with sane bounds. */
export function parsePaging(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export const pageResult = (items, total, { page, pageSize }) => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const round1 = (n) => Math.round(n * 10) / 10;
export const round0 = (n) => Math.round(n);

/** Escape for use inside a SQL LIKE pattern. */
export const likePattern = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // neutralise spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return `${[header, ...lines].join('\r\n')}\r\n`;
}

/** Drops undefined keys (so PATCH bodies only touch what was sent). */
export const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const camelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** Shallow snake_case -> camelCase (jsonb column contents are left untouched). */
export const camelRow = (row) =>
  row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [camelKey(k), v])) : row;
export const camelRows = (rows) => rows.map(camelRow);
