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

## Proposed (in flight)

- v10 — Daily visit streak + shareable badge: track consecutive daily visits in localStorage and reward users with a streak counter and shareable "N-day streak" card; zero server changes, pure client-side, directly advances the founding goal of keeping people coming back. [CID-20260721-2B7FF979]

## Rejected / Not pursuing

- (none yet — backlog seeded at bootstrap 2026-07-18)
