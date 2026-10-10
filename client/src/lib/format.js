// India locale helpers: en-IN numbers, INR currency, IST dates.
const TZ = 'Asia/Kolkata';

export const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) : '—';

export const fmtDateTime = (v) =>
  v
    ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ })
    : '—';

export const fmtINR = (v) => (v == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v));
export const fmtNum = (v, digits = 0) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits }));

export function relativeDeadline(v) {
  if (!v) return '';
  const ms = new Date(v).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Closes in under an hour';
  if (hours < 48) return `Closes in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `Closes in ${Math.floor(hours / 24)} days`;
}

export const titleCase = (s) =>
  String(s ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());

/** datetime-local input value (browser local time) from an ISO string, and back */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : undefined);
