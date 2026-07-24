/**
 * Unit tests for the Challenge Mode streak + history logic.
 * Tests the pure functions extracted from challenge.js.
 */

// ── Extract pure functions for testing ──────────────────────────────────────
// (mirror of the logic in challenge.js so we can test without a browser)

function computeChallengeStreak(history) {
  var streak = 0;
  var d = new Date();
  for (var i = 0; i < 365; i++) {
    var key = d.toISOString().slice(0, 10);
    var result = history[key];
    if (result === 'correct') {
      streak++;
    } else if (result === 'wrong' || result === 'skipped') {
      break;
    } else {
      if (i === 0) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function splitJoke(text) {
  var nl = text.indexOf('\n');
  if (nl !== -1) return { setup: text.slice(0, nl).trim(), punchline: text.slice(nl + 1).trim() };
  var qa = text.match(/^(Q:?\s*.+?)\s+(?:A:?\s*)(.+)$/is);
  if (qa) return { setup: qa[1].trim(), punchline: qa[2].trim() };
  var qmark = text.indexOf('? ');
  if (qmark !== -1) return { setup: text.slice(0, qmark + 1).trim(), punchline: text.slice(qmark + 2).trim() };
  var m = text.match(/^(.+?)\s[–-]\s(.+)$/);
  if (m) return { setup: m[1].trim(), punchline: m[2].trim() };
  return { setup: text, punchline: '' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateStr(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.toISOString().slice(0, 10);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeChallengeStreak', () => {
  it('returns 0 with empty history', () => {
    expect(computeChallengeStreak({})).toBe(0);
  });

  it('returns 0 when today is wrong', () => {
    var h = {};
    h[dateStr(0)] = 'wrong';
    expect(computeChallengeStreak(h)).toBe(0);
  });

  it('returns 0 when today is skipped', () => {
    var h = {};
    h[dateStr(0)] = 'skipped';
    expect(computeChallengeStreak(h)).toBe(0);
  });

  it('returns 1 when only today is correct', () => {
    var h = {};
    h[dateStr(0)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(1);
  });

  it('returns 2 for today + yesterday both correct', () => {
    var h = {};
    h[dateStr(0)] = 'correct';
    h[dateStr(-1)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(2);
  });

  it('streak breaks on a wrong day in the middle', () => {
    var h = {};
    h[dateStr(0)]  = 'correct';
    h[dateStr(-1)] = 'wrong';
    h[dateStr(-2)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(1);
  });

  it('streak breaks on a skipped day', () => {
    var h = {};
    h[dateStr(0)]  = 'correct';
    h[dateStr(-1)] = 'skipped';
    h[dateStr(-2)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(1);
  });

  it('counts streak from yesterday when today is not yet attempted', () => {
    var h = {};
    h[dateStr(-1)] = 'correct';
    h[dateStr(-2)] = 'correct';
    // today has no entry
    expect(computeChallengeStreak(h)).toBe(2);
  });

  it('returns 3 for three consecutive correct days ending today', () => {
    var h = {};
    h[dateStr(0)]  = 'correct';
    h[dateStr(-1)] = 'correct';
    h[dateStr(-2)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(3);
  });

  it('stops counting if a gap exists (no entry = break for past days)', () => {
    var h = {};
    h[dateStr(0)]  = 'correct';
    // -1 has no entry
    h[dateStr(-2)] = 'correct';
    expect(computeChallengeStreak(h)).toBe(1);
  });
});

describe('splitJoke', () => {
  it('splits on newline', () => {
    var r = splitJoke('Why did the chicken cross the road?\nTo get to the other side.');
    expect(r.setup).toBe('Why did the chicken cross the road?');
    expect(r.punchline).toBe('To get to the other side.');
  });

  it('splits on question mark + space', () => {
    var r = splitJoke('Why do scientists not trust atoms? Because they make up everything!');
    expect(r.setup).toBe('Why do scientists not trust atoms?');
    expect(r.punchline).toBe('Because they make up everything!');
  });

  it('splits on Q: A: pattern', () => {
    var r = splitJoke('Q: What do you call fake spaghetti? A: An impasta!');
    expect(r.setup).toMatch(/spaghetti/);
    expect(r.punchline).toMatch(/impasta/);
  });

  it('splits on dash separator', () => {
    var r = splitJoke('I used to hate facial hair - but then it grew on me.');
    expect(r.setup).toBe('I used to hate facial hair');
    expect(r.punchline).toBe('but then it grew on me.');
  });

  it('returns empty punchline for unsplittable joke', () => {
    var r = splitJoke('Just a statement with no punchline.');
    expect(r.punchline).toBe('');
  });
});
