import crypto from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { AppError, conflict, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// A fixed hash so unknown e-mails cost the same as wrong passwords (no user enumeration by timing).
const DUMMY = hashPassword('talentbridge-timing-equaliser');

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') {
    await scrypt(password, Buffer.alloc(16));
    return false;
  }
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = await scrypt(password, salt);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Email/password accounts stored in the application database (schema "auth", see
 * supabase/standalone/bootstrap.sql). Same interface as adapters/supabaseAuth.js.
 * Only hashes are stored: scrypt for passwords, SHA-256 for refresh/recovery tokens.
 */
export function createLocalAuth({ db, jwtSecret, mailer, accessTtlSeconds = 3600, refreshTtlDays = 30, recoveryTtlMinutes = 60 }) {
  const key = new TextEncoder().encode(jwtSecret);

  async function issueSession(userId, email) {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ email, aud: 'authenticated', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('talentbridge')
      .setIssuedAt(now)
      .setExpirationTime(now + accessTtlSeconds)
      .sign(key);
    const refreshToken = token();
    await db.query('insert into auth.refresh_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || \' days\')::interval)', [
      sha256(refreshToken),
      userId,
      String(refreshTtlDays),
    ]);
    // opportunistic cleanup of this user's expired tokens
    await db.query('delete from auth.refresh_tokens where user_id = $1 and expires_at < now()', [userId]);
    return { accessToken, refreshToken, expiresIn: accessTtlSeconds, expiresAt: now + accessTtlSeconds };
  }

  async function insertUser(email, password) {
    if (typeof password !== 'string' || password.length < 8) {
      throw new AppError(400, 'weak_password', 'Password must be at least 8 characters');
    }
    const hash = await hashPassword(password);
    try {
      const { rows } = await db.query('insert into auth.users (email, encrypted_password) values ($1, $2) returning id', [
        email.toLowerCase(),
        hash,
      ]);
      return rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw conflict('An account with this email already exists', 'email_taken');
      throw err;
    }
  }

  return {
    async signUp({ email, password }) {
      const userId = await insertUser(email, password);
      return { userId, session: await issueSession(userId, email.toLowerCase()) };
    },

    async createUser({ email, password }) {
      return { userId: await insertUser(email, password) };
    },

    async signIn({ email, password }) {
      const { rows } = await db.query('select id, email, encrypted_password from auth.users where lower(email) = lower($1)', [email]);
      const user = rows[0];
      const ok = user ? await verifyPassword(password, user.encrypted_password) : (await verifyPassword(password, await DUMMY), false);
      if (!ok) throw unauthorized('Incorrect email or password', 'invalid_credentials');
      return { userId: user.id, session: await issueSession(user.id, user.email) };
    },

    /** Rotating refresh: each token works once. */
    async refresh(refreshToken) {
      const { rows } = await db.query(
        `delete from auth.refresh_tokens where token_hash = $1 and expires_at > now() returning user_id`,
        [sha256(refreshToken ?? '')],
      );
      if (!rows[0]) throw unauthorized('Session expired. Please sign in again.', 'invalid_token');
      const user = (await db.query('select id, email from auth.users where id = $1', [rows[0].user_id])).rows[0];
      if (!user) throw unauthorized('Session expired. Please sign in again.', 'invalid_token');
      return { userId: user.id, session: await issueSession(user.id, user.email) };
    },

    async sendPasswordReset(email, redirectTo) {
      const user = (await db.query('select id, email from auth.users where lower(email) = lower($1)', [email])).rows[0];
      if (!user) return; // same outward behaviour whether or not the account exists
      const raw = token();
      await db.query('insert into auth.recovery_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || \' minutes\')::interval)', [
        sha256(raw),
        user.id,
        String(recoveryTtlMinutes),
      ]);
      if (mailer?.enabled) {
        await mailer.send({
          to: user.email,
          subject: 'Reset your TalentBridge AI password',
          text: `Use this link within ${recoveryTtlMinutes} minutes to choose a new password:\n\n${redirectTo}#access_token=${raw}&type=recovery\n\nIf you did not ask for this, ignore this email.`,
        });
      } else {
        logger.warn('password reset requested but email is not configured; no message was sent');
      }
    },

    /** Resolves a recovery token (from the reset link) to its user without consuming it. */
    async userFromToken(recoveryToken) {
      const { rows } = await db.query(
        `select u.id, u.email from auth.recovery_tokens t join auth.users u on u.id = t.user_id
          where t.token_hash = $1 and t.expires_at > now()`,
        [sha256(recoveryToken ?? '')],
      );
      if (!rows[0]) throw unauthorized('Invalid or expired link', 'invalid_token');
      return rows[0];
    },

    /** New password; burns every recovery token and signs the user out everywhere. */
    async setPassword(userId, password) {
      if (typeof password !== 'string' || password.length < 8) {
        throw new AppError(400, 'weak_password', 'Password must be at least 8 characters');
      }
      const hash = await hashPassword(password);
      await db.query('update auth.users set encrypted_password = $2 where id = $1', [userId, hash]);
      await db.query('delete from auth.recovery_tokens where user_id = $1', [userId]);
      await db.query('delete from auth.refresh_tokens where user_id = $1', [userId]);
    },

    async deleteUser(userId) {
      await db.query('delete from auth.users where id = $1', [userId]);
    },

    /** Global sign-out: revoke every refresh token of the access token's user. */
    async signOut(accessToken) {
      try {
        const { sub } = decodeJwt(accessToken);
        if (sub) await db.query('delete from auth.refresh_tokens where user_id = $1', [sub]);
      } catch {
        /* malformed token: nothing to revoke */
      }
    },
  };
}
