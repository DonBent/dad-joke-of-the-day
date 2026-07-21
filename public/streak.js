/**
 * Streak logic — shared between browser (global) and Node.js tests (CommonJS).
 *
 * computeStreak(lastVisit, currentStreak, today)
 *   - lastVisit: ISO date string "YYYY-MM-DD" or null
 *   - currentStreak: integer
 *   - today: ISO date string "YYYY-MM-DD"
 * Returns { streak, lastVisit }
 */
function computeStreak(lastVisit, currentStreak, today) {
  if (!lastVisit) {
    return { streak: 1, lastVisit: today };
  }
  if (lastVisit === today) {
    // Already visited today — no change
    return { streak: currentStreak, lastVisit: today };
  }
  // Check if lastVisit was yesterday
  const last = new Date(lastVisit + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffMs = todayDate - last;
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 1) {
    return { streak: currentStreak + 1, lastVisit: today };
  }
  // Missed a day or more — reset
  return { streak: 1, lastVisit: today };
}

// CommonJS export for tests; also assign to global for browser use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeStreak };
} else {
  window.computeStreak = computeStreak;
}
