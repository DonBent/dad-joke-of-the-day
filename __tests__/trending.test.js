const request = require('supertest');
const fs = require('fs');
const os = require('os');
const pathLib = require('path');

const TMP_VOTES    = pathLib.join(os.tmpdir(), `trending-votes-${process.pid}.json`);
const TMP_REACTIONS= pathLib.join(os.tmpdir(), `trending-reactions-${process.pid}.json`);
const TMP_PASSPORTS= pathLib.join(os.tmpdir(), `trending-passports-${process.pid}.json`);
const TMP_COMMENTS = pathLib.join(os.tmpdir(), `trending-comments-${process.pid}.json`);
const TMP_EVENTS   = pathLib.join(os.tmpdir(), `trending-events-${process.pid}.json`);

process.env.VOTES_FILE          = TMP_VOTES;
process.env.REACTIONS_FILE      = TMP_REACTIONS;
process.env.PASSPORTS_FILE      = TMP_PASSPORTS;
process.env.COMMENTS_FILE       = TMP_COMMENTS;
process.env.TRENDING_EVENTS_FILE= TMP_EVENTS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PASSPORTS, JSON.stringify({}));
fs.writeFileSync(TMP_COMMENTS,  JSON.stringify([]));
fs.writeFileSync(TMP_EVENTS,    JSON.stringify([]));

const app = require('../server');
const {
  computeTrendingScore,
  getTrendingJokes,
  HALF_LIFE_HOURS,
  TRENDING_WINDOW_HOURS,
  TRENDING_EVENTS_FILE,
} = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PASSPORTS, TMP_COMMENTS, TMP_EVENTS].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
});

// Helper: write events file
function writeEvents(events) {
  fs.writeFileSync(TMP_EVENTS, JSON.stringify(events));
}

// ─── computeTrendingScore unit tests ──────────────────────────────────────
describe('computeTrendingScore() — unit', () => {
  it('exports HALF_LIFE_HOURS=2 and TRENDING_WINDOW_HOURS=24', () => {
    expect(HALF_LIFE_HOURS).toBe(2);
    expect(TRENDING_WINDOW_HOURS).toBe(24);
  });

  it('returns 0 for zero events', () => {
    const score = computeTrendingScore(1, [], [], new Date());
    expect(score).toBe(0);
  });

  it('returns 0 for events outside the window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 3600000).toISOString();
    const score = computeTrendingScore(1,
      [{ jokeId: 1, at: old }], [], now, 24);
    expect(score).toBe(0);
  });

  it('recent vote scores close to weight 2', () => {
    const now = new Date();
    const justNow = new Date(now.getTime() - 60000).toISOString(); // 1 min ago
    const score = computeTrendingScore(1, [{ jokeId: 1, at: justNow }], [], now, 24);
    expect(score).toBeGreaterThan(1.9);
    expect(score).toBeLessThanOrEqual(2);
  });

  it('recent reaction scores close to weight 1', () => {
    const now = new Date();
    const justNow = new Date(now.getTime() - 60000).toISOString();
    const score = computeTrendingScore(1, [], [{ jokeId: 1, at: justNow }], now, 24);
    expect(score).toBeGreaterThan(0.95);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('vote weight is 2× reaction weight for same-time events', () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString(); // 1h ago
    const voteScore = computeTrendingScore(1, [{ jokeId: 1, at: t }], [], now, 24);
    const rxnScore  = computeTrendingScore(1, [], [{ jokeId: 1, at: t }], now, 24);
    expect(Math.round(voteScore * 1000) / 1000).toBe(Math.round(rxnScore * 2 * 1000) / 1000);
  });

  it('event at exactly HALF_LIFE_HOURS ago is worth half weight', () => {
    const now = new Date();
    const halfLife = new Date(now.getTime() - HALF_LIFE_HOURS * 3600000).toISOString();
    const score = computeTrendingScore(1, [{ jokeId: 1, at: halfLife }], [], now, 24);
    // vote weight 2, decayed by 0.5 => ~1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('recent event scores higher than old event', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 1 * 3600000).toISOString();
    const old    = new Date(now.getTime() - 20 * 3600000).toISOString();
    const recentScore = computeTrendingScore(1, [{ jokeId: 1, at: recent }], [], now, 24);
    const oldScore    = computeTrendingScore(1, [{ jokeId: 1, at: old }],    [], now, 24);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('ignores events for other jokeIds', () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    const score = computeTrendingScore(1, [{ jokeId: 2, at: t }], [{ jokeId: 3, at: t }], now, 24);
    expect(score).toBe(0);
  });
});

// ─── getTrendingJokes unit tests ──────────────────────────────────────────
describe('getTrendingJokes() — unit', () => {
  beforeEach(() => writeEvents([]));

  it('returns empty array when no events', () => {
    expect(getTrendingJokes(5, 24)).toHaveLength(0);
  });

  it('ranks higher-scored joke first', async () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    writeEvents([
      { type: 'vote', jokeId: 1, at: t },
      { type: 'vote', jokeId: 1, at: t },
      { type: 'vote', jokeId: 2, at: t },
    ]);
    const ranked = getTrendingJokes(5, 24);
    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(2);
  });

  it('ties broken by jokeId ascending', async () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    writeEvents([
      { type: 'vote', jokeId: 5, at: t },
      { type: 'vote', jokeId: 3, at: t },
    ]);
    const ranked = getTrendingJokes(5, 24);
    // Same score, lower id wins
    expect(ranked[0].id).toBe(3);
    expect(ranked[1].id).toBe(5);
  });

  it('excludes jokes with score 0 (only old events)', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 3600000).toISOString();
    writeEvents([{ type: 'vote', jokeId: 1, at: old }]);
    expect(getTrendingJokes(5, 24)).toHaveLength(0);
  });

  it('respects the limit param', () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    writeEvents([1, 2, 3, 4, 5, 6].map(id => ({ type: 'vote', jokeId: id, at: t })));
    expect(getTrendingJokes(3, 24)).toHaveLength(3);
  });
});

// ─── API: GET /api/jokes/trending ─────────────────────────────────────────
describe('GET /api/jokes/trending', () => {
  beforeEach(() => writeEvents([]));

  it('returns [] when no events', async () => {
    const res = await request(app).get('/api/jokes/trending');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns X-Trending-Window-Hours header', async () => {
    const res = await request(app).get('/api/jokes/trending');
    expect(res.headers['x-trending-window-hours']).toBeDefined();
  });

  it('returns correct shape for a trending joke', async () => {
    const jokeRes = await request(app).get('/api/jokes/today/vibe');
    const jokeId = jokeRes.body.jokeId;
    await request(app).post(`/api/joke/${jokeId}/upvote`);
    const res = await request(app).get('/api/jokes/trending');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const item = res.body[0];
    expect(item).toMatchObject({
      id: expect.any(Number),
      joke: expect.any(String),
      category: expect.any(String),
      score: expect.any(Number),
      votes: expect.any(Number),
      rank: 1,
    });
    expect('topReaction' in item).toBe(true);
  });

  it('?limit clamps to 1–10', async () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    writeEvents([1, 2, 3, 4, 5, 6].map(id => ({ type: 'vote', jokeId: id, at: t })));
    const res = await request(app).get('/api/jokes/trending?limit=3');
    expect(res.body.length).toBeLessThanOrEqual(3);
  });

  it('?window param reflected in response header', async () => {
    const res = await request(app).get('/api/jokes/trending?window=6');
    expect(res.headers['x-trending-window-hours']).toBe('6');
  });

  it('?window > 168 clamped to 168', async () => {
    const res = await request(app).get('/api/jokes/trending?window=999');
    expect(res.headers['x-trending-window-hours']).toBe('168');
  });

  it('rank field increments 1, 2, 3...', async () => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600000).toISOString();
    writeEvents([
      { type: 'vote', jokeId: 1, at: t },
      { type: 'vote', jokeId: 1, at: t },
      { type: 'vote', jokeId: 2, at: t },
    ]);
    const res = await request(app).get('/api/jokes/trending');
    expect(res.body.map(i => i.rank)).toEqual(expect.arrayContaining([1, 2]));
    expect(res.body[0].rank).toBe(1);
  });
});

// ─── UI: data-testid presence ─────────────────────────────────────────────
describe('UI — data-testid attributes in index.html', () => {
  const html = fs.readFileSync(pathLib.join(__dirname, '../public/index.html'), 'utf8');

  it('has data-testid="trending-panel"', () => {
    expect(html).toContain('data-testid="trending-panel"');
  });

  it('has data-testid="trending-window-label"', () => {
    expect(html).toContain('data-testid="trending-window-label"');
  });

  it('has data-testid="trending-empty"', () => {
    expect(html).toContain('data-testid="trending-empty"');
  });

  it('TRENDING_POLL_INTERVAL_MS = 60000 defined in script', () => {
    expect(html).toContain('TRENDING_POLL_INTERVAL_MS = 60000');
  });

  it('localStorage key trending_panel_open used', () => {
    expect(html).toContain('trending_panel_open');
  });
});
