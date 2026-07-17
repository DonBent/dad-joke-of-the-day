const express = require('express');
const path = require('path');
const fs = require('fs');
const jokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;
const VOTES_FILE = path.join(__dirname, 'votes.json');

app.use(express.json());

// Load/save votes
function loadVotes() {
  try { return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8')); } catch { return {}; }
}
function saveVotes(votes) {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
}

let votes = loadVotes();

function jokeWithVotes(joke) {
  return { ...joke, votes: votes[joke.id] || 0 };
}

// Weighted random selection
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

// Deterministic joke index from a date string YYYY-MM-DD
function jokeForDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) & 0xffffffff;
  }
  return jokes[Math.abs(hash) % jokes.length];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: all categories
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(jokes.map(j => j.category))].sort();
  res.json(categories);
});

// API: upvote a joke
app.post('/api/joke/:id/upvote', (req, res) => {
  const id = parseInt(req.params.id);
  const joke = jokes.find(j => j.id === id);
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  votes[id] = (votes[id] || 0) + 1;
  saveVotes(votes);
  res.json({ id, votes: votes[id] });
});

// API: today's joke
app.get('/api/joke/today', (req, res) => {
  const today = todayStr();
  res.json({ ...jokeWithVotes(jokeForDate(today)), date: today });
});

// API: joke for a specific date
app.get('/api/joke/day/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  }
  res.json({ ...jokeWithVotes(jokeForDate(date)), date });
});

// API: last N days archive
app.get('/api/archive', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push({ ...jokeWithVotes(jokeForDate(dateStr)), date: dateStr });
  }
  res.json(result);
});

// API: random joke (weighted, optionally filtered by category)
app.get('/api/joke', (req, res) => {
  const { category } = req.query;
  let pool = jokes;
  if (category) {
    pool = jokes.filter(j => j.category === category);
    if (pool.length === 0) return res.status(404).json({ error: `No jokes found for category: ${category}` });
  }
  res.json(jokeWithVotes(weightedRandom(pool)));
});

// API: joke by id
app.get('/api/joke/:id', (req, res) => {
  const joke = jokes.find(j => j.id === parseInt(req.params.id));
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  res.json(jokeWithVotes(joke));
});

app.listen(PORT, () => {
  console.log(`Dad Joke server running on port ${PORT}`);
});
