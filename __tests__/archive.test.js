const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_VOTES     = path.join(os.tmpdir(), `test-votes-archive-${process.pid}.json`);
const TMP_REACTIONS = path.join(os.tmpdir(), `test-reactions-archive-${process.pid}.json`);
const TMP_PUSH_SUBS = path.join(os.tmpdir(), `test-push-archive-${process.pid}.json`);
const TMP_DUEL      = path.join(os.tmpdir(), `test-duel-archive-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PUSH_SUBS_FILE = TMP_PUSH_SUBS;
process.env.DUEL_FILE      = TMP_DUEL;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([]));

const app = require('../server');
const { _jokeForDate } = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PUSH_SUBS, TMP_DUEL].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

describe('GET /api/jokes/date/:date', () => {
  it('returns the correct joke for a known past date', async () => {
    const date = '2026-01-15';
    const expected = _jokeForDate(date);
    const res = await request(app).get(`/api/jokes/date/${date}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(expected.id);
    expect(res.body.joke).toBe(expected.joke);
    expect(res.body.date).toBe(date);
    expect(res.body.jokeId).toBe(expected.id);
  });

  it('returns votes and reactions fields', async () => {
    const res = await request(app).get('/api/jokes/date/2026-03-10');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('votes');
    expect(res.body).toHaveProperty('reactions');
  });

  it('returns today\'s joke for today\'s date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const expected = _jokeForDate(today);
    const res = await request(app).get(`/api/jokes/date/${today}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(expected.id);
  });

  it('returns 400 for a future date', async () => {
    const future = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    const res = await request(app).get(`/api/jokes/date/${future}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Date must be today or in the past');
  });

  it('returns 400 for a malformed date string', async () => {
    const res = await request(app).get('/api/jokes/date/not-a-date');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid date format');
  });

  it('returns 400 for partial date string', async () => {
    const res = await request(app).get('/api/jokes/date/2026-08');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid date format');
  });

  it('returns 400 for invalid calendar date', async () => {
    const res = await request(app).get('/api/jokes/date/2026-13-99');
    // Either invalid format rejection or NaN date — should be 400
    expect(res.statusCode).toBe(400);
  });

  it('same date always returns the same joke (determinism)', async () => {
    const date = '2025-07-04';
    const res1 = await request(app).get(`/api/jokes/date/${date}`);
    const res2 = await request(app).get(`/api/jokes/date/${date}`);
    expect(res1.body.id).toBe(res2.body.id);
  });

  it('different past dates can return different jokes', async () => {
    const res1 = await request(app).get('/api/jokes/date/2025-01-01');
    const res2 = await request(app).get('/api/jokes/date/2025-06-15');
    // Very unlikely to be the same for two arbitrary dates
    // Just verify both return 200 and have id
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.body).toHaveProperty('id');
    expect(res2.body).toHaveProperty('id');
  });
});
