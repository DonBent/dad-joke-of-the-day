# STATUS — Dad Joke of the Day

**Slug:** dad-joke-of-the-day
**Founding vision:** A lightweight, fun web app that serves a rotating dad joke each day from a curated pool. Users can vote on jokes (upvote/downvote with weighted random selection), submit their own jokes for admin moderation, search the joke catalogue, share jokes via URL hash, subscribe to an RSS feed, and browse stats. The goal is a delightfully low-stakes daily micro-interaction that keeps people coming back and contributes their own groan-worthy material.
**Repo:** /home/moltbot/products/dad-joke-of-the-day/
**GitHub:** https://github.com/DonBent/dad-joke-of-the-day
**DEV URL:** http://localhost:3040
**PROD URL:** <not yet promoted to prod>

---

**Active:** YES
**IdeationExhausted:** NO
**Current Cycle Correlation ID:** CID-20260723-9F652B50
**Stage:** RELEASED
**Last Release Version:** v15
**Last Release At:** 2026-07-23

---

## Notes

- Port 3040 reserved in PORT-REGISTRY.md
- v1–v15 shipped: daily joke rotation, voting, weighted random, shareable links, user submissions + moderation, search, stats, RSS feed, submission rate limiting, email digest, streak badge, weekly leaderboard, hall of fame, joke tag/category filter, contributor dashboard (My Jokes), embeddable widget & snippet generator
- Custom jokes (user-submitted, approved) live in custom-jokes.json; main pool in jokes.json
- No auth system — moderation is admin-flag based
- Keep the tone light and groan-worthy; this is not a serious content platform
