// Layanan lisensi — HANYA berjalan di main process Electron.
// Renderer tidak pernah memegang key/token; ia mendapat status terhitung
// lewat IPC sempit (lihat preload-license.js + main.js).
//
// Keamanan (dokumentasi jujur, F3.7):
// - Lease diverifikasi dengan public key Ed25519 allowlist (JWS EdDSA)
//   memakai shared/jws-verify.js — implementasi sama dengan server.
// - Simpanan lokal (key + lease) dienkripsi safeStorage (DPAPI Windows)
//   bila tersedia; fallback plaintext dengan peringatan. Penyimpanan lokal
//   BUKAN batas keamanan — pemilik perangkat selalu bisa membongkarnya.
// - Jam lokal tidak tepercaya sepenuhnya: skew dihitung dari claims.iat
//   server saat validasi sukses, dan batas waktu bawah monotnik (maxTime)
//   disimpan agar rollback jam tidak memperpanjang grace.
"use strict";

const crypto = require("node:crypto");
const fss = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { verifyJws } = require(path.join(__dirname, "..", "shared", "jws-verify.js"));

const ISS = "icd10-licensing";
const AUD = "icd10-codex-2010";
const PRODUCT = "icd10-codex";
const KEY_RE = /^ICD10-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/;
const FETCH_TIMEOUT_MS = 8000;

// ---------- konfigurasi ----------

function loadJson(p, fallback) {
  try {
    return JSON.parse(fss.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

const cfg = loadJson(path.join(__dirname, "license-config.json"), {});
const publicKeys = loadJson(path.join(__dirname, "public-keys.json"), []);

function serverUrl() {
  return (process.env.ICD10_LICENSE_URL || cfg.serverUrl || "").replace(/\/+$/, "");
}
function graceSeconds() {
  const d = Number(process.env.ICD10_LICENSE_GRACE_DAYS ?? cfg.graceDays ?? 4);
  return Math.max(0, d) * 86400;
}

// ---------- penyimpanan ----------

function storePath() {
  return path.join(app.getPath("userData"), "license.json");
}
function installationPath() {
  return path.join(app.getPath("userData"), "installation.json");
}

function getInstallationId() {
  const f = installationPath();
  let j = loadJson(f, null);
  if (!j || typeof j.installationId !== "string") {
    j = { installationId: crypto.randomUUID(), createdAt: new Date().toISOString() };
    fss.mkdirSync(path.dirname(f), { recursive: true });
    fss.writeFileSync(f, JSON.stringify(j, null, 2));
  }
  return j.installationId;
}

// safeStorage lintas versi: utamakan API asinkron, fallback ke sinkron.
async function encryptionAvailable() {
  try {
    if (typeof safeStorage.isAsyncEncryptionAvailable === "function") {
      return await safeStorage.isAsyncEncryptionAvailable();
    }
    if (typeof safeStorage.getEncryptionAvailable === "function") {
      return await safeStorage.getEncryptionAvailable();
    }
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function saveStore(data) {
  try {
    if (await encryptionAvailable()) {
      const buf = typeof safeStorage.encryptStringAsync === "function"
        ? await safeStorage.encryptStringAsync(JSON.stringify(data))
        : safeStorage.encryptString(JSON.stringify(data));
      fss.writeFileSync(storePath(), JSON.stringify({ v: 1, enc: buf.toString("base64") }));
      return;
    }
  } catch (e) {
    console.warn("LICENSE: safeStorage tidak tersedia — simpan plaintext:", e?.message);
  }
  fss.writeFileSync(storePath(), JSON.stringify({ v: 1, plain: data }));
}

async function loadStore() {
  const f = storePath();
  if (!fss.existsSync(f)) return {};
  const j = loadJson(f, null);
  if (!j || j.v !== 1) return {};
  if (j.plain && typeof j.plain === "object") return j.plain;
  if (j.enc) {
    try {
      const buf = Buffer.from(j.enc, "base64");
      const out = typeof safeStorage.decryptStringAsync === "function"
        ? await safeStorage.decryptStringAsync(buf)
        : safeStorage.decryptString(buf);
      // Electron >=45: decryptStringAsync mengembalikan {result, shouldReEncrypt}.
      const s = typeof out === "string" ? out : out?.result;
      if (typeof s !== "string") throw new Error("bentuk hasil decrypt tak dikenal");
      return JSON.parse(s);
    } catch {
      return { _corrupt: true };
    }
  }
  return {};
}

// ---------- state mesin lisensi ----------

// store: { key?, lease?, maxTime?, skew?, serverState? }
// serverState: status terminal dari server pada validasi terakhir
//   ("revoked" | "license_expired" | "license_disabled" | "quota_exceeded")
// now() = jam lokal + skew server (dikurangi guard rollback via maxTime).

let current = null; // status terakhir yg dikirim ke renderer
let listeners = [];

function nowSec(store) {
  const skew = store.skew ?? 0;
  const t = Math.floor(Date.now() / 1000) + skew;
  // guard rollback jam: waktu efektif tidak pernah di bawah maxTime
  return Math.max(t, store.maxTime ?? 0);
}

function bumpMaxTime(store) {
  const wall = Math.floor(Date.now() / 1000) + (store.skew ?? 0);
  // toleransi 10 menit untuk jitter jam
  store.maxTime = Math.max(store.maxTime ?? 0, wall - 600);
}

// Status terminal dari server: memblokir walau lease lama masih ada.
const TERMINAL = new Set(["revoked", "license_expired", "license_disabled"]);
const TERMINAL_MSG = {
  revoked: "Lisensi dicabut oleh penerbit. Hubungi dukungan RUANGPMIK.",
  license_expired: "Masa berlaku lisensi habis. Perpanjang ke penjual Anda.",
  license_disabled: "Lisensi dinonaktifkan. Hubungi dukungan RUANGPMIK.",
};

function deriveStatus(store) {
  const base = {
    product: PRODUCT,
    canUseApp: false,
    state: "unactivated",
    features: [],
    expiresAt: null,
    graceUntil: null,
    message: null,
  };
  if (store._corrupt) {
    return { ...base, state: "invalid", message: "Simpanan lisensi rusak. Aktifkan ulang dengan license key Anda." };
  }
  // Keputusan server yang bersifat terminal menang atas lease lokal.
  if (store.serverState && TERMINAL.has(store.serverState)) {
    return { ...base, state: store.serverState, message: TERMINAL_MSG[store.serverState] };
  }
  if (!store.lease && !store.key) return base;

  if (!store.lease) {
    // key tersimpan tapi belum ada lease (mis. aktivasi terakhir gagal jaringan)
    return { ...base, state: "unactivated", message: "Lisensi belum teraktivasi di perangkat ini." };
  }

  const v = verifyJws(store.lease, { allowedKeys: publicKeys });
  // Signature/klaim waktu tidak sah (bukan sekadar kedaluwarsa) → perlu online.
  if (!v.ok && v.reason !== "expired") {
    return {
      ...base,
      state: "invalid",
      message: "Lease tidak valid. Butuh koneksi untuk validasi ulang — data Anda aman.",
    };
  }
  const c = v.claims;
  if (!c || c.iss !== ISS || c.aud !== AUD || c.product !== PRODUCT) {
    return { ...base, state: "invalid", message: "Lease bukan untuk produk ini." };
  }
  const now = nowSec(store);
  if (v.ok && c.exp > now) {
    return {
      ...base,
      state: "active",
      canUseApp: true,
      features: Array.isArray(c.features) ? c.features : [],
      expiresAt: c.exp,
    };
  }
  // Kedaluwarsa (signature sah) → masa tenggang
  const graceUntil = c.exp + graceSeconds();
  if (now < graceUntil) {
    return {
      ...base,
      state: "grace",
      canUseApp: true,
      features: Array.isArray(c.features) ? c.features : [],
      expiresAt: c.exp,
      graceUntil,
      message: "Masa tenggang offline — hubungkan internet untuk validasi ulang.",
    };
  }
  return {
    ...base,
    state: "expired",
    expiresAt: c.exp,
    message: "Masa tenggang habis. Aktifkan ulang / validasi online diperlukan — data Anda aman.",
  };
}

// ---------- klien HTTP (main process; bebas CSP renderer) ----------

async function api(pathname, body) {
  const url = serverUrl() + pathname;
  if (!serverUrl()) {
    return { error: "network", detail: "serverUrl kosong" };
  }
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { error: "network" };
  }
  let j = null;
  try {
    j = await r.json();
  } catch {}
  if (r.ok) return { ok: true, j };
  const code = typeof j?.error === "string" ? j.error : "server_error";
  return { error: code, status: r.status };
}

function applyServerResult(store, res) {
  // res: hasil api(). Mutasi store; simpan via saveStore oleh pemanggil.
  if (res.ok) {
    const v = verifyJws(res.j.lease, { allowedKeys: publicKeys });
    if (!v.ok) return { ok: false, error: "server_returned_bad_lease" };
    const c = v.claims;
    // skew: claims.iat diterbitkan server-baru saja → selisih dg jam lokal
    store.skew = c.iat - Math.floor(Date.now() / 1000);
    store.lease = res.j.lease;
    store.serverState = null;
    bumpMaxTime(store);
    return { ok: true };
  }
  if (res.error === "network" || res.error === "rate_limited" || res.status === 500) {
    return { ok: false, error: "network" }; // pertahankan state/grace
  }
  if (["revoked", "license_expired", "license_disabled", "quota_exceeded", "invalid_key"].includes(res.error)) {
    // Jangan hapus lease lama: kegagalan aktivasi kunci lain / salah ketik tidak
    // boleh mengunci pengguna yang lisensinya masih sah. Hanya status terminal
    // yang memblokir (lihat deriveStatus), dan itu pun tidak menghapus data.
    store.serverState = res.error;
    return { ok: false, error: res.error };
  }
  return { ok: false, error: res.error };
}

// ---------- API publik (dipakai main.js + IPC + smoke) ----------

async function getStatus() {
  const store = await loadStore();
  bumpMaxTime(store);
  const st = deriveStatus(store);
  st.installationId = getInstallationId();
  return st;
}

async function activate(key) {
  if (typeof key !== "string" || !KEY_RE.test(key.trim())) {
    return { ok: false, error: "bad_key_format" };
  }
  key = key.trim().toUpperCase();
  const store = await loadStore();
  const res = await api("/v1/activate", { licenseKey: key, installationId: getInstallationId() });
  const ap = applyServerResult(store, res);
  if (ap.ok) {
    store.key = key;
    await saveStore(store);
    return { ok: true, status: deriveStatus(store) };
  }
  if (ap.error === "network") {
    // jangan timpa state; key disimpan agar bisa dicoba ulang otomatis
    store.key = key;
    await saveStore(store);
    return { ok: false, error: "network", status: deriveStatus(store) };
  }
  await saveStore(store);
  const msg = {
    invalid_key: "License key tidak dikenali.",
    revoked: "Lisensi ini dicabut oleh penerbit.",
    license_expired: "Masa berlaku lisensi telah habis.",
    license_disabled: "Lisensi dinonaktifkan.",
    quota_exceeded: "Batas jumlah perangkat tercapai. Deaktivasi perangkat lain terlebih dahulu.",
    server_returned_bad_lease: "Server mengembalikan lease tidak valid.",
  }[ap.error] ?? "Aktivasi gagal.";
  return { ok: false, error: ap.error, message: msg, status: deriveStatus(store) };
}

async function renew() {
  const store = await loadStore();
  if (!store.lease) {
    if (store.key) return activate(store.key); // pemulihan: lease hilang → aktivasi ulang
    return { ok: false, error: "unactivated" };
  }
  const res = await api("/v1/renew", { lease: store.lease, installationId: getInstallationId() });
  let ap = applyServerResult(store, res);
  if (!ap.ok && ap.error === "invalid_lease") {
    // lease lokal ditolak server (kedaluwarsa) → coba aktivasi ulang dgn key
    if (store.key) return activate(store.key);
  }
  if (ap.ok) {
    await saveStore(store);
    return { ok: true, status: deriveStatus(store) };
  }
  await saveStore(store);
  return { ok: false, error: ap.error, status: deriveStatus(store) };
}

async function deactivate() {
  const store = await loadStore();
  if (!store.lease) return { ok: false, error: "unactivated" };
  const res = await api("/v1/deactivate", { lease: store.lease, installationId: getInstallationId() });
  if (res.ok || res.error === "invalid_lease" || res.error === "network") {
    // lease dilepas lokal selalu; kegagalan jaringan bukan alasan mengunci slot
    store.lease = null;
    store.serverState = null;
    await saveStore(store);
    return { ok: true, offline: res.error === "network" || undefined, status: deriveStatus(store) };
  }
  return { ok: false, error: res.error, status: deriveStatus(store) };
}

// ---------- siklus otomatis ----------

let timer = null;
function startAutoRenew(getWin) {
  const tick = async () => {
    try {
      const store = await loadStore();
      const st = deriveStatus(store);
      // Renew bila sisa masa lease < 50% (bukan ambang tetap, agar cocok untuk
      // lease pendek maupun panjang), atau saat grace/butuh pemulihan.
      const v = store.lease ? verifyJws(store.lease, { allowedKeys: publicKeys }) : null;
      const c = v?.claims;
      const halfLife = c ? (c.exp - c.iat) / 2 : 0;
      const need =
        (st.state === "active" && st.expiresAt && st.expiresAt - nowSec(store) < halfLife) ||
        st.state === "grace" ||
        (st.state === "unactivated" && store.key);
      if (need && serverUrl()) await renew();
      broadcast(getWin);
    } catch (e) {
      console.warn("LICENSE: tick gagal:", e?.message);
    }
  };
  timer = setInterval(tick, 15 * 60 * 1000);
  tick();
}

async function broadcast(getWin) {
  const st = await getStatus();
  const key = JSON.stringify(st);
  if (key === JSON.stringify(current)) return;
  current = st;
  const win = getWin();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send("license-status", st);
    } catch {}
  }
}

// ---------- self-test (dipakai mode smoke) ----------

// Verifikasi lease tersimpan: signature sah HARUS lolos; 1 karakter ubahan
// HARUS ditolak. Tidak pernah mengembalikan isi lease/key.
async function selfTest() {
  const store = await loadStore();
  if (!store.lease) return { selfTest: "no-lease" };
  const good = verifyJws(store.lease, { allowedKeys: publicKeys }).ok;
  const [h, p, s] = store.lease.split(".");
  // Ubah karakter PERTAMA signature: 6 bit penuh signifikan. (Karakter terakhir
  // hanya membawa 2 bit — menukarnya bisa menghasilkan byte identik.)
  const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
  const tamper = verifyJws(h + "." + p + "." + flipped, { allowedKeys: publicKeys }).ok;
  return { selfTest: good && !tamper ? "ok" : "FAIL", goodSignature: good, tamperRejected: !tamper };
}

module.exports = { getStatus, activate, renew, deactivate, startAutoRenew, broadcast, selfTest, serverUrl, _internals: { deriveStatus, nowSec, verifyJws, publicKeys } };
