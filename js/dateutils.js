/*
 * dateutils.js
 * ------------
 * Small collection of date helpers shared by calendar.js, stats.js and
 * search.js. Dates are represented two ways throughout the app:
 *   - a JS Date object set to local midnight
 *   - a "YYYY-MM-DD" string (always local calendar date, never UTC-shifted)
 * All week calculations use Monday as the first day of the week.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseDateStr(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function atMidnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, n) {
    const d = atMidnight(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = atMidnight(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  function addYears(date, n) {
    const d = atMidnight(date);
    d.setFullYear(d.getFullYear() + n);
    return d;
  }

  // Monday = 0 ... Sunday = 6
  function isoWeekday(date) {
    return (date.getDay() + 6) % 7;
  }

  function startOfWeek(date) {
    return addDays(date, -isoWeekday(date));
  }

  function endOfWeek(date) {
    return addDays(startOfWeek(date), 6);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1);
  }

  function endOfYear(date) {
    return new Date(date.getFullYear(), 11, 31);
  }

  function isSameDay(a, b) {
    return toDateStr(a) === toDateStr(b);
  }

  /** Inclusive list of "YYYY-MM-DD" strings from start to end. */
  function dateStrRange(start, end) {
    const out = [];
    let cur = atMidnight(start);
    const last = atMidnight(end);
    while (cur <= last) {
      out.push(toDateStr(cur));
      cur = addDays(cur, 1);
    }
    return out;
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function formatHuman(date) {
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatMonthYear(date) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  }

  App.dateutils = {
    MONTH_NAMES,
    WEEKDAY_NAMES_SHORT,
    pad2,
    toDateStr,
    parseDateStr,
    atMidnight,
    addDays,
    addMonths,
    addYears,
    isoWeekday,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    startOfYear,
    endOfYear,
    isSameDay,
    dateStrRange,
    formatHuman,
    formatMonthYear,
  };
})();
