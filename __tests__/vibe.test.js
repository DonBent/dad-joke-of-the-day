const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_VOTES     = pathLib.join(os.tmpdir(), `test-votes-vibe-${process.pid}.json`);
const TMP_REACTIONS = pathLib.join(os.tmpdir(), `test-reactions-vibe-${process.pid}.json`);
const TMP_PASSPORTS = pathLib.join(os.tmpdir(), `test-passports-vibe-${process.pid}.json`);
const TMP_COMMENTS  = pathLib.join(os.tmpdir(), `test-comments-vibe-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PASSPORTS_FILE = TMP_PASSPORTS;
process.env.COMMENTS_FILE  = TMP_COMMENTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PASSPORTS, JSON.stringify({}));
fs.writeFileSync(TMP_COMMENTS,  JSON.stringify([]));

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PASSPORTS, TMP_COMMENTS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// ─── Unit-style: score calculation ────────────────────────────────────────
describe('GET /api/jokes/today/vibe — shape and zero-activity', () => {
  it('returns correct shape with zero activity', async () => {
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      jokeId: expect.any(Number),
      score: 0,
      dominantReaction: null,
      dominantReactionCount: 0,
      commentCount: 0
    });
  });

  it('score reflects upvotes', async () => {
    // Upvote today's joke
    const vibeRes = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibeRes.body;
    await request(app).post(`/api/joke/${jokeId}/upvote`);
    await request(app).post(`/api/joke/${jokeId}/upvote`);
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.body.score).toBeGreaterThanOrEqual(2);
  });
});

// ─── Dominant reaction ────────────────────────────────────────────────────
describe('GET /api/jokes/today/vibe — dominant reaction', () => {
  it('returns dominant reaction emoji after a reaction is set', async () => {
    const vibeRes = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibeRes.body;
    // React with laugh (single IP in supertest — this sets laugh)
    const reactRes = await request(app).post(`/api/jokes/${jokeId}/react`).send({ reaction: 'laugh' });
    expect(reactRes.statusCode).toBe(200);
    // If it toggled off (was already set), set it again
    if (reactRes.body.userReaction !== 'laugh') {
      await request(app).post(`/api/jokes/${jokeId}/react`).send({ reaction: 'laugh' });
    }
    const res = await request(app).get('/api/jokes/today/vibe');
    // dominantReaction should be a non-null emoji string
    expect(res.body.dominantReaction).not.toBeNull();
    expect(typeof res.body.dominantReaction).toBe('string');
    expect(res.body.dominantReactionCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── Comment count ─────────────────────────────────────────────────────────
describe('GET /api/jokes/today/vibe — commentCount', () => {
  it('counts comments for today\'s joke', async () => {
    const vibeRes = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibeRes.body;
    await request(app).post(`/api/jokes/${jokeId}/comments`).send({ text: 'Haha nice one' }).set('X-Forwarded-For', '20.0.0.1');
    await request(app).post(`/api/jokes/${jokeId}/comments`).send({ text: 'Groaning loudly' }).set('X-Forwarded-For', '20.0.0.2');
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.body.commentCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Passport enrichment ──────────────────────────────────────────────────
describe('GET /api/jokes/today/vibe — passport enrichment', () => {
  const TOKEN = 'f0f0f0f0-f0f0-4f0f-af0f-f0f0f0f0f0f0';

  it('includes userVoted and userReacted when valid token provided', async () => {
    const vibeRes = await request(app).get('/api/jokes/today/vibe');
    const { jokeId } = vibeRes.body;
    // Vote with token
    await request(app).post(`/api/joke/${jokeId}/upvote`).set('X-Passport-Token', TOKEN);
    // React with token
    await request(app).post(`/api/jokes/${jokeId}/react`).send({ reaction: 'melt' })
      .set('X-Passport-Token', TOKEN).set('X-Forwarded-For', '30.0.0.1');
    const res = await request(app).get('/api/jokes/today/vibe').set('X-Passport-Token', TOKEN);
    expect(res.body.userVoted).toBe(true);
    expect(res.body.userReacted).toBe('🫠');
  });

  it('does not include userVoted/userReacted without token', async () => {
    const res = await request(app).get('/api/jokes/today/vibe');
    expect(res.body.userVoted).toBeUndefined();
    expect(res.body.userReacted).toBeUndefined();
  });

  it('returns 400 for malformed token', async () => {
    const res = await request(app).get('/api/jokes/today/vibe').set('X-Passport-Token', 'bad-token');
    expect(res.statusCode).toBe(400);
  });
});
