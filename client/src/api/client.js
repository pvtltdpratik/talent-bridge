// Fetch wrapper: Bearer auth, single in-flight token refresh, normalised errors.
// The browser only ever talks to our API. There is no Supabase SDK or key in the client.
/** API prefix from VITE_API_URL. Trailing slashes are dropped so "https://api.x.dev/" cannot become "https://api.x.dev//api". */
export const apiBase = (raw) => `${String(raw ?? '').trim().replace(/\/+$/, '')}/api`;
const BASE = apiBase(import.meta.env.VITE_API_URL);
const STORAGE_KEY = 'tb.session';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---- session storage (wrapped: private windows / blocked storage must not break the app) -----
function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}
let session = read();
const listeners = new Set();

export const sessionStore = {
  get: () => session,
  set(next) {
    session = next;
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: keep in memory only */
    }
    listeners.forEach((l) => l(next));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// ---- request -------------------------------------------------------------------------------
let refreshing = null;
async function refreshSession() {
  const current = session;
  if (!current?.refreshToken) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('refresh failed');
      const json = await res.json();
      sessionStore.set(json.data.session);
      return true;
    })
    .catch(() => {
      sessionStore.set(null);
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function buildUrl(path, query) {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(method, path, { query, body, form, blob, retry = true } = {}) {
  const headers = {};
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && retry && session?.refreshToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request(method, path, { query, body, form, blob, retry: false });
  }

  if (!res.ok) {
    let err;
    try {
      err = (await res.json()).error;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong. Please try again.', err?.details);
  }
  if (res.status === 204) return null;
  if (blob) return res.blob();
  return (await res.json()).data;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  delete: (path) => request('DELETE', path),
  upload: (path, file) => {
    const form = new FormData();
    form.append('file', file);
    return request('POST', path, { form });
  },
  download: async (path, query, filename) => {
    const blob = await request('GET', path, { query, blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/** Field-level messages from a 400 response -> { field: message } for react-hook-form. */
export function fieldErrors(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(error.details.filter((d) => d?.field).map((d) => [d.field, d.message]));
}
