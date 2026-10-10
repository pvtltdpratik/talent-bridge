import { logger } from '../utils/logger.js';

/**
 * Optional email. Disabled unless SMTP_HOST is set. Callers must treat email as best-effort:
 * a failed or disabled send never fails the business operation.
 */
export function createMailer(env) {
  if (!env.SMTP_HOST) {
    return { enabled: false, async send() { return { skipped: true }; } };
  }
  let transport;
  return {
    enabled: true,
    async send({ to, subject, text }) {
      try {
        if (!transport) {
          const nodemailer = (await import('nodemailer')).default;
          transport = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_PORT === 465,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
          });
        }
        await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text });
        return { sent: true };
      } catch (err) {
        logger.warn('email send failed', { error: err.message });
        return { sent: false };
      }
    },
  };
}
