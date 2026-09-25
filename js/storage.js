/*
 * storage.js
 * ----------
 * Owns the data model and the on-disk JSON "database" file.
 *
 * IMPORTANT DESIGN CHOICE (see CLAUDE.md for full rationale):
 * - The JSON file the user opens/creates is the single source of truth.
 *   Score/note DATA is never written to localStorage / sessionStorage /
 *   IndexedDB — all of that lives in plain JS variables in memory and
 *   disappears when the tab/window is closed, exactly as requested.
 * - The ONE exception: the "project folder" you pick via "Set project
 *   folder…" is remembered in IndexedDB (as a FileSystemDirectoryHandle,
 *   not a path — see rememberProjectFolder()/tryRestoreProjectFolder()
 *   below) purely so Open/Create can start there again next session
 *   without re-navigating. It's a UI convenience, holds no day/score/note
 *   data, and can be cleared any time with "Forget remembered folder".
 * - Two storage backends are supported:
 *     "fsa"      File System Access API (Chrome / Edge). The app holds a
 *                real handle to the file on disk and writes to it directly
 *                every time a score changes or a note is saved.
 *     "fallback" Any other browser. The file is loaded once via a classic
 *                <input type="file"> picker and kept in memory; the user
 *                clicks "Save / Download" to get an updated JSON file,
 *                which they save over the original on disk. This is a
 *                fundamental browser limitation (see CLAUDE.md), not a bug.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});

  const SCHEMA_VERSION = 1;
  const MIN_SCORE = 0;
  const MAX_SCORE = 6;

  function nowIso() {
    return new Date().toISOString();
  }

  function freshData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      days: {},
      // Independent, parallel rating/note systems — a month (e.g. "2026-12")
      // or a whole year (e.g. "2027") can have its own score+note, entirely
      // separate from any day inside it. See "Mode" in the calendar panel.
      months: {},
      years: {},
    };
  }

  /**
   * Basic structural validation. Throws a descriptive Error on failure
   * so the UI can show something useful instead of a stack trace.
   */
  function validate(obj) {
    if (!obj || typeof obj !== "object") {
      throw new Error("File does not contain a JSON object.");
    }
    if (typeof obj.days !== "object" || obj.days === null || Array.isArray(obj.days)) {
      throw new Error('File is missing a valid "days" object.');
    }
    for (const key of Object.keys(obj.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        throw new Error(`Invalid date key in data: "${key}"`);
      }
      const entry = obj.days[key];
      if (entry && typeof entry !== "object") {
        throw new Error(`Invalid entry for date "${key}"`);
      }
      if (entry && entry.score != null) {
        const s = Number(entry.score);
        if (!Number.isInteger(s) || s < MIN_SCORE || s > MAX_SCORE) {
          throw new Error(`Invalid score for "${key}": ${entry.score}`);
        }
      }
    }
    validateKeyedScoreNoteMap(obj, "months", /^\d{4}-\d{2}$/, "month");
    validateKeyedScoreNoteMap(obj, "years", /^\d{4}$/, "year");

    if (typeof obj.schemaVersion !== "number") obj.schemaVersion = SCHEMA_VERSION;
    return obj;
  }

  /**
   * Shared validation for the "months" and "years" maps: same shape as
   * "days" (an optional {score, note, updatedAt} per key), just keyed
   * differently. Files from before this feature won't have these keys at
   * all — that's fine, they're defaulted to {} rather than treated as an
   * error, so older data files keep opening normally.
   */
  function validateKeyedScoreNoteMap(obj, field, keyPattern, label) {
    if (obj[field] == null) {
      obj[field] = {};
      return;
    }
    if (typeof obj[field] !== "object" || Array.isArray(obj[field])) {
      throw new Error(`File has an invalid "${field}" object.`);
    }
    for (const key of Object.keys(obj[field])) {
      if (!keyPattern.test(key)) {
        throw new Error(`Invalid ${label} key in data: "${key}"`);
      }
      const entry = obj[field][key];
      if (entry && typeof entry !== "object") {
        throw new Error(`Invalid entry for ${label} "${key}"`);
      }
      if (entry && entry.score != null) {
        const s = Number(entry.score);
        if (!Number.isInteger(s) || s < MIN_SCORE || s > MAX_SCORE) {
          throw new Error(`Invalid score for ${label} "${key}": ${entry.score}`);
        }
      }
    }
  }

  // Groups our two file pickers under one id so Chrome/Edge remember the
  // last folder used and reopen there next time — see setProjectFolder()
  // below for the more immediate way to land somewhere specific on the
  // very first pick, too.
  const PICKER_ID = "day-tracker-diaries";

  const state = {
    mode: null, // "fsa" | "fallback"
    fileHandle: null, // FileSystemFileHandle (fsa mode only)
    fileName: null,
    data: null,
    dirty: false, // fallback mode: true if not yet downloaded since last change
    projectDirHandle: null, // FileSystemDirectoryHandle, ready to use as `startIn`
    pendingProjectDirHandle: null, // remembered handle awaiting a permission re-grant
    pendingLastFileHandle: null, // remembered FileSystemFileHandle for "Open last data file"
  };

  // ---------------------------------------------------------------------
  // Tiny IndexedDB wrapper, used for exactly one thing: remembering the
  // project-folder FileSystemDirectoryHandle across browser restarts.
  // ---------------------------------------------------------------------
  const IDB_NAME = "day-tracker-app";
  const IDB_STORE = "handles";
  const IDB_KEY = "projectDir";
  const IDB_LAST_FILE_KEY = "lastFileHandle";

  function openHandleDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Could not open IndexedDB"));
    });
  }

  async function idbSet(key, value) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    });
  }

  async function idbGet(key) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
    });
  }

  async function idbDelete(key) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    });
  }

  const storage = (App.storage = {
    MIN_SCORE,
    MAX_SCORE,
    state,

    supportsFSA() {
      return typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
    },

    supportsDropHandle() {
      return typeof DataTransferItem !== "undefined" && "getAsFileSystemHandle" in DataTransferItem.prototype;
    },

    isReady() {
      return !!state.data;
    },

    // ---------------------------------------------------------------
    // Project folder: pick it once, and it's used as the starting point
    // for every open/create picker for the rest of this session — AND
    // remembered in IndexedDB (the handle itself, not a path — browsers
    // don't expose real filesystem paths to pages) so it comes back
    // automatically next time you open index.html, without re-picking.
    // Doesn't create or navigate into any particular subfolder — if you
    // keep your data files in a subfolder of your own, just navigate into
    // it once from the picker.
    // ---------------------------------------------------------------

    async setProjectFolder() {
      const dirHandle = await window.showDirectoryPicker({ id: "day-tracker-project", mode: "readwrite" });
      state.projectDirHandle = dirHandle;
      state.pendingProjectDirHandle = null;
      try {
        await idbSet(IDB_KEY, dirHandle);
      } catch (e) {
        // Not fatal — it just won't be remembered next session.
        console.warn("Day Tracker: couldn't remember the project folder for next time.", e);
      }
      return dirHandle;
    },

    /**
     * Call once on load. Looks for a remembered folder in IndexedDB and:
     *  - if permission on it is still granted, uses it immediately —
     *    Open/Create just works, no click needed;
     *  - if the browser needs a fresh permission grant (common after a
     *    full browser restart), returns "needs-permission" so the UI can
     *    offer a single-click "Reconnect" (see reconnectProjectFolder);
     *  - if nothing was remembered, returns "none".
     */
    async tryRestoreProjectFolder() {
      let handle;
      try {
        handle = await idbGet(IDB_KEY);
      } catch (e) {
        return { status: "none" };
      }
      if (!handle) return { status: "none" };

      let permission;
      try {
        permission = await handle.queryPermission({ mode: "readwrite" });
      } catch (e) {
        return { status: "none" };
      }

      if (permission === "granted") {
        state.projectDirHandle = handle;
        state.pendingProjectDirHandle = null;
        return { status: "restored", name: handle.name };
      }

      state.pendingProjectDirHandle = handle;
      return { status: "needs-permission", name: handle.name };
    },

    /** Re-grants permission on the remembered folder. Needs a user gesture (a click). */
    async reconnectProjectFolder() {
      const handle = state.pendingProjectDirHandle;
      if (!handle) throw new Error("No remembered project folder to reconnect.");
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        throw new Error("Permission for the remembered project folder was denied.");
      }
      state.projectDirHandle = handle;
      state.pendingProjectDirHandle = null;
      return handle;
    },

    /** Clears the remembered folder (IndexedDB + in-memory state). */
    async forgetProjectFolder() {
      state.projectDirHandle = null;
      state.pendingProjectDirHandle = null;
      try {
        await idbDelete(IDB_KEY);
      } catch (e) {
        console.warn("Day Tracker: couldn't clear the remembered project folder.", e);
      }
    },

    // ---------------------------------------------------------------
    // Last opened data file: remembered the same way as the project
    // folder above (a real FileSystemFileHandle in IndexedDB, not a path
    // — browsers never expose actual filesystem paths to pages), purely
    // so "Open last data file" on the load screen can reopen it in one
    // click instead of going through the picker again.
    // ---------------------------------------------------------------

    /** Best-effort; failing to remember it just means no shortcut next time. */
    async rememberLastFile(handle) {
      try {
        await idbSet(IDB_LAST_FILE_KEY, handle);
      } catch (e) {
        console.warn("Day Tracker: couldn't remember this as the last opened file.", e);
      }
    },

    /**
     * Call once on load. Looks for a remembered file handle in IndexedDB
     * and reports whether one exists (and its name) so the UI can show
     * "Open last data file" — the actual open happens in openLastFile(),
     * since re-granting permission (if needed) requires a user gesture.
     */
    async checkLastFile() {
      let handle;
      try {
        handle = await idbGet(IDB_LAST_FILE_KEY);
      } catch (e) {
        return { status: "none" };
      }
      if (!handle) return { status: "none" };
      state.pendingLastFileHandle = handle;
      return { status: "found", name: handle.name };
    },

    /**
     * Opens the remembered last file directly — no picker. Re-grants
     * permission first if needed (fine here: this is only ever called
     * from a button click, which counts as the required user gesture).
     */
    async openLastFile() {
      const handle = state.pendingLastFileHandle;
      if (!handle) throw new Error("No remembered data file to open.");
      let permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        permission = await handle.requestPermission({ mode: "readwrite" });
      }
      if (permission !== "granted") {
        throw new Error("Permission for the remembered data file was denied.");
      }
      return loadFromFileHandle(handle);
    },

    // ---------------------------------------------------------------
    // Opening / creating the data file
    // ---------------------------------------------------------------

    async openExistingFSA() {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        id: PICKER_ID,
        ...(state.projectDirHandle ? { startIn: state.projectDirHandle } : {}),
        types: [
          {
            description: "Day Tracker data file",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      return loadFromFileHandle(handle);
    },

    async createNewFSA() {
      const handle = await window.showSaveFilePicker({
        suggestedName: "day-tracker-data.json",
        id: PICKER_ID,
        ...(state.projectDirHandle ? { startIn: state.projectDirHandle } : {}),
        types: [
          {
            description: "Day Tracker data file",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const data = freshData();
      await writeHandle(handle, data);

      state.mode = "fsa";
      state.fileHandle = handle;
      state.fileName = handle.name;
      state.data = data;
      state.dirty = false;
      await storage.rememberLastFile(handle);
      return state;
    },

    /**
     * Drag-and-drop of a file dropped straight onto the load screen.
     * In Chrome/Edge, DataTransferItem.getAsFileSystemHandle() hands back
     * a real, writable FileSystemFileHandle — so a dropped file gets the
     * same live read/write behaviour as one opened via the picker.
     */
    async openFromDroppedHandle(handle) {
      if (handle.kind !== "file") {
        throw new Error("Please drop a single data file, not a folder.");
      }
      return loadFromFileHandle(handle);
    },

    /** Fallback: a dropped/imported File object (Firefox/Safari, or non-FSA drop) */
    async importFallback(file) {
      const text = await file.text();
      let parsed;
      try {
        parsed = text.trim() ? JSON.parse(text) : freshData();
      } catch (e) {
        throw new Error("That file is not valid JSON (" + e.message + ").");
      }
      validate(parsed);

      state.mode = "fallback";
      state.fileHandle = null;
      state.fileName = file.name || "day-tracker-data.json";
      state.data = parsed;
      state.dirty = false;
      return state;
    },

    /** Fallback mode: start a brand-new in-memory file, downloaded on demand */
    createNewFallback(fileName) {
      state.mode = "fallback";
      state.fileHandle = null;
      state.fileName = fileName || "day-tracker-data.json";
      state.data = freshData();
      state.dirty = true; // nothing has been downloaded yet
      return state;
    },

    /** Fallback mode only: trigger a download of the current data */
    downloadFallback() {
      if (!state.data) return;
      const blob = new Blob([JSON.stringify(state.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state.fileName || "day-tracker-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      state.dirty = false;
      App.onDataChanged && App.onDataChanged({ saved: true });
    },

    // ---------------------------------------------------------------
    // Persisting a change (called after every mutation)
    // ---------------------------------------------------------------

    async persist() {
      state.data.updatedAt = nowIso();
      if (state.mode === "fsa") {
        await writeHandle(state.fileHandle, state.data);
        state.dirty = false;
      } else {
        state.dirty = true;
      }
    },

    // ---------------------------------------------------------------
    // Data mutation helpers
    // ---------------------------------------------------------------

    getDay(dateStr) {
      return (state.data.days && state.data.days[dateStr]) || null;
    },

    async setScore(dateStr, score) {
      const days = state.data.days;
      const entry = days[dateStr] || {};
      if (score == null) {
        delete entry.score;
      } else {
        const s = Number(score);
        if (!Number.isInteger(s) || s < MIN_SCORE || s > MAX_SCORE) {
          throw new Error("Score must be an integer between " + MIN_SCORE + " and " + MAX_SCORE + ".");
        }
        entry.score = s;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete days[dateStr];
      } else {
        days[dateStr] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ dateStr });
    },

    async setNote(dateStr, note) {
      const days = state.data.days;
      const entry = days[dateStr] || {};
      const trimmed = (note || "").toString();
      if (trimmed) {
        entry.note = trimmed;
      } else {
        delete entry.note;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete days[dateStr];
      } else {
        days[dateStr] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ dateStr });
    },

    async clearDay(dateStr) {
      delete state.data.days[dateStr];
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ dateStr });
    },

    /** All [dateStr, entry] pairs, sorted ascending by date. */
    allEntries() {
      return Object.keys(state.data.days)
        .sort()
        .map((k) => [k, state.data.days[k]]);
    },

    // ---------------------------------------------------------------
    // Month ratings/notes: a second, independent {score, note} per
    // "YYYY-MM" key. Entirely separate from any day inside that month —
    // see the "Mode" selector in calendar.js.
    // ---------------------------------------------------------------

    getMonth(monthKey) {
      return (state.data.months && state.data.months[monthKey]) || null;
    },

    async setMonthScore(monthKey, score) {
      const months = state.data.months;
      const entry = months[monthKey] || {};
      if (score == null) {
        delete entry.score;
      } else {
        const s = Number(score);
        if (!Number.isInteger(s) || s < MIN_SCORE || s > MAX_SCORE) {
          throw new Error("Score must be an integer between " + MIN_SCORE + " and " + MAX_SCORE + ".");
        }
        entry.score = s;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete months[monthKey];
      } else {
        months[monthKey] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ monthKey });
    },

    async setMonthNote(monthKey, note) {
      const months = state.data.months;
      const entry = months[monthKey] || {};
      const trimmed = (note || "").toString();
      if (trimmed) {
        entry.note = trimmed;
      } else {
        delete entry.note;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete months[monthKey];
      } else {
        months[monthKey] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ monthKey });
    },

    async clearMonth(monthKey) {
      delete state.data.months[monthKey];
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ monthKey });
    },

    /** All [monthKey, entry] pairs, sorted ascending. */
    allMonthEntries() {
      return Object.keys(state.data.months)
        .sort()
        .map((k) => [k, state.data.months[k]]);
    },

    // ---------------------------------------------------------------
    // Year ratings/notes: a third, independent {score, note} per "YYYY"
    // key. Also entirely separate from days and months.
    // ---------------------------------------------------------------

    getYear(yearKey) {
      return (state.data.years && state.data.years[yearKey]) || null;
    },

    async setYearScore(yearKey, score) {
      const years = state.data.years;
      const entry = years[yearKey] || {};
      if (score == null) {
        delete entry.score;
      } else {
        const s = Number(score);
        if (!Number.isInteger(s) || s < MIN_SCORE || s > MAX_SCORE) {
          throw new Error("Score must be an integer between " + MIN_SCORE + " and " + MAX_SCORE + ".");
        }
        entry.score = s;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete years[yearKey];
      } else {
        years[yearKey] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ yearKey });
    },

    async setYearNote(yearKey, note) {
      const years = state.data.years;
      const entry = years[yearKey] || {};
      const trimmed = (note || "").toString();
      if (trimmed) {
        entry.note = trimmed;
      } else {
        delete entry.note;
      }
      entry.updatedAt = nowIso();
      if (entry.score == null && !entry.note) {
        delete years[yearKey];
      } else {
        years[yearKey] = entry;
      }
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ yearKey });
    },

    async clearYear(yearKey) {
      delete state.data.years[yearKey];
      await storage.persist();
      App.onDataChanged && App.onDataChanged({ yearKey });
    },

    /** All [yearKey, entry] pairs, sorted ascending. */
    allYearEntries() {
      return Object.keys(state.data.years)
        .sort()
        .map((k) => [k, state.data.years[k]]);
    },
  });

  /** Shared by openExistingFSA() and openFromDroppedHandle(). */
  async function loadFromFileHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    let parsed;
    try {
      parsed = text.trim() ? JSON.parse(text) : freshData();
    } catch (e) {
      throw new Error("That file is not valid JSON (" + e.message + ").");
    }
    validate(parsed);

    const perm = await ensureReadWritePermission(handle);
    if (!perm) throw new Error("Permission to read/write that file was denied.");

    state.mode = "fsa";
    state.fileHandle = handle;
    state.fileName = handle.name;
    state.data = parsed;
    state.dirty = false;
    await storage.rememberLastFile(handle);
    return state;
  }

  async function ensureReadWritePermission(handle) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
    return false;
  }

  async function writeHandle(handle, data) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }
})();
