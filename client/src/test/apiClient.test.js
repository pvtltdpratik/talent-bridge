import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiBase, ApiError, fieldErrors, sessionStore } from '../api/client.js';

describe('apiBase', () => {
  it('never produces a double slash, whatever the configured URL looks like', () => {
    expect(apiBase('')).toBe('/api');
    expect(apiBase(undefined)).toBe('/api');
    expect(apiBase('https://talentbridge.khaadsetu-ec2.workers.dev')).toBe('https://talentbridge.khaadsetu-ec2.workers.dev/api');
    expect(apiBase('https://talentbridge.khaadsetu-ec2.workers.dev/')).toBe('https://talentbridge.khaadsetu-ec2.workers.dev/api');
    expect(apiBase('  https://api.example.com///  ')).toBe('https://api.example.com/api');
  });
});

const json = (status, body) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['x']) });

describe('api client', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sessionStore.set({ accessToken: 'old', refreshToken: 'r1' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStore.set(null);
  });

  it('sends the bearer token and unwraps { data }', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ok: 1 } }));
    expect(await api.get('/students/me')).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/students/me');
    expect(init.headers.Authorization).toBe('Bearer old');
  });

  it('drops empty query params', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    await api.get('/drives', { q: '', status: 'open', page: undefined });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/drives?status=open');
  });

  it('refreshes the token once on 401 and retries the request', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'invalid_token', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { data: { session: { accessToken: 'new', refreshToken: 'r2' } } }))
      .mockResolvedValueOnce(json(200, { data: { hello: 'world' } }));
    expect(await api.get('/students/me')).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
    expect(sessionStore.get().accessToken).toBe('new');
  });

  it('signs the user out when refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'invalid_token', message: 'expired' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'invalid_token', message: 'nope' } }));
    await expect(api.get('/students/me')).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get()).toBeNull();
  });

  it('normalises errors and exposes field messages', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { code: 'bad_request', message: 'Please check the highlighted fields', details: [{ field: 'cgpa', message: 'Too high' }] } }),
    );
    const err = await api.put('/students/me', { cgpa: 11 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(fieldErrors(err)).toEqual({ cgpa: 'Too high' });
  });

  it('reports network failures with a friendly message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await api.get('/drives').catch((e) => e);
    expect(err.code).toBe('network_error');
    expect(err.message).toMatch(/cannot reach the server/i);
  });

  it('does not try to refresh failed logins', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'invalid_credentials', message: 'Incorrect email or password' } }));
    await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toThrow('Incorrect email or password');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
