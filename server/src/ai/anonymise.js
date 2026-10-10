// Fairness + prompt-injection hygiene for anything sent to the model.
// - Removes direct identifiers (name, email, phone, links, college name) and lines that state
//   protected attributes (gender, age/DOB, religion, caste, nationality, marital status, parents).
// - Neutralises the delimiter tokens used in our prompts so the resume cannot "close" the data block.

const PROTECTED_LINE =
  /\b(gender|sex|dob|d\.o\.b|date of birth|birth ?date|age|religion|caste|category|nationality|marital|married|single|father|mother|guardian|hobbies? and gender)\b\s*[:\-–]/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github|gitlab|bitbucket)\.com\/\S+/gi;
// any run of digits/separators with >= 10 digits (so year ranges like 2021-2025 survive)
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

export const MAX_RESUME_CHARS = 12_000;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function anonymiseText(text, { fullName, collegeName } = {}) {
  let t = String(text ?? '');
  t = t
    .split('\n')
    .filter((line) => !PROTECTED_LINE.test(line))
    .join('\n');
  t = t.replace(EMAIL, '[email]').replace(URL_RE, '[link]').replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));

  if (collegeName && collegeName.trim().length >= 3) {
    t = t.replace(new RegExp(escapeRegExp(collegeName.trim()), 'gi'), '[college]');
  }
  if (fullName) {
    const parts = fullName.split(/\s+/).filter((p) => p.length >= 3);
    for (const p of [fullName.trim(), ...parts]) {
      t = t.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, 'gi'), '[name]');
    }
  }
  // the data fence must not be closable from inside the data
  t = t.replace(/<\/?\s*(resume_data|profile_data|drive_data|facts_data)\s*>/gi, ' ');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t.length > MAX_RESUME_CHARS ? `${t.slice(0, MAX_RESUME_CHARS)}\n[truncated]` : t;
}

/** Strings inside structured profile data get the same treatment (names/links/emails removed). */
export function anonymiseValue(value, ctx = {}) {
  if (typeof value === 'string') return anonymiseText(value, ctx).replace(/\n/g, ' ');
  if (Array.isArray(value)) return value.map((v) => anonymiseValue(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, anonymiseValue(v, ctx)]));
  }
  return value;
}
