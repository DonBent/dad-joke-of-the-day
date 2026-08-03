const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_VOTES     = pathLib.join(os.tmpdir(), `badges-votes-${process.pid}.json`);
const TMP_REACTIONS = pathLib.join(os.tmpdir(), `badges-reactions-${process.pid}.json`);
const TMP_PASSPORTS = pathLib.join(os.tmpdir(), `badges-passports-${process.pid}.json`);
const TMP_COMMENTS  = pathLib.join(os.tmpdir(), `badges-comments-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PASSPORTS_FILE = TMP_PASSPORTS;
process.env.COMMENTS_FILE  = TMP_COMMENTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PASSPORTS, JSON.stringify({}));
fs.writeFileSync(TMP_COMMENTS,  JSON.stringify([]));

const app = require('../server');
const { computeBadges, BADGE_DEFINITIONS } = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PASSPORTS, TMP_COMMENTS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// ─── computeBadges unit tests ──────────────────────────────────────────────
describe('computeBadges() — unit', () => {
  it('earns nothing for a zero-activity passport', () => {
    const badges = computeBadges({ votes: [], reactions: [], saves: [], streak: 0 });
    expect(badges).toHaveLength(0);
  });

  it('earns first_groaner after 1 vote', () => {
    const badges = computeBadges({ votes: [{ jokeId: 1 }], reactions: [], saves: [], streak: 0 });
    expect(badges.map(b => b.id)).toContain('first_groaner');
  });

  it('earns laugh_track after 1 reaction', () => {
    const badges = computeBadges({ votes: [], reactions: [{ jokeId: 1, emoji: 'laugh' }], saves: [], streak: 0 });
    expect(badges.map(b => b.id)).toContain('laugh_track');
  });

  it('earns hoarder at 10 saves', () => {
    const saves = Array.from({ length: 10 }, (_, i) => ({ jokeId: i + 1 }));
    const badges = computeBadges({ votes: [], reactions: [], saves, streak: 0 });
    expect(badges.map(b => b.id)).toContain('hoarder');
    expect(badges.map(b => b.id)).not.toContain('collector');
  });

  it('earns loyal_groaner at streak ≥ 7', () => {
    const badges = computeBadges({ votes: [], reactions: [], saves: [], streak: 7 });
    expect(badges.map(b => b.id)).toContain('loyal_groaner');
  });

  it('earns prolific at 50 votes', () => {
    const votes = Array.from({ length: 50 }, (_, i) => ({ jokeId: i + 1 }));
    const badges = computeBadges({ votes, reactions: [], saves: [], streak: 0 });
    expect(badges.map(b => b.id)).toContain('prolific');
  });

  it('earns reactor at 25 reactions', () => {
    const reactions = Array.from({ length: 25 }, (_, i) => ({ jokeId: i + 1, emoji: 'laugh' }));
    const badges = computeBadges({ votes: [], reactions, saves: [], streak: 0 });
    expect(badges.map(b => b.id)).toContain('reactor');
  });

  it('earns marathon_groaner at streak ≥ 30', () => {
    const badges = computeBadges({ votes: [], reactions: [], saves: [], streak: 30 });
    expect(badges.map(b => b.id)).toContain('marathon_groaner');
  });

  it('earns collector at 50 saves', () => {
    const saves = Array.from({ length: 50 }, (_, i) => ({ jokeId: i + 1 }));
    const badges = computeBadges({ votes: [], reactions: [], saves, streak: 0 });
    expect(badges.map(b => b.id)).toContain('collector');
  });

  it('superfan requires all three conditions (totalVotes≥100, totalSaves≥25, streak≥14)', () => {
    const votes100 = Array.from({ length: 100 }, (_, i) => ({ jokeId: i + 1 }));
    const saves25  = Array.from({ length: 25 },  (_, i) => ({ jokeId: i + 1 }));
    // Missing streak
    expect(computeBadges({ votes: votes100, reactions: [], saves: saves25, streak: 13 }).map(b => b.id)).not.toContain('superfan');
    // Missing saves
    expect(computeBadges({ votes: votes100, reactions: [], saves: saves25.slice(0, 24), streak: 14 }).map(b => b.id)).not.toContain('superfan');
    // Missing votes
    expect(computeBadges({ votes: votes100.slice(0, 99), reactions: [], saves: saves25, streak: 14 }).map(b => b.id)).not.toContain('superfan');
    // All three met
    expect(computeBadges({ votes: votes100, reactions: [], saves: saves25, streak: 14 }).map(b => b.id)).toContain('superfan');
  });

  it('badge shape has id, name, emoji, earnedAt:null', () => {
    const badges = computeBadges({ votes: [{ jokeId: 1 }], reactions: [], saves: [], streak: 0 });
    expect(badges[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), emoji: expect.any(String), earnedAt: null });
  });

  it('BADGE_DEFINITIONS exports 9 definitions', () => {
    expect(BADGE_DEFINITIONS).toHaveLength(9);
  });
});

// ─── API: GET /api/passport/:token includes badges ─────────────────────────
describe('GET /api/passport/:token — includes badges', () => {
  const TOKEN = 'a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1';

  beforeAll(async () => {
    // Create passport by saving a joke (lazy creation)
    const jokeRes = await request(app).get('/api/jokes/today/vibe');
    const jokeId = jokeRes.body.jokeId;
    await request(app).post(`/api/passport/${TOKEN}/saves/${jokeId}`);
  });

  it('includes badges array in GET /api/passport/:token response', async () => {
    const res = await request(app).get(`/api/passport/${TOKEN}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.badges)).toBe(true);
  });

  it('badges array contains objects with id/name/emoji/earnedAt', async () => {
    const res = await request(app).get(`/api/passport/${TOKEN}`);
    if (res.body.badges.length > 0) {
      expect(res.body.badges[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), emoji: expect.any(String), earnedAt: null });
    }
  });
});

// ─── API: GET /api/passport/:token/badges ─────────────────────────────────
describe('GET /api/passport/:token/badges — standalone endpoint', () => {
  const TOKEN = 'b2b2b2b2-b2b2-4b2b-b2b2-b2b2b2b2b2b2';

  beforeAll(async () => {
    const jokeRes = await request(app).get('/api/jokes/today/vibe');
    const jokeId = jokeRes.body.jokeId;
    await request(app).post(`/api/passport/${TOKEN}/saves/${jokeId}`);
  });

  it('returns array from /badges endpoint', async () => {
    const res = await request(app).get(`/api/passport/${TOKEN}/badges`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 400 on malformed token', async () => {
    const res = await request(app).get('/api/passport/bad-token/badges');
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 on unknown valid token', async () => {
    const res = await request(app).get('/api/passport/ffffffff-ffff-4fff-afff-ffffffffffff/badges');
    expect(res.statusCode).toBe(404);
  });

  it('/badges array matches badges in GET /api/passport/:token', async () => {
    const full = await request(app).get(`/api/passport/${TOKEN}`);
    const slim = await request(app).get(`/api/passport/${TOKEN}/badges`);
    expect(slim.body).toEqual(full.body.badges);
  });
});

// ─── UI: data-testid presence ─────────────────────────────────────────────
describe('UI — data-testid attributes in index.html', () => {
  const html = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8');

  it('has data-testid="badges-section"', () => {
    expect(html).toContain('data-testid="badges-section"');
  });

  it('has data-testid="badges-empty"', () => {
    expect(html).toContain('data-testid="badges-empty"');
  });

  it('has data-testid="share-badges-button"', () => {
    expect(html).toContain('data-testid="share-badges-button"');
  });
});
