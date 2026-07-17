# Dad Joke of the Day 😄

A self-evolving web app that serves dad jokes. Because the world needs more groan-worthy puns.

## Features (v1)

- `GET /api/joke` — returns a random dad joke as JSON
- `GET /api/joke/:id` — returns a specific joke by id
- Single-page frontend with a button to fetch another joke
- 15 hardcoded jokes in `jokes.json` (no database needed)

## Running Locally

```bash
npm install
npm start
# Visit http://localhost:3000
```

## API

### `GET /api/joke`
Returns a random joke:
```json
{ "id": 4, "joke": "Why did the scarecrow win an award? Because he was outstanding in his field." }
```

## Deployment

DEV environment runs on port 3001.

## Roadmap

See GitHub Issues for upcoming features. This product is self-evolving — new versions ship continuously.
