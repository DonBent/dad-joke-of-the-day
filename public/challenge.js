/**
 * challenge.js — Daily "Guess the Punchline" Challenge Mode (v16)
 *
 * Pure client-side. No backend changes.
 *
 * localStorage keys:
 *   challengeHistory  — { [YYYY-MM-DD]: "correct" | "wrong" | "skipped" }
 *   djotd_lastVisit   — managed by streak.js (do not touch)
 *   djotd_streak      — managed by streak.js (do not touch)
 *
 * Functions exposed on window:
 *   initChallenge(jokeData)   — call after today's joke is loaded
 *   getChallengeStreak()      — returns current consecutive-correct-day count
 */

(function () {
  var LS_HISTORY = 'challengeHistory';

  // ── helpers ─────────────────────────────────────────────────────────────────

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveHistory(history) {
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  }

  /**
   * Compute the current challenge streak: number of consecutive days (ending
   * with today or yesterday) that have a "correct" outcome.
   */
  function computeChallengeStreak(history) {
    var streak = 0;
    var d = new Date();
    // Allow today to be counted only if already completed
    for (var i = 0; i < 365; i++) {
      var key = d.toISOString().slice(0, 10);
      var result = history[key];
      if (result === 'correct') {
        streak++;
      } else if (result === 'wrong' || result === 'skipped') {
        // streak broken
        break;
      } else {
        // no entry — if this is today, skip (not yet attempted); if past day, break
        if (i === 0) {
          // today not yet done — don't count, but keep looking backward
          d.setDate(d.getDate() - 1);
          continue;
        }
        break;
      }
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  window.getChallengeStreak = function () {
    return computeChallengeStreak(getHistory());
  };

  // ── CSS ──────────────────────────────────────────────────────────────────────

  var styles = `
    .challenge-section {
      margin: 20px 0 8px;
      background: linear-gradient(135deg, #fff8f3 0%, #fff0e6 100%);
      border: 2px solid #ffd5bf;
      border-radius: 14px;
      padding: 20px;
      text-align: center;
      position: relative;
    }
    .challenge-header {
      font-size: 1rem;
      font-weight: 700;
      color: #ff6b35;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }
    .challenge-tagline {
      font-size: 0.82rem;
      color: #aaa;
      margin-bottom: 14px;
    }
    .challenge-streak-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #fff3ec;
      border: 1.5px solid #ffd5bf;
      border-radius: 20px;
      padding: 4px 14px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #e0531f;
      margin-bottom: 14px;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .challenge-reveal-btn {
      background: #ff6b35;
      color: white;
      border: none;
      border-radius: 10px;
      padding: 11px 26px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      font-family: inherit;
    }
    .challenge-reveal-btn:hover { background: #e55a26; }
    .challenge-reveal-btn:active { transform: scale(0.97); }
    .challenge-guess-area {
      display: none;
      margin-top: 12px;
      text-align: left;
    }
    .challenge-guess-area.open { display: block; }
    .challenge-guess-label {
      font-size: 0.82rem;
      color: #888;
      margin-bottom: 6px;
      display: block;
    }
    .challenge-guess-input {
      width: 100%;
      border: 2px solid #eee;
      border-radius: 8px;
      padding: 10px 13px;
      font-size: 0.95rem;
      color: #444;
      outline: none;
      font-family: inherit;
      margin-bottom: 10px;
      transition: border-color 0.2s;
    }
    .challenge-guess-input:focus { border-color: #ff6b35; }
    .challenge-btn-row {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .challenge-do-reveal-btn {
      background: #ff6b35;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 0.9rem;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s;
    }
    .challenge-do-reveal-btn:hover { background: #e55a26; }
    .challenge-skip-btn {
      background: none;
      color: #bbb;
      border: 1.5px solid #eee;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.2s;
    }
    .challenge-skip-btn:hover { border-color: #ccc; color: #999; }
    .challenge-punchline-box {
      display: none;
      margin-top: 14px;
      background: white;
      border-radius: 10px;
      padding: 14px 16px;
      border: 1.5px solid #ffd5bf;
      text-align: left;
    }
    .challenge-punchline-box.open { display: block; }
    .challenge-punchline-label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #bbb;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .challenge-punchline-text {
      font-size: 1.05rem;
      color: #333;
      line-height: 1.5;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .challenge-self-report {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .challenge-self-report span {
      font-size: 0.85rem;
      color: #888;
      margin-right: 4px;
    }
    .challenge-got-it-btn,
    .challenge-nope-btn {
      border: none;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 0.88rem;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
      transition: all 0.15s;
    }
    .challenge-got-it-btn { background: #d4f5d4; color: #1e6b1e; }
    .challenge-got-it-btn:hover { background: #b8edb8; }
    .challenge-nope-btn { background: #fde8e8; color: #a02020; }
    .challenge-nope-btn:hover { background: #f9c8c8; }
    .challenge-result-area {
      display: none;
      margin-top: 14px;
      text-align: center;
    }
    .challenge-result-area.open { display: block; }
    .challenge-result-badge {
      font-size: 1.5rem;
      margin-bottom: 6px;
    }
    .challenge-result-msg {
      font-size: 0.9rem;
      color: #555;
      margin-bottom: 10px;
    }
    .challenge-result-streak {
      font-size: 0.82rem;
      color: #ff6b35;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .challenge-share-badge-btn {
      background: #ff6b35;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 9px 20px;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s;
    }
    .challenge-share-badge-btn:hover { background: #e55a26; }
    .challenge-skipped-msg {
      font-size: 0.88rem;
      color: #bbb;
      padding: 6px 0;
    }
  `;

  var styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // ── extract punchline from joke text ─────────────────────────────────────

  /**
   * Best-effort split of a joke into setup + punchline.
   * Tries common delimiters: newline, " - ", "? " (Q&A format).
   * Falls back to last sentence.
   */
  function splitJoke(text) {
    // Multi-line
    var nl = text.indexOf('\n');
    if (nl !== -1) {
      return { setup: text.slice(0, nl).trim(), punchline: text.slice(nl + 1).trim() };
    }
    // "Q: ... A: ..." pattern
    var qa = text.match(/^(Q:?\s*.+?)\s+(?:A:?\s*)(.+)$/is);
    if (qa) {
      return { setup: qa[1].trim(), punchline: qa[2].trim() };
    }
    // Sentence ending with ? followed by answer
    var qmark = text.indexOf('? ');
    if (qmark !== -1) {
      return { setup: text.slice(0, qmark + 1).trim(), punchline: text.slice(qmark + 2).trim() };
    }
    // Dash separator " - " or " – "
    var dash = text.search(/\s[–-]\s/);
    if (dash !== -1) {
      var m = text.match(/^(.+?)\s[–-]\s(.+)$/);
      if (m) return { setup: m[1].trim(), punchline: m[2].trim() };
    }
    // Fallback: show entire joke as setup with a generic punchline notice
    return { setup: text, punchline: '' };
  }

  // ── DOM build ─────────────────────────────────────────────────────────────

  function buildChallengeUI(jokeData) {
    var today = todayKey();
    var history = getHistory();
    var alreadyDone = history[today];
    var streak = computeChallengeStreak(history);
    var split = splitJoke(jokeData.joke);
    var hasPunchline = split.punchline && split.punchline !== split.setup;

    var section = document.createElement('div');
    section.className = 'challenge-section';
    section.id = 'challenge-section';

    var streakHtml = streak > 0
      ? '<div class="challenge-streak-badge">🧠🔥 Challenge Streak: ' + streak + ' day' + (streak !== 1 ? 's' : '') + '</div>'
      : '';

    if (alreadyDone) {
      // Already completed today — show result summary
      var doneEmoji = alreadyDone === 'correct' ? '✅' : alreadyDone === 'wrong' ? '❌' : '⏭️';
      var doneMsg = alreadyDone === 'correct'
        ? "You nailed it today! Come back tomorrow. 😎"
        : alreadyDone === 'wrong'
        ? "Better luck tomorrow — the bar was on the floor and yet… 😅"
        : "You skipped today's challenge. The punchline awaits tomorrow! 🙈";
      section.innerHTML = `
        <div class="challenge-header">🤔 Today's Challenge</div>
        ${streakHtml}
        <div style="font-size:2rem;margin-bottom:6px;">${doneEmoji}</div>
        <div class="challenge-result-msg">${doneMsg}</div>
        ${alreadyDone === 'correct' ? '<button class="challenge-share-badge-btn" onclick="shareChallengeResult()">Share Today\'s Badge 🏅</button>' : ''}
      `;
      return section;
    }

    // Not yet attempted
    if (!hasPunchline) {
      // Can't split — hide the section gracefully
      return null;
    }

    section.innerHTML = `
      <div class="challenge-header">🤔 Guess the Punchline?</div>
      <div class="challenge-tagline">Think you can out-dad the joke?</div>
      ${streakHtml}
      <div id="challenge-setup-text" style="font-size:1rem;color:#555;margin-bottom:14px;font-style:italic;">${escHtml(split.setup)}</div>
      <button class="challenge-reveal-btn" id="challenge-open-btn" onclick="challengeOpenGuess()">🤔 Try to guess the punchline!</button>
      <div class="challenge-guess-area" id="challenge-guess-area">
        <label class="challenge-guess-label" for="challenge-input">Your guess (optional — no pressure, seriously):</label>
        <input class="challenge-guess-input" id="challenge-input" type="text"
          placeholder="Go on, give it your best groan..." />
        <div class="challenge-btn-row">
          <button class="challenge-do-reveal-btn" onclick="challengeReveal()">🥁 Reveal Punchline</button>
          <button class="challenge-skip-btn" onclick="challengeSkip()">⏭️ Skip today</button>
        </div>
      </div>
      <div class="challenge-punchline-box" id="challenge-punchline-box">
        <div class="challenge-punchline-label">The Punchline</div>
        <div class="challenge-punchline-text" id="challenge-punchline-text">${escHtml(split.punchline)}</div>
        <div class="challenge-self-report" id="challenge-self-report">
          <span>Did you get it?</span>
          <button class="challenge-got-it-btn" onclick="challengeReport('correct')">✅ Got it!</button>
          <button class="challenge-nope-btn" onclick="challengeReport('wrong')">❌ Nope</button>
        </div>
      </div>
      <div class="challenge-result-area" id="challenge-result-area"></div>
    `;

    return section;
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── interaction handlers (attached to window) ─────────────────────────────

  window.challengeOpenGuess = function () {
    document.getElementById('challenge-open-btn').style.display = 'none';
    document.getElementById('challenge-guess-area').classList.add('open');
    var input = document.getElementById('challenge-input');
    if (input) setTimeout(function () { input.focus(); }, 50);
  };

  window.challengeReveal = function () {
    document.getElementById('challenge-guess-area').classList.remove('open');
    document.getElementById('challenge-punchline-box').classList.add('open');
  };

  window.challengeSkip = function () {
    var today = todayKey();
    var history = getHistory();
    history[today] = 'skipped';
    saveHistory(history);
    var section = document.getElementById('challenge-section');
    if (section) {
      section.innerHTML = `
        <div class="challenge-header">🤔 Today's Challenge</div>
        <div style="font-size:1.5rem;margin-bottom:6px;">⏭️</div>
        <div class="challenge-skipped-msg">Skipped! The joke stands unchallenged. 🙈<br>Come back tomorrow.</div>
      `;
    }
  };

  window.challengeReport = function (result) {
    var today = todayKey();
    var history = getHistory();
    history[today] = result;
    saveHistory(history);

    // Hide self-report buttons
    var sr = document.getElementById('challenge-self-report');
    if (sr) sr.style.display = 'none';

    var newStreak = computeChallengeStreak(history);
    var resultArea = document.getElementById('challenge-result-area');
    if (!resultArea) return;

    if (result === 'correct') {
      resultArea.innerHTML = `
        <div class="challenge-result-badge">🎉</div>
        <div class="challenge-result-msg">You got it! Today's challenge: ✅</div>
        <div class="challenge-result-streak">🧠🔥 Challenge Streak: ${newStreak} day${newStreak !== 1 ? 's' : ''}</div>
        <button class="challenge-share-badge-btn" onclick="shareChallengeResult()">Share Today's Badge 🏅</button>
      `;
    } else {
      resultArea.innerHTML = `
        <div class="challenge-result-badge">😅</div>
        <div class="challenge-result-msg">Dads everywhere salute your attempt. ❌<br>Better luck tomorrow!</div>
        ${newStreak > 0 ? '<div class="challenge-result-streak">🧠🔥 Challenge Streak: ' + newStreak + ' day' + (newStreak !== 1 ? 's' : '') + '</div>' : ''}
      `;
    }
    resultArea.classList.add('open');

    // Update top-level streak badge in case it was rendered already
    renderStreakBadge(newStreak);
  };

  window.shareChallengeResult = function () {
    var today = todayKey();
    var history = getHistory();
    var streak = computeChallengeStreak(history);
    var text = '✅ I cracked today\'s Dad Joke Challenge! 🧠🔥 ' + streak + '-day streak!\nJoin me at ' + window.location.origin;

    if (navigator.share) {
      navigator.share({ title: 'Dad Joke Challenge', text: text, url: window.location.origin })
        .catch(function () {});
    } else {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.querySelector('.challenge-share-badge-btn');
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = '✅ Copied!';
          setTimeout(function () { btn.textContent = orig; }, 2000);
        }
      }).catch(function () {
        prompt('Copy your challenge badge:', text);
      });
    }
  };

  function renderStreakBadge(streak) {
    var existing = document.getElementById('challenge-streak-top');
    if (streak <= 0) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'challenge-streak-top';
      existing.className = 'challenge-streak-badge';
      existing.style.margin = '0 auto 12px';
      existing.style.display = 'inline-flex';
    }
    existing.textContent = '🧠🔥 Challenge Streak: ' + streak + ' day' + (streak !== 1 ? 's' : '');
    var streakBadge = document.getElementById('streak-badge');
    if (streakBadge && streakBadge.parentNode && !document.getElementById('challenge-streak-top')) {
      streakBadge.parentNode.insertBefore(existing, streakBadge.nextSibling);
    }
  }

  // ── public init function ──────────────────────────────────────────────────

  window.initChallenge = function (jokeData) {
    // Only show on the main page, never inside a widget iframe
    if (window.self !== window.top) return; // inside iframe — skip

    // Remove any existing challenge section (e.g., on tab reload)
    var existing = document.getElementById('challenge-section');
    if (existing) existing.remove();

    var section = buildChallengeUI(jokeData);
    if (!section) return;

    // Insert challenge section before the .actions row
    var card = document.querySelector('.card');
    var actions = card && card.querySelector('.actions');
    if (actions) {
      card.insertBefore(section, actions);
    } else if (card) {
      card.appendChild(section);
    }

    // Render top-level streak badge
    var streak = computeChallengeStreak(getHistory());
    renderStreakBadge(streak);
  };

  // ── keyboard shortcut: Enter in guess input triggers reveal ──────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'challenge-input') {
      window.challengeReveal();
    }
  });

})();
