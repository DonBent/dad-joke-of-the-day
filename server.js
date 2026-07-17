const express = require('express');
const path = require('path');
const jokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

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

// API: all categories
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(jokes.map(j => j.category))].sort();
  res.json(categories);
});

// API: today's joke
app.get('/api/joke/today', (req, res) => {
  const today = todayStr();
  const joke = jokeForDate(today);
  res.json({ ...joke, date: today });
});

// API: joke for a specific date
app.get('/api/joke/day/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  }
  const joke = jokeForDate(date);
  res.json({ ...joke, date });
});

// API: last N days archive (default 7)
app.get('/api/archive', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push({ ...jokeForDate(dateStr), date: dateStr });
  }
  res.json(result);
});

// API: random joke (optionally filtered by category)
app.get('/api/joke', (req, res) => {
  const { category } = req.query;
  let pool = jokes;
  if (category) {
    pool = jokes.filter(j => j.category === category);
    if (pool.length === 0) return res.status(404).json({ error: `No jokes found for category: ${category}` });
  }
  const joke = pool[Math.floor(Math.random() * pool.length)];
  res.json(joke);
});

// API: joke by id
app.get('/api/joke/:id', (req, res) => {
  const joke = jokes.find(j => j.id === parseInt(req.params.id));
  if (!joke) return res.status(404).json({ error: 'Joke not found' });
  res.json(joke);
});

app.listen(PORT, () => {
  console.log(`Dad Joke server running on port ${PORT}`);
});
