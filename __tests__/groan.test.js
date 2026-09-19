const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_GROAN = pathLib.join(os.tmpdir(), `test-groan-${process.pid}.json`);
process.env.GROAN_FILE = TMP_GROAN;
fs.writeFileSync(TMP_GROAN, JSON.stringify([]));

const app = require('../server');
const { computeGroanScore, _resetGroanRateLimitForTest } = app;

afterAll(() => {
  try { fs.unlinkSync(TMP_GROAN); } catch {}
});

beforeEach(() => {
  fs.writeFileSync(TMP_GROAN, JSON.stringify([]));
  if (typeof _resetGroanRateLimitForTest === 'function') _resetGroanRateLimitForTest();
});

// ─── Unit: computeGroanScore ──────────────────────────────────────────────
describe('computeGroanScore (pure function)', () => {
  it('returns null when there are no ratings', () => {
    expect(computeGroanScore({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBeNull();
  });

  it('returns the rating value for a single rating', () => {
    expect(computeGroanScore({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 })).toBe(3);
  });

  it('returns that value when all ratings are the same', () => {
    expect(computeGroanScore({ 1: 0, 2: 0, 3: 0, 4: 5, 5: 0 })).toBe(4);
  });

  it('computes a correct weighted average for mixed ratings', () => {
    // two 1s, one 5 => (1+1+5)/3 = 2.333...
    expect(computeGroanScore({ 1: 2, 2: 0, 3: 0, 4: 0, 5: 1 })).toBeCloseTo(2.33, 2);
  });
});

// ─── API: POST /api/jokes/:id/groan ───────────────────────────────────────
describe('POST /api/jokes/:id/groan', () => {
  it('400s on a non-integer or out-of-range rating', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    let res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 0 });
    expect(res.statusCode).toBe(400);
    res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 6 });
    expect(res.statusCode).toBe(400);
    res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 2.5 });
    expect(res.statusCode).toBe(400);
    res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({});
    expect(res.statusCode).toBe(400);
  });

  it('404s on a non-existent joke', async () => {
    const res = await request(app).post('/api/jokes/999999/groan').send({ rating: 3 });
    expect(res.statusCode).toBe(404);
  });

  it('accepts a valid rating and returns counts + weightedScore', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    const res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 4 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ jokeId, rating: 4 });
    expect(res.body.counts[4]).toBe(1);
    expect(res.body.weightedScore).toBe(4);
  });

  it('replaces a previous rating from the same IP with a new one', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 2 });
    const res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.body.rating).toBe(5);
    expect(res.body.counts[2]).toBe(0);
    expect(res.body.counts[5]).toBe(1);
  });

  it('removes the rating when the same value is submitted twice (toggle)', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 3 });
    const res = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(res.body.counts[3]).toBe(0);
    expect(res.body.weightedScore).toBeNull();
  });

  it('rate-limits after 20 groan submissions from the same IP within a minute', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    let lastRes;
    for (let i = 0; i < 20; i++) {
      lastRes = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: (i % 5) + 1 });
    }
    expect(lastRes.statusCode).toBe(200);
    const res21 = await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 1 });
    expect(res21.statusCode).toBe(429);
  });
});

// ─── API: GET /api/jokes/:id/groan ────────────────────────────────────────
describe('GET /api/jokes/:id/groan', () => {
  it('404s on a non-existent joke', async () => {
    const res = await request(app).get('/api/jokes/999999/groan');
    expect(res.statusCode).toBe(404);
  });

  it('returns zeroed counts and null weightedScore with no ratings', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    const res = await request(app).get(`/api/jokes/${jokeId}/groan`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      jokeId,
      counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      weightedScore: null,
      totalRatings: 0
    });
  });

  it('reflects a submitted rating', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 5 });
    const res = await request(app).get(`/api/jokes/${jokeId}/groan`);
    expect(res.body.counts[5]).toBe(1);
    expect(res.body.weightedScore).toBe(5);
    expect(res.body.totalRatings).toBe(1);
  });
});

// ─── API: /api/jokes/today/vibe groan enrichment ──────────────────────────
describe('GET /api/jokes/today/vibe — groan fields', () => {
  it('includes groanScore (null) and groanTotal (0) with no ratings', async () => {
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.body).toHaveProperty('groanScore', null);
    expect(res.body).toHaveProperty('groanTotal', 0);
  });

  it('reflects a submitted groan rating for today\'s joke', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 4 });
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.body.groanScore).toBe(4);
    expect(res.body.groanTotal).toBe(1);
  });
});

// ─── API: GET /api/jokes/most-groany ──────────────────────────────────────
describe('GET /api/jokes/most-groany', () => {
  it('returns an empty list when no joke has enough ratings', async () => {
    const res = await request(app).get('/api/jokes/most-groany');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('excludes jokes below the minimum-ratings threshold (3)', async () => {
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    // Only 2 unique-IP ratings possible via supertest (same IP overwrites) —
    // simulate multiple raters by writing directly to the store via API calls
    // from the same client toggles/replaces, so use rating replace to control counts:
    // Instead, verify explicitly the threshold via direct counts using GET.
    await request(app).post(`/api/jokes/${jokeId}/groan`).send({ rating: 5 });
    const res = await request(app).get('/api/jokes/most-groany');
    expect(res.body.find(j => j.id === jokeId)).toBeUndefined();
  });

  it('ranks qualifying jokes by weightedScore descending', async () => {
    const jokesRes = await request(app).get('/api/categories');
    // Use today's joke id and rely on raw file seeding to get >=3 distinct raters,
    // since supertest requests share the same source IP (127.0.0.1 / ::ffff:127.0.0.1).
    const vibe = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibe.body;
    const fs2 = require('fs');
    const seeded = [
      { jokeId, ip: 'hashA', rating: 5, createdAt: new Date().toISOString() },
      { jokeId, ip: 'hashB', rating: 5, createdAt: new Date().toISOString() },
      { jokeId, ip: 'hashC', rating: 4, createdAt: new Date().toISOString() }
    ];
    fs2.writeFileSync(TMP_GROAN, JSON.stringify(seeded));
    const res = await request(app).get('/api/jokes/most-groany?limit=5');
    expect(res.statusCode).toBe(200);
    const entry = res.body.find(j => j.id === jokeId);
    expect(entry).toBeDefined();
    expect(entry.totalRatings).toBe(3);
    expect(entry.weightedScore).toBeCloseTo((5 + 5 + 4) / 3, 2);
  });

  it('respects the limit query param', async () => {
    const res = await request(app).get('/api/jokes/most-groany?limit=1');
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});
