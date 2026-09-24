/*
 * period.js
 * ---------
 * Reusable "period picker" used by both the stats panel and the search
 * panel: Week / Month / Year / Custom range, with prev/next navigation
 * for the first three and two date inputs for Custom.
 *
 * Usage:
 *   const picker = App.period.create(containerEl, {
 *     onChange(range) { ... }   // range = { start: Date, end: Date, label: string }
 *   });
 *   picker.getRange()
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});
  const du = App.dateutils;

  function computeRange(mode, anchor, customStart, customEnd) {
    switch (mode) {
      case "week":
        return {
          start: du.startOfWeek(anchor),
          end: du.endOfWeek(anchor),
          label: `Week of ${du.formatHuman(du.startOfWeek(anchor))}`,
        };
      case "month":
        return {
          start: du.startOfMonth(anchor),
          end: du.endOfMonth(anchor),
          label: du.formatMonthYear(anchor),
        };
      case "year":
        return {
          start: du.startOfYear(anchor),
          end: du.endOfYear(anchor),
          label: String(anchor.getFullYear()),
        };
      case "all":
        return {
          start: new Date(1970, 0, 1),
          end: new Date(2999, 11, 31),
          label: "All time",
        };
      case "custom":
      default: {
        const s = customStart || du.startOfMonth(anchor);
        const e = customEnd || du.endOfMonth(anchor);
        const start = s <= e ? s : e;
        const end = s <= e ? e : s;
        return { start, end, label: `${du.formatHuman(start)} – ${du.formatHuman(end)}` };
      }
    }
  }

  const ALL_MODE_DEFS = [
    ["week", "Week"],
    ["month", "Month"],
    ["year", "Year"],
    ["custom", "Custom"],
    ["all", "All time"],
  ];

  function create(container, opts) {
    opts = opts || {};
    const enabledKeys = opts.modes || ["week", "month", "year", "custom"];
    const MODES = ALL_MODE_DEFS.filter(([key]) => enabledKeys.includes(key));

    const state = {
      mode: opts.defaultMode || MODES[0][0],
      anchor: du.atMidnight(new Date()),
      customStart: du.addDays(du.atMidnight(new Date()), -6),
      customEnd: du.atMidnight(new Date()),
    };
    let labelEl = null;

    const modeRow = document.createElement("div");
    modeRow.className = "period-modes";
    const navRow = document.createElement("div");
    navRow.className = "period-nav";
    container.appendChild(modeRow);
    container.appendChild(navRow);

    const modeButtons = {};
    MODES.forEach(([key, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-toggle";
      b.textContent = label;
      b.addEventListener("click", () => {
        state.mode = key;
        renderNav();
        emit();
      });
      modeButtons[key] = b;
      modeRow.appendChild(b);
    });

    function updateModeButtonStyles() {
      MODES.forEach(([key]) => {
        modeButtons[key].classList.toggle("active", state.mode === key);
      });
    }

    function renderNav() {
      updateModeButtonStyles();
      navRow.innerHTML = "";

      if (state.mode === "custom") {
        const startInput = document.createElement("input");
        startInput.type = "date";
        startInput.value = du.toDateStr(state.customStart);
        startInput.className = "period-date-input";
        startInput.addEventListener("change", () => {
          if (startInput.value) state.customStart = du.parseDateStr(startInput.value);
          emit();
        });

        const dash = document.createElement("span");
        dash.className = "period-dash";
        dash.textContent = "to";

        const endInput = document.createElement("input");
        endInput.type = "date";
        endInput.value = du.toDateStr(state.customEnd);
        endInput.className = "period-date-input";
        endInput.addEventListener("change", () => {
          if (endInput.value) state.customEnd = du.parseDateStr(endInput.value);
          emit();
        });

        navRow.appendChild(startInput);
        navRow.appendChild(dash);
        navRow.appendChild(endInput);
        return;
      }

      if (state.mode === "all") {
        const label = document.createElement("span");
        label.className = "period-label";
        label.textContent = "All time";
        navRow.appendChild(label);
        labelEl = label;
        return;
      }

      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "btn btn-icon";
      prev.setAttribute("aria-label", "Previous " + state.mode);
      prev.textContent = "‹";
      prev.addEventListener("click", () => {
        step(-1);
      });

      const label = document.createElement("span");
      label.className = "period-label";

      const next = document.createElement("button");
      next.type = "button";
      next.className = "btn btn-icon";
      next.setAttribute("aria-label", "Next " + state.mode);
      next.textContent = "›";
      next.addEventListener("click", () => {
        step(1);
      });

      const todayBtn = document.createElement("button");
      todayBtn.type = "button";
      todayBtn.className = "btn btn-ghost btn-small";
      todayBtn.textContent = "Current";
      todayBtn.addEventListener("click", () => {
        state.anchor = du.atMidnight(new Date());
        emit();
      });

      navRow.appendChild(prev);
      navRow.appendChild(label);
      navRow.appendChild(next);
      navRow.appendChild(todayBtn);

      labelEl = label;
    }

    function step(dir) {
      if (state.mode === "week") state.anchor = du.addDays(state.anchor, 7 * dir);
      else if (state.mode === "month") state.anchor = du.addMonths(state.anchor, dir);
      else if (state.mode === "year") state.anchor = du.addYears(state.anchor, dir);
      emit();
    }

    function emit() {
      const range = computeRange(state.mode, state.anchor, state.customStart, state.customEnd);
      if (labelEl) labelEl.textContent = range.label;
      if (opts.onChange) opts.onChange(range);
    }

    renderNav();
    emit();

    return {
      getRange() {
        return computeRange(state.mode, state.anchor, state.customStart, state.customEnd);
      },
    };
  }

  App.period = { create };
})();
