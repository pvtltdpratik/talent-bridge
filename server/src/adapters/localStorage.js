import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/errors.js';

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Private file store on local disk with short-lived, HMAC-signed links
 * (GET /api/files/:token). The directory is never served directly: the only way to read a file is a
 * token minted by the API after an ownership / college check.
 */
export function createLocalStorage({ dir, secret, publicBaseUrl = '' }) {
  const root = path.resolve(dir);
  const hmacKey = crypto.createHmac('sha256', secret).update('talentbridge/file-links/v1').digest();
  const sign = (payload) => crypto.createHmac('sha256', hmacKey).update(payload).digest('base64url');

  // storage keys come from the server (uuid paths), but never trust them to stay inside the root
  const resolveInside = (key) => {
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) throw new AppError(400, 'bad_path', 'Invalid file path');
    return full;
  };

  return {
    root,

    async upload(key, buffer) {
      const full = resolveInside(key);
      await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(full, buffer, { flag: 'wx', mode: 0o600 });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(502, 'storage_error', 'Could not store the file. Please try again.');
      }
    },

    async signedUrl(key, expiresInSeconds = 120) {
      const full = resolveInside(key);
      await fs.access(full).catch(() => {
        throw new AppError(404, 'not_found', 'File not found');
      });
      const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString('base64url');
      return `${publicBaseUrl}/api/files/${payload}.${sign(payload)}`;
    },

    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        await fs.unlink(resolveInside(key)).catch(() => {});
      }
    },

    /** Verifies a link token. Returns { fullPath, contentType, filename } or null. */
    async resolveToken(tokenString) {
      const [payload, mac] = String(tokenString ?? '').split('.');
      if (!payload || !mac) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(mac);
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
      let data;
      try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (typeof data.k !== 'string' || typeof data.e !== 'number' || data.e < Math.floor(Date.now() / 1000)) return null;
      const fullPath = resolveInside(data.k);
      const exists = await fs.stat(fullPath).then((s) => s.isFile()).catch(() => false);
      if (!exists) return null;
      const ext = path.extname(fullPath).toLowerCase();
      return { fullPath, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream', filename: `resume${ext}` };
    },
  };
}
