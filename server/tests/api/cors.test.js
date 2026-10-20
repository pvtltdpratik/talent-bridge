import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestEnv } from '../helpers/harness.js';

let t;
let app;
const VERCEL = 'https://talent-bridge-sand.vercel.app';

beforeAll(async () => {
  t = await createTestEnv();
  // a trailing slash and odd casing in the configured value must not break matching
  const env = { NODE_ENV: 'test', CORS_ORIGINS: ` ${VERCEL}/ , http://LOCALHOST:5173 `, CLIENT_URL: VERCEL };
  const big = { limit: 100000 };
  app = createApp({ env, limits: { api: big, login: big, register: big, passwordReset: big, upload: big, aiUser: big, aiGlobal: big } });
});
afterAll(() => t.close());

describe('CORS', () => {
  it('allows a configured origin and echoes it back', async () => {
    const res = await request(app).get('/api/auth/colleges').set('Origin', VERCEL);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(VERCEL);
    expect(res.headers.vary).toMatch(/Origin/i);
  });

  it('matches regardless of trailing slash / case in the config', async () => {
    const res = await request(app).get('/api/auth/colleges').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow an unlisted origin', async () => {
    const res = await request(app).get('/api/auth/colleges').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight from an allowed origin with the headers a logged-in call needs', async () => {
    const res = await request(app)
      .options('/api/students/me')
      .set('Origin', VERCEL)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(VERCEL);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/);
  });

  it('gives no CORS permission on a preflight from an unlisted origin', async () => {
    const res = await request(app)
      .options('/api/students/me')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('doubled leading slash', () => {
  it('serves //api/... exactly like /api/..., with CORS headers', async () => {
    const res = await request(app).get('//api/auth/colleges').set('Origin', VERCEL);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: expect.any(Array) });
    expect(res.headers['access-control-allow-origin']).toBe(VERCEL);
  });

  it('also covers deeper repetition and the health endpoint', async () => {
    expect((await request(app).get('////api/health')).status).toBe(200);
    expect((await request(app).get('//health')).status).toBe(200);
  });

  it('still 404s genuinely unknown routes, and unknown routes still carry CORS headers for allowed origins', async () => {
    const res = await request(app).get('//api/nope').set('Origin', VERCEL);
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(VERCEL);
  });
});
