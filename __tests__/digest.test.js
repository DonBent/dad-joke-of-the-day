const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Use a temp file for subscribers so tests are isolated
const TMP_SUBS = path.join(os.tmpdir(), `test-subs-${process.pid}.json`);
process.env.SUBSCRIBERS_FILE = TMP_SUBS;

const app = require('../server');

afterEach(() => {
  // Reset subscribers between tests
  if (fs.existsSync(TMP_SUBS)) fs.unlinkSync(TMP_SUBS);
});

afterAll(() => {
  if (fs.existsSync(TMP_SUBS)) fs.unlinkSync(TMP_SUBS);
});

// ── POST /api/subscribe ───────────────────────────────────────────────────────
describe('POST /api/subscribe', () => {
  it('returns 201 for a new valid email', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('message');
  });

  it('persists the subscriber to the store', async () => {
    await request(app).post('/api/subscribe').send({ email: 'persist@example.com' });
    const subs = JSON.parse(fs.readFileSync(TMP_SUBS, 'utf8'));
    expect(subs.some(s => s.email === 'persist@example.com')).toBe(true);
  });

  it('returns 400 for a missing email', async () => {
    const res = await request(app).post('/api/subscribe').send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid email format', async () => {
    const res = await request(app).post('/api/subscribe').send({ email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 for a duplicate email', async () => {
    await request(app).post('/api/subscribe').send({ email: 'dup@example.com' });
    const res = await request(app).post('/api/subscribe').send({ email: 'dup@example.com' });
    expect(res.statusCode).toBe(409);
  });

  it('normalises email to lowercase before storing', async () => {
    await request(app).post('/api/subscribe').send({ email: 'Upper@Example.COM' });
    const subs = JSON.parse(fs.readFileSync(TMP_SUBS, 'utf8'));
    expect(subs.some(s => s.email === 'upper@example.com')).toBe(true);
  });
});

// ── POST /api/unsubscribe ─────────────────────────────────────────────────────
describe('POST /api/unsubscribe', () => {
  it('returns 200 and removes an existing subscriber', async () => {
    await request(app).post('/api/subscribe').send({ email: 'remove@example.com' });

    const res = await request(app)
      .post('/api/unsubscribe')
      .send({ email: 'remove@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message');

    const subs = JSON.parse(fs.readFileSync(TMP_SUBS, 'utf8'));
    expect(subs.some(s => s.email === 'remove@example.com')).toBe(false);
  });

  it('returns 404 for an email that was never subscribed', async () => {
    const res = await request(app)
      .post('/api/unsubscribe')
      .send({ email: 'ghost@example.com' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a missing email', async () => {
    const res = await request(app).post('/api/unsubscribe').send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid email format', async () => {
    const res = await request(app).post('/api/unsubscribe').send({ email: 'bad' });
    expect(res.statusCode).toBe(400);
  });
});

// ── Subscriber data is NOT exposed publicly ───────────────────────────────────
describe('Subscriber data privacy', () => {
  it('GET /api/stats does not include subscriber emails', async () => {
    await request(app).post('/api/subscribe').send({ email: 'private@example.com' });
    const res = await request(app).get('/api/stats');
    expect(JSON.stringify(res.body)).not.toContain('private@example.com');
  });
});

// ── POST /api/admin/send-digest (auth guard) ───────────────────────────────────
describe('POST /api/admin/send-digest', () => {
  it('returns 403 without admin token', async () => {
    const res = await request(app).post('/api/admin/send-digest');
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with admin token when no subscribers exist', async () => {
    const res = await request(app)
      .post('/api/admin/send-digest')
      .set('x-admin-token', process.env.ADMIN_TOKEN || 'dev-admin-token');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('sent');
  });
});
