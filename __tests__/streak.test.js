/**
 * Unit tests for the daily visit streak logic (pure client-side, no server).
 * The streak helpers are extracted to a CommonJS-compatible module so they
 * can be tested without a browser.
 */

const { computeStreak } = require('../public/streak');

// Helper: ISO date string like "2024-07-21"
function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe('computeStreak', () => {
  it('returns streak 1 and today date on first ever visit (no lastVisit)', () => {
    const result = computeStreak(null, 0, dateStr(0));
    expect(result.streak).toBe(1);
    expect(result.lastVisit).toBe(dateStr(0));
  });

  it('increments streak when last visit was yesterday', () => {
    const result = computeStreak(dateStr(-1), 3, dateStr(0));
    expect(result.streak).toBe(4);
    expect(result.lastVisit).toBe(dateStr(0));
  });

  it('does not change streak when already visited today', () => {
    const result = computeStreak(dateStr(0), 5, dateStr(0));
    expect(result.streak).toBe(5);
    expect(result.lastVisit).toBe(dateStr(0));
  });

  it('resets streak to 1 when last visit was two days ago', () => {
    const result = computeStreak(dateStr(-2), 10, dateStr(0));
    expect(result.streak).toBe(1);
    expect(result.lastVisit).toBe(dateStr(0));
  });

  it('resets streak to 1 when last visit was far in the past', () => {
    const result = computeStreak('2020-01-01', 99, dateStr(0));
    expect(result.streak).toBe(1);
    expect(result.lastVisit).toBe(dateStr(0));
  });

  it('handles streak of 1 incrementing to 2 correctly', () => {
    const result = computeStreak(dateStr(-1), 1, dateStr(0));
    expect(result.streak).toBe(2);
  });
});
