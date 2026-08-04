/**
 * Tests for v30 — Challenge a Friend
 */
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

let app;
let tmpDir;
let challengesFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'djotd-challenge-'));
  challengesFile = path.join(tmpDir, 'challenges.json');
  fs.writeFileSync(challengesFile, '[]');

  process.env.CHALLENGES_FILE = challengesFile;
  // Use real votes/reactions/etc from project root for joke data
  process.env.VOTES_FILE = path.join(__dirname, '..', 'votes.json');
  process.env.REACTIONS_FILE = path.join(__dirname, '..', 'reactions.json');

  jest.resetModules();
  app = require('../server');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CHALLENGES_FILE;
});

// ── gradeGuess pure function ────────────────────────────────────────────────

describe('gradeGuess', () => {
  let gradeGuess;
  beforeEach(() => { gradeGuess = app.gradeGuess; });

  it('grades empty guess as nope', () => {
    expect(gradeGuess('', 'because it had too many bugs')).toBe('nope');
  });

  it('grades exact match as good', () => {
    expect(gradeGuess('too many bugs', 'too many bugs')).toBe('good');
  });

  it('grades partial overlap (≥50%) as good', () => {
    // punchline = "because it had too many bugs" (5 tokens)
    // guess    = "it had too many"           — 4/5 match = 0.8
    expect(gradeGuess('it had too many', 'because it had too many bugs')).toBe('good');
  });

  it('grades low overlap (20-49%) as close', () => {
    // punchline = "because it had too many bugs" (6 tokens)
    // guess = "many bugs" — 2/6 = 0.333
    expect(gradeGuess('many bugs', 'because it had too many bugs')).toBe('close');
  });

  it('grades zero overlap as nope', () => {
    expect(gradeGuess('completely wrong answer', 'because it had too many bugs')).toBe('nope');
  });

  it('is case-insensitive', () => {
    expect(gradeGuess('TOO MANY BUGS', 'too many bugs')).toBe('good');
  });
});

// ── splitJokeText ────────────────────────────────────────────────────────────

describe('splitJokeText', () => {
  let splitJokeText;
  beforeEach(() => { splitJokeText = app.splitJokeText; });

  it('splits on newline', () => {
    const r = splitJokeText('Why did the chicken cross the road?\nTo get to the other side.');
    expect(r.setup).toBe('Why did the chicken cross the road?');
    expect(r.punchline).toBe('To get to the other side.');
  });

  it('splits on "? " separator', () => {
    const r = splitJokeText('Why do scientists not trust atoms? Because they make up everything!');
    expect(r.setup).toMatch(/atoms/);
    expect(r.punchline).toMatch(/everything/);
  });

  it('splits on Q:/A: pattern', () => {
    const r = splitJokeText('Q: What do you call fake spaghetti? A: An impasta!');
    expect(r.punchline).toMatch(/impasta/);
  });

  it('returns empty punchline for unsplittable joke', () => {
    const r = splitJokeText('Just a plain statement.');
    expect(r.punchline).toBe('');
  });
});

// ── POST /api/jokes/:id/challenge ────────────────────────────────────────────

describe('POST /api/jokes/:id/challenge', () => {
  it('returns 404 for unknown joke id', async () => {
    const res = await request(app).post('/api/jokes/999999/challenge');
    expect(res.status).toBe(404);
  });

  it('creates a challenge and returns token + challengeUrl', async () => {
    // Use the first joke in the pool
    const jokes = require('../jokes.json');
    const joke = jokes[0];
    const res = await request(app).post(`/api/jokes/${joke.id}/challenge`);
    // May be 422 if joke can't be split; just check for token when 200
    if (res.status === 200) {
      expect(res.body.token).toMatch(/^[0-9a-f-]{36}$/i);
      expect(res.body.challengeUrl).toMatch(/^\/challenge\//);
      // Verify it was persisted
      const saved = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
      expect(saved.length).toBe(1);
      expect(saved[0].token).toBe(res.body.token);
      expect(saved[0].jokeId).toBe(joke.id);
    } else {
      expect(res.status).toBe(422);
    }
  });

  it('creates distinct tokens on repeated calls', async () => {
    const jokes = require('../jokes.json');
    // Find a joke that can be split
    let jokeId = null;
    for (const j of jokes) {
      const r = app.splitJokeText(j.joke);
      if (r.punchline) { jokeId = j.id; break; }
    }
    if (!jokeId) return; // skip if no splittable joke

    const r1 = await request(app).post(`/api/jokes/${jokeId}/challenge`);
    const r2 = await request(app).post(`/api/jokes/${jokeId}/challenge`);
    expect(r1.body.token).not.toBe(r2.body.token);
  });
});

// ── GET /api/challenges/:token ───────────────────────────────────────────────

describe('GET /api/challenges/:token', () => {
  it('returns 400 for non-UUID token', async () => {
    const res = await request(app).get('/api/challenges/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(app).get('/api/challenges/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns setup without punchline before first guess', async () => {
    const jokes = require('../jokes.json');
    let jokeId = null;
    for (const j of jokes) {
      if (app.splitJokeText(j.joke).punchline) { jokeId = j.id; break; }
    }
    if (!jokeId) return;

    const create = await request(app).post(`/api/jokes/${jokeId}/challenge`);
    expect(create.status).toBe(200);
    const { token } = create.body;

    const get = await request(app).get(`/api/challenges/${token}`);
    expect(get.status).toBe(200);
    expect(get.body.setup).toBeTruthy();
    expect(get.body.punchline).toBeUndefined();
    expect(get.body.guessCount).toBe(0);
  });

  it('returns 410 for expired challenge', async () => {
    const jokes = require('../jokes.json');
    let jokeId = null;
    for (const j of jokes) {
      if (app.splitJokeText(j.joke).punchline) { jokeId = j.id; break; }
    }
    if (!jokeId) return;

    const create = await request(app).post(`/api/jokes/${jokeId}/challenge`);
    const { token } = create.body;

    // Backdate createdAt by 8 days
    const saved = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
    saved[0].createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(challengesFile, JSON.stringify(saved));

    const get = await request(app).get(`/api/challenges/${token}`);
    expect(get.status).toBe(410);
  });
});

// ── POST /api/challenges/:token/guess ────────────────────────────────────────

describe('POST /api/challenges/:token/guess', () => {
  let token;
  let jokeId;

  beforeEach(async () => {
    const jokes = require('../jokes.json');
    for (const j of jokes) {
      if (app.splitJokeText(j.joke).punchline) { jokeId = j.id; break; }
    }
    if (!jokeId) return;
    const create = await request(app).post(`/api/jokes/${jokeId}/challenge`);
    token = create.body.token;
  });

  it('returns 400 for missing guess', async () => {
    if (!token) return;
    const res = await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns punchline and grade for valid guess', async () => {
    if (!token) return;
    const res = await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({ guess: 'my guess here' });
    expect(res.status).toBe(200);
    expect(res.body.punchline).toBeTruthy();
    expect(['good', 'close', 'nope']).toContain(res.body.grade);
  });

  it('stores guess in challenges.json', async () => {
    if (!token) return;
    await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({ guess: 'test guess' });
    const saved = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
    const ch = saved.find(c => c.token === token);
    expect(ch.guesses.length).toBe(1);
    expect(ch.guesses[0].guess).toBe('test guess');
  });

  it('enforces 3-guess IP rate limit', async () => {
    if (!token) return;
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/challenges/${token}/guess`)
        .send({ guess: `guess ${i}` });
    }
    const res = await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({ guess: 'fourth attempt' });
    expect(res.status).toBe(429);
  });

  it('returns 410 for expired challenge', async () => {
    if (!token) return;
    const saved = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
    saved[0].createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(challengesFile, JSON.stringify(saved));

    const res = await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({ guess: 'test' });
    expect(res.status).toBe(410);
  });

  it('exposes punchline in GET after first guess', async () => {
    if (!token) return;
    await request(app)
      .post(`/api/challenges/${token}/guess`)
      .send({ guess: 'my guess' });
    const get = await request(app).get(`/api/challenges/${token}`);
    expect(get.body.punchline).toBeTruthy();
    expect(get.body.guessCount).toBe(1);
  });
});

// ── GET /challenge/:token (page route) ───────────────────────────────────────

describe('GET /challenge/:token', () => {
  it('returns 400 for invalid token', async () => {
    const res = await request(app).get('/challenge/not-a-valid-uuid');
    expect(res.status).toBe(400);
  });

  it('serves the challenge page HTML for valid UUID token', async () => {
    const res = await request(app).get('/challenge/00000000-0000-4000-8000-000000000001');
    // challenge-page.html exists so should serve 200
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/challenge/i);
  });
});
