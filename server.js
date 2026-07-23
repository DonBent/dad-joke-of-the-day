const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const builtinJokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const VOTES_FILE = process.env.VOTES_FILE || path.join(__dirname, 'votes.json');
const CUSTOM_JOKES_FILE = path.join(__dirname, 'custom-jokes.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const SUBSCRIBERS_FILE = process.env.SUBSCRIBERS_FILE || path.join(__dirname, 'subscribers.json');
const HALL_OF_FAME_FILE = process.env.HALL_OF_FAME_FILE || path.join(__dirname, 'hall-of-fame.json');

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

// Tags endpoint — derived dynamically from all jokes
app.get('/api/tags', (req, res) => {
  const tags = [...new Set(allJokes().flatMap(j => j.tags || ['classic']))].sort();
  res.json(tags);
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

// Stats
app.get('/api/stats', (req, res) => {
  const jokes = allJokes();
  const categoryCounts = {};
  jokes.forEach(j => { categoryCounts[j.category] = (categoryCounts[j.category] || 0) + 1; });
  const tagCounts = {};
  jokes.forEach(j => (j.tags || ['classic']).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
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
    tags: tagCounts,
    pendingSubmissions: subs.length,
    topVoted
  });
});

app.get('/api/joke', (req, res) => {
  const { category, tag } = req.query;
  let pool = allJokes();
  if (category) {
    pool = pool.filter(j => j.category === category);
    if (!pool.length) return res.status(404).json({ error: `No jokes found for category: ${category}` });
  }
  if (tag) {
    pool = pool.filter(j => (j.tags || ['classic']).includes(tag));
    if (!pool.length) return res.status(404).json({ error: `No jokes found for tag: ${tag}` });
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
  const { joke, category, tags: submittedTags } = req.body || {};
  if (!joke || typeof joke !== 'string' || joke.trim().length < 10) {
    return res.status(400).json({ error: 'joke must be at least 10 characters' });
  }
  const validCategories = [...new Set(builtinJokes.map(j => j.category))];
  const cat = validCategories.includes(category) ? category : 'general';
  const tags = (Array.isArray(submittedTags) && submittedTags.length) ? submittedTags : [];
  const subs = readJson(SUBMISSIONS_FILE, []);
  const sub = { sid: Date.now(), joke: joke.trim(), category: cat, tags, submittedAt: new Date().toISOString() };
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
  // Accept optional tags from request body; fall back to submission tags or default
  const bodyTags = (req.body && Array.isArray(req.body.tags)) ? req.body.tags : null;
  const tags = bodyTags || sub.tags || ['classic'];
  const newJoke = { id: nextId(), joke: sub.joke, category: sub.category, tags };
  custom.push(newJoke);
  writeJson(CUSTOM_JOKES_FILE, custom);
  res.json({ message: 'Approved', joke: newJoke });
});

// Admin: set tags on a submission without approving it yet
app.patch('/api/admin/submissions/:sid/tags', adminAuth, (req, res) => {
  const sid = parseInt(req.params.sid);
  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
  let subs = readJson(SUBMISSIONS_FILE, []);
  const idx = subs.findIndex(s => s.sid === sid);
  if (idx === -1) return res.status(404).json({ error: 'Submission not found' });
  subs[idx].tags = tags;
  writeJson(SUBMISSIONS_FILE, subs);
  res.json({ message: 'Tags updated', submission: subs[idx] });
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
}

module.exports = app;
