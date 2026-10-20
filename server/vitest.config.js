import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    // every API test file boots its own in-memory Postgres (WASM) and applies the migrations;
    // allow generous headroom and cap parallelism so a busy machine does not time out in beforeAll
    hookTimeout: 120_000,
    maxWorkers: 3,
    include: ['tests/**/*.test.js'],
    env: { NODE_ENV: 'test' },
  },
});
