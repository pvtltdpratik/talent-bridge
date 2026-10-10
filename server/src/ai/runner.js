import { ctx } from '../context.js';
import { aiResults } from '../repositories/system.js';
import { getSettings } from '../services/common.js';
import { hashInput } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { AiError } from './gemini.js';
import { PROMPT_VERSION } from './prompts/v1/index.js';

const MESSAGES = {
  disabled: 'AI features are currently turned off by the administrator.',
  not_configured: 'AI is not configured on this server yet.',
  rate_limited: 'The AI service is busy right now. Please try again in a minute.',
  timeout: 'The AI service took too long to respond. Please try again.',
  unavailable: 'The AI service is unavailable right now. Please try again later.',
  invalid_output: 'The AI returned an answer we could not use. Please try again.',
  empty: 'The AI returned no answer. Please try again.',
  blocked: 'The AI could not process this content.',
};

export const aiUnavailable = (reason) => ({ status: 'unavailable', reason, message: MESSAGES[reason] ?? MESSAGES.unavailable });

/** Stable hash of (feature, prompt version, relevant inputs). The model name is deliberately excluded. */
export const inputHash = (feature, hashObj) => hashInput({ f: feature, pv: PROMPT_VERSION, i: hashObj });

const okResult = (row, cached) => ({
  status: 'ok',
  data: row.output,
  meta: { cached, model: row.model, promptVersion: row.promptVersion, generatedAt: row.createdAt, inputHash: row.inputHash },
});

/** Cache lookup without spending anything. state: fresh (matches current inputs) | stale | none */
export async function peek({ feature, userId, scopeKey, hashObj }) {
  const hash = inputHash(feature, hashObj);
  const exact = await aiResults.findOk({ feature, userId, scopeKey, inputHash: hash });
  if (exact) return { state: 'fresh', row: exact };
  const latest = await aiResults.findLatestOk({ feature, userId, scopeKey });
  return latest ? { state: 'stale', row: latest } : { state: 'none', row: null };
}

export function shapeCached(peeked) {
  if (peeked.state === 'none') return { status: 'none' };
  return { ...okResult(peeked.row, true), stale: peeked.state === 'stale' };
}

/**
 * Runs an AI feature with: on/off switch, config check, input-hash cache, schema validation,
 * one retry on unusable output, and a stored record of success or failure.
 * Never throws for AI problems: returns { status: 'unavailable', reason, message } instead so the
 * deterministic parts of the page keep working.
 */
export async function runFeature({ feature, userId, driveId = null, scopeKey, hashObj, schema, prompt, force = false, temperature }) {
  const settings = await getSettings();
  if (!settings.ai_enabled) return aiUnavailable('disabled');
  if (!ctx.gemini?.configured) return aiUnavailable('not_configured');

  const hash = inputHash(feature, hashObj);
  if (!force) {
    const cached = await aiResults.findOk({ feature, userId, scopeKey, inputHash: hash });
    if (cached) return okResult(cached, true);
  }

  let validated;
  let failure;
  for (let attempt = 1; attempt <= 2 && !validated; attempt += 1) {
    try {
      const raw = await ctx.gemini.generate({ system: prompt.system, user: prompt.user, schema, temperature });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new AiError('invalid_output', 'Schema validation failed');
      validated = parsed.data;
    } catch (err) {
      failure = err instanceof AiError ? err : new AiError('unavailable', err?.message);
      if (failure.kind !== 'invalid_output' && failure.kind !== 'empty') break; // only retry unusable output
    }
  }

  const model = ctx.gemini.model;
  if (!validated) {
    logger.warn('ai feature failed', { feature, kind: failure?.kind });
    await aiResults
      .insertFailed({ feature, userId, driveId, scopeKey, model, promptVersion: PROMPT_VERSION, inputHash: hash, error: failure?.kind ?? 'unavailable' })
      .catch(() => {});
    return aiUnavailable(failure?.kind ?? 'unavailable');
  }

  const row = await aiResults.upsertOk({ feature, userId, driveId, scopeKey, model, promptVersion: PROMPT_VERSION, inputHash: hash, output: validated });
  return okResult(row, false);
}
