const { chromium } = require("playwright");
const path = require("path");
const assert = require("assert");

(async () => {
  // executablePath is only needed in the dev sandbox used to build this app;
  // on a normal machine with `npm i playwright && npx playwright install`
  // you can drop the executablePath option entirely.
  const launchOpts = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.stack || err.message}`));

  // Force fallback (non-FSA) mode so the whole flow is automatable headlessly:
  // real showOpenFilePicker/showSaveFilePicker require a native OS dialog.
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });

  const url = "file://" + path.join(__dirname, "..", "index.html");
  await page.goto(url);

  // --- load screen shows fallback path -------------------------------
  await page.waitForSelector("#fallbackButtons:not([hidden])", { timeout: 5000 });
  assert.strictEqual(await page.isHidden("#fsaButtons"), true, "fsaButtons should be hidden in fallback mode");
  console.log("PASS: load screen shows fallback UI when FSA unsupported");

  // --- drag & drop a data file onto the load screen ---------------------
  assert.strictEqual(await page.isHidden("#dropzone"), false, "dropzone should be visible on the load screen");
  await page.evaluate(() => {
    const data = { schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), days: {} };
    const file = new File([JSON.stringify(data)], "dropped-sample.json", { type: "application/json" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = document.getElementById("dropzone");
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    zone.dispatchEvent(new DragEvent("dragenter", opts));
    zone.dispatchEvent(new DragEvent("dragover", opts));
    zone.dispatchEvent(new DragEvent("drop", opts));
  });
  await page.waitForSelector("#app:not([hidden])");
  const droppedFileName = await page.textContent("#fileName");
  assert.strictEqual(droppedFileName, "dropped-sample.json", "header should show the dropped file's name");
  console.log("PASS: dropping a file on the load screen opens it");

  // switch back to the load screen and use the normal "new file" button for the rest of the run
  await page.click("#btnSwitchFile");
  await page.waitForSelector("#fallbackButtons:not([hidden])");
  await page.click("#btnNewFallback");
  await page.waitForSelector("#app:not([hidden])");
  console.log("PASS: app becomes visible after creating a new fallback file");

  // --- set a score on "today" (selected by default) --------------------
  const scoreButtons = await page.$$("#scoreButtons .score-btn");
  assert.strictEqual(scoreButtons.length, 7, "expected 7 score buttons (0-6)");
  await scoreButtons[5].click(); // score = 5
  await page.waitForTimeout(50);
  const activeScoreText = await page.$eval("#scoreButtons .score-btn.active", (el) => el.textContent);
  assert.strictEqual(activeScoreText, "5", "score button 5 should be active after click");
  console.log("PASS: clicking a score button marks it active");

  // score dot should now appear on the selected day cell in the calendar
  const todayStr = await page.evaluate(() => App.dateutils.toDateStr(new Date()));
  const dotText = await page.$eval(`.day-cell[data-date="${todayStr}"] .day-score-dot`, (el) => el.textContent);
  assert.strictEqual(dotText, "5", "calendar cell should show the score dot");
  console.log("PASS: calendar cell reflects the saved score");

  // --- write + save a note ---------------------------------------------
  const noteText = "Had a really productive day working on the tracker app.";
  await page.fill("#noteField", noteText);
  await page.click("#btnSaveNote");
  await page.waitForSelector("#noteStatus:has-text(\"Saved\")");
  console.log("PASS: note save shows confirmation");

  const flashedAfterManualSave = await page.evaluate(() =>
    document.getElementById("noteBlock").classList.contains("note-flash")
  );
  assert.ok(flashedAfterManualSave, "note block should get the flash class right after a manual save");
  console.log("PASS: note block plays the save flash effect on manual save");

  const noteMarkExists = await page.$(`.day-cell[data-date="${todayStr}"] .day-note-mark`);
  assert.ok(noteMarkExists, "calendar cell should show a note marker");
  console.log("PASS: calendar cell shows note marker");

  // --- switching days auto-saves an unsaved note edit --------------------
  const neighborDateStr = await page.evaluate(() => {
    const d = App.dateutils.addDays(new Date(), 1);
    return App.dateutils.toDateStr(d);
  });
  await page.evaluate((ds) => App.calendar.selectDate(ds), neighborDateStr); // navigate to a blank day first
  await page.waitForTimeout(50);

  const autosaveNoteText = "This note was never explicitly saved.";
  await page.fill("#noteField", autosaveNoteText);
  await page.evaluate((ds) => App.calendar.selectDate(ds), todayStr); // switch away without clicking "Save note"
  await page.waitForTimeout(50);

  const autoSavedNote = await page.evaluate(
    (ds) => (App.storage.getDay(ds) || {}).note,
    neighborDateStr
  );
  assert.strictEqual(autoSavedNote, autosaveNoteText, "switching days should auto-save the previous day's unsaved note");
  console.log("PASS: switching to a different day auto-saves the note you were editing");

  const flashedAfterAutosave = await page.evaluate(() =>
    document.getElementById("noteBlock").classList.contains("note-flash")
  );
  assert.ok(flashedAfterAutosave, "note block should get the flash class right after an autosave-on-switch");
  console.log("PASS: note block plays the save flash effect after an autosave-on-switch");

  const todaysNoteUnaffected = await page.inputValue("#noteField");
  assert.strictEqual(todaysNoteUnaffected, noteText, "today's own note should be untouched by the neighboring day's autosave");
  console.log("PASS: autosaving a different day doesn't touch the day switched to");

  // --- "go to date" jumps the calendar + editor to an arbitrary date ----
  const targetDateStr = await page.evaluate(() => {
    const d = App.dateutils.addMonths(new Date(), 2);
    return App.dateutils.toDateStr(d);
  });
  await page.fill("#goToDateInput", targetDateStr);
  await page.dispatchEvent("#goToDateInput", "change");
  await page.waitForTimeout(50);
  const editorDateAfterGoTo = await page.textContent("#editorDate");
  const expectedHuman = await page.evaluate(
    (ds) => App.dateutils.formatHuman(App.dateutils.parseDateStr(ds)),
    targetDateStr
  );
  assert.strictEqual(editorDateAfterGoTo, expectedHuman, "editor should show the date jumped to");
  const selectedCell = await page.$(`.day-cell.day-cell-selected[data-date="${targetDateStr}"]`);
  assert.ok(selectedCell, "calendar should have the jumped-to date selected");
  console.log("PASS: \"go to date\" jumps the calendar and editor to the chosen date");

  // jump back to today so the rest of the test operates on today's entry
  await page.evaluate(() => App.calendar.goToDate(App.dateutils.toDateStr(new Date())));
  await page.waitForTimeout(50);

  // --- arrow keys: Left/Right change the day, Shift+Left/Right change month
  await page.click("#calendarTitle"); // move focus off any input first
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(30);
  let selectedCellDate = await page.$eval(".day-cell-selected", (el) => el.dataset.date);
  let expected = await page.evaluate(
    (ds) => App.dateutils.toDateStr(App.dateutils.addDays(App.dateutils.parseDateStr(ds), 1)),
    todayStr
  );
  assert.strictEqual(selectedCellDate, expected, "ArrowRight should select the next day");

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(30);
  selectedCellDate = await page.$eval(".day-cell-selected", (el) => el.dataset.date);
  expected = await page.evaluate(
    (ds) => App.dateutils.toDateStr(App.dateutils.addDays(App.dateutils.parseDateStr(ds), -1)),
    todayStr
  );
  assert.strictEqual(selectedCellDate, expected, "two ArrowLeft presses after one ArrowRight should net one day back");
  console.log("PASS: Left/Right arrow keys change the selected day");

  await page.evaluate((ds) => App.calendar.goToDate(ds), todayStr); // clean baseline
  await page.waitForTimeout(30);

  const editorDateBeforeShift = await page.textContent("#editorDate");
  const monthTitleBeforeShift = await page.textContent("#calendarTitle");
  await page.click("#calendarTitle");
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(30);
  const monthTitleAfterShiftRight = await page.textContent("#calendarTitle");
  const editorDateAfterShiftRight = await page.textContent("#editorDate");
  assert.notStrictEqual(monthTitleAfterShiftRight, monthTitleBeforeShift, "Shift+ArrowRight should change the visible month");
  assert.strictEqual(
    editorDateAfterShiftRight,
    editorDateBeforeShift,
    "Shift+ArrowRight should not change which day is selected, only the visible month"
  );
  console.log("PASS: Shift+ArrowRight changes the visible month without changing the selected day");

  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(30);
  const monthTitleAfterShiftLeft = await page.textContent("#calendarTitle");
  assert.strictEqual(monthTitleAfterShiftLeft, monthTitleBeforeShift, "Shift+ArrowLeft should return to the original month");
  console.log("PASS: Shift+ArrowLeft changes the visible month back");

  // arrow keys must keep their native (cursor-moving) behavior while typing
  await page.click("#noteField");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(30);
  const editorDateAfterTypingArrow = await page.textContent("#editorDate");
  assert.strictEqual(
    editorDateAfterTypingArrow,
    editorDateBeforeShift,
    "arrow keys while focused in the note field must not change the selected day"
  );
  console.log("PASS: arrow keys inside the note field keep their normal text-editing behavior, not calendar navigation");

  // --- note textarea height roughly matches the calendar panel's height -
  const heights = await page.evaluate(() => ({
    calendar: document.querySelector(".calendar-panel").getBoundingClientRect().height,
    sidePanel: document.querySelector(".side-panel").getBoundingClientRect().height,
    noteField: document.getElementById("noteField").getBoundingClientRect().height,
  }));
  assert.ok(
    Math.abs(heights.calendar - heights.sidePanel) < 2,
    `side panel (${heights.sidePanel}px) should match calendar panel height (${heights.calendar}px)`
  );
  assert.ok(heights.noteField > 140, `note field should have grown taller than its old fixed size, got ${heights.noteField}px`);
  console.log("PASS: note field stretches to match the calendar section's height");

  // --- stats panel: current month should now report 1 scored day -------
  const statValues = await page.$$eval(".stat-card .stat-value", (els) => els.map((e) => e.textContent));
  assert.ok(statValues[0].startsWith("1 / "), `expected "1 / N" days-scored stat, got "${statValues[0]}"`);
  assert.strictEqual(statValues[1], "5.00", `expected average 5.00, got "${statValues[1]}"`);
  assert.strictEqual(statValues[2], "5", `expected sum 5, got "${statValues[2]}"`);
  assert.strictEqual(statValues[3], "5", `expected min 5, got "${statValues[3]}"`);
  assert.strictEqual(statValues[4], "5", `expected max 5, got "${statValues[4]}"`);
  console.log("PASS: stats panel computes count/avg/sum/min/max correctly for month period");

  // switch stats period to "Year" and re-check count still includes today
  await page.click("#statsPeriodControls .btn-toggle:has-text(\"Year\")");
  await page.waitForTimeout(50);
  const yearStatValues = await page.$$eval(".stat-card .stat-value", (els) => els.map((e) => e.textContent));
  assert.ok(yearStatValues[0].startsWith("1 / "), "year period should still include today's score");
  console.log("PASS: stats period switching (Year) recomputes correctly");

  // --- search panel: find the note we just saved ------------------------
  await page.fill("#searchInput", "productive");
  await page.waitForTimeout(50);
  const resultCount = await page.$$eval(".search-result", (els) => els.length);
  assert.strictEqual(resultCount, 1, "expected exactly 1 search result for 'productive'");
  const snippetHtml = await page.$eval(".search-result-snippet", (el) => el.innerHTML);
  assert.ok(snippetHtml.includes("<mark>productive</mark>"), "matched term should be highlighted");
  console.log("PASS: search finds note and highlights the match");

  // search with a non-matching term
  await page.fill("#searchInput", "zzz_no_match_zzz");
  await page.waitForTimeout(50);
  const noResultCount = await page.$$eval(".search-result", (els) => els.length);
  assert.strictEqual(noResultCount, 0, "expected 0 results for a non-matching query");
  console.log("PASS: search correctly returns zero results for non-matching query");

  // restrict search to a custom period that excludes today -> should find nothing
  await page.fill("#searchInput", "productive");
  await page.click("#searchPeriodControls .btn-toggle:has-text(\"Custom\")");
  const yesterday = await page.evaluate(() => {
    const d = App.dateutils.addDays(new Date(), -10);
    return App.dateutils.toDateStr(d);
  });
  const twoWeeksAgo = await page.evaluate(() => {
    const d = App.dateutils.addDays(new Date(), -20);
    return App.dateutils.toDateStr(d);
  });
  const dateInputs = await page.$$("#searchPeriodControls .period-date-input");
  await dateInputs[0].fill(twoWeeksAgo);
  await dateInputs[1].fill(yesterday);
  await page.waitForTimeout(50);
  const excludedCount = await page.$$eval(".search-result", (els) => els.length);
  assert.strictEqual(excludedCount, 0, "custom range excluding today should return 0 results");
  console.log("PASS: search respects custom period filter");

  // --- clear the day and confirm calendar/stat reflect it ---------------
  await dateInputs[0].fill(twoWeeksAgo); // no-op, just to be safe before clearing
  await page.click("#btnClearDay");
  await page.waitForTimeout(50);
  const dotAfterClear = await page.$(`.day-cell[data-date="${todayStr}"] .day-score-dot`);
  assert.strictEqual(dotAfterClear, null, "score dot should be gone after clearing the day");
  console.log("PASS: clearing a day removes its score/note from the calendar");

  // --- score-legend filter: click a chip to spotlight only that score ---
  // Seed score 4 on today and two months from now (skipping the month in
  // between, which gets nothing) so the "skip empty months" behavior of
  // Prev/Next while filtered can be verified against a known gap.
  const filterMonthA = todayStr; // today already has no score (cleared above)
  const filterMonthCDate = await page.evaluate(() => {
    const d = App.dateutils.addMonths(new Date(), 2);
    return App.dateutils.toDateStr(d);
  });
  await page.evaluate(
    async ({ a, c }) => {
      await App.storage.setScore(a, 4);
      await App.storage.setScore(c, 4);
    },
    { a: filterMonthA, c: filterMonthCDate }
  );
  await page.evaluate(() => App.calendar.goToDate(App.dateutils.toDateStr(new Date())));
  await page.waitForTimeout(50);
  await page.evaluate(() => App.calendar.renderAll());
  await page.waitForTimeout(30);

  const legendChips = await page.$$(".legend-chip");
  assert.strictEqual(legendChips.length, 7, "expected 7 legend chips (scores 0-6)");
  await legendChips[4].click(); // score 4
  await page.waitForTimeout(30);

  const chipActive = await page.$eval(".legend-chip-active", (el) => el.textContent);
  assert.strictEqual(chipActive, "4", "clicked chip should become the active filter chip");

  const matchingCellVisible = await page.$eval(
    `.day-cell[data-date="${filterMonthA}"] .day-num`,
    (el) => el.textContent.length > 0
  );
  assert.ok(matchingCellVisible, "day matching the active filter should still show its day number");

  const filteredOutCells = await page.$$(".day-cell-filtered");
  assert.ok(filteredOutCells.length > 0, "non-matching days should get the day-cell-filtered class");
  const someFilteredCellBlank = await page.evaluate(() => {
    const cell = document.querySelector(".day-cell-filtered:not(.day-cell-outside)");
    return cell ? cell.querySelector(".day-num") === null : null;
  });
  assert.strictEqual(someFilteredCellBlank, true, "a filtered-out in-month cell should have its day number blanked");
  console.log("PASS: clicking a legend chip filters the calendar to that score, blanking non-matching cells");

  const filterStatusText = await page.textContent("#filterStatus");
  assert.ok(filterStatusText.includes("scored 4"), `filter status should mention the active score, got "${filterStatusText}"`);
  assert.ok(filterStatusText.includes("1"), `filter status should report 1 match this month, got "${filterStatusText}"`);
  console.log("PASS: filter status message reports the match count for the active month");

  // --- Next month while filtered should skip the empty month in between -
  const monthTitleAtFilterStart = await page.textContent("#calendarTitle");
  await page.click("#btnNextMonth");
  await page.waitForTimeout(30);
  const monthTitleAfterFilteredNext = await page.textContent("#calendarTitle");
  assert.notStrictEqual(monthTitleAfterFilteredNext, monthTitleAtFilterStart, "filtered Next should move the month");
  const cellForC = await page.$(`.day-cell[data-date="${filterMonthCDate}"]:not(.day-cell-filtered)`);
  assert.ok(cellForC, "filtered Next month should land directly on the next month that has a matching score");
  const filterStatusAfterNext = await page.textContent("#filterStatus");
  assert.ok(filterStatusAfterNext.includes("1"), "landed month should report its 1 matching day");
  console.log("PASS: Next month navigation skips empty months/years while a score filter is active");

  await page.click("#btnPrevMonth");
  await page.waitForTimeout(30);
  const monthTitleAfterFilteredPrev = await page.textContent("#calendarTitle");
  assert.strictEqual(monthTitleAfterFilteredPrev, monthTitleAtFilterStart, "filtered Prev should jump back to the original matching month");
  console.log("PASS: Prev month navigation skips back over empty months while a score filter is active");

  // --- clicking the active chip again clears the filter ------------------
  // Re-query: renderLegend() rebuilds the chip buttons on every render, so
  // the earlier handles are stale after the month navigation above.
  const legendChipsAfterNav = await page.$$(".legend-chip");
  await legendChipsAfterNav[4].click();
  await page.waitForTimeout(30);
  const noActiveChip = await page.$(".legend-chip-active");
  assert.strictEqual(noActiveChip, null, "no chip should be active after clicking it a second time");
  const filterStatusHiddenAfterClear = await page.isHidden("#filterStatus");
  assert.strictEqual(filterStatusHiddenAfterClear, true, "filter status should be hidden once the filter is cleared");
  const noFilteredCellsLeft = await page.$$eval(".day-cell-filtered", (els) => els.length);
  assert.strictEqual(noFilteredCellsLeft, 0, "no cells should carry day-cell-filtered once the filter is cleared");
  console.log("PASS: clicking the active chip again clears the filter and restores all cells");

  // clean up the seeded score-4 entries so they don't affect stats/search below
  await page.evaluate(
    async ({ a, c }) => {
      await App.storage.clearDay(a);
      await App.storage.clearDay(c);
    },
    { a: filterMonthA, c: filterMonthCDate }
  );
  await page.evaluate(() => App.calendar.renderAll());
  await page.waitForTimeout(30);

  // --- save & download produces valid JSON matching the schema ----------
  await page.click("#scoreButtons .score-btn:nth-child(3)"); // score = 2, to have something to export
  await page.fill("#noteField", "Export check.");
  await page.click("#btnSaveNote");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btnSaveNow")]);
  const downloadPath = await download.path();
  const fs = require("fs");
  const exported = JSON.parse(fs.readFileSync(downloadPath, "utf8"));
  assert.strictEqual(exported.schemaVersion, 1);
  assert.ok(exported.days[todayStr], "exported JSON should contain today's entry");
  assert.strictEqual(exported.days[todayStr].score, 2);
  assert.strictEqual(exported.days[todayStr].note, "Export check.");
  console.log("PASS: Save & Download produces a valid, schema-correct JSON file");

  if (logs.length) {
    console.log("\n--- console/page logs during run ---");
    logs.forEach((l) => console.log(l));
  }

  await browser.close();
  console.log("\nALL SMOKE TESTS PASSED");
})().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
