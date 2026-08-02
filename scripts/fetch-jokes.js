#!/usr/bin/env node
/**
 * v23 bulk joke fetcher
 * Fetches from icanhazdadjoke.com and JokeAPI, deduplicates,
 * and writes pending import to import-pending.json
 *
 * Usage: node scripts/fetch-jokes.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const JOKES_FILE       = path.join(ROOT, 'jokes.json');
const CUSTOM_FILE      = path.join(ROOT, 'custom-jokes.json');
const PENDING_FILE     = path.join(ROOT, 'import-pending.json');

const ICHDJ_UA = 'dad-joke-of-the-day/1.0 (bulk-import; https://github.com/DonBent/dad-joke-of-the-day)';

// ── Helpers ──────────────────────────────────────────────────────────────────

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = Object.assign({ headers: { 'Accept': 'application/json', ...headers } }, require('url').parse(url));
    https.get(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isDuplicate(jokeText, existingSet) {
  return existingSet.has(normalize(jokeText));
}

// ── Fetch icanhazdadjoke.com ──────────────────────────────────────────────────

async function fetchICHDJ() {
  console.log('[ichdj] Starting paginated fetch...');
  const jokes = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    process.stdout.write(`\r[ichdj] page ${page}/${totalPages}   `);
    const data = await get(
      `https://icanhazdadjoke.com/search?limit=30&page=${page}`,
      { 'User-Agent': ICHDJ_UA }
    );
    if (data.status !== 200) { console.error('\n[ichdj] non-200:', data); break; }
    totalPages = data.total_pages;
    for (const j of data.results) {
      jokes.push({ source: 'icanhazdadjoke', sourceId: j.id, joke: j.joke.trim(), category: 'misc' });
    }
    page++;
    await sleep(150); // polite rate-limiting
  }
  console.log(`\n[ichdj] fetched ${jokes.length} raw jokes`);
  return jokes;
}

// ── Fetch JokeAPI ─────────────────────────────────────────────────────────────

async function fetchJokeAPI() {
  console.log('[jokeapi] Starting fetch (Pun + Misc, safe, single-line, en)...');
  const jokes = [];
  const idMax = 318; // English range
  const batchSize = 10;
  const seenIds = new Set();

  // We'll iterate through ID ranges in batches
  // JokeAPI allows idRange param to select a range
  for (let startId = 0; startId <= idMax; startId += batchSize) {
    const endId = Math.min(startId + batchSize - 1, idMax);
    process.stdout.write(`\r[jokeapi] ids ${startId}-${endId}/${idMax}   `);
    try {
      const url = `https://v2.jokeapi.dev/joke/Pun,Misc?blacklistFlags=nsfw,racist,sexist,explicit&type=single&amount=10&idRange=${startId}-${endId}&lang=en`;
      const data = await get(url);
      if (data.error) { await sleep(500); continue; }
      const list = data.jokes || (data.type ? [data] : []);
      for (const j of list) {
        if (seenIds.has(j.id)) continue;
        seenIds.add(j.id);
        const jokeText = (j.joke || j.delivery || '').trim();
        if (!jokeText) continue;
        jokes.push({
          source: 'jokeapi',
          sourceId: `jokeapi-${j.id}`,
          joke: jokeText,
          category: (j.category || 'misc').toLowerCase()
        });
      }
    } catch (e) {
      // skip batch on error
    }
    await sleep(100);
  }
  console.log(`\n[jokeapi] fetched ${jokes.length} raw jokes`);
  return jokes;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Build dedup set from existing jokes
  const existing = [
    ...JSON.parse(fs.readFileSync(JOKES_FILE, 'utf8')),
    ...(fs.existsSync(CUSTOM_FILE) ? JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8')) : []),
    ...(fs.existsSync(PENDING_FILE) ? JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')) : [])
  ];
  const existingSet = new Set(existing.map(j => normalize(j.joke)));
  console.log(`[dedup] ${existingSet.size} existing jokes loaded`);

  // Fetch from both sources
  const [ichdj, jokeapi] = await Promise.all([fetchICHDJ(), fetchJokeAPI()]);
  const allFetched = [...ichdj, ...jokeapi];
  console.log(`[total] ${allFetched.length} raw jokes fetched`);

  // Dedup against existing + within batch
  const pending = [];
  const batchSeen = new Set(existingSet);
  let dupes = 0;

  for (const j of allFetched) {
    const key = normalize(j.joke);
    if (batchSeen.has(key)) { dupes++; continue; }
    batchSeen.add(key);
    pending.push({ ...j, status: 'pending' });
  }

  console.log(`[dedup] ${dupes} duplicates removed; ${pending.length} new jokes pending review`);

  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
  console.log(`[done] Written to ${PENDING_FILE}`);
  console.log(`       Run the server and use POST /api/admin/import/approve or /reject to batch-review`);
}

main().catch(e => { console.error(e); process.exit(1); });
