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

## Proposed (in flight)


## Rejected / Not pursuing

- (none yet — backlog seeded at bootstrap 2026-07-18)
