# Day Tracker — project notes

A local, single-user calendar app for tracking a daily score (0–6) and a
note per day, with simple statistics over time periods and note search.
Pure HTML/CSS/JS, no build step, no backend, no analytics, nothing phoned
home. Data lives in one JSON file on your computer.

## How to run it

Just open `index.html` in **Chrome or Edge** (double-click it, or drag it
into the browser). That's it — no server, no install step.

On first load you'll be asked to either **open an existing data file** or
**create a new one**. Pick a location/name (e.g. `day-tracker-data.json`)
and you're in.

Firefox and Safari don't support the API this app uses to write files
directly to disk, so they get an automatic **compatibility mode** instead
(see below) — the app still works, just with one extra manual step per
save.

## How storage actually works (read this before changing it)

This was a deliberate, discussed design choice — not a default:

- **The JSON file is the real database**, not a backup/export. There is a
  `days` object keyed by `YYYY-MM-DD`, and that's the whole "table".
- **Score/note data is never written to `localStorage`, `sessionStorage`,
  or IndexedDB.** All of it lives in plain JS variables in memory
  (`App.storage.state` in `js/storage.js`). Close the tab/window and it's
  gone — by design: the JSON file on disk is still the only real copy.
  Two deliberate, UI-only exceptions — remembering your project *folder*,
  and remembering the last data *file* you opened — are explained just
  below; neither one stores any score/note data itself.
- Every time you change a score, click **Save note**, or switch to a
  different day while a note has unsaved edits (auto-save — see Features
  below), the app writes the *entire* JSON file back to disk immediately.
  There's no separate "sync" step.

### Primary mode: File System Access API (Chrome / Edge)

`js/storage.js` uses `window.showOpenFilePicker` / `showSaveFilePicker` to
get a real, persistent handle to a file on your disk (`FileSystemFileHandle`),
then writes to it directly with `handle.createWritable()`. This works even
when `index.html` is opened straight from disk via `file://` — no local
server needed. Every file opened/created this way (and every file dropped
onto the load screen with a live handle) is also remembered as the "last
data file" — see **"Open last data file"** below — so in practice you only
go through Open/Create's own picker again when you actually want a
*different* file; picking up where you left off is one click.

### Fallback mode: any other browser

Feature-detected automatically (`App.storage.supportsFSA()`). You import a
JSON file via a normal `<input type="file">` (or by dropping it — see
below), work in memory, and click **Save & Download** to get an updated
file — which you then manually overwrite the original with. The header
shows "Unsaved changes" whenever there's something not yet downloaded, and
the app will warn you before you close the tab with unsaved changes. This
is a genuine browser limitation (these browsers don't expose a
write-capable file API to web pages), not something we can work around
from inside the page.

### Jumping straight to a folder you use often

Three complementary mechanisms, all in `js/storage.js`, none of which
creates or assumes any particular subfolder — you point them wherever you
actually keep your data:

- **Picker memory (automatic, zero setup, browser-native).** Every
  open/create call passes `id: "day-tracker-diaries"` to
  `showOpenFilePicker`/`showSaveFilePicker`. Chrome/Edge remember the last
  folder used for a given `id` and reopen there next time — so once
  you've manually navigated into wherever you keep your data file once,
  every later open/create starts there automatically. This is entirely
  the browser's own picker history; our code never sees or stores it.
- **"Set project folder…" (immediate, and remembered — see below).** The
  load screen has a button that calls `App.storage.setProjectFolder()`,
  which opens a directory picker and holds the chosen
  `FileSystemDirectoryHandle` in memory as `state.projectDirHandle`.
  Every open/create for the rest of that session passes it as `startIn`,
  so the picker opens exactly there — no "already visited once"
  requirement, and it doesn't touch the filesystem or create anything.
- **Remembering that folder across browser restarts.** This was the gap
  reported and fixed: closing the browser used to lose the project folder
  entirely (it only lived in a JS variable), so every reopen meant
  re-picking the folder before Open/Create was convenient again. A real
  filesystem path can't be stored and reused later — the File System
  Access API deliberately never exposes one to a page, by design, for
  security — so instead `setProjectFolder()` also saves the
  `FileSystemDirectoryHandle` **object itself** into IndexedDB
  (`idbSet`/`idbGet`/`idbDelete` near the top of `js/storage.js`; Chromium
  can structured-clone a real `FileSystemHandle`, unlike a plain mock
  object — see the comment in `tests/persistence-test.js` for why that
  distinction actually matters). On every load,
  `tryRestoreProjectFolder()` looks for that saved handle and:
  - if permission on it is still granted (the common case), it's wired up
    immediately — Open/Create just works, nothing to click;
  - if the browser wants a fresh permission grant (can happen after a full
    restart, browser-version-dependent), the load screen shows a single
    **"Reconnect \"‹folder›\"…"** button — one click, no folder-picker
    dialog, no re-navigating;
  - **"Forget remembered folder"** clears it from IndexedDB and resets the
    UI, for when you want to point somewhere else or stop remembering
    entirely.

  This is one of two deliberate exceptions to "no browser storage" in this
  app: it stores a folder *handle* (a UI convenience), never any
  score/note data, and it's fully optional and clearable.

There's no way for a `file://` page to know its own containing folder, so
none of this can be "automatic on the very first-ever run ever" — some
first pick is unavoidable. After that, normal use is "picked once, then
it's just there" across reloads and restarts alike.

### "Open last data file" (remembering the file itself)

The second exception, added alongside the project-folder one and working
exactly the same way: every time a data file is opened or created via the
File System Access API (`openExistingFSA`, `createNewFSA`, or a
live-handle drag-and-drop via `openFromDroppedHandle`), its
`FileSystemFileHandle` is saved into IndexedDB
(`rememberLastFile()`/`checkLastFile()`/`openLastFile()` in
`js/storage.js`, right next to the project-folder helpers, same
`idbSet`/`idbGet` wrapper, different key). On every load,
`checkLastFile()` looks for it and, if found, the load screen shows an
**"Open last data file — "‹name›""** button above "Open existing data
file" (`js/main.js` → `initLastFileUI()`); clicking it calls
`openLastFile()`, which re-grants permission if needed (that's why it has
to happen inside the click handler — a user gesture is required) and
loads the file directly, with no picker dialog at all. It reappears
correctly after a full browser restart, exactly like the project folder
(re-granting permission silently when Chrome allows it, otherwise via the
same one-click flow). Switching to a *different* file (Open existing,
Create new, or drag-and-drop with a live handle) simply updates which
file is remembered as "last" — there's no separate "forget" control for
this one, since picking any other file already replaces it.

Like the project folder, this stores a file *handle* (a UI convenience for
getting back in quickly), never the file's contents — those are still
read fresh from disk every time, exactly as in the primary open flow.

### Drag & drop (load screen)

The load screen has a dropzone in addition to the Open/Create/Import
buttons. Drop a `.json` data file onto it:

- In Chrome/Edge, `DataTransferItem.getAsFileSystemHandle()` hands back a
  real, writable `FileSystemFileHandle` for a file dragged from a native
  file manager — so a dropped file gets full live read/write, exactly like
  one opened via the picker (`App.storage.openFromDroppedHandle`).
  Dragging a folder, or a browser that can't produce a handle, falls back
  to the next option.
- Otherwise, it's read via `DataTransferItem.getAsFile()` into
  compatibility mode, same as the fallback `<input type="file">` path.

### Alternatives considered, not built (reminders in case you change your mind)

These were the other two options on the table when we discussed storage.
Ask me to switch to one of these if the picker-every-time UX above gets
annoying, or if you need Firefox/Safari to also get live writes:

1. **Local server + live file-backed JSON (still via File System Access
   API).** Run something like `python -m http.server` in this folder and
   open the app via `http://localhost:8000` instead of `file://`. Behavior
   would be identical to the current primary mode — this only matters if
   `file://` + FSA ever turns out to be blocked in some browser/version;
   serving over `http://localhost` is the more "by the book" secure
   context for that API.
2. **Small Node.js backend (`server.js`).** A ~30-line Express or plain
   `http` server that reads/writes one JSON file on disk and serves the
   static files. Pros: works in *any* browser (Firefox, Safari included),
   no picker dance, could add multi-device access on a LAN. Cons: you'd
   need Node installed and a process running (`node server.js`) instead of
   just double-clicking a file.

## Data schema

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-15T18:32:00.000Z",
  "days": {
    "2026-09-15": {
      "score": 4,
      "note": "Good focus in the morning, slow afternoon.",
      "updatedAt": "2026-09-15T18:32:00.000Z"
    }
  },
  "months": {
    "2026-09": {
      "score": 5,
      "note": "Strong month, hit the big deadline.",
      "updatedAt": "2026-09-24T09:00:00.000Z"
    }
  },
  "years": {
    "2026": {
      "score": 4,
      "note": "Good year overall, rocky Q2.",
      "updatedAt": "2026-09-24T09:00:00.000Z"
    }
  }
}
```

- `days`, `months`, and `years` are three independent, sparse rating/note
  tables — a key only gets an entry once it has a score and/or a note;
  clearing both removes the key entirely. Rating a month or a year never
  reads or writes anything under `days`, and vice versa — see "Mode" under
  Features below.
- `days` is keyed `"YYYY-MM-DD"`, `months` is keyed `"YYYY-MM"`, `years` is
  keyed `"YYYY"` (a plain 4-digit year string).
- `score` is an integer 0–6 in all three tables, or omitted if the entry
  only has a note.
- Validated on load (`js/storage.js` → `validate()` /
  `validateKeyedScoreNoteMap()`); a malformed file shows an error on the
  load screen instead of silently corrupting data. Files saved before this
  feature existed simply have no `months`/`years` keys — they're defaulted
  to `{}` on load, no migration needed.

## File structure

```
day-tracker/
├── index.html          Markup only
├── css/
│   └── styles.css      All styling
├── js/
│   ├── dateutils.js     Date math shared by everything (Monday-start weeks)
│   ├── storage.js       Data model (days + months + years) + file I/O (FSA + fallback) + project-folder & last-file memory (IndexedDB)
│   ├── period.js        Reusable Week/Month/Year/Custom[/All time] picker
│   ├── calendar.js       Month grid + Day/Month/Year editor panel + score-legend filter
│   ├── stats.js          "Score operations" panel (avg/sum/min/max/distribution)
│   ├── search.js         Note search with period filter
│   └── main.js           Boots the app, wires the load screen, save status
├── tests/
│   ├── smoketest.js         Headless Playwright smoke test (see below)
│   └── persistence-test.js Project-folder-survives-a-restart test (see below)
└── CLAUDE.md
```

Scripts are loaded as plain `<script src>` tags (not ES modules) in that
order, deliberately — ES module imports are blocked by CORS when a page is
opened via `file://`, so classic scripts attaching to a shared `window.App`
namespace is what makes "just double-click index.html" possible at all.

## Features

- **Open last data file**: on the load screen (Chrome/Edge only), a
  button above "Open existing data file" reopens whatever file was
  opened/created last time, in one click — no picker, and it survives
  browser restarts. Only appears once there's something to remember; see
  "Open last data file" under storage above for how it works.
- **Calendar** (left): month grid, Monday-first weeks, prev/next/Today
  navigation, a **Go to date** picker that jumps straight to any date, each
  day colour-coded by score with a small dot if it has a note. **Keyboard:**
  ←/→ step the selected day by one; Shift+←/→ (either Shift key) step the
  visible month, same as the ‹ / › buttons — both are disabled while
  focus is in a text field, a date input, or anything editable, so typing
  and native cursor movement are never hijacked (`handleGlobalKeydown` /
  `isTypingTarget` in `js/calendar.js`).
- **Day editor** (right): click a day (or use Go to date) to select it,
  then pick a score 0–6 (click again to clear it — saves to disk
  immediately) and write a note. Saved on **Save note**, and also
  auto-saved if you switch to a different day (click a cell, use Go to
  date, or Today) while the note has unsaved edits, so nothing you typed
  is ever silently lost. Every note save — manual or automatic — plays a
  brief highlight animation around the note block
  (`js/calendar.js` → `flashNoteSaved()`, `.note-flash` in
  `css/styles.css`; respects `prefers-reduced-motion`). The note box
  stretches to match the calendar's height. **Clear this day** wipes both.
- **Score operations**: pick Week / Month / Year / a manual custom date
  range, see days-scored count, average, sum, min, max, and a 0–6
  distribution bar chart for that period.
- **Search notes**: substring search across note text, with the same
  Week/Month/Year/Custom period filter plus an "All time" option;
  clicking a result jumps the calendar to that day.
- **Score-legend filter**: each chip in the score legend under the
  calendar (0–6) is a clickable toggle button, not just a colour key.
  Clicking one spotlights that score: every other day cell in the visible
  month has its number/dot/note-mark blanked out (`day-cell-filtered` in
  `css/styles.css`) while staying in its normal grid position, so weekday
  columns and the today/selected outlines don't shift. A status line under
  the legend (`#filterStatus`) reports how many matching days are in the
  visible month, or that there are none. While a filter is active, **‹ /
  ›** (and their month logic) skip straight to the next/previous month —
  however many months or whole years away — that actually has a day with
  that score, instead of stepping through empty months one at a time; if
  there's no further match in that direction they simply do nothing.
  Click the active chip again (or reload the file) to clear the filter.
  Implemented in `js/calendar.js`: `toggleFilter()`, `monthsWithScore()`,
  `nextMatchingMonthKey()` / `prevMatchingMonthKey()` /
  `nearestMatchingMonthKey()`, and the filter-aware branches in
  `goPrevMonth()` / `goNextMonth()` / `renderMonthGrid()`.
- **Mode: Day / Month / Year** — a dropdown in the bottom-right of the
  calendar panel (next to the score legend) switches which of three
  entirely independent rating/note systems the side panel edits:
  - **Day** (default): the original per-date score/note described above.
  - **Month**: rates/notes whichever month is currently visible in the
    calendar (its title becomes e.g. "September 2026"; every in-month day
    cell gets a soft highlight, `.day-cell-month-target`, so it's clear
    which month a score/note would apply to). **‹ / ›** and Shift+←/→
    still step by month, just like Day mode, moving which month is being
    rated as they go.
  - **Year**: rates/notes whichever year the visible month falls in (its
    title becomes just the year, e.g. "2026"). **‹ / ›** and Shift+←/→
    switch to stepping a **whole year** at a time instead of a month
    while this mode is active.

  Whichever mode is active, "Save note" / autosave-on-navigate /
  "Clear this ___" all act on that mode's own store
  (`storage.months`/`storage.years`, never `storage.days`) — rating a
  month or year never creates, changes, or clears any individual day.
  The calendar grid itself always keeps showing the day view underneath,
  purely for browsing context; clicking any day cell immediately snaps
  Mode back to **Day** and selects that day, so switching into Month/Year
  mode is never a dead end. The score-legend filter chips are Day-mode-only
  (they filter individual days by score) and are hidden while Mode is
  Month or Year; any active day filter is cleared automatically when you
  switch away from Day mode. Implemented in `js/calendar.js`: `setMode()`,
  `currentKey()` / `currentEntry()` / `setCurrentScore()` (the mode
  dispatch layer used by the score buttons, note save/autosave, and
  Clear), `goPrevYear()` / `goNextYear()`, and the mirrored
  `getMonth/setMonthScore/setMonthNote/clearMonth` and
  `getYear/setYearScore/setYearNote/clearYear` methods in `js/storage.js`.

## Colour palette

Per request: **no purple, fuchsia, magenta or violet anywhere.** UI accent
is teal (`#0d7d75`); the score scale is a plain red → green ramp
(`#dc2626` → `#16a34a`) defined in `js/calendar.js` (`SCORE_COLORS`) and
mirrored in `css/styles.css`. If you want a different accent or score
ramp later, those are the two places to change.

## Testing

Two headless Playwright scripts, both optional tooling for future changes
(not part of the shipped app):

```
npm i -D playwright && npx playwright install chromium
node tests/smoketest.js
node tests/persistence-test.js
```

- **`tests/smoketest.js`** drives the real app end-to-end (forces
  compatibility mode so it's automatable — see comment in the file —
  creates a file, sets scores, saves/auto-saves notes, checks the
  calendar/stats/search panels, clears a day, and validates the downloaded
  JSON against the schema, exercises the ←/→ and Shift+←/→ keyboard
  shortcuts including the guard that keeps them out of the way inside the
  note field, — for the score-legend filter — seeds matching days two
  months apart, clicks a legend chip, checks that non-matching cells are
  blanked and the status line reports the right count, confirms ‹ / ›
  jump straight between the two matching months skipping the empty one in
  between, and confirms clicking the chip again restores every cell, and
  — for the Mode dropdown — switches to Month mode and confirms the
  editor title/legend visibility change, rates a month and confirms it
  lands in `storage.months` untouched by `storage.days`, switches to Year
  mode and confirms ‹ / › now steps whole years, and confirms clicking a
  day cell snaps back to Day mode with that day's own data intact). 35
  checks.
- **`tests/persistence-test.js`** covers both handle-remembering features,
  since both need a real `FileSystemHandle` and a genuine browser restart
  to test honestly (not just a same-tab reload): it launches a real
  Chromium profile, sets a project folder, **closes the browser
  entirely**, relaunches against the same profile directory, and confirms
  the folder comes back with no re-pick. It also checks the one-click
  reconnect path and that "Forget remembered folder" clears IndexedDB, not
  just the in-page state. Then, for **"Open last data file"**: opens a
  file via a stubbed picker backed by a real handle, confirms the button
  appears on the load screen naming that file, confirms clicking it
  reopens the file with `showOpenFilePicker` stubbed to throw (proving no
  picker is invoked), and confirms the button and reopen both still work
  correctly after a full browser restart. Runs over a throwaway local
  `http://127.0.0.1` server rather than `file://`, because the Origin
  Private File System it uses to fabricate real, structured-cloneable
  `FileSystemDirectoryHandle`/`FileSystemFileHandle`s for testing is
  unavailable on `file://` origins — the shipped app is unaffected, this
  is purely a test-harness detail (see the comments at the top of the
  file). 8 checks.

This is how the app was verified while building it — all 43 checks across
both scripts pass.

## Known limitations

- File System Access API is Chromium-only (Chrome, Edge, Opera, Brave).
  Firefox and Safari always use compatibility mode.
- In fallback mode (Firefox/Safari), every page load requires
  re-importing your data file — intentional, see "no local storage"
  above; there's no way to remember a file *handle* there since that
  mode never gets one from the browser in the first place. In FSA mode
  (Chrome/Edge), "Open last data file" makes reopening the same file a
  single click, but a *different* file is always an explicit pick — data
  itself is still never cached, only the handle used to get back to it.
- Fallback mode's "Save & Download" relies on your browser's download
  behavior to overwrite the original file; if your browser is set to ask
  where to save each download, choose the original file's location and
  confirm the overwrite.
- Both the remembered project folder and the remembered last data file
  live in IndexedDB for this page's origin. Clearing site data/history
  for this app, using a different browser profile, or opening
  `index.html` from a different path all mean they won't be found — the
  usual pickers/buttons just won't have anything to show, and you go back
  to picking normally.
- Month/Year mode has no dedicated "jump to a specific month/year" input
  of its own — you get there via ‹ / › (which step by year while in Year
  mode), Shift+←/→, or by using Go to date/Today in Day mode and then
  switching Mode. There's also no month/year equivalent of the score
  filter or Score-operations/Search panels yet — those still summarize
  only the day-level data.

## Working with Claude on this project

- Delivery: changed files are written straight into this project folder
  (`Z:\my_apps\MyLifeScores`) as work happens — **no `day-tracker.zip` is
  created inside the folder anymore**; a zip is only sent as a chat
  download when explicitly asked for. Don't be surprised if there's no
  zip sitting next to the app files — that's intentional as of the
  score-filter feature.
- This file is kept current after every feature, and is also updated
  proactively whenever a Claude session's context is getting full
  (around 90%), so project state and history aren't lost to context
  limits mid-conversation.

## Version control

This folder is a git repo tracking
[github.com/CaligolaGG/MyLifeScores](https://github.com/CaligolaGG/MyLifeScores)
(`origin/main`). A `.gitignore` deliberately excludes:

- `diaries/*.json` — your real data file (scores/notes). Only
  `diaries/README.md` is tracked. This is personal data and was kept out
  of the repo on purpose; if you ever want a specific data file version-
  controlled too, `git add -f` it explicitly.
- `Claude outputs/` — a working folder used during Claude sessions, not
  part of the app.

To push further changes yourself: `git add -A && git commit -m "..." && git push`
from this folder (Git for Windows, or any shell with access to it).
