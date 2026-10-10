import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatZodIssues } from './validate.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found', requestId: req.id } });
}

export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'bad_request';
    message = 'Please check the highlighted fields';
    details = formatZodIssues(err);
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'The request is too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'bad_json';
    message = 'Request body is not valid JSON';
  } else if (err?.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than the allowed size' : 'Upload failed';
  } else if (err?.code === '23505') {
    status = 409;
    code = 'duplicate';
    message = 'This record already exists';
  } else if (err?.code === '23503') {
    status = 409;
    code = 'conflict';
    message = 'This action conflicts with related data';
  } else if (err?.code === '22P02' || err?.code === '23514') {
    status = 400;
    code = 'bad_request';
    message = 'One of the provided values is not valid';
  }

  if (status >= 500) {
    logger.error('request failed', { requestId: req.id, path: req.path, method: req.method, error: err?.message, stack: err?.stack });
  }

  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}
