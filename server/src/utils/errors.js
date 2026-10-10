export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Invalid request', details) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required', code = 'unauthorized') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this', code = 'forbidden', details) =>
  new AppError(403, code, message, details);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const conflict = (message = 'Conflict', code = 'conflict', details) => new AppError(409, code, message, details);
export const unprocessable = (message, code = 'unprocessable', details) => new AppError(422, code, message, details);
export const tooMany = (message = 'Too many requests, please try again later') =>
  new AppError(429, 'rate_limited', message);

/** Postgres unique violation helper (SQLSTATE 23505). */
export const isUniqueViolation = (err, constraint) =>
  err?.code === '23505' && (!constraint || err.constraint === constraint || String(err.message).includes(constraint));
