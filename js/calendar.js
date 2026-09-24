/*
 * calendar.js
 * -----------
 * Renders the month grid on the left and the score/note editor on the
 * right, and keeps them in sync with the in-memory data store.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});
  const du = App.dateutils;

  // Score 0 -> 6 colour ramp (red to green). No purple/fuchsia/violet tones.
  const SCORE_COLORS = [
    "#dc2626", // 0 red
    "#ea580c", // 1 orange-red
    "#f59e0b", // 2 amber
    "#eab308", // 3 yellow
    "#a3e635", // 4 lime
    "#4ade80", // 5 light green
    "#16a34a", // 6 deep green
  ];

  function scoreColor(score) {
    if (score == null) return null;
    return SCORE_COLORS[Math.max(0, Math.min(6, score))];
  }

  const els = {};

  const state = {
    viewDate: du.startOfMonth(new Date()),
    selectedDateStr: du.toDateStr(new Date()),
    filterScore: null, // null = show every day; 0-6 = spotlight only that score
  };

  function cacheEls() {
    els.title = document.getElementById("calendarTitle");
    els.weekdayRow = document.getElementById("weekdayRow");
    els.grid = document.getElementById("calendarGrid");
    els.legend = document.getElementById("scoreLegend");
    els.btnPrev = document.getElementById("btnPrevMonth");
    els.btnNext = document.getElementById("btnNextMonth");
    els.btnToday = document.getElementById("btnToday");
    els.goToDateInput = document.getElementById("goToDateInput");

    els.filterStatus = document.getElementById("filterStatus");

    els.editorDate = document.getElementById("editorDate");
    els.scoreButtons = document.getElementById("scoreButtons");
    els.noteBlock = document.getElementById("noteBlock");
    els.noteField = document.getElementById("noteField");
    els.btnSaveNote = document.getElementById("btnSaveNote");
    els.noteStatus = document.getElementById("noteStatus");
    els.btnClearDay = document.getElementById("btnClearDay");
  }

  function renderWeekdayRow() {
    els.weekdayRow.innerHTML = "";
    du.WEEKDAY_NAMES_SHORT.forEach((name) => {
      const cell = document.createElement("div");
      cell.className = "weekday-cell";
      cell.textContent = name;
      els.weekdayRow.appendChild(cell);
    });
  }

  function renderLegend() {
    els.legend.innerHTML = "";
    const label = document.createElement("span");
    label.className = "legend-label";
    label.textContent = "Score:";
    els.legend.appendChild(label);
    for (let s = App.storage.MIN_SCORE; s <= App.storage.MAX_SCORE; s++) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "legend-chip";
      chip.style.background = scoreColor(s);
      chip.textContent = s;
      chip.setAttribute("aria-pressed", String(state.filterScore === s));
      if (state.filterScore === s) chip.classList.add("legend-chip-active");
      chip.title =
        state.filterScore === s
          ? `Showing only days scored ${s} — click to show all days again`
          : `Show only days scored ${s}`;
      chip.addEventListener("click", () => toggleFilter(s));
      els.legend.appendChild(chip);
    }
  }

  // -----------------------------------------------------------------
  // Score filter: spotlight only days with a given score. Navigating
  // months while a filter is active skips straight to the next/previous
  // month (however many months or years away) that actually has a
  // matching day, instead of stepping through empty ones.
  // -----------------------------------------------------------------

  function monthKeyOf(date) {
    return date.getFullYear() + "-" + du.pad2(date.getMonth() + 1);
  }

  function monthKeyToDate(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }

  /** Every "YYYY-MM" that has at least one day with the given score. */
  function monthsWithScore(score) {
    const months = new Set();
    for (const [dateStr, entry] of App.storage.allEntries()) {
      if (entry.score === score) months.add(dateStr.slice(0, 7));
    }
    return months;
  }

  function nextMatchingMonthKey(months, fromKey) {
    let best = null;
    for (const key of months) {
      if (key > fromKey && (best === null || key < best)) best = key;
    }
    return best;
  }

  function prevMatchingMonthKey(months, fromKey) {
    let best = null;
    for (const key of months) {
      if (key < fromKey && (best === null || key > best)) best = key;
    }
    return best;
  }

  function nearestMatchingMonthKey(months, fromKey) {
    if (months.has(fromKey)) return fromKey;
    return nextMatchingMonthKey(months, fromKey) || prevMatchingMonthKey(months, fromKey);
  }

  function toggleFilter(score) {
    state.filterScore = state.filterScore === score ? null : score;

    if (state.filterScore != null) {
      const months = monthsWithScore(state.filterScore);
      const currentKey = monthKeyOf(state.viewDate);
      if (months.size && !months.has(currentKey)) {
        const nearest = nearestMatchingMonthKey(months, currentKey);
        if (nearest) state.viewDate = monthKeyToDate(nearest);
      }
    }

    renderLegend();
    renderMonthGrid();
  }

  function renderMonthGrid() {
    els.title.textContent = du.formatMonthYear(state.viewDate);
    els.grid.innerHTML = "";

    const monthStart = du.startOfMonth(state.viewDate);
    const monthEnd = du.endOfMonth(state.viewDate);
    const gridStart = du.startOfWeek(monthStart);
    const gridEnd = du.endOfWeek(monthEnd);

    const todayStr = du.toDateStr(new Date());
    const filterScore = state.filterScore;
    let matchesInMonth = 0;

    let cur = gridStart;
    while (cur <= gridEnd) {
      const dateStr = du.toDateStr(cur);
      const entry = App.storage.getDay(dateStr);
      const inMonth = cur.getMonth() === monthStart.getMonth();
      const matchesFilter = filterScore == null || (entry && entry.score === filterScore);
      if (inMonth && matchesFilter && filterScore != null) matchesInMonth++;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell" + (inMonth ? "" : " day-cell-outside");
      if (dateStr === todayStr) cell.classList.add("day-cell-today");
      if (dateStr === state.selectedDateStr) cell.classList.add("day-cell-selected");
      if (!matchesFilter) cell.classList.add("day-cell-filtered");
      cell.dataset.date = dateStr;

      // A filtered-out day is emptied (per the "filtered days are removed"
      // request) but keeps its grid slot, so weekday columns stay aligned
      // and the today/selected outlines still work as position markers.
      if (matchesFilter) {
        const num = document.createElement("span");
        num.className = "day-num";
        num.textContent = cur.getDate();
        cell.appendChild(num);

        if (entry && entry.score != null) {
          const dot = document.createElement("span");
          dot.className = "day-score-dot";
          dot.style.background = scoreColor(entry.score);
          dot.textContent = entry.score;
          cell.appendChild(dot);
        }
        if (entry && entry.note) {
          const noteMark = document.createElement("span");
          noteMark.className = "day-note-mark";
          noteMark.title = "Has a note";
          cell.appendChild(noteMark);
        }
      }

      cell.addEventListener("click", () => selectDate(dateStr));
      els.grid.appendChild(cell);

      cur = du.addDays(cur, 1);
    }

    updateFilterStatus(matchesInMonth);
  }

  function updateFilterStatus(matchesInMonth) {
    if (!els.filterStatus) return;
    if (state.filterScore == null) {
      els.filterStatus.hidden = true;
      return;
    }
    els.filterStatus.hidden = false;
    const monthLabel = du.formatMonthYear(state.viewDate);
    els.filterStatus.textContent =
      matchesInMonth === 0
        ? `No days scored ${state.filterScore} in ${monthLabel}.`
        : `Showing only days scored ${state.filterScore} (${matchesInMonth} in ${monthLabel}). Click the chip again to show all.`;
  }

  function renderScoreButtons() {
    els.scoreButtons.innerHTML = "";
    const entry = App.storage.getDay(state.selectedDateStr);
    const current = entry ? entry.score : null;

    for (let s = App.storage.MIN_SCORE; s <= App.storage.MAX_SCORE; s++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "score-btn";
      b.textContent = s;
      b.style.setProperty("--score-color", scoreColor(s));
      if (current === s) b.classList.add("active");
      b.addEventListener("click", async () => {
        const next = current === s ? null : s; // click again to clear
        await App.storage.setScore(state.selectedDateStr, next);
        renderScoreButtons();
        renderMonthGrid();
      });
      els.scoreButtons.appendChild(b);
    }
  }

  function renderEditor() {
    const date = du.parseDateStr(state.selectedDateStr);
    els.editorDate.textContent = du.formatHuman(date);
    renderScoreButtons();

    const entry = App.storage.getDay(state.selectedDateStr);
    els.noteField.value = entry && entry.note ? entry.note : "";
    els.noteStatus.textContent = "";
  }

  /**
   * If the note field has unsaved edits for the day we're currently on,
   * save them before we navigate away — so switching days never silently
   * drops what you typed.
   */
  async function autoSaveNoteIfDirty() {
    if (!els.noteField || state.selectedDateStr == null) return;
    const entry = App.storage.getDay(state.selectedDateStr);
    const storedNote = entry && entry.note ? entry.note : "";
    const currentValue = els.noteField.value;
    if (currentValue === storedNote) return; // nothing to do
    // No status text here: we're navigating away from this day, so the
    // "Saved" message would belong to a note field the user is no longer
    // looking at. The flash (triggered inside saveNoteFor) is the feedback.
    await saveNoteFor(state.selectedDateStr, currentValue, { showStatus: false });
  }

  /** Shared by the "Save note" button and the switch-day autosave above. */
  async function saveNoteFor(dateStr, text, opts) {
    opts = opts || {};
    const showStatus = opts.showStatus !== false;
    await App.storage.setNote(dateStr, text);
    renderMonthGrid();
    flashNoteSaved();
    if (showStatus && dateStr === state.selectedDateStr) {
      els.noteStatus.textContent = "Saved ✓";
      clearTimeout(saveNoteFor._statusTimer);
      saveNoteFor._statusTimer = setTimeout(() => {
        els.noteStatus.textContent = "";
      }, 2000);
    }
  }

  /** Brief highlight animation around the note block, on every note save. */
  function flashNoteSaved() {
    const block = els.noteBlock;
    if (!block) return;
    block.classList.remove("note-flash");
    void block.offsetWidth; // restart the animation even if it's already mid-flash
    block.classList.add("note-flash");
    clearTimeout(flashNoteSaved._timer);
    // Explicit cleanup rather than relying on animationend: keeps this
    // correct under prefers-reduced-motion (where the CSS highlight isn't
    // driven by the animation's own end event) and avoids stacking
    // listeners across rapid saves.
    flashNoteSaved._timer = setTimeout(() => {
      block.classList.remove("note-flash");
    }, 700);
  }

  async function selectDate(dateStr) {
    await autoSaveNoteIfDirty();

    state.selectedDateStr = dateStr;
    const d = du.parseDateStr(dateStr);
    if (d.getMonth() !== state.viewDate.getMonth() || d.getFullYear() !== state.viewDate.getFullYear()) {
      state.viewDate = du.startOfMonth(d);
    }
    renderAll();
    if (els.goToDateInput) els.goToDateInput.value = dateStr;
  }

  function goToDate(dateStr) {
    if (!dateStr) return Promise.resolve();
    return selectDate(dateStr);
  }

  function goPrevMonth() {
    if (state.filterScore != null) {
      const months = monthsWithScore(state.filterScore);
      const prevKey = prevMatchingMonthKey(months, monthKeyOf(state.viewDate));
      if (!prevKey) return; // nothing further back with this score — stay put
      state.viewDate = monthKeyToDate(prevKey);
      renderMonthGrid();
      return;
    }
    state.viewDate = du.addMonths(state.viewDate, -1);
    renderMonthGrid();
  }

  function goNextMonth() {
    if (state.filterScore != null) {
      const months = monthsWithScore(state.filterScore);
      const nextKey = nextMatchingMonthKey(months, monthKeyOf(state.viewDate));
      if (!nextKey) return; // nothing further ahead with this score — stay put
      state.viewDate = monthKeyToDate(nextKey);
      renderMonthGrid();
      return;
    }
    state.viewDate = du.addMonths(state.viewDate, 1);
    renderMonthGrid();
  }

  function goToday() {
    return selectDate(du.toDateStr(new Date()));
  }

  function renderAll() {
    renderMonthGrid();
    renderEditor();
  }

  function saveNote() {
    return saveNoteFor(state.selectedDateStr, els.noteField.value);
  }

  async function clearDay() {
    await App.storage.clearDay(state.selectedDateStr);
    renderAll();
  }

  /** True for form fields etc. where arrow keys must keep their native meaning. */
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  /**
   * Left/Right: step the selected day by one (same as clicking a
   * neighboring cell — autosave-on-switch and the note flash still apply).
   * Shift+Left/Right (either shift key — the browser sets shiftKey the
   * same way for both): step the visible month, same as the ‹ / › buttons.
   */
  function handleGlobalKeydown(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (isTypingTarget(e.target)) return;

    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;

    if (e.shiftKey) {
      if (dir > 0) goNextMonth();
      else goPrevMonth();
    } else {
      const next = du.addDays(du.parseDateStr(state.selectedDateStr), dir);
      selectDate(du.toDateStr(next));
    }
  }

  function init() {
    cacheEls();
    renderWeekdayRow();
    renderLegend();

    els.btnPrev.addEventListener("click", goPrevMonth);
    els.btnNext.addEventListener("click", goNextMonth);
    els.btnToday.addEventListener("click", goToday);
    els.btnSaveNote.addEventListener("click", saveNote);
    els.btnClearDay.addEventListener("click", clearDay);
    els.goToDateInput.addEventListener("change", () => goToDate(els.goToDateInput.value));
    document.addEventListener("keydown", handleGlobalKeydown);

    state.viewDate = du.startOfMonth(new Date());
    state.selectedDateStr = du.toDateStr(new Date());
    state.filterScore = null;
    renderAll();
  }

  App.calendar = {
    init,
    renderAll,
    selectDate,
    goToDate,
    scoreColor,
    SCORE_COLORS,
  };
})();
