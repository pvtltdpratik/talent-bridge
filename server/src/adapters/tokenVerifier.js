import { createRemoteJWKSet, jwtVerify } from 'jose';
import { unauthorized } from '../utils/errors.js';

/**
 * Verifies Supabase-issued access tokens locally (no network call per request).
 * - If `jwtSecret` is set: HS256 (legacy Supabase projects / tests)
 * - Otherwise: the project's JWKS (asymmetric signing keys)
 */
export function createTokenVerifier({ supabaseUrl, jwtSecret }) {
  const issuer = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined;
  const secretKey = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const jwks = !secretKey && supabaseUrl ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

  return {
    async verify(token) {
      try {
        const options = { audience: 'authenticated', ...(issuer && !secretKey ? { issuer } : {}) };
        const { payload } = secretKey
          ? await jwtVerify(token, secretKey, { ...options, algorithms: ['HS256'] })
          : await jwtVerify(token, jwks, options);
        if (!payload.sub) throw new Error('missing sub');
        return { sub: payload.sub, email: payload.email ?? null };
      } catch {
        throw unauthorized('Your session is invalid or has expired. Please sign in again.', 'invalid_token');
      }
    },
  };
}
