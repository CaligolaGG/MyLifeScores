/*
 * main.js
 * -------
 * Boots the app: shows the load screen, wires up file open/create/import,
 * then hands off to calendar.js / stats.js / search.js once data is
 * available. Also owns the small "save status" indicator in the header.
 */
(function () {
  "use strict";

  const App = (window.App = window.App || {});

  const els = {};

  function cacheEls() {
    els.loadScreen = document.getElementById("loadScreen");
    els.appEl = document.getElementById("app");
    els.fsaButtons = document.getElementById("fsaButtons");
    els.fallbackButtons = document.getElementById("fallbackButtons");
    els.btnOpenLastFile = document.getElementById("btnOpenLastFile");
    els.btnOpenFSA = document.getElementById("btnOpenFSA");
    els.btnNewFSA = document.getElementById("btnNewFSA");
    els.fallbackImportInput = document.getElementById("fallbackImportInput");
    els.btnNewFallback = document.getElementById("btnNewFallback");
    els.dropzone = document.getElementById("dropzone");
    els.btnSetProjectFolder = document.getElementById("btnSetProjectFolder");
    els.btnReconnectProjectFolder = document.getElementById("btnReconnectProjectFolder");
    els.btnForgetProjectFolder = document.getElementById("btnForgetProjectFolder");
    els.projectFolderHint = document.getElementById("projectFolderHint");
    els.loadError = document.getElementById("loadError");

    els.fileName = document.getElementById("fileName");
    els.saveStatus = document.getElementById("saveStatus");
    els.btnSaveNow = document.getElementById("btnSaveNow");
    els.btnSwitchFile = document.getElementById("btnSwitchFile");
  }

  function showLoadError(err) {
    console.error(err);
    els.loadError.hidden = false;
    els.loadError.textContent = err && err.message ? err.message : String(err);
  }

  function clearLoadError() {
    els.loadError.hidden = true;
    els.loadError.textContent = "";
  }

  function isAbort(err) {
    return err && err.name === "AbortError";
  }

  function updateSaveStatus() {
    const state = App.storage.state;
    if (state.mode === "fsa") {
      els.saveStatus.textContent = "All changes saved to file";
      els.btnSaveNow.hidden = true;
    } else {
      els.saveStatus.textContent = state.dirty
        ? "Unsaved changes — click “Save & Download”"
        : "Downloaded";
      els.btnSaveNow.hidden = false;
    }
  }

  function onFileReady() {
    clearLoadError();
    els.loadScreen.hidden = true;
    els.appEl.hidden = false;
    els.fileName.textContent = App.storage.state.fileName;
    updateSaveStatus();

    App.calendar.init();
    App.stats.init();
    App.search.init();
  }

  function resetToLoadScreen() {
    App.storage.state.mode = null;
    App.storage.state.fileHandle = null;
    App.storage.state.fileName = null;
    App.storage.state.data = null;
    App.storage.state.dirty = false;
    els.appEl.hidden = true;
    els.loadScreen.hidden = false;
    clearLoadError();
    els.fallbackImportInput.value = "";
    // Refresh so "Open last data file" reflects whatever was just closed,
    // not whatever was remembered when the page first loaded.
    if (App.storage.supportsFSA()) initLastFileUI();
  }

  function showProjectFolderHint(text) {
    els.projectFolderHint.hidden = false;
    els.projectFolderHint.textContent = text;
  }

  /** Reflects "we have a usable project folder right now" in the UI. */
  function showProjectFolderReady(name) {
    els.btnSetProjectFolder.textContent = "Change project folder…";
    els.btnReconnectProjectFolder.hidden = true;
    els.btnForgetProjectFolder.hidden = false;
    showProjectFolderHint(`Project folder ready: “${name}”. Open/Create will start there.`);
  }

  /**
   * Runs once on load (Chrome/Edge only): checks IndexedDB for the file
   * opened/created last time and, if found, shows "Open last data file" so
   * getting back in is one click instead of a re-pick. Permission is
   * (re-)granted inside the click handler itself — see storage.js
   * openLastFile() for why that has to happen there rather than here.
   */
  async function initLastFileUI() {
    let result;
    try {
      result = await App.storage.checkLastFile();
    } catch (err) {
      result = { status: "none" };
    }

    if (result.status === "found") {
      els.btnOpenLastFile.hidden = false;
      els.btnOpenLastFile.textContent = `Open last data file — “${result.name}”`;
    } else {
      els.btnOpenLastFile.hidden = true;
    }
  }

  /**
   * Runs once on load (Chrome/Edge only): checks IndexedDB for a folder
   * remembered from a previous session and either wires it up immediately
   * or offers a one-click "Reconnect" — see storage.js tryRestoreProjectFolder()
   * for why a full re-pick usually isn't needed.
   */
  async function initProjectFolderUI() {
    els.btnSetProjectFolder.hidden = false;

    let result;
    try {
      result = await App.storage.tryRestoreProjectFolder();
    } catch (err) {
      result = { status: "none" };
    }

    if (result.status === "restored") {
      showProjectFolderReady(result.name);
    } else if (result.status === "needs-permission") {
      els.btnReconnectProjectFolder.hidden = false;
      els.btnReconnectProjectFolder.textContent = `Reconnect “${result.name}”…`;
      showProjectFolderHint(
        `Remembered folder “${result.name}” needs a quick one-click permission check before Open/Create can use it.`
      );
    } else {
      showProjectFolderHint(
        "Picking a project folder once will make Open/Create start there — and it'll be remembered for next time, too."
      );
    }
  }

  function wireLoadScreen() {
    if (App.storage.supportsFSA()) {
      els.fsaButtons.hidden = false;
      initLastFileUI();
      initProjectFolderUI();
    } else {
      els.fallbackButtons.hidden = false;
    }

    els.btnOpenLastFile.addEventListener("click", async () => {
      try {
        await App.storage.openLastFile();
        onFileReady();
      } catch (err) {
        showLoadError(err);
      }
    });

    els.btnOpenFSA.addEventListener("click", async () => {
      try {
        await App.storage.openExistingFSA();
        onFileReady();
      } catch (err) {
        if (!isAbort(err)) showLoadError(err);
      }
    });

    els.btnNewFSA.addEventListener("click", async () => {
      try {
        await App.storage.createNewFSA();
        onFileReady();
      } catch (err) {
        if (!isAbort(err)) showLoadError(err);
      }
    });

    els.fallbackImportInput.addEventListener("change", async () => {
      const file = els.fallbackImportInput.files[0];
      if (!file) return;
      try {
        await App.storage.importFallback(file);
        onFileReady();
      } catch (err) {
        showLoadError(err);
      }
    });

    els.btnNewFallback.addEventListener("click", () => {
      App.storage.createNewFallback("day-tracker-data.json");
      onFileReady();
    });

    els.btnSetProjectFolder.addEventListener("click", async () => {
      try {
        const handle = await App.storage.setProjectFolder();
        showProjectFolderReady(handle.name);
      } catch (err) {
        if (!isAbort(err)) showLoadError(err);
      }
    });

    els.btnReconnectProjectFolder.addEventListener("click", async () => {
      try {
        const handle = await App.storage.reconnectProjectFolder();
        showProjectFolderReady(handle.name);
      } catch (err) {
        showLoadError(err);
      }
    });

    els.btnForgetProjectFolder.addEventListener("click", async () => {
      await App.storage.forgetProjectFolder();
      els.btnSetProjectFolder.textContent = "Set project folder…";
      els.btnReconnectProjectFolder.hidden = true;
      els.btnForgetProjectFolder.hidden = true;
      showProjectFolderHint(
        "Picking a project folder once will make Open/Create start there — and it'll be remembered for next time, too."
      );
    });

    wireDropzone();
  }

  function wireDropzone() {
    const zone = els.dropzone;

    ["dragenter", "dragover"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add("dropzone-active");
      });
    });

    ["dragleave", "dragend"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove("dropzone-active");
      });
    });

    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("dropzone-active");

      const items = e.dataTransfer && e.dataTransfer.items;
      const item = items && items.length ? items[0] : null;

      try {
        // Prefer a live, writable FileSystemFileHandle when the browser and
        // the drag source can give us one (Chrome/Edge, dragged from a real
        // OS file manager). Anything else — a directory, an unsupported
        // browser, or a synthetic/non-native drag that yields no handle —
        // falls back to a plain read-only import of the dropped file.
        let handle = null;
        if (item && item.kind === "file" && typeof item.getAsFileSystemHandle === "function") {
          handle = await item.getAsFileSystemHandle();
        }
        if (handle && handle.kind === "file") {
          await App.storage.openFromDroppedHandle(handle);
          onFileReady();
          return;
        }

        const file = item && item.getAsFile ? item.getAsFile() : e.dataTransfer.files[0];
        if (!file) throw new Error("Couldn't read the dropped file. Please drop a single data file, not a folder.");
        await App.storage.importFallback(file);
        onFileReady();
      } catch (err) {
        showLoadError(err);
      }
    });

    // Prevent the browser from navigating away if a file is dropped
    // outside the dropzone while the load screen is showing.
    ["dragover", "drop"].forEach((evt) => {
      window.addEventListener(evt, (e) => {
        if (els.loadScreen.hidden) return;
        e.preventDefault();
      });
    });
  }

  function wireHeader() {
    els.btnSaveNow.addEventListener("click", () => {
      App.storage.downloadFallback();
      updateSaveStatus();
    });

    els.btnSwitchFile.addEventListener("click", () => {
      const state = App.storage.state;
      if (state.mode === "fallback" && state.dirty) {
        const ok = confirm(
          "You have unsaved changes that haven't been downloaded yet. Switch files anyway and lose them?"
        );
        if (!ok) return;
      }
      resetToLoadScreen();
    });
  }

  function wireUnloadWarning() {
    window.addEventListener("beforeunload", (e) => {
      const state = App.storage.state;
      if (state.mode === "fallback" && state.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  App.onDataChanged = function () {
    updateSaveStatus();
    App.stats && App.stats.refresh();
    App.search && App.search.refresh();
  };

  function init() {
    cacheEls();
    wireLoadScreen();
    wireHeader();
    wireUnloadWarning();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
