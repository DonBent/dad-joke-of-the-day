const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_VOTES   = path.join(os.tmpdir(), `test-votes-import-${process.pid}.json`);
const TMP_REACT   = path.join(os.tmpdir(), `test-react-import-${process.pid}.json`);
const TMP_PUSH    = path.join(os.tmpdir(), `test-push-import-${process.pid}.json`);
const TMP_DUEL    = path.join(os.tmpdir(), `test-duel-import-${process.pid}.json`);
const TMP_CUSTOM  = path.join(os.tmpdir(), `test-custom-import-${process.pid}.json`);
const TMP_IMPORT  = path.join(os.tmpdir(), `test-import-${process.pid}.json`);

process.env.VOTES_FILE          = TMP_VOTES;
process.env.REACTIONS_FILE      = TMP_REACT;
process.env.PUSH_SUBS_FILE      = TMP_PUSH;
process.env.DUEL_FILE           = TMP_DUEL;
process.env.CUSTOM_JOKES_FILE   = TMP_CUSTOM;
process.env.IMPORT_PENDING_FILE = TMP_IMPORT;

fs.writeFileSync(TMP_VOTES,  JSON.stringify({}));
fs.writeFileSync(TMP_REACT,  JSON.stringify({}));
fs.writeFileSync(TMP_PUSH,   JSON.stringify([]));
fs.writeFileSync(TMP_CUSTOM, JSON.stringify([]));

const ADMIN = 'dev-admin-token';

const SAMPLE_PENDING = [
  { source: 'icanhazdadjoke', sourceId: 'abc1', joke: 'Why did the robot go on a diet? Because it had too many bytes.', category: 'misc', status: 'pending' },
  { source: 'jokeapi',        sourceId: 'j-42', joke: 'What do you call a bear with no teeth? A gummy bear.', category: 'pun', status: 'pending' },
  { source: 'icanhazdadjoke', sourceId: 'abc3', joke: 'Why do programmers prefer dark mode? Because light attracts bugs.', category: 'tech', status: 'pending' },
  { source: 'jokeapi',        sourceId: 'j-99', joke: 'AlreadyRejectedJoke—uniqueXYZ987notinbuiltin', category: 'misc', status: 'rejected' },
  { source: 'jokeapi',        sourceId: 'j-55', joke: 'AlreadyApprovedJoke—uniqueABC123notinbuiltin', category: 'misc', status: 'approved' },
];

function writePending(data) { fs.writeFileSync(TMP_IMPORT, JSON.stringify(data)); }
function readCustom() { return JSON.parse(fs.readFileSync(TMP_CUSTOM, 'utf8')); }
function readPending() { return JSON.parse(fs.readFileSync(TMP_IMPORT, 'utf8')); }

let app;
beforeEach(() => {
  jest.resetModules();
  // Re-require with fresh env
  app = require('../server');
});

afterAll(() => {
  [TMP_VOTES, TMP_REACT, TMP_PUSH, TMP_DUEL, TMP_CUSTOM, TMP_IMPORT].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('Import API auth', () => {
  beforeEach(() => writePending([]));

  it('GET /api/admin/import/pending requires admin token', async () => {
    const res = await request(app).get('/api/admin/import/pending');
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/admin/import/stats requires admin token', async () => {
    const res = await request(app).get('/api/admin/import/stats');
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/admin/import/approve requires admin token', async () => {
    const res = await request(app).post('/api/admin/import/approve').send({ ids: [0] });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/admin/import/reject requires admin token', async () => {
    const res = await request(app).post('/api/admin/import/reject').send({ ids: [0] });
    expect(res.statusCode).toBe(403);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/import/stats', () => {
  it('returns counts of pending/approved/rejected', async () => {
    writePending(SAMPLE_PENDING);
    const res = await request(app).get('/api/admin/import/stats').set('X-Admin-Token', ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.pending).toBe(3);
    expect(res.body.approved).toBe(1);
    expect(res.body.rejected).toBe(1);
  });

  it('returns zeros when file is empty', async () => {
    writePending([]);
    const res = await request(app).get('/api/admin/import/stats').set('X-Admin-Token', ADMIN);
    expect(res.body.pending).toBe(0);
    expect(res.body.total).toBe(0);
  });
});

// ── Pending list ──────────────────────────────────────────────────────────────

describe('GET /api/admin/import/pending', () => {
  beforeEach(() => writePending(SAMPLE_PENDING));

  it('returns only pending jokes', async () => {
    const res = await request(app).get('/api/admin/import/pending').set('X-Admin-Token', ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.body.jokes.every(j => j.status === 'pending')).toBe(true);
    expect(res.body.total).toBe(3);
  });

  it('returns pagination fields', async () => {
    const res = await request(app).get('/api/admin/import/pending?page=1&limit=2').set('X-Admin-Token', ADMIN);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');
    expect(res.body.jokes.length).toBeLessThanOrEqual(2);
  });
});

// ── Approve by index ──────────────────────────────────────────────────────────

describe('POST /api/admin/import/approve', () => {
  beforeEach(() => {
    writePending(SAMPLE_PENDING.map(j => ({ ...j })));
    fs.writeFileSync(TMP_CUSTOM, JSON.stringify([]));
  });

  it('approves joke by index and adds to custom-jokes', async () => {
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0] });
    expect(res.statusCode).toBe(200);
    expect(res.body.approved).toBe(1);
    const custom = readCustom();
    expect(custom.some(j => j.joke.includes('too many bytes'))).toBe(true);
  });

  it('sets status to approved in pending file', async () => {
    await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0] });
    expect(readPending()[0].status).toBe('approved');
  });

  it('skips already-approved/rejected items even if id listed', async () => {
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [3, 4] }); // rejected + approved — both non-pending
    expect(res.body.approved).toBe(0);
  });

  it('approves multiple ids at once', async () => {
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0, 1, 2] });
    expect(res.body.approved).toBe(3);
    expect(readCustom().length).toBe(3);
  });

  it('approved joke gets a numeric id', async () => {
    await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0] });
    const custom = readCustom();
    expect(typeof custom[0].id).toBe('number');
  });

  it('deduplicates: does not add joke already in custom-jokes', async () => {
    // Pre-populate custom with the same joke text
    fs.writeFileSync(TMP_CUSTOM, JSON.stringify([
      { id: 100, joke: 'Why did the robot go on a diet? Because it had too many bytes.', category: 'misc' }
    ]));
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0] });
    expect(res.body.approved).toBe(0); // deduped
    expect(readCustom().length).toBe(1); // unchanged
  });
});

// ── Approve all ───────────────────────────────────────────────────────────────

describe('POST /api/admin/import/approve all:true', () => {
  beforeEach(() => {
    writePending(SAMPLE_PENDING.map(j => ({ ...j })));
    fs.writeFileSync(TMP_CUSTOM, JSON.stringify([]));
  });

  it('approves all pending jokes', async () => {
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ all: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.approved).toBe(3); // only the 3 pending ones
    expect(readCustom().length).toBe(3);
  });
});

// ── Reject ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/import/reject', () => {
  beforeEach(() => {
    writePending(SAMPLE_PENDING.map(j => ({ ...j })));
  });

  it('rejects joke by index', async () => {
    const res = await request(app)
      .post('/api/admin/import/reject')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect(readPending()[1].status).toBe('rejected');
  });

  it('rejects all pending with all:true', async () => {
    const res = await request(app)
      .post('/api/admin/import/reject')
      .set('X-Admin-Token', ADMIN)
      .send({ all: true });
    expect(res.body.rejected).toBe(3); // only the 3 pending
    const p = readPending();
    expect(p.filter(j => j.status === 'rejected').length).toBe(4); // 3 new + 1 pre-existing
  });

  it('does not double-reject already rejected items', async () => {
    const res = await request(app)
      .post('/api/admin/import/reject')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [3] }); // index 3 already rejected
    expect(res.body.rejected).toBe(0);
  });
});

// ── total reflects pool size ──────────────────────────────────────────────────

describe('Pool total in approve response', () => {
  it('total includes builtin + newly approved custom jokes', async () => {
    writePending(SAMPLE_PENDING.map(j => ({ ...j })));
    fs.writeFileSync(TMP_CUSTOM, JSON.stringify([]));
    const res = await request(app)
      .post('/api/admin/import/approve')
      .set('X-Admin-Token', ADMIN)
      .send({ ids: [0] });
    expect(res.body.total).toBeGreaterThan(15); // 15 builtin + at least 1 new
  });
});
