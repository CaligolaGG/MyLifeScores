/*
 * stats.js
 * --------
 * "Score operations" panel: aggregate operations (count, sum, average,
 * min, max, distribution) over a chosen period (week / month / year /
 * custom range), driven by the shared period.js picker.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});
  const du = App.dateutils;

  let resultsEl = null;
  let picker = null;

  function computeStats(range) {
    const dateStrs = du.dateStrRange(range.start, range.end);
    const scores = [];
    for (const dateStr of dateStrs) {
      const entry = App.storage.getDay(dateStr);
      if (entry && entry.score != null) scores.push(entry.score);
    }
    if (scores.length === 0) return null;

    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = sum / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    const distribution = new Array(App.storage.MAX_SCORE - App.storage.MIN_SCORE + 1).fill(0);
    scores.forEach((s) => distribution[s]++);

    return {
      count: scores.length,
      totalDays: dateStrs.length,
      sum,
      avg,
      min,
      max,
      distribution,
    };
  }

  function statCard(value, label) {
    const card = document.createElement("div");
    card.className = "stat-card";
    const v = document.createElement("div");
    v.className = "stat-value";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = label;
    card.appendChild(v);
    card.appendChild(l);
    return card;
  }

  function render(range) {
    resultsEl.innerHTML = "";
    const stats = computeStats(range);

    if (!stats) {
      const empty = document.createElement("p");
      empty.className = "stats-empty";
      empty.textContent = `No scored days between ${du.formatHuman(range.start)} and ${du.formatHuman(range.end)}.`;
      resultsEl.appendChild(empty);
      return;
    }

    resultsEl.appendChild(statCard(stats.count + " / " + stats.totalDays, "Days scored"));
    resultsEl.appendChild(statCard(stats.avg.toFixed(2), "Average"));
    resultsEl.appendChild(statCard(stats.sum, "Sum"));
    resultsEl.appendChild(statCard(stats.min, "Min"));
    resultsEl.appendChild(statCard(stats.max, "Max"));

    const dist = document.createElement("div");
    dist.className = "stat-distribution";
    const title = document.createElement("div");
    title.className = "stat-label";
    title.style.marginBottom = "0.5rem";
    title.textContent = "Distribution";
    dist.appendChild(title);

    stats.distribution.forEach((count, score) => {
      const row = document.createElement("div");
      row.className = "dist-row";

      const scoreLabel = document.createElement("span");
      scoreLabel.textContent = score;

      const track = document.createElement("div");
      track.className = "dist-bar-track";
      const fill = document.createElement("div");
      fill.className = "dist-bar-fill";
      const pct = stats.count ? (count / stats.count) * 100 : 0;
      fill.style.width = pct + "%";
      fill.style.background = App.calendar.scoreColor(score);
      track.appendChild(fill);

      const countLabel = document.createElement("span");
      countLabel.textContent = count;

      row.appendChild(scoreLabel);
      row.appendChild(track);
      row.appendChild(countLabel);
      dist.appendChild(row);
    });

    resultsEl.appendChild(dist);
  }

  function init() {
    resultsEl = document.getElementById("statsResults");
    const controlsEl = document.getElementById("statsPeriodControls");
    picker = App.period.create(controlsEl, { onChange: render });
  }

  function refresh() {
    if (picker) render(picker.getRange());
  }

  App.stats = { init, refresh };
})();
