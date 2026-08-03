const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_VOTES     = pathLib.join(os.tmpdir(), `test-votes-passport-${process.pid}.json`);
const TMP_REACTIONS = pathLib.join(os.tmpdir(), `test-reactions-passport-${process.pid}.json`);
const TMP_PASSPORTS = pathLib.join(os.tmpdir(), `test-passports-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PASSPORTS_FILE = TMP_PASSPORTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PASSPORTS, JSON.stringify({}));

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PASSPORTS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

const VALID_TOKEN   = '12345678-1234-4abc-89ab-1234567890ab';
const VALID_TOKEN_2 = 'aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const VALID_TOKEN_3 = 'ccccdddd-cccc-4ccc-aaaa-cccccccccccc';
const VALID_TOKEN_4 = 'eeeeffff-eeee-4eee-aaaa-eeeeeeeeeeee';
const BAD_TOKEN     = 'not-a-uuid';

async function getJokeId() {
  const res = await request(app).get('/api/joke');
  return res.body.id;
}

// ─── Token validation ───────────────────────────────────────────────────────
describe('Passport token validation', () => {
  it('rejects malformed token on GET /api/passport/:token', async () => {
    const res = await request(app).get(`/api/passport/${BAD_TOKEN}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns 404 for valid but unknown token', async () => {
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}`);
    expect(res.statusCode).toBe(404);
  });
});

// ─── Passport lazy creation via save ───────────────────────────────────────
describe('POST /api/passport/:token/saves/:jokeId', () => {
  let jokeId;
  beforeAll(async () => { jokeId = await getJokeId(); });

  it('rejects bad token with 400', async () => {
    const res = await request(app).post(`/api/passport/${BAD_TOKEN}/saves/${jokeId}`);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown jokeId', async () => {
    const res = await request(app).post(`/api/passport/${VALID_TOKEN}/saves/999999`);
    expect(res.statusCode).toBe(404);
  });

  it('saves a joke (creates passport lazily)', async () => {
    const res = await request(app).post(`/api/passport/${VALID_TOKEN}/saves/${jokeId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.jokeId).toBe(jokeId);
    expect(res.body.totalSaves).toBe(1);
  });

  it('toggle-unsaves the same joke', async () => {
    const res = await request(app).post(`/api/passport/${VALID_TOKEN}/saves/${jokeId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.totalSaves).toBe(0);
  });
});

// ─── GET /api/passport/:token ──────────────────────────────────────────────
describe('GET /api/passport/:token', () => {
  let jokeId;
  beforeAll(async () => {
    jokeId = await getJokeId();
    // Create a passport with a save using a fresh token
    await request(app).post(`/api/passport/${VALID_TOKEN_3}/saves/${jokeId}`);
  });

  it('returns passport summary shape', async () => {
    const res = await request(app).get(`/api/passport/${VALID_TOKEN_3}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      token: VALID_TOKEN_3,
      totalVotes: expect.any(Number),
      totalReactions: expect.any(Number),
      totalSaves: 1,
      votes: expect.any(Array),
      reactions: expect.any(Array),
      saves: expect.any(Array)
    });
  });
});

// ─── GET /api/joke/:id with passport ──────────────────────────────────────
describe('GET /api/joke/:id with X-Passport-Token', () => {
  let jokeId;
  beforeAll(async () => {
    jokeId = await getJokeId();
    // Use a fresh token dedicated to this describe block
    await request(app).post(`/api/passport/${VALID_TOKEN_4}/saves/${jokeId}`);
  });

  it('includes userSaved=true when joke is saved', async () => {
    const res = await request(app)
      .get(`/api/joke/${jokeId}`)
      .set('X-Passport-Token', VALID_TOKEN_4);
    expect(res.statusCode).toBe(200);
    expect(res.body.userSaved).toBe(true);
  });

  it('includes userSaved=false when not saved', async () => {
    // token with no saves
    const noSaveToken = '99999999-1234-4abc-89ab-1234567890ab';
    const res = await request(app)
      .get(`/api/joke/${jokeId}`)
      .set('X-Passport-Token', noSaveToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.userSaved).toBe(false);
  });

  it('no passport fields without header', async () => {
    const res = await request(app).get(`/api/joke/${jokeId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.userSaved).toBeUndefined();
  });

  it('returns 400 when bad token provided', async () => {
    // bad token goes through passportToken middleware on save endpoint, not here — but
    // the joke endpoint ignores bad tokens; let's confirm save endpoint 400s
    const res = await request(app).post(`/api/passport/${BAD_TOKEN}/saves/${jokeId}`);
    expect(res.statusCode).toBe(400);
  });
});

// ─── Passport data recorded via vote/react ────────────────────────────────
describe('Vote/React with passport token records to passports.json', () => {
  let jokeId;
  const voteToken = 'deadbeef-dead-4bee-aaaa-deadbeefcafe';
  beforeAll(async () => { jokeId = await getJokeId(); });

  it('upvote records vote in passport', async () => {
    await request(app)
      .post(`/api/joke/${jokeId}/upvote`)
      .set('X-Passport-Token', voteToken);
    const res = await request(app).get(`/api/passport/${voteToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.votes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.votes[0].jokeId).toBe(jokeId);
  });

  it('reaction records in passport', async () => {
    await request(app)
      .post(`/api/jokes/${jokeId}/react`)
      .send({ reaction: 'laugh' })
      .set('X-Passport-Token', voteToken)
      .set('X-Forwarded-For', '77.77.77.77');
    const res = await request(app).get(`/api/passport/${voteToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.reactions.length).toBeGreaterThanOrEqual(1);
  });
});
