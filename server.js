const express = require('express');
const path = require('path');
const fs = require('fs');
const builtinJokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const VOTES_FILE = path.join(__dirname, 'votes.json');
const CUSTOM_JOKES_FILE = path.join(__dirname, 'custom-jokes.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

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
  return { ...joke, votes: votes[joke.id] || 0 };
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

// ── Static ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Public API ───────────────────────────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(allJokes().map(j => j.category))].sort();
  res.json(categories);
});

app.post('/api/joke/:id/upvote', (req, res) => {
  const id = parseInt(req.params.id);
  if (!allJokes().find(j => j.id === id)) return res.status(404).json({ error: 'Joke not found' });
  votes[id] = (votes[id] || 0) + 1;
  saveVotes();
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
  res.json(jokeWithVotes(joke));
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

// ── Admin API ────────────────────────────────────────────────────────────────
app.get('/api/admin/submissions', adminAuth, (req, res) => {
  res.json(readJson(SUBMISSIONS_FILE, []));
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

app.listen(PORT, () => console.log(`Dad Joke server running on port ${PORT}`));
