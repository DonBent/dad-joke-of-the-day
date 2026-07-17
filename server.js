const express = require('express');
const path = require('path');
const jokes = require('./jokes.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: random joke
app.get('/api/joke', (req, res) => {
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
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
