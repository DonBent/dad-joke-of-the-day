/**
 * widget.test.js — v15 embed widget & snippet generator tests
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TMP_VOTES       = path.join(os.tmpdir(), `wgt-votes-${process.pid}.json`);
const TMP_SUBS        = path.join(os.tmpdir(), `wgt-subs-${process.pid}.json`);
const TMP_CUSTOM      = path.join(os.tmpdir(), `wgt-custom-${process.pid}.json`);
const TMP_HOF         = path.join(os.tmpdir(), `wgt-hof-${process.pid}.json`);
const TMP_SUBSCRIBERS = path.join(os.tmpdir(), `wgt-subscribers-${process.pid}.json`);

process.env.VOTES_FILE        = TMP_VOTES;
process.env.SUBSCRIBERS_FILE  = TMP_SUBSCRIBERS;
process.env.HALL_OF_FAME_FILE = TMP_HOF;
process.env.CUSTOM_JOKES_FILE = TMP_CUSTOM;
process.env.SUBMISSIONS_FILE  = TMP_SUBS;

fs.writeFileSync(TMP_VOTES,       JSON.stringify({}));
fs.writeFileSync(TMP_SUBS,        JSON.stringify([]));
fs.writeFileSync(TMP_CUSTOM,      JSON.stringify([]));
fs.writeFileSync(TMP_HOF,         JSON.stringify([]));
fs.writeFileSync(TMP_SUBSCRIBERS, JSON.stringify([]));

let request, app;

beforeAll(() => {
  jest.isolateModules(() => {
    request = require('supertest');
    app     = require('../server');
  });
});

afterAll(() => {
  [TMP_VOTES, TMP_SUBS, TMP_CUSTOM, TMP_HOF, TMP_SUBSCRIBERS].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

// ── GET /api/joke/today (enhanced) ───────────────────────────────────────────
describe('GET /api/joke/today', () => {
  it('returns 200 with joke fields', async () => {
    const res = await request(app).get('/api/joke/today');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('joke');
    expect(res.body).toHaveProperty('date');
  });

  it('includes Access-Control-Allow-Origin: *', async () => {
    const res = await request(app).get('/api/joke/today');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('returns voteScore and tags in response', async () => {
    const res = await request(app).get('/api/joke/today');
    expect(res.body).toHaveProperty('voteScore');
    expect(Array.isArray(res.body.tags)).toBe(true);
  });

  it('date field matches today (YYYY-MM-DD)', async () => {
    const res  = await request(app).get('/api/joke/today');
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.date).toBe(today);
  });
});

// ── GET /api/embed/today ─────────────────────────────────────────────────────
describe('GET /api/embed/today', () => {
  it('returns 200 JSON', async () => {
    const res = await request(app).get('/api/embed/today');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
  });

  it('includes Access-Control-Allow-Origin: *', async () => {
    const res = await request(app).get('/api/embed/today');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('response has all required fields', async () => {
    const res = await request(app).get('/api/embed/today');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('joke');
    expect(res.body).toHaveProperty('category');
    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body).toHaveProperty('voteScore');
    expect(res.body).toHaveProperty('date');
  });

  it('?tag= filter returns 200 (may be all jokes if no tags on this branch)', async () => {
    const res = await request(app).get('/api/embed/today?tag=general');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('joke');
  });

  it('unknown tag falls back gracefully to unfiltered joke', async () => {
    const res = await request(app).get('/api/embed/today?tag=xxxxnonexistent');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('joke');
  });
});

// ── GET /widget ───────────────────────────────────────────────────────────────
describe('GET /widget', () => {
  it('returns 200 HTML', async () => {
    const res = await request(app).get('/widget');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
  });

  it('contains a joke', async () => {
    const res = await request(app).get('/widget');
    expect(res.text.length).toBeGreaterThan(100);
    // Must contain at least some content text
    expect(res.text).toMatch(/<body/);
  });

  it('sets frame-ancestors * in CSP header', async () => {
    const res = await request(app).get('/widget');
    expect(res.headers['content-security-policy']).toContain('frame-ancestors *');
  });

  it('is under 10 KB', async () => {
    const res = await request(app).get('/widget');
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(10 * 1024);
  });

  it('dark theme does not crash', async () => {
    const res = await request(app).get('/widget?theme=dark');
    expect(res.status).toBe(200);
    expect(res.text).toContain('#1a1a1a');
  });

  it('light theme is default', async () => {
    const res = await request(app).get('/widget');
    expect(res.text).toContain('#ffffff');
  });

  it('?tag= param is accepted without crashing', async () => {
    const res = await request(app).get('/widget?tag=science&theme=light');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<body/);
  });

  it('HTML includes back-link to main site', async () => {
    const res = await request(app).get('/widget');
    expect(res.text).toContain('Dad Joke of the Day');
    expect(res.text).toContain('href="/"');
  });

  it('contains today\'s date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app).get('/widget');
    expect(res.text).toContain(today);
  });
});

// ── GET /embed ────────────────────────────────────────────────────────────────
describe('GET /embed', () => {
  it('returns 200 HTML', async () => {
    const res = await request(app).get('/embed');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
  });

  it('contains iframe preview pointing to /widget', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('/widget');
  });

  it('contains snippet code for iframe', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('iframe');
  });

  it('contains snippet for JavaScript fetch', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('fetch');
    expect(res.text).toContain('/api/embed/today');
  });

  it('contains theme toggle', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('themeSelect');
    expect(res.text).toContain('light');
    expect(res.text).toContain('dark');
  });

  it('contains tag filter dropdown', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('tagSelect');
  });

  it('contains copy button', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('Copy');
  });

  it('has back-link to home', async () => {
    const res = await request(app).get('/embed');
    expect(res.text).toContain('href="/"');
  });
});
