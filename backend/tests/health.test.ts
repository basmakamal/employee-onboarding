import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('health endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/ready reports up when the DB check passes', async () => {
    const app = createApp({ checkReady: async () => {} });
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { db: 'up' } });
  });

  it('GET /api/ready returns 503 when the DB check fails', async () => {
    const app = createApp({
      checkReady: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not-ready', checks: { db: 'down' } });
  });
});
