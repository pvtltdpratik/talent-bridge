import { z } from 'zod';

export class AiError extends Error {
  /** kind: not_configured | rate_limited | timeout | unavailable | invalid_output | empty | blocked */
  constructor(kind, message) {
    super(message ?? kind);
    this.name = 'AiError';
    this.kind = kind;
  }
}

export const toGeminiSchema = (zodSchema) => {
  const js = z.toJSONSchema(zodSchema, { target: 'draft-7', io: 'input', unrepresentable: 'any' });
  delete js.$schema;
  return js;
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal Gemini REST client (server-side only).
 * - key from env, sent in a header (never in the URL, never logged)
 * - timeout per attempt, exponential backoff with jitter on 429 / 5xx / network errors
 * - returns the *parsed JSON* of the first candidate; schema validation is the caller's job
 */
export function createGeminiClient({
  apiKey,
  model,
  timeoutMs = 30_000,
  maxAttempts = 3,
  baseDelayMs = 600,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}) {
  const configured = Boolean(apiKey && model);

  return {
    configured,
    model,

    async generate({ system, user, schema, temperature = 0.2, maxOutputTokens = 4096 }) {
      if (!configured) throw new AiError('not_configured', 'Gemini is not configured');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: toGeminiSchema(schema),
        },
      });

      let lastError = new AiError('unavailable');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body,
            signal: controller.signal,
          });
        } catch (err) {
          lastError = err?.name === 'AbortError' ? new AiError('timeout') : new AiError('unavailable');
        } finally {
          clearTimeout(timer);
        }

        if (res) {
          if (res.status === 429) lastError = new AiError('rate_limited');
          else if (res.status >= 500) lastError = new AiError('unavailable');
          else if (!res.ok) throw new AiError('unavailable', `Gemini rejected the request (${res.status})`); // non-retryable
          else return parseResponse(await res.json().catch(() => null));
        }

        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
        }
      }
      throw lastError;
    },
  };
}

function parseResponse(json) {
  if (!json) throw new AiError('invalid_output', 'Response body was not JSON');
  if (json.promptFeedback?.blockReason) throw new AiError('blocked', 'The request was blocked by the safety system');
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new AiError('empty', 'Model returned no content');
  if (candidate.finishReason === 'MAX_TOKENS') throw new AiError('invalid_output', 'Model output was truncated');
  try {
    return JSON.parse(text);
  } catch {
    // tolerate a ```json fence
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        /* fall through */
      }
    }
    throw new AiError('invalid_output', 'Model returned invalid JSON');
  }
}
