const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_VOTES     = pathLib.join(os.tmpdir(), `fy-votes-${process.pid}.json`);
const TMP_REACTIONS = pathLib.join(os.tmpdir(), `fy-reactions-${process.pid}.json`);
const TMP_PASSPORTS = pathLib.join(os.tmpdir(), `fy-passports-${process.pid}.json`);
const TMP_COMMENTS  = pathLib.join(os.tmpdir(), `fy-comments-${process.pid}.json`);
const TMP_EVENTS    = pathLib.join(os.tmpdir(), `fy-events-${process.pid}.json`);

process.env.VOTES_FILE           = TMP_VOTES;
process.env.REACTIONS_FILE       = TMP_REACTIONS;
process.env.PASSPORTS_FILE       = TMP_PASSPORTS;
process.env.COMMENTS_FILE        = TMP_COMMENTS;
process.env.TRENDING_EVENTS_FILE = TMP_EVENTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PASSPORTS, JSON.stringify({}));
fs.writeFileSync(TMP_COMMENTS,  JSON.stringify([]));
fs.writeFileSync(TMP_EVENTS,    JSON.stringify([]));

const app = require('../server');
const { computeCategoryAffinity, getRecommendations } = require('../server');

const VALID_TOKEN = '12345678-1234-4234-8234-1234567890ab';
const VALID_TOKEN_2 = 'aaaabbbb-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const BAD_TOKEN = '***';

// Minimal joke dataset for pure-function tests
const JOKES = [
  { id: 1, joke: 'Pun joke 1', category: 'pun' },
  { id: 2, joke: 'Pun joke 2', category: 'pun' },
  { id: 3, joke: 'Science joke', category: 'science' },
  { id: 4, joke: 'Animal joke', category: 'animal' },
  { id: 5, joke: 'Pun joke 3', category: 'pun' },
];

function writePassports(data) {
  fs.writeFileSync(TMP_PASSPORTS, JSON.stringify(data));
}

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PASSPORTS, TMP_COMMENTS, TMP_EVENTS].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

// ─── computeCategoryAffinity unit tests ──────────────────────────────────
describe('computeCategoryAffinity() — unit', () => {
  it('returns empty map for empty passport', () => {
    const result = computeCategoryAffinity({ votes: [], saves: [], reactions: [] }, JOKES);
    expect(Object.keys(result).length).toBe(0);
  });

  it('upvote adds 2.0 to category', () => {
    const p = { votes: [{ jokeId: 1, direction: 'up' }], saves: [], reactions: [] };
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['pun']).toBeCloseTo(1.0); // only category; normalised to 1
  });

  it('save adds 1.5 to category', () => {
    const p = { votes: [], saves: [{ jokeId: 3 }], reactions: [] };
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['science']).toBeCloseTo(1.0);
  });

  it('reaction adds 1.0 to category', () => {
    const p = { votes: [], saves: [], reactions: [{ jokeId: 4 }] };
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['animal']).toBeCloseTo(1.0);
  });

  it('normalises scores: highest category = 1.0', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 1, direction: 'up' }], // pun +4
      saves: [{ jokeId: 3 }], // science +1.5
      reactions: [],
    };
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['pun']).toBeCloseTo(1.0);
    expect(result['science']).toBeCloseTo(1.5 / 4);
  });

  it('multiple interactions accumulate before normalisation', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }],  // pun +2
      saves: [{ jokeId: 2 }],                    // pun +1.5
      reactions: [{ jokeId: 1 }],                // pun +1
    };
    // pun raw = 4.5, normalised = 1.0
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['pun']).toBeCloseTo(1.0);
  });

  it('downvote subtracts 1.0 (floor at 0)', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'down' }],
      saves: [],
      reactions: [],
    };
    const result = computeCategoryAffinity(p, JOKES);
    expect(result['pun'] || 0).toBe(0);
  });

  it('ignores jokeId not found in allJokes', () => {
    const p = { votes: [{ jokeId: 9999, direction: 'up' }], saves: [], reactions: [] };
    const result = computeCategoryAffinity(p, JOKES);
    expect(Object.keys(result).length).toBe(0);
  });
});

// ─── getRecommendations unit tests ───────────────────────────────────────
describe('getRecommendations() — unit', () => {
  it('returns [] when totalInteractions < 3', () => {
    const p = { votes: [{ jokeId: 1, direction: 'up' }], saves: [], reactions: [] };
    expect(getRecommendations(p, JOKES, 10)).toEqual([]);
  });

  it('returns [] when exactly 2 interactions', () => {
    const p = { votes: [{ jokeId: 1, direction: 'up' }], saves: [{ jokeId: 2 }], reactions: [] };
    expect(getRecommendations(p, JOKES, 10)).toEqual([]);
  });

  it('returns results when >= 3 interactions', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }],
      saves: [{ jokeId: 2 }],
      reactions: [{ jokeId: 3 }],
    };
    const recs = getRecommendations(p, JOKES, 10);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('excludes already-voted jokes', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 3, direction: 'up' }],
      saves: [{ jokeId: 2 }],
      reactions: [],
    };
    const recs = getRecommendations(p, JOKES, 10);
    const ids = recs.map(r => r.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
  });

  it('ranks higher-affinity category first', () => {
    // Give pun max affinity
    const p = {
      votes: [
        { jokeId: 1, direction: 'up' },
        { jokeId: 1, direction: 'up' },
        { jokeId: 2, direction: 'up' },
      ],
      saves: [],
      reactions: [],
    };
    const recs = getRecommendations(p, JOKES, 10);
    // id 5 is pun (not yet rated), id 4 is animal — pun should come first
    expect(recs[0].category).toBe('pun');
  });

  it('respects limit n', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }],
      saves: [{ jokeId: 2 }],
      reactions: [{ jokeId: 3 }],
    };
    const recs = getRecommendations(p, JOKES, 1);
    expect(recs.length).toBe(1);
  });

  it('returns rank starting from 1', () => {
    const p = {
      votes: [{ jokeId: 1, direction: 'up' }],
      saves: [{ jokeId: 2 }],
      reactions: [{ jokeId: 3 }],
    };
    const recs = getRecommendations(p, JOKES, 10);
    expect(recs[0].rank).toBe(1);
    if (recs.length > 1) expect(recs[1].rank).toBe(2);
  });
});

// ─── API: GET /api/passport/:token/recommendations ──────────────────────
describe('GET /api/passport/:token/recommendations', () => {
  beforeEach(() => writePassports({}));

  it('returns 400 for bad token format', async () => {
    const res = await request(app).get(`/api/passport/${BAD_TOKEN}/recommendations`);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown valid token', async () => {
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.statusCode).toBe(404);
  });

  it('returns correct shape', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 2, direction: 'up' }],
        saves: [{ jokeId: 3 }],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('recommendations');
    expect(res.body).toHaveProperty('strategy');
    expect(res.body).toHaveProperty('totalUnrated');
    expect(Array.isArray(res.body.recommendations)).toBe(true);
  });

  it('strategy is fallback when < 3 interactions', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }],
        saves: [],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.statusCode).toBe(200);
    expect(res.body.strategy).toBe('fallback');
  });

  it('strategy is affinity when >= 3 interactions', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 2, direction: 'up' }],
        saves: [{ jokeId: 3 }],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.statusCode).toBe(200);
    expect(res.body.strategy).toBe('affinity');
  });

  it('affinity recommendations have affinityScore as number', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 2, direction: 'up' }],
        saves: [{ jokeId: 3 }],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.body.strategy).toBe('affinity');
    for (const r of res.body.recommendations) {
      expect(typeof r.affinityScore).toBe('number');
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('joke');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('rank');
    }
  });

  it('fallback recommendations have affinityScore = null', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [],
        saves: [],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(res.body.strategy).toBe('fallback');
    for (const r of res.body.recommendations) {
      expect(r.affinityScore).toBeNull();
    }
  });

  it('totalUnrated excludes rated jokes', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 2, direction: 'up' }],
        saves: [{ jokeId: 3 }],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations`);
    expect(typeof res.body.totalUnrated).toBe('number');
    // 3 rated, so totalUnrated = totalJokes - 3
    const totalJokesRes = await request(app).get('/api/jokes');
    if (totalJokesRes.body && Array.isArray(totalJokesRes.body)) {
      expect(res.body.totalUnrated).toBe(totalJokesRes.body.length - 3);
    } else {
      expect(res.body.totalUnrated).toBeGreaterThanOrEqual(0);
    }
  });

  it('?limit param respected (clamped 1–20)', async () => {
    writePassports({
      [VALID_TOKEN]: {
        votes: [{ jokeId: 1, direction: 'up' }, { jokeId: 2, direction: 'up' }],
        saves: [{ jokeId: 3 }],
        reactions: [],
        streak: 0,
      },
    });
    const res = await request(app).get(`/api/passport/${VALID_TOKEN}/recommendations?limit=3`);
    expect(res.body.recommendations.length).toBeLessThanOrEqual(3);
  });
});

// ─── UI: data-testid presence ─────────────────────────────────────────────
describe('UI — data-testid attributes in index.html', () => {
  const html = fs.readFileSync(pathLib.join(__dirname, '../public/index.html'), 'utf8');

  it('has data-testid="for-you-tab"', () => {
    expect(html).toContain('data-testid="for-you-tab"');
  });

  it('has data-testid="for-you-no-passport"', () => {
    expect(html).toContain('data-testid="for-you-no-passport"');
  });

  it('has data-testid="for-you-fallback-hint"', () => {
    expect(html).toContain('data-testid="for-you-fallback-hint"');
  });

  it('has data-testid="for-you-refresh"', () => {
    expect(html).toContain('data-testid="for-you-refresh"');
  });

  it('has data-testid="for-you-unrated-count"', () => {
    expect(html).toContain('data-testid="for-you-unrated-count"');
  });

  it('has for-you-item-${item.rank} pattern in script', () => {
    expect(html).toContain('for-you-item-');
  });
});
