const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_VOTES    = path.join(os.tmpdir(), `test-votes-push-${process.pid}.json`);
const TMP_REACTIONS = path.join(os.tmpdir(), `test-reactions-push-${process.pid}.json`);
const TMP_PUSH_SUBS = path.join(os.tmpdir(), `test-push-subs-${process.pid}.json`);

process.env.VOTES_FILE     = TMP_VOTES;
process.env.REACTIONS_FILE = TMP_REACTIONS;
process.env.PUSH_SUBS_FILE = TMP_PUSH_SUBS;

fs.writeFileSync(TMP_VOTES,     JSON.stringify({}));
fs.writeFileSync(TMP_REACTIONS, JSON.stringify({}));
fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([]));

const app = require('../server');

afterAll(() => {
  [TMP_VOTES, TMP_REACTIONS, TMP_PUSH_SUBS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// Minimal valid push subscription object
function makeSub(endpoint) {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtDbelXbESfMol-i8gFqUfMxiM8X_dGbpRVBnIZ3_Kp2bEk5JxGf6fEY1jAFqBo',
      auth: 'tBHItJI5svbpez7KI4CCXg'
    }
  };
}

describe('POST /api/push/subscribe', () => {
  beforeEach(() => { fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([])); });

  it('returns 400 for missing endpoint', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ keys: {} });
    expect(res.statusCode).toBe(400);
  });

  it('stores subscription and returns 200', async () => {
    const sub = makeSub('https://push.example.com/sub/abc123');
    const res = await request(app)
      .post('/api/push/subscribe')
      .send(sub);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Subscribed');
    // Verify persisted
    const stored = JSON.parse(fs.readFileSync(TMP_PUSH_SUBS, 'utf8'));
    expect(stored.length).toBe(1);
    expect(stored[0].endpoint).toBe(sub.endpoint);
  });

  it('returns 409 for duplicate subscription', async () => {
    const sub = makeSub('https://push.example.com/sub/dup999');
    // First subscribe
    await request(app).post('/api/push/subscribe').send(sub);
    // Second — same endpoint
    const res = await request(app)
      .post('/api/push/subscribe')
      .send(sub);
    expect(res.statusCode).toBe(409);
  });

  it('allows different endpoints to subscribe independently', async () => {
    await request(app).post('/api/push/subscribe').send(makeSub('https://push.example.com/sub/A'));
    const res = await request(app).post('/api/push/subscribe').send(makeSub('https://push.example.com/sub/B'));
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(fs.readFileSync(TMP_PUSH_SUBS, 'utf8'));
    expect(stored.length).toBe(2);
  });
});

describe('POST /api/push/unsubscribe', () => {
  beforeEach(() => { fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([])); });

  it('returns 400 when endpoint missing', async () => {
    const res = await request(app).post('/api/push/unsubscribe').send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when endpoint not found', async () => {
    const res = await request(app)
      .post('/api/push/unsubscribe')
      .send({ endpoint: 'https://push.example.com/sub/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('removes subscription and returns 200', async () => {
    const sub = makeSub('https://push.example.com/sub/remove-me');
    await request(app).post('/api/push/subscribe').send(sub);

    const res = await request(app)
      .post('/api/push/unsubscribe')
      .send({ endpoint: sub.endpoint });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Unsubscribed');

    const stored = JSON.parse(fs.readFileSync(TMP_PUSH_SUBS, 'utf8'));
    expect(stored.find(s => s.endpoint === sub.endpoint)).toBeUndefined();
  });

  it('only removes the targeted endpoint', async () => {
    const sub1 = makeSub('https://push.example.com/sub/keep');
    const sub2 = makeSub('https://push.example.com/sub/remove');
    await request(app).post('/api/push/subscribe').send(sub1);
    await request(app).post('/api/push/subscribe').send(sub2);

    await request(app).post('/api/push/unsubscribe').send({ endpoint: sub2.endpoint });

    const stored = JSON.parse(fs.readFileSync(TMP_PUSH_SUBS, 'utf8'));
    expect(stored.length).toBe(1);
    expect(stored[0].endpoint).toBe(sub1.endpoint);
  });
});

describe('GET /api/push/vapid-public-key', () => {
  it('returns a publicKey field', async () => {
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('publicKey');
  });
});

describe('sendDailyPush', () => {
  it('returns { sent:0, failed:0, removed:0 } when no subscriptions', async () => {
    fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([]));
    const { sendDailyPush } = require('../server');
    const result = await sendDailyPush();
    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
  });

  it('removes expired (410) subscriptions automatically', async () => {
    // Seed a subscription with a fake endpoint that will trigger 410
    const badSub = makeSub('https://push.example.com/sub/gone');
    fs.writeFileSync(TMP_PUSH_SUBS, JSON.stringify([badSub]));

    // Patch webpush.sendNotification to throw 410
    const webpush = require('web-push');
    const original = webpush.sendNotification;
    webpush.sendNotification = async () => {
      const err = new Error('Gone');
      err.statusCode = 410;
      throw err;
    };

    const { sendDailyPush } = require('../server');
    const result = await sendDailyPush();
    expect(result.removed).toBe(1);
    expect(result.sent).toBe(0);

    const stored = JSON.parse(fs.readFileSync(TMP_PUSH_SUBS, 'utf8'));
    expect(stored.length).toBe(0);

    webpush.sendNotification = original;
  });
});
