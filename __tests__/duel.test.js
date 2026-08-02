const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_VOTES     = path.join(os.tmpdir(), `test-votes-duel-${process.pid}.json`);
const TMP_REACTIONS = path.join(os.tmpdir(), `test-reactions-duel-${process.pid}.json`);
const TMP_PUSH_SUBS = path.join(os.tmpdir(), `test-push-duel-${process.pid}.json`);
const TMP_DUEL      = path.join(os.tmpdir(), `test-duel-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PUSH_SUBS_FILE = TMP_PUSH_SUBS;
process.env.DUEL_FILE      = TMP_DUEL;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([]));
// No duel.json yet — should be auto-created

const app = require('../server');
const { _duelPairForDate, _jokeForDate } = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PUSH_SUBS, TMP_DUEL].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

describe('GET /api/duel/today', () => {
  beforeEach(() => { try { fs.unlinkSync(TMP_DUEL); } catch {} });

  it('returns jokeA, jokeB, votesA, votesB, voted fields', async () => {
    const res = await request(app).get('/api/duel/today');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('jokeA');
    expect(res.body).toHaveProperty('jokeB');
    expect(res.body).toHaveProperty('votesA');
    expect(res.body).toHaveProperty('votesB');
    expect(res.body).toHaveProperty('voted');
    expect(typeof res.body.voted).toBe('boolean');
  });

  it('returns two distinct jokes', async () => {
    const res = await request(app).get('/api/duel/today');
    expect(res.body.jokeA.id).not.toBe(res.body.jokeB.id);
  });

  it('jokeA and jokeB have id and joke fields', async () => {
    const res = await request(app).get('/api/duel/today');
    expect(res.body.jokeA).toHaveProperty('id');
    expect(res.body.jokeA).toHaveProperty('joke');
    expect(res.body.jokeB).toHaveProperty('id');
    expect(res.body.jokeB).toHaveProperty('joke');
  });

  it('votesA and votesB start at 0', async () => {
    const res = await request(app).get('/api/duel/today');
    expect(res.body.votesA).toBe(0);
    expect(res.body.votesB).toBe(0);
  });

  it('voted is false for a fresh duel', async () => {
    const res = await request(app).get('/api/duel/today');
    expect(res.body.voted).toBe(false);
  });
});

describe('POST /api/duel/vote', () => {
  beforeEach(() => { try { fs.unlinkSync(TMP_DUEL); } catch {} });

  it('returns 400 for invalid pick', async () => {
    const res = await request(app)
      .post('/api/duel/vote')
      .send({ pick: 'C' });
    expect(res.statusCode).toBe(400);
  });

  it('records vote A and returns updated counts', async () => {
    const res = await request(app)
      .post('/api/duel/vote')
      .send({ pick: 'A' });
    expect(res.statusCode).toBe(200);
    expect(res.body.votesA).toBe(1);
    expect(res.body.votesB).toBe(0);
    expect(res.body).toHaveProperty('winner');
    expect(res.body.winner).toBe('A');
  });

  it('records vote B and returns updated counts', async () => {
    const res = await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ pick: 'B' });
    expect(res.statusCode).toBe(200);
    expect(res.body.votesB).toBe(1);
    expect(res.body.winner).toBe('B');
  });

  it('returns 409 for duplicate vote from same IP', async () => {
    await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.1.1.1')
      .send({ pick: 'A' });
    const res = await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.1.1.1')
      .send({ pick: 'B' });
    expect(res.statusCode).toBe(409);
  });

  it('winner is null on a tie', async () => {
    await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.2.2.1')
      .send({ pick: 'A' });
    const res = await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.2.2.2')
      .send({ pick: 'B' });
    expect(res.body.winner).toBeNull();
  });

  it('GET voted=true after voting from same IP', async () => {
    await request(app)
      .post('/api/duel/vote')
      .set('X-Forwarded-For', '10.3.3.3')
      .send({ pick: 'A' });
    const res = await request(app)
      .get('/api/duel/today')
      .set('X-Forwarded-For', '10.3.3.3');
    expect(res.body.voted).toBe(true);
  });
});

describe('duelPairForDate determinism', () => {
  it('returns the same pair for the same date', () => {
    const p1 = _duelPairForDate('2026-08-02');
    const p2 = _duelPairForDate('2026-08-02');
    expect(p1.jokeA.id).toBe(p2.jokeA.id);
    expect(p1.jokeB.id).toBe(p2.jokeB.id);
  });

  it('returns different pairs for different dates', () => {
    const p1 = _duelPairForDate('2026-08-01');
    const p2 = _duelPairForDate('2026-08-02');
    // Very unlikely to be equal for different dates
    const sameA = p1.jokeA.id === p2.jokeA.id && p1.jokeB.id === p2.jokeB.id;
    const sameB = p1.jokeA.id === p2.jokeB.id && p1.jokeB.id === p2.jokeA.id;
    expect(sameA && sameB).toBe(false);
  });

  it('returns distinct jokes (A !== B)', () => {
    const { jokeA, jokeB } = _duelPairForDate('2026-08-02');
    expect(jokeA.id).not.toBe(jokeB.id);
  });

  it('excludes the daily joke of the day', () => {
    const dateStr = '2026-08-02';
    const daily = _jokeForDate(dateStr);
    const { jokeA, jokeB } = _duelPairForDate(dateStr);
    expect(jokeA.id).not.toBe(daily.id);
    expect(jokeB.id).not.toBe(daily.id);
  });
});

describe('duel.json reset on new day', () => {
  it('regenerates duel when stored date is stale', async () => {
    // Write a stale duel file
    fs.writeFileSync(TMP_DUEL, JSON.stringify({
      date: '2020-01-01',
      jokeIdA: 999,
      jokeIdB: 998,
      votesA: 99,
      votesB: 88,
      voters: ['oldhash']
    }));
    const res = await request(app).get('/api/duel/today');
    expect(res.statusCode).toBe(200);
    expect(res.body.votesA).toBe(0);
    expect(res.body.votesB).toBe(0);
    const stored = JSON.parse(fs.readFileSync(TMP_DUEL, 'utf8'));
    expect(stored.date).not.toBe('2020-01-01');
  });
});
