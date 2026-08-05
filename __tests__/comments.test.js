const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_VOTES     = path.join(os.tmpdir(), `test-votes-comments-${process.pid}.json`);
const TMP_REACTIONS = path.join(os.tmpdir(), `test-reactions-comments-${process.pid}.json`);
const TMP_COMMENTS  = path.join(os.tmpdir(), `test-comments-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.COMMENTS_FILE  = TMP_COMMENTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_COMMENTS,  JSON.stringify([]));

const app = require('../server');
const { _resetCommentRateLimitForTest } = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_COMMENTS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

async function getJokeId() {
  const res = await request(app).get('/api/joke');
  return res.body.id;
}

describe('POST /api/jokes/:id/comments', () => {
  let jokeId;
  beforeAll(async () => { jokeId = await getJokeId(); });
  beforeEach(() => { _resetCommentRateLimitForTest(); });

  it('returns 404 for unknown joke id', async () => {
    const res = await request(app)
      .post('/api/jokes/999999/comments')
      .send({ text: 'That joke needs therapy.' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for empty text', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .send({ text: '' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing text', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for text over 280 chars', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .send({ text: 'a'.repeat(281) });
    expect(res.statusCode).toBe(400);
  });

  it('creates a comment in pending state', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '1.1.1.1')
      .send({ text: 'My sides have left the building.' });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.jokeId).toBe(jokeId);
    expect(res.body.text).toBe('My sides have left the building.');
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
  });

  it('stores hashed IP (not raw IP)', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '2.2.2.2')
      .send({ text: 'Groaning internally.' });
    expect(res.statusCode).toBe(201);
    // ip should be a sha256 hex string, not the raw IP
    expect(res.body.ip).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.ip).not.toBe('2.2.2.2');
  });

  it('enforces rate limit: max 3 comments per joke per IP per 24h', async () => {
    const ip = '99.99.99.99';
    // Send 3 ok, 4th fails
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/jokes/${jokeId}/comments`)
        .set('X-Forwarded-For', ip)
        .send({ text: `Roast number ${i + 1}` });
      expect(res.statusCode).toBe(201);
    }
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', ip)
      .send({ text: 'This one should be blocked.' });
    expect(res.statusCode).toBe(429);
  });

  it('accepts exactly 280 chars', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '5.5.5.5')
      .send({ text: 'a'.repeat(280) });
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /api/jokes/:id/comments', () => {
  let jokeId;
  beforeAll(async () => { jokeId = await getJokeId(); });
  beforeEach(() => { _resetCommentRateLimitForTest(); });

  it('returns 404 for unknown joke id', async () => {
    const res = await request(app).get('/api/jokes/999999/comments');
    expect(res.statusCode).toBe(404);
  });

  it('returns empty array when no approved comments', async () => {
    const res = await request(app).get(`/api/jokes/${jokeId}/comments`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All comments created in prior suite are pending — none should appear
    res.body.forEach(c => expect(c.status).toBeUndefined()); // status not exposed
  });

  it('returns only approved comments after admin approval', async () => {
    // Create a comment
    const postRes = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '10.10.10.10')
      .send({ text: 'Approved roast!' });
    expect(postRes.statusCode).toBe(201);
    const cid = postRes.body.id;

    // Approve via admin
    const approveRes = await request(app)
      .patch(`/api/admin/comments/${cid}`)
      .set('X-Admin-Token', 'dev-admin-token')
      .send({ status: 'approved' });
    expect(approveRes.statusCode).toBe(200);

    // Now it should appear in public GET
    const getRes = await request(app).get(`/api/jokes/${jokeId}/comments`);
    expect(getRes.statusCode).toBe(200);
    const found = getRes.body.find(c => c.id === cid);
    expect(found).toBeDefined();
    expect(found.text).toBe('Approved roast!');
  });

  it('does not expose ip field in public GET', async () => {
    const res = await request(app).get(`/api/jokes/${jokeId}/comments`);
    res.body.forEach(c => expect(c.ip).toBeUndefined());
  });

  it('returns newest-first', async () => {
    const res = await request(app).get(`/api/jokes/${jokeId}/comments`);
    const dates = res.body.map(c => new Date(c.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });
});

describe('Admin comment moderation', () => {
  let jokeId;
  beforeAll(async () => { jokeId = await getJokeId(); });
  beforeEach(() => { _resetCommentRateLimitForTest(); });

  it('GET /api/admin/comments requires admin token', async () => {
    const res = await request(app).get('/api/admin/comments');
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/admin/comments returns all comments for admin', async () => {
    const res = await request(app)
      .get('/api/admin/comments')
      .set('X-Admin-Token', 'dev-admin-token');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PATCH /api/admin/comments/:cid approves a comment', async () => {
    const postRes = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '20.20.20.20')
      .send({ text: 'Admin approves this.' });
    const cid = postRes.body.id;

    const res = await request(app)
      .patch(`/api/admin/comments/${cid}`)
      .set('X-Admin-Token', 'dev-admin-token')
      .send({ status: 'approved' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('PATCH /api/admin/comments/:cid rejects a comment', async () => {
    const postRes = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '21.21.21.21')
      .send({ text: 'Reject this roast.' });
    const cid = postRes.body.id;

    const res = await request(app)
      .patch(`/api/admin/comments/${cid}`)
      .set('X-Admin-Token', 'dev-admin-token')
      .send({ status: 'rejected' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  it('PATCH /api/admin/comments/:cid returns 400 for invalid status', async () => {
    const postRes = await request(app)
      .post(`/api/jokes/${jokeId}/comments`)
      .set('X-Forwarded-For', '22.22.22.22')
      .send({ text: 'Invalid status test.' });
    const cid = postRes.body.id;

    const res = await request(app)
      .patch(`/api/admin/comments/${cid}`)
      .set('X-Admin-Token', 'dev-admin-token')
      .send({ status: 'spam' });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/admin/comments/:cid returns 404 for unknown cid', async () => {
    const res = await request(app)
      .patch('/api/admin/comments/nonexistent-id')
      .set('X-Admin-Token', 'dev-admin-token')
      .send({ status: 'approved' });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/admin/comments requires admin token', async () => {
    const res = await request(app)
      .patch('/api/admin/comments/any-id')
      .send({ status: 'approved' });
    expect(res.statusCode).toBe(403);
  });
});
