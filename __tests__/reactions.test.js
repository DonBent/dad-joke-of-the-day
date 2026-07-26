const request = require('supertest');
const path    = require('fs');
const fs      = require('fs');
const os      = require('os');

const TMP_VOTES     = require('path').join(os.tmpdir(), `test-votes-reactions-${process.pid}.json`);
const TMP_REACTIONS = require('path').join(os.tmpdir(), `test-reactions-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// Helper: grab a valid joke id from the server
async function getJokeId() {
  const res = await request(app).get('/api/joke');
  return res.body.id;
}

describe('POST /api/jokes/:id/react', () => {
  let jokeId;
  beforeAll(async () => { jokeId = await getJokeId(); });

  it('returns 404 for unknown joke id', async () => {
    const res = await request(app)
      .post('/api/jokes/999999/react')
      .send({ reaction: 'laugh' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid reaction', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'unknown' });
    expect(res.statusCode).toBe(400);
  });

  it('increments reaction count', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'laugh' })
      .set('X-Forwarded-For', '1.2.3.4');
    expect(res.statusCode).toBe(200);
    expect(res.body.reactions.laugh).toBe(1);
    expect(res.body.userReaction).toBe('laugh');
  });

  it('changing reaction removes old and adds new', async () => {
    // Same IP, change from laugh to groan
    await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'laugh' })
      .set('X-Forwarded-For', '10.0.0.1');
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'groan' })
      .set('X-Forwarded-For', '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(res.body.userReaction).toBe('groan');
    // laugh count should be back to the state from the previous test (1 from 1.2.3.4)
    // groan should be 1
    expect(res.body.reactions.groan).toBeGreaterThanOrEqual(1);
  });

  it('toggling same reaction removes it (returns userReaction null)', async () => {
    // Use a unique IP
    const ip = '192.168.1.99';
    // First react
    await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'melt' })
      .set('X-Forwarded-For', ip);
    // React again with same reaction => toggle off
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'melt' })
      .set('X-Forwarded-For', ip);
    expect(res.statusCode).toBe(200);
    expect(res.body.userReaction).toBeNull();
  });

  it('returns all four reaction keys in response', async () => {
    const res = await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'drums' })
      .set('X-Forwarded-For', '5.5.5.5');
    expect(res.body.reactions).toHaveProperty('laugh');
    expect(res.body.reactions).toHaveProperty('groan');
    expect(res.body.reactions).toHaveProperty('drums');
    expect(res.body.reactions).toHaveProperty('melt');
  });

  it('reactions are returned with GET /api/joke/:id', async () => {
    const res = await request(app).get(`/api/joke/${jokeId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('reactions');
    expect(res.body.reactions).toHaveProperty('laugh');
  });

  it('reactions are returned with GET /api/joke/today', async () => {
    const res = await request(app).get('/api/joke/today');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('reactions');
  });

  it('reactions are returned with GET /api/joke (random)', async () => {
    const res = await request(app).get('/api/joke');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('reactions');
  });
});
