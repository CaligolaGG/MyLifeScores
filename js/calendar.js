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
    mode: "day", // "day" | "month" | "year" — which independent rating/note system the side panel edits
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
    els.modeSelect = document.getElementById("modeSelect");

    els.filterStatus = document.getElementById("filterStatus");

    els.editorPanel = document.getElementById("editorPanel");
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

  // -----------------------------------------------------------------
  // Mode: three independent, parallel rating/note systems sharing this
  // one side panel — Day (the original per-date one, keyed by
  // "YYYY-MM-DD"), Month (keyed by "YYYY-MM"), and Year (keyed by
  // "YYYY"). Whichever is active is entirely separate storage
  // (App.storage.{get,set}{Month,Year}{Score,Note}) from the others; the
  // day grid stays visible in every mode purely for browsing context.
  // -----------------------------------------------------------------

  function yearKeyOf(date) {
    return String(date.getFullYear());
  }

  function yearKeyToDate(key) {
    return new Date(Number(key), 0, 1);
  }

  /** The key (date/month/year string) the side panel is currently bound to. */
  function currentKey() {
    if (state.mode === "month") return monthKeyOf(state.viewDate);
    if (state.mode === "year") return yearKeyOf(state.viewDate);
    return state.selectedDateStr;
  }

  function currentEntry() {
    if (state.mode === "month") return App.storage.getMonth(currentKey());
    if (state.mode === "year") return App.storage.getYear(currentKey());
    return App.storage.getDay(currentKey());
  }

  function setCurrentScore(score) {
    const key = currentKey();
    if (state.mode === "month") return App.storage.setMonthScore(key, score);
    if (state.mode === "year") return App.storage.setYearScore(key, score);
    return App.storage.setScore(key, score);
  }

  function editorTitleFor(mode, key) {
    if (mode === "month") return du.formatMonthYear(monthKeyToDate(key));
    if (mode === "year") return key;
    return du.formatHuman(du.parseDateStr(key));
  }

  function notePlaceholderFor(mode) {
    if (mode === "month") return "Write something about this month…";
    if (mode === "year") return "Write something about this year…";
    return "Write something about this day…";
  }

  function clearLabelFor(mode) {
    if (mode === "month") return "Clear this month";
    if (mode === "year") return "Clear this year";
    return "Clear this day";
  }

  function ariaLabelFor(mode) {
    if (mode === "month") return "Month editor";
    if (mode === "year") return "Year editor";
    return "Day editor";
  }

  function updateLegendVisibility() {
    // The score-legend filter chips spotlight individual DAYS by score, so
    // they (and their status line) only make sense in Day mode.
    const dayMode = state.mode === "day";
    if (els.legend) els.legend.hidden = !dayMode;
    if (els.filterStatus && !dayMode) els.filterStatus.hidden = true;
  }

  async function setMode(newMode) {
    if (newMode === state.mode) return;
    await autoSaveNoteIfDirty(); // flush whatever's dirty under the OLD mode/key first
    state.mode = newMode;
    if (els.modeSelect) els.modeSelect.value = newMode;
    if (newMode !== "day" && state.filterScore != null) {
      state.filterScore = null; // the day-score filter only applies in Day mode
      renderLegend();
    }
    updateLegendVisibility();
    renderAll();
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
    const highlightMonthTarget = state.mode === "month";
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
      if (highlightMonthTarget && inMonth) cell.classList.add("day-cell-month-target");
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

      cell.addEventListener("click", async () => {
        // Clicking a day always means "look at this day" — if a Month/Year
        // rating was showing, switch back to Day mode first so the side
        // panel actually reflects the day just clicked.
        if (state.mode !== "day") await setMode("day");
        selectDate(dateStr);
      });
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
    const entry = currentEntry();
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
        await setCurrentScore(next);
        renderScoreButtons();
        if (state.mode === "day") renderMonthGrid();
      });
      els.scoreButtons.appendChild(b);
    }
  }

  function renderEditor() {
    const key = currentKey();
    els.editorDate.textContent = editorTitleFor(state.mode, key);
    renderScoreButtons();

    const entry = currentEntry();
    els.noteField.value = entry && entry.note ? entry.note : "";
    els.noteField.placeholder = notePlaceholderFor(state.mode);
    els.noteStatus.textContent = "";
    if (els.btnClearDay) els.btnClearDay.textContent = clearLabelFor(state.mode);
    if (els.editorPanel) els.editorPanel.setAttribute("aria-label", ariaLabelFor(state.mode));
  }

  /**
   * If the note field has unsaved edits for whatever the side panel is
   * currently bound to (a day, a month, or a year — see "mode" above),
   * save them before we navigate/switch away — so nothing typed is ever
   * silently dropped.
   */
  async function autoSaveNoteIfDirty() {
    if (!els.noteField) return;
    const mode = state.mode;
    const key = currentKey();
    if (key == null) return;
    const entry = currentEntry();
    const storedNote = entry && entry.note ? entry.note : "";
    const currentValue = els.noteField.value;
    if (currentValue === storedNote) return; // nothing to do
    // No status text here: we're navigating away, so the "Saved" message
    // would belong to a side panel the user is no longer looking at. The
    // flash (triggered inside saveNoteFor) is the feedback.
    await saveNoteFor(mode, key, currentValue, { showStatus: false });
  }

  /** Shared by the "Save note" button and the switch-away autosave above. */
  async function saveNoteFor(mode, key, text, opts) {
    opts = opts || {};
    const showStatus = opts.showStatus !== false;
    if (mode === "month") await App.storage.setMonthNote(key, text);
    else if (mode === "year") await App.storage.setYearNote(key, text);
    else await App.storage.setNote(key, text);

    if (mode === "day") renderMonthGrid(); // day note-mark on the grid only applies to Day mode
    flashNoteSaved();
    if (showStatus && mode === state.mode && key === currentKey()) {
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

  async function goPrevMonth() {
    await autoSaveNoteIfDirty();
    if (state.filterScore != null) {
      const months = monthsWithScore(state.filterScore);
      const prevKey = prevMatchingMonthKey(months, monthKeyOf(state.viewDate));
      if (!prevKey) return; // nothing further back with this score — stay put
      state.viewDate = monthKeyToDate(prevKey);
    } else {
      state.viewDate = du.addMonths(state.viewDate, -1);
    }
    renderMonthGrid();
    if (state.mode !== "day") renderEditor(); // Month mode's target follows the visible month
  }

  async function goNextMonth() {
    await autoSaveNoteIfDirty();
    if (state.filterScore != null) {
      const months = monthsWithScore(state.filterScore);
      const nextKey = nextMatchingMonthKey(months, monthKeyOf(state.viewDate));
      if (!nextKey) return; // nothing further ahead with this score — stay put
      state.viewDate = monthKeyToDate(nextKey);
    } else {
      state.viewDate = du.addMonths(state.viewDate, 1);
    }
    renderMonthGrid();
    if (state.mode !== "day") renderEditor();
  }

  /** Year mode: ‹ / › (and Shift+←/→) step a whole year at a time instead. */
  async function goPrevYear() {
    await autoSaveNoteIfDirty();
    state.viewDate = du.addYears(state.viewDate, -1);
    renderMonthGrid();
    renderEditor();
  }

  async function goNextYear() {
    await autoSaveNoteIfDirty();
    state.viewDate = du.addYears(state.viewDate, 1);
    renderMonthGrid();
    renderEditor();
  }

  /** ‹ / › and Shift+←/→ both go through here so they follow the active mode. */
  function goPrev() {
    return state.mode === "year" ? goPrevYear() : goPrevMonth();
  }

  function goNext() {
    return state.mode === "year" ? goNextYear() : goNextMonth();
  }

  function goToday() {
    return selectDate(du.toDateStr(new Date()));
  }

  function renderAll() {
    renderMonthGrid();
    renderEditor();
  }

  function saveNote() {
    return saveNoteFor(state.mode, currentKey(), els.noteField.value);
  }

  async function clearCurrent() {
    const mode = state.mode;
    const key = currentKey();
    if (mode === "month") await App.storage.clearMonth(key);
    else if (mode === "year") await App.storage.clearYear(key);
    else await App.storage.clearDay(key);
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
      if (dir > 0) goNext();
      else goPrev();
    } else {
      const next = du.addDays(du.parseDateStr(state.selectedDateStr), dir);
      selectDate(du.toDateStr(next));
    }
  }

  function init() {
    cacheEls();
    renderWeekdayRow();
    renderLegend();
    updateLegendVisibility();

    els.btnPrev.addEventListener("click", goPrev);
    els.btnNext.addEventListener("click", goNext);
    els.btnToday.addEventListener("click", goToday);
    els.btnSaveNote.addEventListener("click", saveNote);
    els.btnClearDay.addEventListener("click", clearCurrent);
    els.goToDateInput.addEventListener("change", () => goToDate(els.goToDateInput.value));
    if (els.modeSelect) {
      els.modeSelect.addEventListener("change", () => setMode(els.modeSelect.value));
    }
    document.addEventListener("keydown", handleGlobalKeydown);

    state.viewDate = du.startOfMonth(new Date());
    state.selectedDateStr = du.toDateStr(new Date());
    state.filterScore = null;
    state.mode = "day";
    if (els.modeSelect) els.modeSelect.value = "day";
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
