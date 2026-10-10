// Process-wide dependency container. Populated once at startup (src/index.js) or by tests.
// Keeping this explicit (instead of importing clients directly) lets tests swap Postgres for PGlite,
// Supabase Auth/Storage for in-memory fakes and Gemini for a scripted mock.
export const ctx = {
  env: null, // parsed env
  db: null, // { query, tx, end }
  verifier: null, // { verify(token) => { sub, email } }
  authAdmin: null, // supabase auth adapter (see adapters/supabaseAuth.js)
  storage: null, // { upload, signedUrl, remove }
  gemini: null, // { configured, model, generate() }
  mailer: null, // { enabled, send() }
};

export function initContext(deps) {
  Object.assign(ctx, deps);
  return ctx;
}

export const db = () => {
  if (!ctx.db) throw new Error('Database is not initialised');
  return ctx.db;
};
