const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const TMP_VOTES = path.join(os.tmpdir(), `test-votes-tags-${process.pid}.json`);
const TMP_SUBS  = path.join(os.tmpdir(), `test-subs-tags-${process.pid}.json`);
const TMP_CUSTOM = path.join(os.tmpdir(), `test-custom-tags-${process.pid}.json`);
const TMP_SUBMISSIONS = path.join(os.tmpdir(), `test-submissions-tags-${process.pid}.json`);
const TMP_HOF   = path.join(os.tmpdir(), `test-hof-tags-${process.pid}.json`);

process.env.SUBSCRIBERS_FILE = TMP_SUBS;
process.env.VOTES_FILE = TMP_VOTES;
process.env.HALL_OF_FAME_FILE = TMP_HOF;

fs.writeFileSync(TMP_VOTES, JSON.stringify({}));
fs.writeFileSync(TMP_SUBS, JSON.stringify([]));
fs.writeFileSync(TMP_CUSTOM, JSON.stringify([]));
fs.writeFileSync(TMP_SUBMISSIONS, JSON.stringify([]));
fs.writeFileSync(TMP_HOF, JSON.stringify([]));

// Point server at temp custom-jokes and submissions files
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...args) {
  if (req.endsWith('custom-jokes.json')) return [];
  if (req.endsWith('submissions.json')) return [];
  return origLoad.call(this, req, ...args);
};

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_SUBS, TMP_CUSTOM, TMP_SUBMISSIONS, TMP_HOF].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

describe('GET /api/tags', () => {
  it('returns an array of tag strings', async () => {
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('includes classic, science, tech, animals, food, wordplay', async () => {
    const res = await request(app).get('/api/tags');
    const tags = res.body;
    ['classic', 'science', 'tech', 'animals', 'food', 'wordplay'].forEach(t => {
      expect(tags).toContain(t);
    });
  });

  it('is sorted alphabetically', async () => {
    const res = await request(app).get('/api/tags');
    const sorted = [...res.body].sort();
    expect(res.body).toEqual(sorted);
  });
});

describe('GET /api/joke?tag=', () => {
  it('returns a joke with matching tag', async () => {
    const res = await request(app).get('/api/joke?tag=tech');
    expect(res.status).toBe(200);
    expect(res.body.tags).toContain('tech');
  });

  it('returns 404 for unknown tag', async () => {
    const res = await request(app).get('/api/joke?tag=zzz-nonexistent-tag');
    expect(res.status).toBe(404);
  });

  it('respects tag filter alongside category', async () => {
    const res = await request(app).get('/api/joke?tag=science&category=science');
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('science');
    expect(res.body.tags).toContain('science');
  });
});

describe('GET /api/stats includes tags breakdown', () => {
  it('has a tags object with counts', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body.tags).toBeDefined();
    expect(typeof res.body.tags).toBe('object');
    expect(res.body.tags['classic']).toBeGreaterThan(0);
    expect(res.body.tags['tech']).toBeGreaterThan(0);
  });
});

describe('PATCH /api/admin/submissions/:sid/tags', () => {
  it('sets tags on a pending submission', async () => {
    // First submit a joke
    const sub = await request(app)
      .post('/api/submit')
      .send({ joke: 'Why did the developer quit? He did not get arrays.', category: 'tech' });
    expect(sub.status).toBe(201);
    const sid = sub.body.sid;

    // Set tags via admin PATCH
    const patch = await request(app)
      .patch(`/api/admin/submissions/${sid}/tags`)
      .set('x-admin-token', 'dev-admin-token')
      .send({ tags: ['tech', 'programming'] });
    expect(patch.status).toBe(200);
    expect(patch.body.submission.tags).toEqual(['tech', 'programming']);
  });

  it('returns 400 if tags is not an array', async () => {
    const sub = await request(app)
      .post('/api/submit')
      .send({ joke: 'What do you call a ghost developer? A haunt-end engineer.', category: 'tech' });
    const sid = sub.body.sid;
    const res = await request(app)
      .patch(`/api/admin/submissions/${sid}/tags`)
      .set('x-admin-token', 'dev-admin-token')
      .send({ tags: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('returns 403 without admin token', async () => {
    const res = await request(app)
      .patch('/api/admin/submissions/99999/tags')
      .send({ tags: ['classic'] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/approve/:sid — preserves tags', () => {
  it('approves a submission with tags from request body', async () => {
    const sub = await request(app)
      .post('/api/submit')
      .send({ joke: 'I tried to catch fog earlier. I mist.', category: 'wordplay' });
    const sid = sub.body.sid;

    const approve = await request(app)
      .post(`/api/admin/approve/${sid}`)
      .set('x-admin-token', 'dev-admin-token')
      .send({ tags: ['wordplay', 'weather'] });
    expect(approve.status).toBe(200);
    expect(approve.body.joke.tags).toEqual(['wordplay', 'weather']);
  });
});

describe('jokes.json — tags coverage', () => {
  it('has at least 30 jokes with tags populated', () => {
    const jokes = require('../jokes.json');
    const withTags = jokes.filter(j => Array.isArray(j.tags) && j.tags.length > 0);
    expect(withTags.length).toBeGreaterThanOrEqual(30);
  });
});
