/*
 * search.js
 * ---------
 * Full-text (substring) search over note content, restricted to an
 * optional period (week / month / year / custom / all time). Clicking a
 * result jumps the calendar + editor to that day.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});
  const du = App.dateutils;

  let inputEl = null;
  let resultsEl = null;
  let picker = null;

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function snippetWithHighlight(note, query) {
    const idx = note.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(note.slice(0, 140));

    const contextRadius = 60;
    const start = Math.max(0, idx - contextRadius);
    const end = Math.min(note.length, idx + query.length + contextRadius);
    let snippet = note.slice(start, end);

    const prefix = start > 0 ? "…" : "";
    const suffix = end < note.length ? "…" : "";

    const relIdx = idx - start;
    const before = escapeHtml(snippet.slice(0, relIdx));
    const match = escapeHtml(snippet.slice(relIdx, relIdx + query.length));
    const after = escapeHtml(snippet.slice(relIdx + query.length));

    return prefix + before + "<mark>" + match + "</mark>" + after + suffix;
  }

  function runSearch(range) {
    if (!range) range = picker.getRange();
    const query = inputEl.value.trim();
    resultsEl.innerHTML = "";

    if (!query) {
      const hint = document.createElement("p");
      hint.className = "search-empty";
      hint.textContent = "Type something to search your notes.";
      resultsEl.appendChild(hint);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matches = [];
    for (const [dateStr, entry] of App.storage.allEntries()) {
      if (!entry.note) continue;
      const d = du.parseDateStr(dateStr);
      if (d < range.start || d > range.end) continue;
      if (entry.note.toLowerCase().includes(lowerQuery)) {
        matches.push([dateStr, entry]);
      }
    }
    matches.sort((a, b) => (a[0] < b[0] ? 1 : -1)); // newest first

    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = `No notes matching "${query}" in this period.`;
      resultsEl.appendChild(empty);
      return;
    }

    matches.forEach(([dateStr, entry]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "search-result";

      const head = document.createElement("div");
      head.className = "search-result-head";

      if (entry.score != null) {
        const scoreBadge = document.createElement("span");
        scoreBadge.className = "search-result-score";
        scoreBadge.style.background = App.calendar.scoreColor(entry.score);
        scoreBadge.textContent = entry.score;
        head.appendChild(scoreBadge);
      }

      const dateLabel = document.createElement("span");
      dateLabel.textContent = du.formatHuman(du.parseDateStr(dateStr));
      head.appendChild(dateLabel);

      const snippet = document.createElement("div");
      snippet.className = "search-result-snippet";
      snippet.innerHTML = snippetWithHighlight(entry.note, query);

      card.appendChild(head);
      card.appendChild(snippet);

      card.addEventListener("click", () => {
        App.calendar.selectDate(dateStr);
        document.getElementById("editorDate").scrollIntoView({ behavior: "smooth", block: "center" });
      });

      resultsEl.appendChild(card);
    });
  }

  function init() {
    inputEl = document.getElementById("searchInput");
    resultsEl = document.getElementById("searchResults");
    const controlsEl = document.getElementById("searchPeriodControls");

    picker = App.period.create(controlsEl, {
      modes: ["all", "week", "month", "year", "custom"],
      defaultMode: "all",
      onChange: runSearch,
    });

    inputEl.addEventListener("input", () => runSearch());
    runSearch();
  }

  function refresh() {
    if (picker) runSearch();
  }

  App.search = { init, refresh };
})();
