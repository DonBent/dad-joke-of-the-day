const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Isolate all data files
const TMP_VOTES = path.join(os.tmpdir(), `test-votes-hof-${process.pid}.json`);
const TMP_SUBS  = path.join(os.tmpdir(), `test-subs-hof-${process.pid}.json`);
const TMP_HOF   = path.join(os.tmpdir(), `test-hof-${process.pid}.json`);

process.env.SUBSCRIBERS_FILE   = TMP_SUBS;
process.env.HALL_OF_FAME_FILE  = TMP_HOF;

// Seed a few votes so we have a winner to freeze
fs.writeFileSync(TMP_VOTES, JSON.stringify({ "1": 99, "2": 5 }));
fs.writeFileSync(TMP_HOF,   JSON.stringify([]));

// Patch votes file path before app loads
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...args) {
  if (req === './votes.json') return {};
  return origLoad.call(this, req, ...args);
};

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_SUBS, TMP_HOF].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  // reset hall-of-fame file env
  delete process.env.HALL_OF_FAME_FILE;
});

// ── GET /api/jokes/hall-of-fame ───────────────────────────────────────────────
describe('GET /api/jokes/hall-of-fame', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/jokes/hall-of-fame');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns empty array when no entries exist', async () => {
    const res = await request(app).get('/api/jokes/hall-of-fame');
    expect(res.body).toEqual([]);
  });
});

// ── POST /api/admin/freeze-hall-of-fame ──────────────────────────────────────
describe('POST /api/admin/freeze-hall-of-fame', () => {
  const adminHeaders = { 'x-admin-token': 'dev-admin-token' };
  const testMonth = '2026-06';

  afterEach(() => {
    // Clean HOF between tests
    fs.writeFileSync(TMP_HOF, JSON.stringify([]));
  });

  it('rejects missing admin token with 403', async () => {
    const res = await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .send({ month: testMonth });
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid month format with 400', async () => {
    const res = await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: 'June 2026' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM/);
  });

  it('creates a hall of fame entry for the given month', async () => {
    const res = await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: testMonth });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('month', testMonth);
    expect(res.body).toHaveProperty('jokeId');
    expect(res.body).toHaveProperty('text');
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('permalink');
    expect(res.body).toHaveProperty('frozenAt');
    expect(res.body.score).toBeGreaterThanOrEqual(1);
  });

  it('returns 409 if month already exists', async () => {
    // First freeze
    await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: testMonth });
    // Second freeze for same month
    const res = await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: testMonth });
    expect(res.statusCode).toBe(409);
  });

  it('persists entry so GET returns it', async () => {
    await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: testMonth });
    const res = await request(app).get('/api/jokes/hall-of-fame');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].month).toBe(testMonth);
  });

  it('GET returns entries in reverse-chronological order', async () => {
    const months = ['2026-01', '2026-03', '2026-02'];
    for (const m of months) {
      await request(app)
        .post('/api/admin/freeze-hall-of-fame')
        .set(adminHeaders)
        .send({ month: m });
    }
    const res = await request(app).get('/api/jokes/hall-of-fame');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].month).toBe('2026-03');
    expect(res.body[1].month).toBe('2026-02');
    expect(res.body[2].month).toBe('2026-01');
  });

  it('permalink contains #joke-<id>', async () => {
    const res = await request(app)
      .post('/api/admin/freeze-hall-of-fame')
      .set(adminHeaders)
      .send({ month: testMonth });
    expect(res.body.permalink).toMatch(/#joke-\d+$/);
  });
});

// ── GET /hall-of-fame page ───────────────────────────────────────────────────
describe('GET /hall-of-fame', () => {
  it('returns 200 HTML page', async () => {
    const res = await request(app).get('/hall-of-fame');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('page contains Hall of Fame heading', async () => {
    const res = await request(app).get('/hall-of-fame');
    expect(res.text).toContain('Hall of Fame');
  });

  it('page contains nav back link to home', async () => {
    const res = await request(app).get('/hall-of-fame');
    expect(res.text).toContain('href="/"');
  });
});
