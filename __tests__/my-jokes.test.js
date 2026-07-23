/**
 * my-jokes.test.js
 * Uses jest.isolateModules to guarantee server.js is loaded fresh
 * with the correct temp file env vars.
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TMP_VOTES       = path.join(os.tmpdir(), `mj-votes-${process.pid}.json`);
const TMP_SUBS        = path.join(os.tmpdir(), `mj-subs-${process.pid}.json`);
const TMP_CUSTOM      = path.join(os.tmpdir(), `mj-custom-${process.pid}.json`);
const TMP_HOF         = path.join(os.tmpdir(), `mj-hof-${process.pid}.json`);
const TMP_SUBSCRIBERS = path.join(os.tmpdir(), `mj-subscribers-${process.pid}.json`);

function writeTmpFiles() {
  fs.writeFileSync(TMP_VOTES,       JSON.stringify({}));
  fs.writeFileSync(TMP_SUBS,        JSON.stringify([]));
  fs.writeFileSync(TMP_CUSTOM,      JSON.stringify([]));
  fs.writeFileSync(TMP_HOF,         JSON.stringify([]));
  fs.writeFileSync(TMP_SUBSCRIBERS, JSON.stringify([]));
}

writeTmpFiles();

// Set env vars before any require so server.js constants resolve correctly
process.env.VOTES_FILE        = TMP_VOTES;
process.env.SUBSCRIBERS_FILE  = TMP_SUBSCRIBERS;
process.env.HALL_OF_FAME_FILE = TMP_HOF;
process.env.CUSTOM_JOKES_FILE = TMP_CUSTOM;
process.env.SUBMISSIONS_FILE  = TMP_SUBS;

let request, app;

beforeAll(() => {
  jest.isolateModules(() => {
    request = require('supertest');
    app = require('../server');
  });
});

afterAll(() => {
  [TMP_VOTES, TMP_SUBS, TMP_CUSTOM, TMP_HOF, TMP_SUBSCRIBERS].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

// ── submitterToken on submit ──────────────────────────────────────────────────
describe('POST /api/submit — returns submitterToken', () => {
  it('returns a UUID submitterToken on successful submission', async () => {
    const res = await request(app)
      .post('/api/submit')
      .send({ joke: 'Why do Java developers wear glasses? Because they cannot C#.', category: 'tech' });
    expect(res.status).toBe(201);
    expect(res.body.submitterToken).toBeDefined();
    expect(res.body.submitterToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('each submission gets a unique token', async () => {
    const r1 = await request(app)
      .post('/api/submit')
      .send({ joke: 'I am reading a book about clocks — it is very time-consuming.', category: 'wordplay' });
    const r2 = await request(app)
      .post('/api/submit')
      .send({ joke: 'What do you call a shoe made from a banana? A slipper.', category: 'food' });
    expect(r1.body.submitterToken).not.toBe(r2.body.submitterToken);
  });

  it('does NOT expose submitterToken without admin header', async () => {
    const res = await request(app).get('/api/admin/submissions');
    expect(res.status).toBe(403);
  });
});

// ── GET /api/my-jokes ─────────────────────────────────────────────────────────
describe('GET /api/my-jokes', () => {
  it('requires a token param', async () => {
    const res = await request(app).get('/api/my-jokes');
    expect(res.status).toBe(400);
  });

  it('returns empty jokes array for unknown token', async () => {
    const res = await request(app).get('/api/my-jokes?token=00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.jokes).toEqual([]);
  });

  it('returns pending submission for the submitter token', async () => {
    const sub = await request(app)
      .post('/api/submit')
      .set('X-Forwarded-For', '10.0.0.10')
      .send({ joke: 'What do clouds wear under their raincoats? Thunderwear.', category: 'general' });
    expect(sub.status).toBe(201);
    const token = sub.body.submitterToken;

    const mine = await request(app).get(`/api/my-jokes?token=${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.count).toBeGreaterThanOrEqual(1);
    const j = mine.body.jokes.find(x => /thunderwear/i.test(x.joke));
    expect(j).toBeDefined();
    expect(j.status).toBe('pending');
    expect(j.voteScore).toBe(0);
    expect(j.monthlyWins).toBe(0);
  });

  it('does not return jokes from a different token', async () => {
    const s1 = await request(app)
      .post('/api/submit')
      .set('X-Forwarded-For', '10.0.0.20')
      .send({ joke: 'I used to be a banker but I lost interest.', category: 'general' });
    const s2 = await request(app)
      .post('/api/submit')
      .set('X-Forwarded-For', '10.0.0.21')
      .send({ joke: 'Did you hear about the guy who invented Lifesavers? He made a mint.', category: 'food' });

    const mine = await request(app).get(`/api/my-jokes?token=${s1.body.submitterToken}`);
    const texts = mine.body.jokes.map(j => j.joke);
    expect(texts.some(t => /lifesavers/i.test(t))).toBe(false);
    expect(texts.some(t => /banker/i.test(t))).toBe(true);
  });

  it('shows approved joke after admin approval with correct status', async () => {
    const sub = await request(app)
      .post('/api/submit')
      .set('X-Forwarded-For', '10.0.0.30')
      .send({ joke: 'Why do bees have sticky hair? Because they use honeycombs.', category: 'animals' });
    const token = sub.body.submitterToken;
    const sid   = sub.body.sid;

    await request(app)
      .post(`/api/admin/approve/${sid}`)
      .set('x-admin-token', 'dev-admin-token');

    const mine = await request(app).get(`/api/my-jokes?token=${token}`);
    expect(mine.body.count).toBeGreaterThanOrEqual(1);
    const j = mine.body.jokes.find(x => /honeycombs/i.test(x.joke));
    expect(j).toBeDefined();
    expect(j.status).toBe('approved');
  });

  it('response shape has all required fields', async () => {
    const sub = await request(app)
      .post('/api/submit')
      .set('X-Forwarded-For', '10.0.0.40')
      .send({ joke: 'What do you call a fake stone in Ireland? A shamrock.', category: 'general' });
    const mine = await request(app).get(`/api/my-jokes?token=${sub.body.submitterToken}`);
    const j = mine.body.jokes[0];
    expect(j).toHaveProperty('id');
    expect(j).toHaveProperty('joke');
    expect(j).toHaveProperty('category');
    expect(j).toHaveProperty('tags');
    expect(j).toHaveProperty('status');
    expect(j).toHaveProperty('voteScore');
    expect(j).toHaveProperty('monthlyWins');
  });
});

// ── /my-jokes page route ──────────────────────────────────────────────────────
describe('GET /my-jokes', () => {
  it('serves the my-jokes HTML page', async () => {
    const res = await request(app).get('/my-jokes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('My Jokes');
    expect(res.text).toContain('djotd_submitter_token');
  });
});
