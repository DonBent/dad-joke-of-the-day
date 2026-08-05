# BACKLOG — Dad Joke of the Day

Truth layer for the autonomous ideation loop. The Product Owner reads this in full before
proposing anything new so it never re-proposes a shipped or rejected idea.

## Shipped

- v1 — daily joke rotation (date-seeded deterministic pick from pool)
- v2 — expanded joke pool + basic styling
- v3 — dark/light theme toggle
- v4 — shareable joke links via URL hash
- v5 — joke upvotes with weighted random selection (upvoted jokes surface more often)
- v6 — user joke submissions with admin moderation queue
- v7 — joke search + stats endpoint (/api/stats)
- v8 — RSS feed for Joke of the Day + submission rate limiting (per-IP)
- v9 — Weekly joke digest email opt-in: users subscribe with their email to receive a curated weekly roundup of the top-voted jokes [CID-20260719-4E76F8B2]
- v10 — Daily visit streak + shareable badge: localStorage streak counter + 🔥 badge + Web Share API card; pure client-side [CID-20260721-2B7FF979]
- v11 — "Top jokes this week" leaderboard panel: /api/jokes/top + collapsible panel surfacing the voting system as community social proof [CID-20260722-1ED2C88C]
- v12 — "Joke of the Month" Hall of Fame: monthly top-voted joke gets a permanent trophy entry [CID-20260722-A3C91D7F]
- v13 — Joke tag/category filter: browse jokes by category tag (puns, one-liners, etc.)
- v14 — Contributor dashboard "My Jokes": submitters can see status + vote counts for their submissions
- v15 — Embeddable widget + snippet generator: iframe/JS embed code so other sites can show the daily joke
- v16 — Guess the Punchline challenge mode: daily interactive challenge hiding the punchline [CID-20260724-0763B543]
- v17 — Emoji reaction bar per joke: expressive emoji reactions (😂 😬 🥁 🫠) stored server-side with live counts; one reaction per IP, toggle to remove [CID-20260725-A9F3D201]
- v18 — "Random Joke" button: on-demand weighted-random joke fetch via GET /api/jokes/random with vote+reaction weighting; excludes today's daily pick; 🎲 Random badge; fade/slide swap animation [CID-20260728-B9118062]
- v19 — Per-joke comment thread ("Roast the Joke"): lightweight visitor comment section on each joke page; no auth, IP-rate-limited, admin-moderated; turns the daily joke into a shared groaning ritual and drives return visits [CID-20260801-5B5AA475]
- v20 — Daily browser push notification opt-in: one-click Service Worker/Web Push (VAPID) subscription delivering the joke of the day at 08:00; zero-friction daily re-engagement with no email required [CID-20260802-C79DD50D]
- v21 — Joke Duel: daily head-to-head joke voting; two date-seeded jokes pitted against each other, one IP vote per day, live results revealed after voting with 🏆 winner highlight [CID-20260802-B3194F39]
- v22 — "On This Day" joke archive: date-picker browse of any past date's joke with vote counts, reactions, and shareable ?date= links [CID-20260802-11B7A540]
- v23 — Bulk joke import: fetch-jokes.js script + admin batch-review UI (admin-import.html) + dedup logic; pool expanded from 15 → 776 jokes via icanhazdadjoke + JokeAPI safe filters [CEO-REQUEST-20260802]

- v24 — Joke Passport: UUID v4 token in localStorage, passports.json, save/favourite jokes, cross-device shareable /passport/:token URL; tracks votes, reactions, saves, streak per anonymous session [CID-20260803-AFA576FB]

- v25 — "Today's Vibe" live reaction summary strip: auto-refreshing strip beneath the daily joke card showing net vote score, dominant emoji reaction, and comment count; polls GET /api/jokes/today/vibe every 30 s, pauses on hidden tab, animates changes [CID-20260803-0600F5CA]

- v26 — Groan Badges: 9 Passport-powered milestone badges (First Groaner, Laugh Track, Hoarder, Loyal Groaner, Prolific, Collector, Marathon Groaner, Reactor, Superfan) computed via pure computeBadges(); displayed in Passport panel as emoji chips + shareable plain-text card; GET /api/passport/:token/badges convenience endpoint [CID-20260803-1A206CBB]

- v27 — "Trending Now" panel: time-decay ranked joke list (HALF_LIFE_HOURS=2, TRENDING_WINDOW_HOURS=24); GET /api/jokes/trending with ?limit/?window params + X-Trending-Window-Hours header; trending-events.json append-only event log; collapsible panel with 60 s auto-poll, flame bar visualisation, localStorage state [CID-20260803-BC998885]

- v28 — "For You" personalised joke feed: computeCategoryAffinity() + getRecommendations() pure functions; GET /api/passport/:token/recommendations returns affinity/fallback strategy + totalUnrated; ✨ For You tab with 10 joke cards, save buttons, refresh, fallback hint; no new storage [CID-20260804-DDF72BDE]

- v29 — "Joke of the Year" annual retrospective: getBestOfYear() pure function; GET /api/jokes/best-of-year[?year=YYYY] + 400/404 error codes; vote-log.json timestamped log (non-breaking); /best-of-year page with year selector, trophy card, Web Share API, empty state; footer link in index.html [CID-20260804-7BD05379]
- v30 — "Challenge a Friend" joke duel link: generate a shareable one-time challenge URL for any joke that shows only the setup; the recipient must type a guess before the punchline is revealed; result screen shows their guess vs. real punchline with emoji rating + reaction + share-your-score card — turns passive joke consumption into active social play without requiring auth [CID-20260804-F3A12E91]
- v31 — User joke collections: Passport-powered curated joke sets; POST/GET/DELETE /api/collections + /api/collections/:id/jokes; public /collection/:id page; 10 collections/Passport, 50 jokes/collection; save-to-collection dropdown on joke cards; Collections section in Passport panel [CID-20260804-9C4B1F37]

## Proposed (in flight)

- v32 — Groan-O-Meter: a 1–5 groan-intensity vote (😐😏😬🙈🤮) per joke, separate from the upvote quality signal; stored in groan-ratings.json keyed by jokeId; one rating per IP per joke, toggleable; GET /api/jokes/:id/groan returns counts + weighted groan score; groan score surfaces on Today's Vibe strip and feeds a new "Most Groan-Worthy" leaderboard tab — adds a second community data dimension that directly reflects the product's founding "groan-worthy" identity [CID-20260805-49971341]


## Rejected / Not pursuing

- (none yet — backlog seeded at bootstrap 2026-07-18)
