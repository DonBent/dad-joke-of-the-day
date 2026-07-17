const express = require('express');
const path = require('path');
const jokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: all categories
app.get('/api/categories', (req, res) => {
  const categories = [...new Set(jokes.map(j => j.category))].sort();
  res.json(categories);
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
