require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const cron = require('node-cron');
const builtinJokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const VOTES_FILE = process.env.VOTES_FILE || path.join(__dirname, 'votes.json');
const REACTIONS_FILE = process.env.REACTIONS_FILE || path.join(__dirname, 'reactions.json');
const CUSTOM_JOKES_FILE = process.env.CUSTOM_JOKES_FILE || path.join(__dirname, 'custom-jokes.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const SUBSCRIBERS_FILE = process.env.SUBSCRIBERS_FILE || path.join(__dirname, 'subscribers.json');
const HALL_OF_FAME_FILE = process.env.HALL_OF_FAME_FILE || path.join(__dirname, 'hall-of-fame.json');
const COMMENTS_FILE = process.env.COMMENTS_FILE || path.join(__dirname, 'comments.json');
const PUSH_SUBS_FILE = process.env.PUSH_SUBS_FILE || path.join(__dirname, 'push-subscriptions.json');
const DUEL_FILE = process.env.DUEL_FILE || path.join(__dirname, 'duel.json');
const IMPORT_PENDING_FILE = process.env.IMPORT_PENDING_FILE || path.join(__dirname, 'import-pending.json');
const PASSPORTS_FILE = process.env.PASSPORTS_FILE || path.join(__dirname, 'passports.json');
const TRENDING_EVENTS_FILE = process.env.TRENDING_EVENTS_FILE || path.join(__dirname, 'trending-events.json');
const VOTE_LOG_FILE = process.env.VOTE_LOG_FILE || path.join(__dirname, 'vote-log.json');
const CHALLENGES_FILE = process.env.CHALLENGES_FILE || path.join(__dirname, 'challenges.json');

// UUID v4 validation regex
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── VAPID / Web Push setup ───────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:admin@dadjoke.local';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

app.use(express.json());

// ── Persistence helpers ──────────────────────────────────────────────────────
function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let votes = readJson(VOTES_FILE, {});
function saveVotes() { writeJson(VOTES_FILE, votes); }

// reactions[jokeId] = { laugh: N, groan: N, drums: N, melt: N }
// reactorIndex[jokeId][ip] = reactionKey
let reactions = readJson(REACTIONS_FILE, {});
let reactorIndex = {}; // rebuilt from reactions.json on startup – separate file not needed; we maintain in-memory only
const VALID_REACTIONS = ['laugh', 'groan', 'drums', 'melt'];
function saveReactions() { writeJson(REACTIONS_FILE, reactions); }

function jokeReactions(jokeId) {
  return reactions[jokeId] || { laugh: 0, groan: 0, drums: 0, melt: 0 };
}

function allJokes() {
  const custom = readJson(CUSTOM_JOKES_FILE, []);
  return [...builtinJokes, ...custom];
}

function nextId() {
  const maxBuiltin = Math.max(...builtinJokes.map(j => j.id));
  const custom = readJson(CUSTOM_JOKES_FILE, []);
  const maxCustom = custom.length ? Math.max(...custom.map(j => j.id)) : 0;
  return Math.max(maxBuiltin, maxCustom) + 1;
}

// ── Middleware ───────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── Joke helpers ─────────────────────────────────────────────────────────────
function jokeWithVotes(joke) {
  return { ...joke, votes: votes[joke.id] || 0, reactions: jokeReactions(joke.id) };
}

function weightedRandom(pool) {
  const weights = pool.map(j => 1 + (votes[j.id] || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function jokeForDate(dateStr) {
  const jokes = allJokes();
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) & 0xffffffff;
  return jokes[Math.abs(hash) % jokes.length];
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── Rate limiting (in-memory) ───────────────────────────────────────────────
const submitRateLimit = {}; // ip -> [timestamps]
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const times = (submitRateLimit[ip] || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  submitRateLimit[ip] = times;
  if (times.length >= RATE_LIMIT_MAX) return false;
  times.push(now);
  return true;
}

// Comment rate limit: max 3 comments per joke per IP per 24 h
const commentRateLimit = {}; // `${ip}:${jokeId}` -> [timestamps]
const COMMENT_RATE_LIMIT_MAX = 3;
const COMMENT_RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours

function checkCommentRateLimit(ip, jokeId) {
  const key = `${ip}:${jokeId}`;
  const now = Date.now();
  const times = (commentRateLimit[key] || []).filter(t => now - t < COMMENT_RATE_LIMIT_WINDOW);
  commentRateLimit[key] = times;
  if (times.length >= COMMENT_RATE_LIMIT_MAX) return false;
  times.push(now);
  return true;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Test helper: clear in-memory rate limit state
function _resetCommentRateLimitForTest() {
  Object.keys(commentRateLimit).forEach(k => delete commentRateLimit[k]);
}

// ── Static ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Public API ───────────────────────────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(allJokes().map(j => j.category))].sort();
  res.json(categories);
});

// ── Reactions ────────────────────────────────────────────────────────────────
app.post('/api/jokes/:id/react', (req, res) => {
  const id = String(parseInt(req.params.id));
  if (!allJokes().find(j => j.id === parseInt(id))) return res.status(404).json({ error: 'Joke not found' });
  const { reaction } = req.body || {};
  if (!VALID_REACTIONS.includes(reaction)) {
    return res.status(400).json({ error: `reaction must be one of: ${VALID_REACTIONS.join(', ')}` });
  }
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!reactorIndex[id]) reactorIndex[id] = {};
  if (!reactions[id]) reactions[id] = { laugh: 0, groan: 0, drums: 0, melt: 0 };
  const prev = reactorIndex[id][ip];
  if (prev === reaction) {
    // Toggle off — remove reaction
    reactions[id][prev] = Math.max(0, (reactions[id][prev] || 0) - 1);
    delete reactorIndex[id][ip];
    saveReactions();
    return res.json({ id: parseInt(id), reactions: reactions[id], userReaction: null });
  }
  if (prev) {
    // Change reaction: remove old
    reactions[id][prev] = Math.max(0, (reactions[id][prev] || 0) - 1);
  }
  reactions[id][reaction] = (reactions[id][reaction] || 0) + 1;
  reactorIndex[id][ip] = reaction;
  saveReactions();
  appendTrendingEvent({ type: 'reaction', jokeId: parseInt(id), reaction, at: new Date().toISOString() });
  // Write to passport if token present
  const pToken = req.headers['x-passport-token'] || req.query.passport;
  if (pToken && UUID_V4_RE.test(pToken)) {
    const passports = readPassports();
    const p = ensurePassport(passports, pToken);
    p.reactions = p.reactions.filter(r => r.jokeId !== parseInt(id));
    if (reactorIndex[id][ip]) {
      p.reactions.push({ jokeId: parseInt(id), emoji: reaction, at: new Date().toISOString() });
    }
    savePassports(passports);
  }
  res.json({ id: parseInt(id), reactions: reactions[id], userReaction: reaction });
});

app.post('/api/joke/:id/upvote', (req, res) => {
  const id = parseInt(req.params.id);
  if (!allJokes().find(j => j.id === id)) return res.status(404).json({ error: 'Joke not found' });
  votes[id] = (votes[id] || 0) + 1;
  saveVotes();
  appendVoteLog({ jokeId: id, direction: 'up', at: new Date().toISOString() });
  appendTrendingEvent({ type: 'vote', jokeId: id, at: new Date().toISOString() });
  // Write to passport if token present
  const pToken = req.headers['x-passport-token'] || req.query.passport;
  if (pToken && UUID_V4_RE.test(pToken)) {
    const passports = readPassports();
    const p = ensurePassport(passports, pToken);
    if (!p.votes.find(v => v.jokeId === id)) {
      p.votes.push({ jokeId: id, direction: 'up', at: new Date().toISOString() });
    }
    savePassports(passports);
  }
  res.json({ id, votes: votes[id] });
});

app.get('/api/joke/today', (req, res) => {
  const today = todayStr();
  res.json({ ...jokeWithVotes(jokeForDate(today)), date: today });
});

app.get('/api/joke/day/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  res.json({ ...jokeWithVotes(jokeForDate(date)), date });
});

app.get('/api/archive', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push({ ...jokeWithVotes(jokeForDate(dateStr)), date: dateStr });
  }
  res.json(result);
});

// RSS feed
app.get('/feed.rss', (req, res) => {
  const days = 30;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const items = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const joke = jokeForDate(dateStr);
    const pubDate = new Date(dateStr + 'T12:00:00Z').toUTCString();
    items.push(`    <item>
      <title>Dad Joke — ${dateStr}</title>
      <link>${baseUrl}/#joke-${joke.id}</link>
      <guid isPermaLink="false">${dateStr}-${joke.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${joke.joke}]]></description>
      <category>${joke.category}</category>
    </item>`);
  }
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dad Joke of the Day</title>
    <link>${baseUrl}</link>
    <description>A fresh dad joke every day. Subscribe for daily groan-worthy humor.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>`;
  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(rss);
});

// Search jokes
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  const results = allJokes().filter(j => j.joke.toLowerCase().includes(q)).map(jokeWithVotes);
  res.json({ q, count: results.length, results });
});

// Hall of Fame
app.get('/api/jokes/hall-of-fame', (req, res) => {
  const hall = readJson(HALL_OF_FAME_FILE, []);
  // Return reverse-chronological (most recent month first)
  const sorted = [...hall].sort((a, b) => b.month.localeCompare(a.month));
  res.json(sorted);
});

// Admin: freeze month winner into hall of fame
app.post('/api/admin/freeze-hall-of-fame', adminAuth, (req, res) => {
  const { month } = req.body || {};
  // Validate month format YYYY-MM
  const monthStr = month || (() => {
    const d = new Date();
    // Default: freeze the previous month
    d.setDate(0); // last day of previous month
    return d.toISOString().slice(0, 7);
  })();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    return res.status(400).json({ error: 'month must be YYYY-MM' });
  }
  const hall = readJson(HALL_OF_FAME_FILE, []);
  if (hall.some(e => e.month === monthStr)) {
    return res.status(409).json({ error: `Hall of Fame entry for ${monthStr} already exists` });
  }
  // Find the top-voted joke
  const top = allJokes()
    .map(j => ({ id: j.id, joke: j.joke, category: j.category, score: votes[j.id] || 0 }))
    .filter(j => j.score >= 1)
    .sort((a, b) => b.score - a.score);
  if (!top.length) {
    return res.status(422).json({ error: 'No voted jokes to freeze' });
  }
  const winner = top[0];
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const entry = {
    month: monthStr,
    jokeId: winner.id,
    text: winner.joke,
    score: winner.score,
    permalink: `${baseUrl}/#joke-${winner.id}`,
    frozenAt: new Date().toISOString()
  };
  hall.push(entry);
  writeJson(HALL_OF_FAME_FILE, hall);
  console.log(JSON.stringify({ event: 'hall_of_fame_frozen', month: monthStr, jokeId: winner.id, score: winner.score }));
  res.status(201).json(entry);
});

// Serve /hall-of-fame page
app.get('/hall-of-fame', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hall-of-fame.html'));
});

// Serve /best-of-year page (v29)
app.get('/best-of-year', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'best-of-year.html'));
});

// Top jokes leaderboard
app.get('/api/jokes/top', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  const top = allJokes()
    .map(j => ({ id: j.id, joke: j.joke, category: j.category, votes: votes[j.id] || 0 }))
    .filter(j => j.votes >= 1)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit);
  res.json(top);
});

// Random joke (weighted, never today's daily)
app.get('/api/jokes/random', (req, res) => {
  const today = todayStr();
  const dailyJoke = jokeForDate(today);
  const pool = allJokes();
  if (pool.length <= 1) {
    // Only one joke exists — return it anyway
    return res.json(jokeWithVotes(pool[0]));
  }
  // Build pool excluding today's daily joke
  const eligible = pool.filter(j => j.id !== dailyJoke.id);
  // Weighted random including reaction totals in weight
  function weightedRandomWithReactions(candidates) {
    const weights = candidates.map(j => {
      const rxns = reactions[j.id] || {};
      const reactionTotal = Object.values(rxns).reduce((s, v) => s + v, 0);
      return 1 + (votes[j.id] || 0) + reactionTotal;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      rand -= weights[i];
      if (rand <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }
  const chosen = weightedRandomWithReactions(eligible);
  res.json(jokeWithVotes(chosen));
});

// Stats
app.get('/api/stats', (req, res) => {
  const jokes = allJokes();
  const categoryCounts = {};
  jokes.forEach(j => { categoryCounts[j.category] = (categoryCounts[j.category] || 0) + 1; });
  const topVoted = jokes
    .map(j => ({ id: j.id, joke: j.joke.slice(0, 60) + (j.joke.length > 60 ? '…' : ''), votes: votes[j.id] || 0 }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 5);
  const subs = readJson(SUBMISSIONS_FILE, []);
  res.json({
    totalJokes: jokes.length,
    builtinJokes: builtinJokes.length,
    customJokes: jokes.length - builtinJokes.length,
    categories: categoryCounts,
    pendingSubmissions: subs.length,
    topVoted
  });
});

app.get('/api/joke', (req, res) => {
  const { category } = req.query;
  let pool = allJokes();
  if (category) {
    pool = pool.filter(j => j.category === category);
    if (!pool.length) return res.status(404).json({ error: `No jokes found for category: ${category}` });
  }
  res.json(jokeWithVotes(weightedRandom(pool)));
});

app.get('/api/joke/:id', (req, res) => {
  const joke = allJokes().find(j => j.id === parseInt(req.params.id));
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  const token = req.headers['x-passport-token'] || req.query.passport;
  const base = jokeWithVotes(joke);
  if (token && UUID_V4_RE.test(token)) {
    const passports = readJson(PASSPORTS_FILE, {});
    const p = passports[token];
    base.userVote = p ? (p.votes.find(v => v.jokeId === joke.id) || null) : null;
    base.userReaction = p ? (p.reactions.find(r => r.jokeId === joke.id) ? p.reactions.find(r => r.jokeId === joke.id).emoji : null) : null;
    base.userSaved = p ? p.saves.some(s => s.jokeId === joke.id) : false;
  }
  res.json(base);
});

// Submit a joke
app.post('/api/submit', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please wait before submitting again.' });
  }
  const { joke, category } = req.body || {};
  if (!joke || typeof joke !== 'string' || joke.trim().length < 10) {
    return res.status(400).json({ error: 'joke must be at least 10 characters' });
  }
  const validCategories = [...new Set(builtinJokes.map(j => j.category))];
  const cat = validCategories.includes(category) ? category : 'general';
  const subs = readJson(SUBMISSIONS_FILE, []);
  const sub = { sid: Date.now(), joke: joke.trim(), category: cat, submittedAt: new Date().toISOString() };
  subs.push(sub);
  writeJson(SUBMISSIONS_FILE, subs);
  res.status(201).json({ message: 'Submitted! Your joke will appear after moderation.', sid: sub.sid });
});

// ── Passport helpers ────────────────────────────────────────────────────────
function readPassports() { return readJson(PASSPORTS_FILE, {}); }
function savePassports(data) { writeJson(PASSPORTS_FILE, data); }

function ensurePassport(passports, token) {
  if (!passports[token]) {
    passports[token] = {
      token,
      createdAt: new Date().toISOString(),
      streak: 0,
      votes: [],
      reactions: [],
      saves: []
    };
  }
  return passports[token];
}

// ── Groan Badges (v26) ────────────────────────────────────────────────────
const BADGE_DEFINITIONS = [
  { id: 'first_groaner',    name: 'First Groaner',    emoji: '🗳️',  test: p => p.totalVotes >= 1 },
  { id: 'laugh_track',     name: 'Laugh Track',      emoji: '😂',  test: p => p.totalReactions >= 1 },
  { id: 'hoarder',         name: 'Hoarder',          emoji: '🔖',  test: p => p.totalSaves >= 10 },
  { id: 'loyal_groaner',   name: 'Loyal Groaner',    emoji: '🔥',  test: p => p.streak >= 7 },
  { id: 'prolific',        name: 'Prolific',         emoji: '🗳️',  test: p => p.totalVotes >= 50 },
  { id: 'collector',       name: 'Collector',        emoji: '🏆',  test: p => p.totalSaves >= 50 },
  { id: 'marathon_groaner',name: 'Marathon Groaner', emoji: '🔥',  test: p => p.streak >= 30 },
  { id: 'reactor',         name: 'Reactor',          emoji: '😬',  test: p => p.totalReactions >= 25 },
  { id: 'superfan',        name: 'Superfan',         emoji: '⭐',  test: p => p.totalVotes >= 100 && p.totalSaves >= 25 && p.streak >= 14 },
];

function computeBadges(passport) {
  const summary = {
    streak: passport.streak || 0,
    totalVotes: Array.isArray(passport.votes) ? passport.votes.length : (passport.totalVotes || 0),
    totalReactions: Array.isArray(passport.reactions) ? passport.reactions.length : (passport.totalReactions || 0),
    totalSaves: Array.isArray(passport.saves) ? passport.saves.length : (passport.totalSaves || 0),
  };
  return BADGE_DEFINITIONS
    .filter(b => b.test(summary))
    .map(({ id, name, emoji }) => ({ id, name, emoji, earnedAt: null }));
}

function passportSummary(p) {
  const summary = {
    token: p.token,
    createdAt: p.createdAt,
    streak: p.streak || 0,
    votes: p.votes,
    reactions: p.reactions,
    saves: p.saves,
    totalVotes: p.votes.length,
    totalReactions: p.reactions.length,
    totalSaves: p.saves.length
  };
  summary.badges = computeBadges(summary);
  return summary;
}

// ── Trending Now (v27) ────────────────────────────────────────────────────
const HALF_LIFE_HOURS = 2;
const TRENDING_WINDOW_HOURS = 24;
const TRENDING_VOTE_WEIGHT = 2;
const TRENDING_REACTION_WEIGHT = 1;

// Trending event log helpers (lazy-create)
function readTrendingEvents() { return readJson(TRENDING_EVENTS_FILE, []); }
function appendTrendingEvent(entry) {
  const events = readTrendingEvents();
  events.push(entry);
  writeJson(TRENDING_EVENTS_FILE, events);
}

function appendVoteLog(entry) {
  const log = readJson(VOTE_LOG_FILE, []);
  log.push(entry);
  writeJson(VOTE_LOG_FILE, log);
}

/**
 * Pure function — compute time-decay trending score for a single joke.
 * @param {number} jokeId
 * @param {Array<{jokeId,at}>} voteEvents - vote event log entries
 * @param {Array<{jokeId,at}>} reactionEvents - reaction event log entries
 * @param {Date} now
 * @param {number} windowHours - only events within this window are scored
 * @returns {number}
 */
function computeTrendingScore(jokeId, voteEvents, reactionEvents, now, windowHours) {
  const wh = windowHours != null ? windowHours : TRENDING_WINDOW_HOURS;
  const lambda = Math.LN2 / HALF_LIFE_HOURS;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  let score = 0;
  for (const ev of voteEvents) {
    if (ev.jokeId !== jokeId) continue;
    const hoursAgo = (nowMs - new Date(ev.at).getTime()) / 3600000;
    if (hoursAgo < 0 || hoursAgo > wh) continue;
    score += TRENDING_VOTE_WEIGHT * Math.exp(-lambda * hoursAgo);
  }
  for (const ev of reactionEvents) {
    if (ev.jokeId !== jokeId) continue;
    const hoursAgo = (nowMs - new Date(ev.at).getTime()) / 3600000;
    if (hoursAgo < 0 || hoursAgo > wh) continue;
    score += TRENDING_REACTION_WEIGHT * Math.exp(-lambda * hoursAgo);
  }
  return score;
}

/**
 * Return top-n jokes by trending score.
 * Ties broken by jokeId ascending. Jokes with score=0 excluded.
 */
function getTrendingJokes(n, windowHours) {
  const limit = n != null ? n : 5;
  const wh = windowHours != null ? windowHours : TRENDING_WINDOW_HOURS;
  const now = new Date();
  const events = readTrendingEvents();
  const voteEvents = events.filter(e => e.type === 'vote');
  const reactionEvents = events.filter(e => e.type === 'reaction');
  // Gather unique joke ids that have events in window
  const nowMs = now.getTime();
  const activeIds = new Set();
  for (const ev of events) {
    const hoursAgo = (nowMs - new Date(ev.at).getTime()) / 3600000;
    if (hoursAgo >= 0 && hoursAgo <= wh) activeIds.add(ev.jokeId);
  }
  return Array.from(activeIds)
    .map(id => ({ id, score: computeTrendingScore(id, voteEvents, reactionEvents, now, wh) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, limit);
}

// Middleware: optional passport token validation
function passportToken(req, res, next) {
  const token = req.headers['x-passport-token'] || req.query.passport;
  if (token) {
    if (!UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
    req.passportToken = token;
  }
  next();
}

// ── Today's Vibe (v25) ────────────────────────────────────────────────────
const REACTION_EMOJIS = { laugh: '😂', groan: '😬', drums: '🥁', melt: '🫠' };

app.get('/api/jokes/today/vibe', (req, res) => {
  const today = todayStr();
  const joke = jokeForDate(today);
  const jokeId = joke.id;
  const idStr = String(jokeId);

  // Validate optional passport token early
  const token = req.headers['x-passport-token'] || req.query.passport;
  if (token && !UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
  // Score
  const score = votes[jokeId] || 0;

  // Dominant reaction
  const rxns = reactions[idStr] || {};
  let dominantReaction = null;
  let dominantReactionCount = 0;
  for (const [key, count] of Object.entries(rxns)) {
    if (count > dominantReactionCount) {
      dominantReactionCount = count;
      dominantReaction = REACTION_EMOJIS[key] || null;
    }
  }

  // Comment count (all statuses)
  const comments = readJson(COMMENTS_FILE, []);
  const commentCount = comments.filter(c => c.jokeId === jokeId).length;

  const result = { jokeId, score, dominantReaction, dominantReactionCount, commentCount };

  // Passport enrichment
  if (token && UUID_V4_RE.test(token)) {
    const passports = readPassports();
    const p = passports[token];
    result.userVoted = p ? p.votes.some(v => v.jokeId === jokeId) : false;
    result.userReacted = p ? (p.reactions.find(r => r.jokeId === jokeId) ? REACTION_EMOJIS[p.reactions.find(r => r.jokeId === jokeId).emoji] || p.reactions.find(r => r.jokeId === jokeId).emoji : null) : null;
  }

  res.json(result);
});

// GET /api/jokes/trending (v27)
app.get('/api/jokes/trending', (req, res) => {
  let limit = parseInt(req.query.limit);
  let window = parseInt(req.query.window);
  if (isNaN(limit) || limit < 1) limit = 5;
  if (limit > 10) limit = 10;
  if (isNaN(window) || window < 1) window = TRENDING_WINDOW_HOURS;
  if (window > 168) window = 168;

  const ranked = getTrendingJokes(limit, window);
  const jokes = allJokes();
  const events = readTrendingEvents();
  const nowMs = Date.now();

  const result = ranked.map((item, idx) => {
    const joke = jokes.find(j => j.id === item.id);
    // vote count from events in window
    const voteCount = events.filter(e => e.type === 'vote' && e.jokeId === item.id &&
      (nowMs - new Date(e.at).getTime()) / 3600000 <= window).length;
    // top reaction from events in window
    const rxnCounts = {};
    for (const e of events) {
      if (e.type !== 'reaction' || e.jokeId !== item.id) continue;
      if ((nowMs - new Date(e.at).getTime()) / 3600000 > window) continue;
      rxnCounts[e.reaction] = (rxnCounts[e.reaction] || 0) + 1;
    }
    let topRxn = null, topRxnCount = 0;
    for (const [k, v] of Object.entries(rxnCounts)) {
      if (v > topRxnCount) { topRxnCount = v; topRxn = REACTION_EMOJIS[k] || k; }
    }
    return {
      id: item.id,
      joke: joke ? joke.joke : '',
      category: joke ? joke.category : '',
      score: Math.round(item.score * 100) / 100,
      votes: voteCount,
      topReaction: topRxn,
      rank: idx + 1,
    };
  });

  res.set('X-Trending-Window-Hours', String(window));
  res.json(result);
});

app.get('/api/passport/:token', (req, res) => {
  const { token } = req.params;
  if (!UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
  const passports = readPassports();
  if (!passports[token]) return res.status(404).json({ error: 'Passport not found' });
  res.json(passportSummary(passports[token]));
});

// GET /api/passport/:token/badges — convenience endpoint
app.get('/api/passport/:token/badges', (req, res) => {
  const { token } = req.params;
  if (!UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
  const passports = readPassports();
  if (!passports[token]) return res.status(404).json({ error: 'Passport not found' });
  res.json(computeBadges(passports[token]));
});

// POST /api/passport/:token/saves/:jokeId — toggle save
app.post('/api/passport/:token/saves/:jokeId', (req, res) => {
  const { token } = req.params;
  const jokeId = parseInt(req.params.jokeId);
  if (!UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
  if (!allJokes().find(j => j.id === jokeId)) return res.status(404).json({ error: 'Joke not found' });
  const passports = readPassports();
  const p = ensurePassport(passports, token);
  const idx = p.saves.findIndex(s => s.jokeId === jokeId);
  let saved;
  if (idx >= 0) {
    p.saves.splice(idx, 1);
    saved = false;
  } else {
    p.saves.push({ jokeId, at: new Date().toISOString() });
    saved = true;
  }
  savePassports(passports);
  res.json({ token, jokeId, saved, totalSaves: p.saves.length });
});

// Serve /passport/:token — client-side import page
app.get('/passport/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Comments (v19 — Roast the Joke) ────────────────────────────────────────
app.get('/api/jokes/:id/comments', (req, res) => {
  const id = parseInt(req.params.id);
  if (!allJokes().find(j => j.id === id)) return res.status(404).json({ error: 'Joke not found' });
  const comments = readJson(COMMENTS_FILE, []);
  const approved = comments
    .filter(c => c.jokeId === id && c.status === 'approved')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
    .map(({ id, jokeId, text, createdAt }) => ({ id, jokeId, text, createdAt }));
  res.json(approved);
});

app.post('/api/jokes/:id/comments', (req, res) => {
  const id = parseInt(req.params.id);
  if (!allJokes().find(j => j.id === id)) return res.status(404).json({ error: 'Joke not found' });
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.trim().length > 280) {
    return res.status(400).json({ error: 'text must be 280 characters or fewer' });
  }
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkCommentRateLimit(ip, id)) {
    return res.status(429).json({ error: 'Too many comments for this joke. Try again tomorrow.' });
  }
  const comments = readJson(COMMENTS_FILE, []);
  const comment = {
    id: `c${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    jokeId: id,
    text: text.trim(),
    ip: hashIp(ip),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  comments.push(comment);
  writeJson(COMMENTS_FILE, comments);
  res.status(201).json(comment);
});

// ── Admin API ────────────────────────────────────────────────────────────────
app.get('/api/admin/submissions', adminAuth, (req, res) => {
  res.json(readJson(SUBMISSIONS_FILE, []));
});

// Admin: list all comments (pending/approved/rejected)
app.get('/api/admin/comments', adminAuth, (req, res) => {
  const comments = readJson(COMMENTS_FILE, []);
  res.json(comments);
});

// Admin: moderate a comment
app.patch('/api/admin/comments/:cid', adminAuth, (req, res) => {
  const { cid } = req.params;
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }
  const comments = readJson(COMMENTS_FILE, []);
  const comment = comments.find(c => c.id === cid);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  comment.status = status;
  writeJson(COMMENTS_FILE, comments);
  res.json(comment);
});

app.post('/api/admin/approve/:sid', adminAuth, (req, res) => {
  const sid = parseInt(req.params.sid);
  let subs = readJson(SUBMISSIONS_FILE, []);
  const idx = subs.findIndex(s => s.sid === sid);
  if (idx === -1) return res.status(404).json({ error: 'Submission not found' });
  const [sub] = subs.splice(idx, 1);
  writeJson(SUBMISSIONS_FILE, subs);
  const custom = readJson(CUSTOM_JOKES_FILE, []);
  const newJoke = { id: nextId(), joke: sub.joke, category: sub.category };
  custom.push(newJoke);
  writeJson(CUSTOM_JOKES_FILE, custom);
  res.json({ message: 'Approved', joke: newJoke });
});

app.delete('/api/admin/submissions/:sid', adminAuth, (req, res) => {
  const sid = parseInt(req.params.sid);
  let subs = readJson(SUBMISSIONS_FILE, []);
  const len = subs.length;
  subs = subs.filter(s => s.sid !== sid);
  if (subs.length === len) return res.status(404).json({ error: 'Submission not found' });
  writeJson(SUBMISSIONS_FILE, subs);
  res.json({ message: 'Rejected' });
});

// ── Subscribe / Unsubscribe ──────────────────────────────────────────────────

// ── Push Notifications (v20) ────────────────────────────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription object' });
  const subs = readJson(PUSH_SUBS_FILE, []);
  if (subs.some(s => s.endpoint === sub.endpoint)) {
    return res.status(409).json({ error: 'Already subscribed' });
  }
  subs.push(sub);
  writeJson(PUSH_SUBS_FILE, subs);
  res.status(200).json({ message: 'Subscribed' });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  let subs = readJson(PUSH_SUBS_FILE, []);
  const before = subs.length;
  subs = subs.filter(s => s.endpoint !== endpoint);
  writeJson(PUSH_SUBS_FILE, subs);
  if (subs.length === before) return res.status(404).json({ error: 'Subscription not found' });
  res.json({ message: 'Unsubscribed' });
});

async function sendDailyPush(overrideUrl) {
  const subs = readJson(PUSH_SUBS_FILE, []);
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  const joke = jokeForDate(todayStr());
  const appUrl = overrideUrl || process.env.APP_URL || 'http://localhost:3000';
  const payload = JSON.stringify({
    title: '😄 Joke of the Day',
    body: joke.joke,
    url: appUrl
  });
  let sent = 0, failed = 0;
  const expired = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410) {
        expired.push(sub.endpoint);
      } else {
        failed++;
      }
    }
  }
  if (expired.length) {
    const remaining = readJson(PUSH_SUBS_FILE, []).filter(s => !expired.includes(s.endpoint));
    writeJson(PUSH_SUBS_FILE, remaining);
  }
  return { sent, failed, removed: expired.length };
}

// Admin: manually trigger push dispatch
app.post('/api/admin/send-push', adminAuth, async (req, res) => {
  const result = await sendDailyPush();
  res.json({ message: 'Push dispatch complete', ...result });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/subscribe', (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const normalized = email.toLowerCase().trim();
  const subs = readJson(SUBSCRIBERS_FILE, []);
  if (subs.some(s => s.email === normalized)) {
    return res.status(409).json({ error: 'Already subscribed' });
  }
  subs.push({ email: normalized, subscribedAt: new Date().toISOString() });
  writeJson(SUBSCRIBERS_FILE, subs);
  res.status(201).json({ message: 'Subscribed! You will receive the weekly joke digest.' });
});

app.post('/api/unsubscribe', (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const normalized = email.toLowerCase().trim();
  const subs = readJson(SUBSCRIBERS_FILE, []);
  const next = subs.filter(s => s.email !== normalized);
  if (next.length === subs.length) {
    return res.status(404).json({ error: 'Email not found in subscribers' });
  }
  writeJson(SUBSCRIBERS_FILE, next);
  res.json({ message: 'Unsubscribed successfully.' });
});

// ── Admin: send weekly digest ─────────────────────────────────────────────────
app.post('/api/admin/send-digest', adminAuth, async (req, res) => {
  // Collect jokes from last 7 days
  const weekJokes = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    weekJokes.push({ ...jokeWithVotes(jokeForDate(dateStr)), date: dateStr });
  }
  // Deduplicate by id, top 5 by votes
  const seen = new Set();
  const unique = weekJokes.filter(j => { if (seen.has(j.id)) return false; seen.add(j.id); return true; });
  const top5 = unique.sort((a, b) => b.votes - a.votes).slice(0, 5);

  const subs = readJson(SUBSCRIBERS_FILE, []);
  if (!subs.length) return res.json({ message: 'No subscribers — digest not sent.', sent: 0 });

  // Build email
  const jokeHtml = top5.map((j, i) => `<li style="margin-bottom:12px"><b>#${i + 1} (${j.votes} 👍)</b><br>${j.joke}<br><small>${j.category} · ${j.date}</small></li>`).join('');
  const html = `<h2>🥁 Your Weekly Dad Joke Digest</h2><p>Top jokes from the past 7 days:</p><ol>${jokeHtml}</ol><p><a href="${process.env.APP_URL || 'http://localhost:3000'}">Visit the site</a> for more daily groaners!</p><hr><p style="font-size:11px;color:#888">To unsubscribe, POST to /api/unsubscribe with your email.</p>`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });

  const results = { sent: 0, failed: 0 };
  for (const sub of subs) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@dadjoke.local',
        to: sub.email,
        subject: '🥁 Your Weekly Dad Joke Digest',
        html
      });
      results.sent++;
    } catch (e) {
      results.failed++;
    }
  }
  res.json({ message: 'Digest sent.', ...results });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Dad Joke server running on port ${PORT}`));
  // Daily push notification at 08:00 server local time
  cron.schedule('0 8 * * *', () => {
    sendDailyPush().then(r => {
      console.log(JSON.stringify({ event: 'daily_push_sent', ...r }));
    }).catch(err => {
      console.error(JSON.stringify({ event: 'daily_push_error', error: err.message }));
    });
  });
}


// ── Bulk Import Admin API (v23) ────────────────────────────────────────────
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// GET /api/admin/import/pending?page=1&limit=50
app.get('/api/admin/import/pending', adminAuth, (req, res) => {
  const pending = readJson(IMPORT_PENDING_FILE, []).filter(j => j.status === 'pending');
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const start = (page - 1) * limit;
  res.json({
    total: pending.length,
    page,
    limit,
    jokes: pending.slice(start, start + limit)
  });
});

// GET /api/admin/import/stats
app.get('/api/admin/import/stats', adminAuth, (req, res) => {
  const all = readJson(IMPORT_PENDING_FILE, []);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const j of all) counts[j.status] = (counts[j.status] || 0) + 1;
  res.json({ total: all.length, ...counts });
});

// POST /api/admin/import/approve  { ids: [idx, ...] }  or  { all: true }
app.post('/api/admin/import/approve', adminAuth, (req, res) => {
  const { ids, all: approveAll } = req.body || {};
  const pending = readJson(IMPORT_PENDING_FILE, []);
  const custom  = readJson(CUSTOM_JOKES_FILE, []);
  const existingSet = new Set([
    ...builtinJokes.map(j => normalize(j.joke)),
    ...custom.map(j => normalize(j.joke))
  ]);
  let approved = 0;
  for (let i = 0; i < pending.length; i++) {
    const j = pending[i];
    if (j.status !== 'pending') continue;
    if (!approveAll && !(ids || []).includes(i)) continue;
    if (existingSet.has(normalize(j.joke))) { j.status = 'rejected'; continue; }
    j.status = 'approved';
    const newJoke = { id: nextId(), joke: j.joke, category: j.category || 'misc', source: j.source };
    custom.push(newJoke);
    existingSet.add(normalize(j.joke));
    approved++;
  }
  writeJson(IMPORT_PENDING_FILE, pending);
  writeJson(CUSTOM_JOKES_FILE, custom);
  res.json({ approved, total: allJokes().length });
});

// POST /api/admin/import/reject  { ids: [idx, ...] }  or  { all: true }
app.post('/api/admin/import/reject', adminAuth, (req, res) => {
  const { ids, all: rejectAll } = req.body || {};
  const pending = readJson(IMPORT_PENDING_FILE, []);
  let rejected = 0;
  for (let i = 0; i < pending.length; i++) {
    const j = pending[i];
    if (j.status !== 'pending') continue;
    if (!rejectAll && !(ids || []).includes(i)) continue;
    j.status = 'rejected';
    rejected++;
  }
  writeJson(IMPORT_PENDING_FILE, pending);
  res.json({ rejected });
});

// ── Joke Duel (v21) ─────────────────────────────────────────────────────────
function duelPairForDate(dateStr) {
  const jokes = allJokes();
  const dailyJoke = jokeForDate(dateStr);
  const pool = jokes.filter(j => j.id !== dailyJoke.id);
  // Two independent hashes for positions A and B
  let hashA = 0, hashB = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hashA = (hashA * 31 + dateStr.charCodeAt(i)) & 0xffffffff;
    hashB = (hashB * 37 + dateStr.charCodeAt(i) + 7) & 0xffffffff;
  }
  const idxA = Math.abs(hashA) % pool.length;
  let idxB = Math.abs(hashB) % (pool.length - 1);
  if (idxB >= idxA) idxB += 1; // ensure distinct
  return { jokeA: pool[idxA], jokeB: pool[idxB] };
}

function loadDuel(dateStr) {
  const stored = readJson(DUEL_FILE, null);
  if (stored && stored.date === dateStr) return stored;
  const { jokeA, jokeB } = duelPairForDate(dateStr);
  const fresh = { date: dateStr, jokeIdA: jokeA.id, jokeIdB: jokeB.id, votesA: 0, votesB: 0, voters: [] };
  writeJson(DUEL_FILE, fresh);
  return fresh;
}

app.get('/api/duel/today', (req, res) => {
  const today = todayStr();
  const duel = loadDuel(today);
  const jokes = allJokes();
  const jokeA = jokes.find(j => j.id === duel.jokeIdA);
  const jokeB = jokes.find(j => j.id === duel.jokeIdB);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const hashedIp = crypto.createHash('sha256').update(ip).digest('hex');
  const voted = duel.voters.includes(hashedIp);
  res.json({ jokeA, jokeB, votesA: duel.votesA, votesB: duel.votesB, voted });
});

app.post('/api/duel/vote', (req, res) => {
  const { pick } = req.body || {};
  if (pick !== 'A' && pick !== 'B') return res.status(400).json({ error: 'pick must be "A" or "B"' });
  const today = todayStr();
  const duel = loadDuel(today);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const hashedIp = crypto.createHash('sha256').update(ip).digest('hex');
  if (duel.voters.includes(hashedIp)) return res.status(409).json({ error: 'Already voted today' });
  if (pick === 'A') duel.votesA += 1; else duel.votesB += 1;
  duel.voters.push(hashedIp);
  writeJson(DUEL_FILE, duel);
  const winner = duel.votesA > duel.votesB ? 'A' : duel.votesB > duel.votesA ? 'B' : null;
  res.json({ votesA: duel.votesA, votesB: duel.votesB, winner });
});

// ── For You — Personalised Recommendations (v28) ──────────────────────

/**
 * Pure function — build a {category: affinityScore} map from passport history.
 * Scores: upvote=+2, save=+1.5, reaction=+1, downvote=-1 (floor 0).
 * Normalised to 0–1 range.
 */
function computeCategoryAffinity(passport, allJokes) {
  const catScore = {};
  const jokeMap = {};
  for (const j of allJokes) jokeMap[j.id] = j;

  const addScore = (jokeId, delta) => {
    const j = jokeMap[jokeId];
    if (!j) return;
    const cat = j.category;
    catScore[cat] = (catScore[cat] || 0) + delta;
    if (catScore[cat] < 0) catScore[cat] = 0;
  };

  for (const v of (passport.votes || [])) {
    if (v.direction === 'down') addScore(v.jokeId, -1);
    else addScore(v.jokeId, 2);
  }
  for (const s of (passport.saves || [])) addScore(s.jokeId, 1.5);
  for (const r of (passport.reactions || [])) addScore(r.jokeId, 1);

  const maxScore = Math.max(0, ...Object.values(catScore));
  if (maxScore === 0) return catScore;
  for (const cat of Object.keys(catScore)) catScore[cat] /= maxScore;
  return catScore;
}

/**
 * Pure function — return top-n unrated jokes ranked by category affinity.
 * Returns [] if totalInteractions < 3 (signals fallback).
 * Ties broken by global vote count descending.
 */
function getRecommendations(passport, allJokes, n) {
  const limit = n != null ? n : 10;
  const totalVotes = Array.isArray(passport.votes) ? passport.votes.length : (passport.totalVotes || 0);
  const totalSaves = Array.isArray(passport.saves) ? passport.saves.length : (passport.totalSaves || 0);
  const totalReactions = Array.isArray(passport.reactions) ? passport.reactions.length : (passport.totalReactions || 0);
  if (totalVotes + totalSaves + totalReactions < 3) return [];

  // Build already-rated set
  const rated = new Set();
  for (const v of (passport.votes || [])) rated.add(v.jokeId);
  for (const s of (passport.saves || [])) rated.add(s.jokeId);
  for (const r of (passport.reactions || [])) rated.add(r.jokeId);

  const affinity = computeCategoryAffinity(passport, allJokes);

  return allJokes
    .filter(j => !rated.has(j.id))
    .map(j => ({ joke: j, score: affinity[j.category] || 0 }))
    .sort((a, b) => b.score - a.score || (votes[b.joke.id] || 0) - (votes[a.joke.id] || 0))
    .slice(0, limit)
    .map((item, idx) => ({ ...item.joke, affinityScore: item.score, rank: idx + 1 }));
}

// GET /api/passport/:token/recommendations
app.get('/api/passport/:token/recommendations', (req, res) => {
  const { token } = req.params;
  if (!UUID_V4_RE.test(token)) return res.status(400).json({ error: 'Invalid passport token format' });
  const passports = readPassports();
  if (!passports[token]) return res.status(404).json({ error: 'Passport not found' });

  let limit = parseInt(req.query.limit);
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 20) limit = 20;

  const passport = passports[token];
  const jokes = allJokes();

  // Already-rated set for totalUnrated
  const rated = new Set();
  for (const v of (passport.votes || [])) rated.add(v.jokeId);
  for (const s of (passport.saves || [])) rated.add(s.jokeId);
  for (const r of (passport.reactions || [])) rated.add(r.jokeId);
  const totalUnrated = jokes.filter(j => !rated.has(j.id)).length;

  const recs = getRecommendations(passport, jokes, limit);

  if (recs.length === 0) {
    // Fallback: weighted-random from unrated pool
    const unrated = jokes.filter(j => !rated.has(j.id));
    const pool = unrated.length >= limit ? unrated : jokes;
    const fallbackPick = [];
    const used = new Set();
    for (let i = 0; i < Math.min(limit, pool.length); i++) {
      let candidate = weightedRandom(pool.filter(j => !used.has(j.id)));
      if (!candidate) break;
      used.add(candidate.id);
      fallbackPick.push({
        id: candidate.id,
        joke: candidate.joke,
        category: candidate.category,
        affinityScore: null,
        rank: fallbackPick.length + 1,
      });
    }
    return res.json({ recommendations: fallbackPick, strategy: 'fallback', totalUnrated });
  }

  const recommendations = recs.map(r => ({
    id: r.id,
    joke: r.joke,
    category: r.category,
    affinityScore: Math.round(r.affinityScore * 1000) / 1000,
    rank: r.rank,
  }));
  res.json({ recommendations, strategy: 'affinity', totalUnrated });
});

// ── Joke of the Year (v29) ────────────────────────────────────────────────

/**
 * Pure function — find the best joke for a given calendar year.
 * @param {number} year  4-digit year
 * @param {Array}  allJokes  full jokes array [{id, joke, category}]
 * @param {Array}  voteLog   array of {jokeId, direction, at} entries
 * @returns winner object augmented with {netScore, upvotes, downvotes, year} or null
 */
function getBestOfYear(year, allJokes, voteLog) {
  const scores = {}; // jokeId -> {up, down}
  for (const v of voteLog) {
    if (!v.at) continue;
    const y = new Date(v.at).getFullYear();
    if (y !== year) continue;
    const jid = v.jokeId;
    if (!scores[jid]) scores[jid] = { up: 0, down: 0 };
    if (v.direction === 'down') scores[jid].down++;
    else scores[jid].up++;
  }
  const jokeIds = Object.keys(scores).map(Number);
  if (jokeIds.length === 0) return null;
  const jokeMap = {};
  for (const j of allJokes) jokeMap[j.id] = j;
  let winner = null;
  for (const jid of jokeIds) {
    const j = jokeMap[jid];
    if (!j) continue;
    const { up, down } = scores[jid];
    const net = up - down;
    if (
      winner === null ||
      net > winner.netScore ||
      (net === winner.netScore && jid < winner.id)
    ) {
      winner = { ...j, netScore: net, upvotes: up, downvotes: down, year };
    }
  }
  return winner;
}

// GET /api/jokes/best-of-year[?year=YYYY]
app.get('/api/jokes/best-of-year', (req, res) => {
  const currentYear = new Date().getFullYear();
  let year = currentYear;
  if (req.query.year !== undefined) {
    const parsed = parseInt(req.query.year, 10);
    if (isNaN(parsed) || String(parsed) !== String(req.query.year).trim()) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (parsed > currentYear) {
      return res.status(404).json({ error: 'No data for future year' });
    }
    year = parsed;
  }
  const voteLog = readJson(VOTE_LOG_FILE, []);
  const jokes = allJokes();
  const totalVotesInYear = voteLog.filter(v => v.at && new Date(v.at).getFullYear() === year).length;
  if (totalVotesInYear === 0) {
    return res.status(404).json({ error: `No votes recorded for ${year}` });
  }
  const winner = getBestOfYear(year, jokes, voteLog);
  if (!winner) return res.status(404).json({ error: `No votes recorded for ${year}` });
  res.json({
    year,
    winner: {
      id: winner.id,
      joke: winner.joke,
      category: winner.category,
      netScore: winner.netScore,
      upvotes: winner.upvotes,
      downvotes: winner.downvotes,
    },
    totalVotesInYear,
    computedAt: new Date().toISOString(),
  });
});


// ── Challenge-a-Friend (v30) ────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHALLENGE_GUESS_LIMIT = 3; // per IP per token

function readChallenges() {
  return readJson(CHALLENGES_FILE, []);
}

function saveChallenges(data) {
  writeJson(CHALLENGES_FILE, data);
}

/**
 * Simple string-similarity grade: normalise both strings to lowercase word
 * tokens and count overlap. Returns 'close' | 'nope' | 'good'.
 */
function gradeGuess(guess, punchline) {
  function tokens(s) {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  }
  const gTokens = new Set(tokens(guess));
  const pTokens = tokens(punchline);
  if (!pTokens.length || !gTokens.size) return 'nope';
  const matches = pTokens.filter(t => gTokens.has(t)).length;
  const ratio = matches / pTokens.length;
  if (ratio >= 0.5) return 'good';   // 🥁 surprisingly good
  if (ratio >= 0.2) return 'close';  // 😂 close
  return 'nope';                      // 😬 nope
}

/**
 * Split joke text into { setup, punchline } — same heuristic as client.
 */
function splitJokeText(text) {
  const nl = text.indexOf('\n');
  if (nl !== -1) return { setup: text.slice(0, nl).trim(), punchline: text.slice(nl + 1).trim() };
  const qa = text.match(/^(Q:?\s*.+?)\s+(?:A:?\s*)(.+)$/is);
  if (qa) return { setup: qa[1].trim(), punchline: qa[2].trim() };
  const qmark = text.indexOf('? ');
  if (qmark !== -1) return { setup: text.slice(0, qmark + 1).trim(), punchline: text.slice(qmark + 2).trim() };
  const m = text.match(/^(.+?)\s[–-]\s(.+)$/);
  if (m) return { setup: m[1].trim(), punchline: m[2].trim() };
  return { setup: text, punchline: '' };
}

// In-memory IP-rate-limit: guessRateLimit[token][ip] = count
const guessRateLimit = {};

// POST /api/jokes/:id/challenge — create challenge token
app.post('/api/jokes/:id/challenge', (req, res) => {
  const joke = allJokes().find(j => j.id === parseInt(req.params.id));
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  const { setup, punchline } = splitJokeText(joke.joke);
  if (!punchline) return res.status(422).json({ error: 'Joke cannot be split into setup/punchline' });

  const token = crypto.randomUUID();
  const challenges = readChallenges();
  challenges.push({ token, jokeId: joke.id, createdAt: new Date().toISOString(), guesses: [] });
  saveChallenges(challenges);

  res.json({ token, challengeUrl: `/challenge/${token}`, setup });
});

// GET /api/challenges/:token
app.get('/api/challenges/:token', (req, res) => {
  if (!UUID_V4_RE.test(req.params.token)) return res.status(400).json({ error: 'Invalid token' });
  const challenges = readChallenges();
  const ch = challenges.find(c => c.token === req.params.token);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });
  if (Date.now() - new Date(ch.createdAt).getTime() > CHALLENGE_TTL_MS) {
    return res.status(410).json({ error: 'Challenge expired' });
  }
  const joke = allJokes().find(j => j.id === ch.jokeId);
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  const { setup, punchline } = splitJokeText(joke.joke);
  // Only include punchline if caller has already guessed (guessCount > 0)
  const guessCount = ch.guesses.length;
  const payload = { jokeId: ch.jokeId, setup, guessCount };
  if (guessCount > 0) payload.punchline = punchline;
  res.json(payload);
});

// POST /api/challenges/:token/guess
app.post('/api/challenges/:token/guess', (req, res) => {
  if (!UUID_V4_RE.test(req.params.token)) return res.status(400).json({ error: 'Invalid token' });
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const { guess } = req.body || {};
  if (typeof guess !== 'string' || !guess.trim()) {
    return res.status(400).json({ error: 'guess is required' });
  }

  const challenges = readChallenges();
  const idx = challenges.findIndex(c => c.token === req.params.token);
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });
  const ch = challenges[idx];

  if (Date.now() - new Date(ch.createdAt).getTime() > CHALLENGE_TTL_MS) {
    return res.status(410).json({ error: 'Challenge expired' });
  }

  // IP rate limit: 3 guesses per token per IP
  if (!guessRateLimit[ch.token]) guessRateLimit[ch.token] = {};
  const ipCount = guessRateLimit[ch.token][ip] || 0;
  if (ipCount >= CHALLENGE_GUESS_LIMIT) {
    return res.status(429).json({ error: 'Too many guesses for this challenge' });
  }
  guessRateLimit[ch.token][ip] = ipCount + 1;

  const joke = allJokes().find(j => j.id === ch.jokeId);
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  const { punchline } = splitJokeText(joke.joke);

  const grade = gradeGuess(guess.trim(), punchline);
  ch.guesses.push({ guess: guess.trim(), grade, ip, at: new Date().toISOString() });
  challenges[idx] = ch;
  saveChallenges(challenges);

  res.json({ punchline, grade });
});

// GET /challenge/:token — serve challenge page
app.get('/challenge/:token', (req, res) => {
  if (!UUID_V4_RE.test(req.params.token)) {
    return res.status(400).send('Invalid challenge token');
  }
  res.sendFile(path.join(__dirname, 'public', 'challenge-page.html'));
});

module.exports = app;
module.exports._resetCommentRateLimitForTest = _resetCommentRateLimitForTest;
module.exports._readPassports = readPassports;
module.exports._savePassports = savePassports;
module.exports._ensurePassport = ensurePassport;
module.exports.PASSPORTS_FILE = PASSPORTS_FILE;
module.exports.sendDailyPush = sendDailyPush;
module.exports._duelPairForDate = duelPairForDate;
module.exports._loadDuel = loadDuel;
module.exports._jokeForDate = jokeForDate;
module.exports.computeBadges = computeBadges;
module.exports.BADGE_DEFINITIONS = BADGE_DEFINITIONS;
module.exports.computeTrendingScore = computeTrendingScore;
module.exports.getTrendingJokes = getTrendingJokes;
module.exports.HALF_LIFE_HOURS = HALF_LIFE_HOURS;
module.exports.TRENDING_WINDOW_HOURS = TRENDING_WINDOW_HOURS;
module.exports.TRENDING_EVENTS_FILE = TRENDING_EVENTS_FILE;
module.exports._readTrendingEvents = readTrendingEvents;
module.exports.computeCategoryAffinity = computeCategoryAffinity;
module.exports.getRecommendations = getRecommendations;
module.exports.getBestOfYear = getBestOfYear;
module.exports.VOTE_LOG_FILE = VOTE_LOG_FILE;
module.exports.CHALLENGES_FILE = CHALLENGES_FILE;
module.exports._readChallenges = readChallenges;
module.exports._saveChallenges = saveChallenges;
module.exports.gradeGuess = gradeGuess;
module.exports.splitJokeText = splitJokeText;
