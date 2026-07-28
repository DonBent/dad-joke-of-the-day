const request = require('supertest');
const app = require('../server');

describe('GET /api/jokes/random', () => {
  it('returns a joke object with required fields', async () => {
    const res = await request(app).get('/api/jokes/random');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('joke');
    expect(res.body).toHaveProperty('category');
    expect(res.body).toHaveProperty('votes');
    expect(res.body).toHaveProperty('reactions');
  });

  it('never returns the same joke as today\'s daily joke', async () => {
    // Call random many times and verify it never matches today's daily joke
    const todayRes = await request(app).get('/api/joke/today');
    const todayId = todayRes.body.id;

    // With a pool larger than 1 joke this should hold reliably
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/api/jokes/random');
      expect(res.body.id).not.toBe(todayId);
    }
  });

  it('reactions shape is correct', async () => {
    const res = await request(app).get('/api/jokes/random');
    const rxns = res.body.reactions;
    expect(rxns).toHaveProperty('laugh');
    expect(rxns).toHaveProperty('groan');
    expect(rxns).toHaveProperty('drums');
    expect(rxns).toHaveProperty('melt');
  });

  it('each call can return a different joke (randomness check)', async () => {
    const ids = new Set();
    for (let i = 0; i < 15; i++) {
      const res = await request(app).get('/api/jokes/random');
      ids.add(res.body.id);
    }
    // Expect at least 2 distinct IDs over 15 calls (pool is large)
    expect(ids.size).toBeGreaterThan(1);
  });
});
