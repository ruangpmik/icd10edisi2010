// Main process ICD-10 2010 Browser (Electron).
// Menyajikan hasil `next build` (folder out/) lewat protokol app://,
// bukan file:// — karena fetch() JSON gagal di file:// dan port lokal
// membuka celah bagi proses lain untuk menyadap.
const { app, BrowserWindow, Menu, Shell, session, protocol } = require("electron");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");

const isSmoke = process.env.ICD10_SMOKE === "1";
const OUT = path.join(__dirname, "..", "out");

// Protokol wajib didaftarkan sebelum app "ready".
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const CSP = [
  "default-src 'self'",
  // Next static export memakai inline script untuk hydration (self.__next_f);
  // tanpa server, nonce tidak tersedia. Ini trade-off yang diperlukan.
  "script-src 'self' 'unsafe-inline'",
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
const EXTERNAL_OK = /^https:\/\/(icd\.who\.int|www\.who\.int|docs\.google\.com)(\/|$)/;

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

app.setName("ICD-10 2010 Browser");
app.setAppUserModelId("id.ruangpmik.icd10browser");

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

    // Produksi: tanpa menu (mati reload, tanpa DevTools dari menu).
    if (app.isPackaged) Menu.setApplicationMenu(null);

    createWindow();
  });
}

function createWindow() {
  const win = new BrowserWindow({
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
    },
  });

  win.once("ready-to-show", () => {
    if (!isSmoke) win.show();
  });

  // Navigasi hanya boleh ke dalam app; target _blank dibuka di browser sistem
  // hanya untuk domain yang dikenal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_OK.test(url)) void Shell.openExternal(url);
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
}

app.on("window-all-closed", () => app.quit());

// Mode uji: ICD10_SMOKE=1 → tanpa window, baca konsol, cek data, screenshot, exit.
function runSmoke(wc) {
  const errors = [];
  wc.on("console-message", (e) => {
    if (e.level >= 3) errors.push(e.message);
  });
  wc.on("preload-error", (_e, _p, err) => errors.push("preload: " + err?.message));
  setTimeout(async () => {
    try {
      const r = await wc.executeJavaScript(
        `(async () => {
          const j = await fetch("data/icd10.json").then((r) => r.json());
          return {
            idTerms: Object.keys(j.idTerms ?? {}).length,
            bodyLen: document.body.innerText.length,
            chapters: [...document.querySelectorAll("button")].filter((b) =>
              /^(I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII)(?=[A-Z])/.test(b.textContent ?? "")
            ).length,
          };
        })()`,
        true
      );
      const shot = process.env.ICD10_SMOKE_SHOT ?? path.join(app.getPath("temp"), "icd10-smoke.png");
      fss.writeFileSync(shot, (await wc.capturePage()).toPNG());
      console.log("SMOKE", JSON.stringify({ ...r, errors, shot }));
      process.exit(r.idTerms >= 437 && r.chapters >= 22 && r.bodyLen > 2000 && errors.length === 0 ? 0 : 1);
    } catch (e) {
      console.error("SMOKE-FAIL", e);
      process.exit(2);
    }
  }, 15000);
}
