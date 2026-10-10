import { badRequest } from '../utils/errors.js';

export function formatZodIssues(error) {
  return error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

/**
 * validate({ body, query, params }) — parses with zod and exposes the *parsed* values on `req.valid`.
 * (Express 5 makes req.query read-only, so we never mutate the request.)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        throw badRequest('Please check the highlighted fields', formatZodIssues(result.error));
      }
      valid[part] = result.data;
    }
    req.valid = valid;
    next();
  };
}
