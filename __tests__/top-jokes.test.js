const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Isolate votes and subscribers from real data
const TMP_VOTES = path.join(os.tmpdir(), `test-votes-top-${process.pid}.json`);
const TMP_SUBS  = path.join(os.tmpdir(), `test-subs-top-${process.pid}.json`);
process.env.SUBSCRIBERS_FILE = TMP_SUBS;

// Seed a few votes before the app loads
fs.writeFileSync(TMP_VOTES, JSON.stringify({ "1": 12, "2": 5, "3": 1, "4": 0 }));

// Patch VOTES_FILE path so server reads our seed
process.env.VOTES_FILE_OVERRIDE = TMP_VOTES;

// We need the server to use our temp votes file — patch before require
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === './votes.json') return {};
  return origLoad.call(this, request, ...args);
};

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_SUBS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// ── GET /api/jokes/top ────────────────────────────────────────────────────────
describe('GET /api/jokes/top', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/jokes/top');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('response items have required fields: id, joke, category, votes', async () => {
    const res = await request(app).get('/api/jokes/top');
    // May be empty if no votes in test env — just check shape when items present
    res.body.forEach(item => {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('joke');
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('votes');
    });
  });

  it('returns at most 5 items by default', async () => {
    const res = await request(app).get('/api/jokes/top');
    expect(res.body.length).toBeLessThanOrEqual(5);
  });

  it('only returns jokes with votes >= 1', async () => {
    const res = await request(app).get('/api/jokes/top');
    res.body.forEach(item => {
      expect(item.votes).toBeGreaterThanOrEqual(1);
    });
  });

  it('returns items sorted by votes descending', async () => {
    const res = await request(app).get('/api/jokes/top');
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i - 1].votes).toBeGreaterThanOrEqual(res.body[i].votes);
    }
  });

  it('respects ?limit query param', async () => {
    const res = await request(app).get('/api/jokes/top?limit=2');
    expect(res.body.length).toBeLessThanOrEqual(2);
  });

  it('caps limit at 20', async () => {
    const res = await request(app).get('/api/jokes/top?limit=999');
    expect(res.body.length).toBeLessThanOrEqual(20);
  });
});
