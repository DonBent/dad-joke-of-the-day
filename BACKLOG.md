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
- v12 — "Joke of the Month" Hall of Fame: permanent /hall-of-fame page listing each month's #1 top-voted joke with score, date, and shareable permalink [CID-20260722-A3C91D7F]
- v13 — Joke categories & tag filter: tag each joke with one or more categories stored in jokes.json, tag-filter bar on main page, ?tag= query param support [CID-20260723-2F5479FA]
- v14 — "My Jokes" contributor dashboard: /my-jokes personal page tracking submissions, vote tallies, moderation status, and hall-of-fame wins via localStorage submitter token [CID-20260723-86B9BDFE]
- v15 — Embeddable joke widget: /widget iframe endpoint + /embed snippet generator; /api/embed/today CORS-open endpoint; theme + tag support; no external CDN deps [CID-20260723-9F652B50]

## Proposed (in flight)

_(none)_

## Rejected / Not pursuing

- (none yet — backlog seeded at bootstrap 2026-07-18)
