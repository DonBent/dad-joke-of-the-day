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

## Proposed (in flight)

- v11 — "Top jokes this week" leaderboard panel: /api/jokes/top returns the 5 highest-voted jokes from the last 7 days; displayed in a collapsible panel on the main page; makes the voting system socially visible and gives the product a live community pulse. [CID-20260722-1ED2C88C]

## Rejected / Not pursuing

- (none yet — backlog seeded at bootstrap 2026-07-18)
