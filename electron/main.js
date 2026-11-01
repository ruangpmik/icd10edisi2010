// Main process ICD-10 2010 Browser (Electron).
// Menyajikan hasil `next build` (folder out/) lewat protokol app://,
// bukan file:// — karena fetch() JSON gagal di file:// dan port lokal
// membuka celah bagi proses lain untuk menyadap.
const { app, BrowserWindow, Menu, shell, session, protocol, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const license = require("./license.js");
const { allowLicenseIpc } = require("./ipc-guard.js");

const isSmoke = process.env.ICD10_SMOKE === "1";
const OUT = path.join(__dirname, "..", "out");

// Hash inline script (dihitung build oleh scripts/csp-hashes.mjs). Tanpa file
// ini (mode dev) CSP jatuh ke 'unsafe-inline' agar hydration tetap jalan.
let inlineHashes = [];
try {
  inlineHashes = JSON.parse(fss.readFileSync(path.join(__dirname, "csp-hashes.json"), "utf8"));
} catch {}
const scriptSrc =
  inlineHashes.length > 0
    ? "script-src 'self' " +
      inlineHashes.map((h) => `'sha256-${h}'`).join(" ")
    : "script-src 'self' 'unsafe-inline'";

// Protokol wajib didaftarkan sebelum app "ready".
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const CSP = [
  "default-src 'self'",
  // Next static export memakai inline script untuk hydration (self.__next_f)
  // dan next-themes. Isi statis per halaman, jadi cukup hash SHA-256.
  // Catatan: CSP3 (2026) mensyaratkan hash BERKUTIP ('sha256-...'); format
  // lama tanpa kutip ditolak Chromium 156+ sebagai "invalid source".
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://docs.google.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain",
};

// Tautan keluar yang boleh terbuka di browser sistem.
const EXTERNAL_OK = /^https:\/\/(icd\.who\.int|www\.who\.int|docs\.google\.com|ruangpmik\.myr\.id)(\/|$)/;

async function serve(url) {
  try {
    let p = decodeURIComponent(new URL(url).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(OUT, p));
    if (file !== OUT && !file.startsWith(OUT + path.sep)) return notFound();
    const buf = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const headers = {
      "content-type": /^text|javascript|json/.test(type) ? type + "; charset=utf-8" : type,
      "content-security-policy": CSP,
      "cache-control": "no-cache",
    };
    return new Response(buf, { headers });
  } catch {
    return notFound();
  }
}

function notFound() {
  return new Response("404 Not Found", { status: 404, headers: { "content-security-policy": CSP } });
}

app.setName("ICD-10 Codex 2010");
app.setAppUserModelId("id.ruangpmik.icd10codex");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.show();
    w?.focus();
  });

  app.whenReady().then(() => {
    protocol.handle("app", (req) => serve(req.url));

    // CSP ganda: header langsung dari Response + webRequest (seluruh sesi).
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: { ...details.responseHeaders, "content-security-policy": [CSP] },
      });
    });

    // Tolak semua permission request (kamera, geo, notifikasi, dsb) —
    // aplikasi ini tidak butuh satu pun.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

    // Produksi: tanpa menu (mati reload, tanpa DevTools dari menu).
    if (app.isPackaged) Menu.setApplicationMenu(null);

    createWindow();
  });
}

let win = null;

// IPC lisensi — penjaga sender: hanya frame top-level dari app://local.
function licGuard(e) {
  return allowLicenseIpc(e);
}
ipcMain.handle("license:status", async (e) => (licGuard(e) ? license.getStatus() : { error: "forbidden" }));
ipcMain.handle("license:activate", async (e, key) =>
  licGuard(e) ? license.activate(key) : { ok: false, error: "forbidden" }
);
ipcMain.handle("license:renew", async (e) => (licGuard(e) ? license.renew() : { ok: false, error: "forbidden" }));
ipcMain.handle("license:deactivate", async (e) => (licGuard(e) ? license.deactivate() : { ok: false, error: "forbidden" }));

function createWindow() {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, "preload-license.js"),
    },
  });
  win = w;

  win.once("ready-to-show", () => {
    if (!isSmoke) win.show();
  });

  // Judul window desktop tetap "ICD-10 Codex 2010"; dokumen web memakai
  // judul aslinya (layout.tsx) tanpa perubahan.
  win.on("page-title-updated", (e) => e.preventDefault());
  win.setTitle("ICD-10 Codex 2010 (EN + Indonesia)");

  // Navigasi hanya boleh ke dalam app; target _blank dibuka di browser sistem
  // hanya untuk domain yang dikenal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_OK.test(url)) {
      console.log("EXT-OPEN", url);
      void shell.openExternal(url);
    } else {
      console.log("EXT-DENY", url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://local/")) e.preventDefault();
  });

  // Blok DevTools manual di rilis (F12 / Ctrl+Shift+I).
  if (app.isPackaged) {
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown") return;
      const combo =
        input.key === "F12" ||
        (input.control && input.shift && /^I$/.test(input.key));
      if (combo) e.preventDefault();
    });
  }

  if (isSmoke) runSmoke(win.webContents);

  win.loadURL("app://local/");
  win.on("closed", () => win.destroy());

  // Siklus lisensi: status awal ke renderer + renew otomatis tiap 15 menit.
  license.broadcast(() => win);
  license.startAutoRenew(() => win);
}

app.on("window-all-closed", () => app.quit());

// Mode uji: ICD10_SMOKE=1 → tanpa window, baca konsol, cek data, screenshot, exit.
function runSmoke(wc) {
  const errors = [];
  wc.on("console-message", (e) => {
    if (e.level >= 3) errors.push(e.message);
  });
  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) errors.push(`fail-load ${code} ${desc} ${url}`);
  });
  wc.on("render-process-gone", (_e, details) =>
    errors.push("render-gone " + details?.reason)
  );
  wc.on("preload-error", (_e, _p, err) => errors.push("preload: " + err?.message));
  setTimeout(async () => {
    try {
      const r = await wc.executeJavaScript(
        `(async () => {
          const j = await fetch("data/icd10.json").then((r) => r.json());
          // Uji policy window.open: keduanya harus menolak pembuatan window
          // (eksternal ditangani main process; log EXT-OPEN/EXT-DENY di stdout).
          const ok = window.open("https://icd.who.int/browse10/2010/en");
          const bad = window.open("https://evil.example.com/x");
          return {
            idTerms: Object.keys(j.idTerms ?? {}).length,
            bodyLen: document.body.innerText.length,
            chapters: [...document.querySelectorAll("button")].filter((b) =>
              /^(I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII)(?=[A-Z])/.test(b.textContent ?? "")
            ).length,
            noWindowAllowed: ok === null,
            noWindowDenied: bad === null,
            nodeExposed: typeof require !== "undefined" || typeof process !== "undefined",
            licenseApi: typeof window.icd10License === "object" && window.icd10License !== null,
          };
        })()`,
        true
      );
      // Lisensi: dengan ICD10_LIC_KEY + ICD10_LICENSE_URL → aktivasi harus sukses,
      // lease harus lolos verifikasi, dan tamper 1 karakter harus ditolak.
      let licInfo = { state: "unactivated-no-env" };
      const key = process.env.ICD10_LIC_KEY;
      if (key && license.serverUrl()) {
        const act = await license.activate(key);
        const st = await license.getStatus();
        const self = await license.selfTest();
        licInfo = {
          state: st.state,
          activateOk: act.ok === true,
          activateError: act.error ?? null,
          canUseApp: st.canUseApp === true,
          ...self,
        };
      } else {
        const st = await license.getStatus();
        licInfo = { state: st.state };
      }
      const shot = process.env.ICD10_SMOKE_SHOT ?? path.join(app.getPath("temp"), "icd10-smoke.png");
      fss.writeFileSync(shot, (await wc.capturePage()).toPNG());
      console.log("SMOKE", JSON.stringify({ ...r, license: licInfo, errors, shot }));
      // Ekspektasi eksplisit (matriks uji negatif) menang atas kriteria default,
      // supaya run negatif dinilai lulus bila perilakunya memang sesuai.
      const expectState = process.env.ICD10_SMOKE_EXPECT_STATE;
      const expectError = process.env.ICD10_SMOKE_EXPECT_ERROR;
      const licOk = expectState
        ? licInfo.state === expectState &&
          (!expectError || licInfo.activateError === expectError)
        : key && license.serverUrl()
          ? licInfo.activateOk === true && licInfo.state === "active" &&
            licInfo.canUseApp === true && licInfo.selfTest === "ok"
          : ["unactivated-no-env", "unactivated", "grace", "active"].includes(licInfo.state);
      process.exit(
        r.idTerms >= 437 &&
          r.chapters >= 22 &&
          r.bodyLen > 2000 &&
          r.noWindowAllowed &&
          r.noWindowDenied &&
          !r.nodeExposed &&
          r.licenseApi === true &&
          licOk &&
          errors.length === 0
          ? 0
          : 1
      );
    } catch (e) {
      console.error("SMOKE-FAIL", e);
      process.exit(2);
    }
  }, 15000);
}
