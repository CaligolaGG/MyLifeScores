/*
 * persistence-test.js
 * --------------------
 * Verifies the actual bug report this test exists for: "Set project
 * folder" needs to survive a full browser close/reopen, not just page
 * reloads within the same tab.
 *
 * Playwright's normal browser.launch() gives every run a throwaway
 * profile, so IndexedDB never persists between two launches — which
 * would make this exact scenario untestable. Instead this uses
 * launchPersistentContext() against a real temp profile directory,
 * closes it, and launches a SECOND persistent context against the same
 * directory — that's an actual "quit the browser, reopen it" in
 * Chromium's own terms, not a simulation.
 *
 * The only thing stubbed is window.showDirectoryPicker itself (there's
 * no way to automate a real native OS folder dialog); everything else —
 * IndexedDB storage, queryPermission/requestPermission flow, the load
 * screen UI states — runs exactly as it does for a real user.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const assert = require("assert");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

/**
 * navigator.storage.getDirectory() (the Origin Private File System) is
 * unavailable on file:// origins in Chromium — confirmed by this test
 * failing with a SecurityError before this server was added. The app
 * itself still ships as file:// static files; this server exists only so
 * the test can hand storage.js a genuine, structured-cloneable
 * FileSystemDirectoryHandle (a real native OS folder dialog can't be
 * automated at all, and a hand-rolled plain-object mock isn't
 * clone-compatible with IndexedDB — see the comment below). The
 * IndexedDB/persistence code being tested doesn't care which origin
 * scheme serves the page.
 */
function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(rootDir, reqPath === "/" ? "/index.html" : reqPath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const launchOpts = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "day-tracker-profile-"));
  const server = await startStaticServer(path.join(__dirname, ".."));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html`;

  // --- "session 1": pick a project folder, close the browser -------------
  let context = await chromium.launchPersistentContext(profileDir, launchOpts);
  let page = await context.newPage();
  await page.goto(url);

  await page.waitForSelector("#fsaButtons:not([hidden])", { timeout: 5000 });
  console.log("PASS: real FSA support detected (fsaButtons shown, not compatibility mode)");

  await page.evaluate(async () => {
    // Only a native OS folder dialog (which can't be automated) can
    // produce a handle to a real on-disk folder — so this stubs
    // showDirectoryPicker() itself. But it hands back a GENUINE
    // FileSystemDirectoryHandle (from the Origin Private File System)
    // rather than a fake plain object, because IndexedDB's structured
    // clone algorithm has special native support for real FileSystemHandle
    // instances that a hand-rolled mock (with plain-function methods)
    // cannot replicate — using a real handle is what makes this test
    // trustworthy evidence about the actual storage code path.
    const opfsRoot = await navigator.storage.getDirectory();
    const dirHandle = await opfsRoot.getDirectoryHandle("MyLifeScores", { create: true });
    window.showDirectoryPicker = async () => dirHandle;
  });

  await page.click("#btnSetProjectFolder");
  await page.waitForFunction(() => document.getElementById("btnForgetProjectFolder").hidden === false);
  const hintAfterSet = await page.textContent("#projectFolderHint");
  assert.ok(hintAfterSet.includes("MyLifeScores"), `hint should name the folder, got: "${hintAfterSet}"`);
  console.log("PASS: setting a project folder updates the load screen immediately");

  await context.close();

  // --- "session 2": relaunch against the SAME profile dir -----------------
  // This is the actual bug: does the folder survive closing the browser?
  context = await chromium.launchPersistentContext(profileDir, launchOpts);
  page = await context.newPage();
  await page.goto(url);

  // tryRestoreProjectFolder() runs on load and queries IndexedDB; give it
  // a moment (it's async but fast — no picker UI is involved).
  await page.waitForFunction(
    () => {
      const hint = document.getElementById("projectFolderHint");
      return !hint.hidden && hint.textContent.length > 0;
    },
    { timeout: 5000 }
  );

  const hintAfterRestart = await page.textContent("#projectFolderHint");
  const btnLabel = await page.textContent("#btnSetProjectFolder");
  const forgetVisible = await page.isHidden("#btnForgetProjectFolder");

  assert.ok(
    hintAfterRestart.includes("ready") && hintAfterRestart.includes("MyLifeScores"),
    `after reopening the browser, the remembered folder should be restored automatically without any click, got hint: "${hintAfterRestart}"`
  );
  assert.ok(btnLabel.includes("Change"), `button should read "Change project folder…", got "${btnLabel}"`);
  assert.strictEqual(forgetVisible, false, '"Forget remembered folder" should be visible once a folder is restored');
  console.log("PASS: project folder survives closing and reopening the browser — no re-pick, no click needed");

  // --- forgetting it clears both the UI and IndexedDB ---------------------
  await page.click("#btnForgetProjectFolder");
  await page.waitForFunction(() => document.getElementById("btnForgetProjectFolder").hidden === true);
  const btnLabelAfterForget = await page.textContent("#btnSetProjectFolder");
  assert.ok(btnLabelAfterForget.includes("Set project folder"), "button should revert to \"Set project folder…\" after forgetting");
  console.log("PASS: \"Forget remembered folder\" resets the UI");

  await context.close();

  // --- session 3: confirm forgetting actually cleared IndexedDB too -------
  context = await chromium.launchPersistentContext(profileDir, launchOpts);
  page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector("#fsaButtons:not([hidden])");
  await page.waitForTimeout(200); // let tryRestoreProjectFolder() finish (there's nothing to wait on — it should find nothing)
  const hintAfterForgetRestart = await page.textContent("#projectFolderHint");
  assert.ok(
    !hintAfterForgetRestart.includes("MyLifeScores"),
    `forgetting should have cleared IndexedDB too, but the folder came back: "${hintAfterForgetRestart}"`
  );
  const reconnectHidden = await page.isHidden("#btnReconnectProjectFolder");
  assert.strictEqual(reconnectHidden, true, "there should be nothing to reconnect after forgetting");
  console.log("PASS: forgetting the project folder clears IndexedDB, not just the in-page state");

  // --- "Open last data file": remembering the last-opened FILE itself ---
  // (separate from the project *folder* above) so it reopens in one click,
  // with no picker, even after a full browser restart.
  await page.evaluate(async () => {
    const opfsRoot = await navigator.storage.getDirectory();
    const fileHandle = await opfsRoot.getFileHandle("last-file-test.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(
      JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        days: {},
        months: {},
        years: {},
      })
    );
    await writable.close();
    // Only a native OS file dialog (which can't be automated) can produce a
    // handle to a real on-disk file, so this stubs showOpenFilePicker itself
    // — same rationale as the showDirectoryPicker stub above.
    window.showOpenFilePicker = async () => [fileHandle];
  });

  await page.click("#btnOpenFSA");
  await page.waitForSelector("#app:not([hidden])");
  const openedFileName = await page.textContent("#fileName");
  assert.strictEqual(openedFileName, "last-file-test.json", "opening via the (stubbed) picker should load the OPFS test file");

  await page.click("#btnSwitchFile");
  await page.waitForFunction(() => document.getElementById("btnOpenLastFile").hidden === false, { timeout: 5000 });
  const lastFileButtonLabel = await page.textContent("#btnOpenLastFile");
  assert.ok(
    lastFileButtonLabel.includes("last-file-test.json"),
    `"Open last data file" should name the just-opened file, got: "${lastFileButtonLabel}"`
  );
  console.log('PASS: "Open last data file" appears on the load screen, naming the just-opened file');

  // Clicking it must reopen directly — no picker involved at all.
  await page.evaluate(() => {
    window.showOpenFilePicker = async () => {
      throw new Error("showOpenFilePicker should not be called by Open last data file");
    };
  });
  await page.click("#btnOpenLastFile");
  await page.waitForSelector("#app:not([hidden])");
  const reopenedFileName = await page.textContent("#fileName");
  assert.strictEqual(reopenedFileName, "last-file-test.json", '"Open last data file" should reopen the same file directly');
  console.log('PASS: "Open last data file" reopens the remembered file with no picker involved');

  await context.close();

  // --- session 4: the remembered last file survives a full browser restart too
  context = await chromium.launchPersistentContext(profileDir, launchOpts);
  page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById("btnOpenLastFile").hidden === false, { timeout: 5000 });
  const lastFileButtonLabelAfterRestart = await page.textContent("#btnOpenLastFile");
  assert.ok(
    lastFileButtonLabelAfterRestart.includes("last-file-test.json"),
    `"Open last data file" should survive a browser restart, got: "${lastFileButtonLabelAfterRestart}"`
  );
  await page.click("#btnOpenLastFile");
  await page.waitForSelector("#app:not([hidden])");
  const reopenedFileNameAfterRestart = await page.textContent("#fileName");
  assert.strictEqual(reopenedFileNameAfterRestart, "last-file-test.json", "the remembered last file should reopen correctly after a restart too");
  console.log('PASS: "Open last data file" survives closing and reopening the browser, just like the project folder');

  await context.close();
  server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });

  console.log("\nALL PERSISTENCE TESTS PASSED");
})().catch((err) => {
  console.error("PERSISTENCE TEST FAILED:", err);
  process.exit(1);
});
