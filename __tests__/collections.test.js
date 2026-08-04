/**
 * Tests for v31 — User Joke Collections
 */
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

let app;
let tmpDir;
let collectionsFile;
let passportsFile;

// Shared passport tokens
const TOKEN_A = '11111111-1111-4111-8111-111111111111';
const TOKEN_B = '22222222-2222-4222-8222-222222222222';

function makePassports(tokens) {
  const p = {};
  tokens.forEach(t => {
    p[t] = { token: t, createdAt: new Date().toISOString(), streak: 0, votes: [], reactions: [], saves: [] };
  });
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'djotd-collections-'));
  collectionsFile = path.join(tmpDir, 'collections.json');
  passportsFile = path.join(tmpDir, 'passports.json');
  fs.writeFileSync(collectionsFile, '[]');
  fs.writeFileSync(passportsFile, JSON.stringify(makePassports([TOKEN_A, TOKEN_B])));

  process.env.COLLECTIONS_FILE = collectionsFile;
  process.env.PASSPORTS_FILE = passportsFile;
  process.env.VOTES_FILE = path.join(__dirname, '..', 'votes.json');
  process.env.REACTIONS_FILE = path.join(__dirname, '..', 'reactions.json');

  jest.resetModules();
  app = require('../server');
  app._resetCollectionRateLimitForTest();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.COLLECTIONS_FILE;
  delete process.env.PASSPORTS_FILE;
});

const jokes = require('../jokes.json');
const JOKE_ID = jokes[0].id;
const JOKE_ID_2 = jokes[1].id;

// ── POST /api/collections ────────────────────────────────────────────────────

describe('POST /api/collections', () => {
  it('returns 400 for missing passportToken', async () => {
    const res = await request(app).post('/api/collections').send({ name: 'My faves' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid passportToken', async () => {
    const res = await request(app).post('/api/collections').send({ passportToken: 'bad', name: 'My faves' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for unknown passport', async () => {
    const res = await request(app).post('/api/collections').send({ passportToken: '33333333-3333-4333-8333-333333333333', name: 'My faves' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app).post('/api/collections').send({ passportToken: TOKEN_A });
    expect(res.status).toBe(400);
  });

  it('returns 400 for name > 60 chars', async () => {
    const res = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'x'.repeat(61) });
    expect(res.status).toBe(400);
  });

  it('creates a collection and returns 201', async () => {
    const res = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'My Faves' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.name).toBe('My Faves');
    expect(res.body.jokeCount).toBe(0);
  });

  it('persists to collections.json', async () => {
    await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'Groaners' });
    const saved = JSON.parse(fs.readFileSync(collectionsFile, 'utf8'));
    expect(saved.length).toBe(1);
    expect(saved[0].passportToken).toBe(TOKEN_A);
    expect(saved[0].jokeIds).toEqual([]);
  });

  it('rejects when limit of 10 collections exceeded', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: `Col ${i}` });
      expect(r.status).toBe(201);
    }
    const r = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'Col 10' });
    expect(r.status).toBe(422);
  });
});

// ── GET /api/collections ─────────────────────────────────────────────────────

describe('GET /api/collections', () => {
  it('returns 400 for invalid token', async () => {
    const res = await request(app).get('/api/collections?passportToken=bad');
    expect(res.status).toBe(400);
  });

  it('returns empty array for passport with no collections', async () => {
    const res = await request(app).get(`/api/collections?passportToken=${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only own collections', async () => {
    await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'A col' });
    await request(app).post('/api/collections').send({ passportToken: TOKEN_B, name: 'B col' });
    const res = await request(app).get(`/api/collections?passportToken=${TOKEN_A}`);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('A col');
  });

  it('response includes id, name, jokeCount, updatedAt', async () => {
    await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'Test' });
    const res = await request(app).get(`/api/collections?passportToken=${TOKEN_A}`);
    const col = res.body[0];
    expect(col.id).toBeTruthy();
    expect(col.name).toBe('Test');
    expect(col.jokeCount).toBe(0);
    expect(col.updatedAt).toBeTruthy();
  });
});

// ── GET /api/collections/:id ─────────────────────────────────────────────────

describe('GET /api/collections/:id', () => {
  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).get('/api/collections/not-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/collections/00000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
  });

  it('returns collection with full joke objects', async () => {
    const create = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'Public' });
    const colId = create.body.id;
    await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: JOKE_ID });

    const res = await request(app).get(`/api/collections/${colId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Public');
    expect(res.body.jokes.length).toBe(1);
    expect(res.body.jokes[0].id).toBe(JOKE_ID);
    expect(res.body.jokeCount).toBe(1);
  });

  it('is publicly readable (no auth required)', async () => {
    const create = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'Open' });
    const res = await request(app).get(`/api/collections/${create.body.id}`);
    expect(res.status).toBe(200);
  });
});

// ── POST /api/collections/:id/jokes ─────────────────────────────────────────

describe('POST /api/collections/:id/jokes', () => {
  let colId;
  beforeEach(async () => {
    const r = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'My List' });
    colId = r.body.id;
  });

  it('returns 400 for missing jokeId', async () => {
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown joke', async () => {
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: 999999 });
    expect(res.status).toBe(404);
  });

  it('returns 403 for wrong passport', async () => {
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_B, jokeId: JOKE_ID });
    expect(res.status).toBe(403);
  });

  it('adds a joke and returns jokeCount', async () => {
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: JOKE_ID });
    expect(res.status).toBe(200);
    expect(res.body.jokeCount).toBe(1);
  });

  it('rejects duplicate joke', async () => {
    await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: JOKE_ID });
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: JOKE_ID });
    expect(res.status).toBe(409);
  });

  it('rejects over-50-joke limit', async () => {
    const pool = require('../jokes.json');
    // Need 51 distinct jokes; skip if pool too small
    if (pool.length < 51) return;
    for (let i = 0; i < 50; i++) {
      await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: pool[i].id });
    }
    const res = await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: pool[50].id });
    expect(res.status).toBe(422);
  });
});

// ── DELETE /api/collections/:id/jokes/:jokeId ────────────────────────────────

describe('DELETE /api/collections/:id/jokes/:jokeId', () => {
  let colId;
  beforeEach(async () => {
    const r = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'My List' });
    colId = r.body.id;
    await request(app).post(`/api/collections/${colId}/jokes`).send({ passportToken: TOKEN_A, jokeId: JOKE_ID });
  });

  it('removes a joke from collection', async () => {
    const res = await request(app)
      .delete(`/api/collections/${colId}/jokes/${JOKE_ID}`)
      .set('x-passport-token', TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.body.jokeCount).toBe(0);
  });

  it('returns 403 for wrong passport', async () => {
    const res = await request(app)
      .delete(`/api/collections/${colId}/jokes/${JOKE_ID}`)
      .set('x-passport-token', TOKEN_B);
    expect(res.status).toBe(403);
  });

  it('returns 404 for joke not in collection', async () => {
    const res = await request(app)
      .delete(`/api/collections/${colId}/jokes/999999`)
      .set('x-passport-token', TOKEN_A);
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/collections/:id ──────────────────────────────────────────────

describe('DELETE /api/collections/:id', () => {
  let colId;
  beforeEach(async () => {
    const r = await request(app).post('/api/collections').send({ passportToken: TOKEN_A, name: 'To Delete' });
    colId = r.body.id;
  });

  it('deletes collection', async () => {
    const res = await request(app)
      .delete(`/api/collections/${colId}`)
      .set('x-passport-token', TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    const check = await request(app).get(`/api/collections/${colId}`);
    expect(check.status).toBe(404);
  });

  it('returns 403 for wrong passport', async () => {
    const res = await request(app)
      .delete(`/api/collections/${colId}`)
      .set('x-passport-token', TOKEN_B);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown collection', async () => {
    const res = await request(app)
      .delete('/api/collections/00000000-0000-4000-8000-000000000002')
      .set('x-passport-token', TOKEN_A);
    expect(res.status).toBe(404);
  });
});

// ── GET /collection/:id (page route) ─────────────────────────────────────────

describe('GET /collection/:id', () => {
  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).get('/collection/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('serves collection page HTML for valid UUID', async () => {
    const res = await request(app).get('/collection/00000000-0000-4000-8000-000000000003');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/collection/i);
  });
});
