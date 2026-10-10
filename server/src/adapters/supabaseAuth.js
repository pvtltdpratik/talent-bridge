import { createClient } from '@supabase/supabase-js';
import { AppError, conflict, unauthorized } from '../utils/errors.js';

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Thin adapter over Supabase Auth. Only this file knows about supabase-js auth calls, so tests can
 * replace it with an in-memory fake that has the same shape.
 */
export function createSupabaseAuth({ url, anonKey, serviceKey }) {
  const anon = createClient(url, anonKey, opts);
  const admin = createClient(url, serviceKey, opts);

  const wrap = (error, fallback = 'Authentication service error') => {
    const status = error?.status && error.status >= 400 && error.status < 500 ? error.status : 502;
    return new AppError(status, 'auth_provider_error', status === 502 ? fallback : error.message);
  };

  const sessionOf = (s) => ({
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresIn: s.expires_in,
    expiresAt: s.expires_at,
  });

  return {
    async signUp({ email, password, metadata }) {
      const { data, error } = await anon.auth.signUp({ email, password, options: { data: metadata } });
      if (error) {
        if (/already|registered/i.test(error.message)) throw conflict('An account with this email already exists', 'email_taken');
        if (/password/i.test(error.message)) throw new AppError(400, 'weak_password', error.message);
        throw wrap(error);
      }
      // Supabase returns an obfuscated user (no identities) when the email already exists.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw conflict('An account with this email already exists', 'email_taken');
      }
      return { userId: data.user.id, session: data.session ? sessionOf(data.session) : null };
    },

    async signIn({ email, password }) {
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        if (error && /confirm/i.test(error.message)) {
          throw new AppError(403, 'email_not_confirmed', 'Please confirm your email address before signing in.');
        }
        if (error && error.status >= 500) throw wrap(error);
        throw unauthorized('Incorrect email or password', 'invalid_credentials');
      }
      return { userId: data.user.id, session: sessionOf(data.session) };
    },

    async refresh(refreshToken) {
      const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw unauthorized('Session expired. Please sign in again.', 'invalid_token');
      return { userId: data.user.id, session: sessionOf(data.session) };
    },

    async sendPasswordReset(email, redirectTo) {
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error && error.status >= 500) throw wrap(error);
    },

    async userFromToken(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      if (error || !data.user) throw unauthorized('Invalid or expired link', 'invalid_token');
      return { id: data.user.id, email: data.user.email };
    },

    async setPassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) {
        if (/password/i.test(error.message)) throw new AppError(400, 'weak_password', error.message);
        throw wrap(error);
      }
    },

    async createUser({ email, password, metadata }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw conflict('An account with this email already exists', 'email_taken');
        if (/password/i.test(error.message)) throw new AppError(400, 'weak_password', error.message);
        throw wrap(error);
      }
      return { userId: data.user.id };
    },

    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) throw wrap(error);
    },

    async signOut(accessToken) {
      try {
        await admin.auth.admin.signOut(accessToken);
      } catch {
        /* best effort */
      }
    },
  };
}
