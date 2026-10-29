// F4 ops test matrix: rate limiter durable, peran admin/support, CLI admin,
// TLS, dan pengaman bind jaringan. Dijalankan dengan server + DB terpisah dari
// suite fungsional (run-tests.mjs) agar batas rate tidak saling mengganggu.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, "..");
const KID = "ops-test";
const ADMIN = "admin-ops-" + crypto.randomBytes(8).toString("hex");
const SUPPORT = "support-ops-" + crypto.randomBytes(8).toString("hex");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lic-ops-"));
const keysDir = path.join(tmp, "keys");
fs.mkdirSync(keysDir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(path.join(keysDir, `${KID}.private.pem`), privateKey.export({ type: "pkcs8", format: "pem" }));
fs.writeFileSync(path.join(keysDir, `${KID}.public.pem`), publicKey.export({ type: "spki", format: "pem" }));

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log("PASS " + name + (extra ? " — " + extra : ""));
  } else {
    fail++;
    console.log("FAIL " + name + (extra ? " — " + extra : ""));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
let nextPort = 19600 + Math.floor(Math.random() * 300);

// Selaraskan ke awal window rate limit agar uji deterministik (tidak melewati
// batas window di tengah urutan request).
async function alignWindow(windowMs) {
  const wait = windowMs - (Date.now() % windowMs);
  await sleep(wait + 30);
}

function healthOnce(base) {
  return new Promise((resolve) => {
    if (base.startsWith("https:")) {
      const req = https.get(base + "/healthz", { rejectUnauthorized: false, timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      return;
    }
    fetch(base + "/healthz").then((r) => resolve(r.ok)).catch(() => resolve(false));
  });
}

async function waitUp(base, proc, logRef) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error("server keluar: " + logRef.text);
    if (await healthOnce(base)) return;
    await sleep(100);
  }
  throw new Error("server tidak siap: " + logRef.text);
}

async function startServer({ dbPath, env = {}, tls = null }) {
  const port = nextPort++;
  const logRef = { text: "" };
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      LICENSE_HOST: "127.0.0.1",
      LICENSE_PORT: String(port),
      LICENSE_SIGNING_KID: KID,
      LICENSE_KEYS_DIR: keysDir,
      LICENSE_DB: dbPath,
      LICENSE_ADMIN_TOKEN: ADMIN,
      LICENSE_SUPPORT_TOKEN: SUPPORT,
      LICENSE_LEASE_DAYS: "3",
      ...(tls ? { LICENSE_TLS_CERT: tls.cert, LICENSE_TLS_KEY: tls.key } : {}),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => (logRef.text += d));
  proc.stderr.on("data", (d) => (logRef.text += d));
  const base = `${tls ? "https" : "http"}://127.0.0.1:${port}`;
  await waitUp(base, proc, logRef);
  return {
    port,
    base,
    log: () => logRef.text,
    stop: async () => {
      if (proc.exitCode === null) proc.kill();
      for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(50);
    },
  };
}

const post = async (base, p, body, token) => {
  const r = await fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j, headers: r.headers };
};
const get = async (base, p, token) => {
  const r = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j };
};
const patch = async (base, p, body, token) => {
  const r = await fetch(base + p, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j };
};
const del = async (base, p, token) => {
  const r = await fetch(base + p, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j };
};

// Kunci lisensi tidak valid (format sah, tidak dikenal) — cukup untuk menguji
// rate limit tanpa membuat lisensi sungguhan. Alfabet base32: A-Z tanpa I/O + 2-7.
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ234567";
const bogusKey = () => {
  let s = "";
  for (let i = 0; i < 20; i++) s += B32[crypto.randomInt(B32.length)];
  return "ICD10-" + s.match(/.{5}/g).join("-");
};

// ---------- F4.3 rate limiter ----------

async function testRateLimit() {
  const dbPath = path.join(tmp, "rate", "rate.db");
  const high = {
    LICENSE_RATE_ACTIVATE: "1000",
    LICENSE_RATE_ACTIVATE_KEY: "1000",
    LICENSE_RATE_ACTIVATE_INSTALLATION: "1000",
  };
  const WINDOW = 60_000;  // window panjang: restart server harus tetap di window yang sama
  const SHORT = 8_000;    // window pendek untuk uji yang tidak butuh restart

  // 1) batas per IP + retry-after
  let s = await startServer({
    dbPath,
    env: {
      ...high,
      LICENSE_RATE_ACTIVATE: "3",
      LICENSE_RATE_WINDOW_MS: String(WINDOW),
    },
  });
  await alignWindow(WINDOW);
  const st = [];
  let last = null;
  for (let i = 0; i < 4; i++) {
    last = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
    st.push(last.status);
  }
  ok("rate: 3 request pertama lolos, request ke-4 → 429", st.slice(0, 3).every((x) => x === 403) && st[3] === 429, st.join(","));
  ok("rate: respons 429 menyertakan Retry-After", Number(last.headers.get("retry-after")) >= 1, last.headers.get("retry-after") ?? "null");

  // 2) bertahan setelah restart server (DB yang sama, window yang sama)
  await s.stop();
  s = await startServer({ dbPath, env: { ...high, LICENSE_RATE_ACTIVATE: "3", LICENSE_RATE_WINDOW_MS: String(WINDOW) } });
  const afterRestart = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  ok("rate: batas tetap berlaku setelah restart server", afterRestart.status === 429, `status=${afterRestart.status}`);
  await s.stop();

  // 3) pulih otomatis pada window berikutnya (window pendek)
  const dbRecover = path.join(tmp, "rate", "recover.db");
  s = await startServer({
    dbPath: dbRecover,
    env: { ...high, LICENSE_RATE_ACTIVATE: "2", LICENSE_RATE_WINDOW_MS: "1500" },
  });
  await alignWindow(1500);
  const a1 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  const a2 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  const a3 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  await alignWindow(1500);
  const a4 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  ok("rate: pulih pada window berikutnya (bukan kunci permanen)",
    a1.status === 403 && a2.status === 403 && a3.status === 429 && a4.status === 403,
    `${a1.status},${a2.status},${a3.status},${a4.status}`);
  await s.stop();

  // 4) request simultan tidak melampaui batas
  const dbConc = path.join(tmp, "rate", "concurrent.db");
  s = await startServer({
    dbPath: dbConc,
    env: { ...high, LICENSE_RATE_ACTIVATE: "5", LICENSE_RATE_WINDOW_MS: String(SHORT) },
  });
  await alignWindow(SHORT);
  const results = await Promise.all(
    Array.from({ length: 30 }, () => post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() }))
  );
  const allowed = results.filter((r) => r.status !== 429).length;
  const blocked = results.filter((r) => r.status === 429).length;
  ok("rate: 30 request simultan → tepat 5 lolos, 25 ditolak", allowed === 5 && blocked === 25, `lolos=${allowed} ditolak=${blocked}`);
  await s.stop();

  // 5) bucket per license key (bukan hanya IP)
  const dbKey = path.join(tmp, "rate", "key.db");
  s = await startServer({
    dbPath: dbKey,
    env: {
      ...high,
      LICENSE_RATE_ACTIVATE: "1000",
      LICENSE_RATE_ACTIVATE_KEY: "2",
      LICENSE_RATE_WINDOW_MS: String(SHORT),
    },
  });
  await alignWindow(SHORT);
  const k = bogusKey();
  const k1 = await post(s.base, "/v1/activate", { licenseKey: k, installationId: uuid() });
  const k2 = await post(s.base, "/v1/activate", { licenseKey: k, installationId: uuid() });
  const k3 = await post(s.base, "/v1/activate", { licenseKey: k, installationId: uuid() });
  const other = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  ok("rate: batas per license key berlaku (IP sama)", k1.status === 403 && k2.status === 403 && k3.status === 429,
    `${k1.status},${k2.status},${k3.status}`);
  ok("rate: license key lain pada IP sama tetap dilayani", other.status === 403, `status=${other.status}`);
  await s.stop();

  // 6) bucket per installation id
  const dbInst = path.join(tmp, "rate", "inst.db");
  s = await startServer({
    dbPath: dbInst,
    env: {
      ...high,
      LICENSE_RATE_ACTIVATE: "1000",
      LICENSE_RATE_ACTIVATE_INSTALLATION: "2",
      LICENSE_RATE_WINDOW_MS: String(SHORT),
    },
  });
  await alignWindow(SHORT);
  const inst = uuid();
  const i1 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: inst });
  const i2 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: inst });
  const i3 = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: inst });
  ok("rate: batas per installation id berlaku", i1.status === 403 && i2.status === 403 && i3.status === 429,
    `${i1.status},${i2.status},${i3.status}`);
  await s.stop();

  // 7) penyimpanan rate limit gagal → fail-open + audit (bukan 500 / lockout)
  const dbFail = path.join(tmp, "rate", "failopen.db");
  s = await startServer({ dbPath: dbFail, env: { ...high, LICENSE_RATE_WINDOW_MS: String(WINDOW) } });
  const raw = new DatabaseSync(dbFail);
  raw.exec("DROP TABLE rate_limits");
  raw.close();
  const fo = await post(s.base, "/v1/activate", { licenseKey: bogusKey(), installationId: uuid() });
  await sleep(100);
  const auditDb = new DatabaseSync(dbFail, { readOnly: true });
  const seen = auditDb.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = 'rate_store_error'").get().n;
  auditDb.close();
  ok("rate: penyimpanan gagal → fail-open (bukan 500), tercatat di audit",
    (fo.status === 403 || fo.status === 429) && seen >= 1,
    `status=${fo.status} audit=${seen}`);
  await s.stop();
}

// ---------- F4.4 peran administratif ----------

async function testAdminRoles() {
  const dbPath = path.join(tmp, "roles", "roles.db");
  const s = await startServer({
    dbPath,
    env: {
      LICENSE_RATE_ACTIVATE: "1000",
      LICENSE_RATE_ACTIVATE_KEY: "1000",
      LICENSE_RATE_ACTIVATE_INSTALLATION: "1000",
      LICENSE_RATE_ADMIN: "1000",
      LICENSE_RATE_ADMIN_ROLE: "1000",
    },
  });

  const noTok = await get(s.base, "/admin/licenses");
  ok("admin: tanpa token → 401", noTok.status === 401, `status=${noTok.status}`);
  const badTok = await get(s.base, "/admin/licenses", "salah-" + ADMIN);
  ok("admin: token salah → 401", badTok.status === 401, `status=${badTok.status}`);

  const supList = await get(s.base, "/admin/licenses", SUPPORT);
  ok("admin: peran support boleh membaca daftar", supList.status === 200, `status=${supList.status}`);

  const supCreate = await post(s.base, "/admin/licenses", { maxActivations: 1 }, SUPPORT);
  ok("admin: peran support DILARANG membuat lisensi (403)", supCreate.status === 403 && supCreate.j?.error === "forbidden_role",
    `status=${supCreate.status} error=${supCreate.j?.error}`);

  const admCreate = await post(s.base, "/admin/licenses", { maxActivations: 2, note: "ops-test" }, ADMIN);
  const lic = admCreate.j?.license;
  ok("admin: peran admin boleh membuat lisensi (201 + key sekali tampil)", admCreate.status === 201 && /^ICD10(-[A-Z0-9]{5}){4}$/.test(lic?.licenseKey ?? ""),
    `status=${admCreate.status}`);
  // Pastikan DB tidak menyimpan key mentah.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare("SELECT key_hash FROM licenses WHERE id = ?").get(lic.id);
  db.close();
  const keyHash = crypto.createHash("sha256").update(lic.licenseKey).digest("hex");
  ok("admin: DB menyimpan hash SHA-256, bukan license key mentah", row?.key_hash === keyHash, "hash cocok");

  const supPatch = await patch(s.base, `/admin/licenses/${lic.id}`, { status: "disabled" }, SUPPORT);
  ok("admin: support DILARANG mengubah lisensi (403)", supPatch.status === 403, `status=${supPatch.status}`);
  const supRevoke = await post(s.base, `/admin/licenses/${lic.id}/revoke`, { reason: "x" }, SUPPORT);
  ok("admin: support DILARANG mencabut lisensi (403)", supRevoke.status === 403, `status=${supRevoke.status}`);

  const admPatch = await patch(s.base, `/admin/licenses/${lic.id}`, { maxActivations: 3 }, ADMIN);
  ok("admin: admin boleh mengubah kuota", admPatch.status === 200, `status=${admPatch.status}`);

  const act = await post(s.base, "/v1/activate", { licenseKey: lic.licenseKey, installationId: uuid() });
  ok("admin: aktivasi perangkat berhasil untuk lisensi aktif", act.status === 200 && act.j?.lease, `status=${act.status}`);
  const lics = await get(s.base, `/admin/licenses/${lic.id}/activations`, SUPPORT);
  const actId = lics.j?.activations?.[0]?.id;
  ok("admin: support boleh melihat aktivasi", lics.status === 200 && Boolean(actId), `status=${lics.status}`);

  const admAudit = await get(s.base, "/admin/audit", ADMIN);
  const aud = admAudit.j?.audit ?? [];
  ok("admin: percobaan peran support tercatat di audit",
    aud.some((a) => a.event === "admin_denied" && String(a.detail ?? "").includes("role=support")),
    `${aud.length} entri`);

  const supRelease = await del(s.base, `/admin/activations/${actId}`, SUPPORT);
  ok("admin: support boleh melepas aktivasi (operasi support sah)", supRelease.status === 200, `status=${supRelease.status}`);

  // Rate limit admin per IP
  await s.stop();
  const dbAdminRate = path.join(tmp, "roles", "admin-rate.db");
  const s2 = await startServer({
    dbPath: dbAdminRate,
    env: {
      LICENSE_RATE_ADMIN: "3",
      LICENSE_RATE_ADMIN_ROLE: "1000",
      LICENSE_RATE_WINDOW_MS: "8000",
    },
  });
  await alignWindow(8000);
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await get(s2.base, "/admin/licenses", ADMIN)).status);
  ok("rate: endpoint admin dibatasi per IP (3 lalu 429)",
    codes.slice(0, 3).every((c) => c === 200) && codes[3] === 429, codes.join(","));

  // ---------- CLI admin ----------
  const cli = path.join(ROOT, "admin-cli.mjs");
  const runCli = (args, token) =>
    execFileSync(process.execPath, [cli, ...args], {
      env: { ...process.env, LICENSE_ADMIN_URL: s3.base, LICENSE_ADMIN_TOKEN: token ?? ADMIN },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  // Server s2 sedang kena rate limit admin per IP; pakai server baru untuk CLI.
  await s2.stop();
  const dbCli = path.join(tmp, "roles", "cli.db");
  const s3 = await startServer({ dbPath: dbCli, env: { LICENSE_RATE_ADMIN: "1000", LICENSE_RATE_ADMIN_ROLE: "1000" } });

  let cliHealth = "";
  try {
    cliHealth = execFileSync(process.execPath, [cli, "health"], {
      env: { ...process.env, LICENSE_ADMIN_URL: s3.base },
      encoding: "utf8",
    });
  } catch (e) {
    cliHealth = "GAGAL " + (e.stderr ?? e.message);
  }
  ok("CLI: health berfungsi tanpa token", cliHealth.includes('"ok":true'), cliHealth.trim().slice(0, 60));

  let cliSupportCreate = { code: 0, out: "" };
  try {
    const out = execFileSync(process.execPath, [cli, "create", "--max", "1"], {
      env: { ...process.env, LICENSE_ADMIN_URL: s3.base, LICENSE_SUPPORT_TOKEN: SUPPORT, LICENSE_ADMIN_TOKEN: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    cliSupportCreate.out = out;
  } catch (e) {
    cliSupportCreate = { code: e.status ?? 1, out: String(e.stderr ?? "") };
  }
  ok("CLI: support ditolak saat create (exit != 0, pesan 403)", cliSupportCreate.code !== 0 && cliSupportCreate.out.includes("403"),
    cliSupportCreate.out.trim().slice(0, 80));

  const cliCreate = runCli(["create", "--max", "2", "--note", "cli-test"]);
  let created = null;
  try {
    created = JSON.parse(cliCreate.slice(cliCreate.indexOf("{"), cliCreate.lastIndexOf("}") + 1));
  } catch {}
  ok("CLI: create mengembalikan lisensi + licenseKey", Boolean(created?.id) && /^ICD10(-[A-Z0-9]{5}){4}$/.test(created?.licenseKey ?? ""));

  let revokeNoYes = { code: 0, out: "" };
  try {
    revokeNoYes.out = execFileSync(process.execPath, [cli, "revoke", created.id], {
      env: { ...process.env, LICENSE_ADMIN_URL: s3.base, LICENSE_ADMIN_TOKEN: ADMIN },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    revokeNoYes = { code: e.status ?? 1, out: String(e.stderr ?? "") };
  }
  ok("CLI: revoke tanpa --yes ditolak (exit 2, tidak ada request)", revokeNoYes.code === 2 && revokeNoYes.out.includes("--yes"),
    `exit=${revokeNoYes.code}`);

  const cliRevoke = runCli(["revoke", created.id, "--yes", "--reason", "uji-cli"]);
  ok("CLI: revoke dengan --yes berhasil", cliRevoke.includes("OK: lisensi dicabut"), cliRevoke.trim());

  const cliList = runCli(["list"]);
  ok("CLI: list menampilkan status revoked", cliList.includes(created.id) && cliList.includes("revoked"), cliList.split("\n")[0]);

  // Lisensi yang sudah revoked tetap ada (tidak ada penghapusan permanen).
  const dbCheck = new DatabaseSync(dbCli, { readOnly: true });
  const still = dbCheck.prepare("SELECT status FROM licenses WHERE id = ?").get(created.id);
  dbCheck.close();
  ok("CLI: revoke bersifat soft (baris lisensi tetap ada)", still?.status === "revoked", `status=${still?.status}`);

  await s3.stop();
  await s.stop();
}

// ---------- F4.2 TLS & bind ----------

function findOpenssl() {
  const cands = [
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
  ];
  for (const c of cands) {
    try {
      execFileSync(c, ["version"], { stdio: "ignore" });
      return c;
    } catch {}
  }
  return null;
}

async function testTlsAndBind() {
  const openssl = findOpenssl();
  if (!openssl) {
    console.log("SKIP TLS: openssl tidak tersedia — uji TLS tidak dijalankan (bukan PASS)");
    return;
  }
  const tlsDir = path.join(tmp, "tls");
  fs.mkdirSync(tlsDir, { recursive: true });
  const cert = path.join(tlsDir, "cert.pem");
  const key = path.join(tlsDir, "key.pem");
  execFileSync(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
    "-keyout", key, "-out", cert,
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });

  const s = await startServer({
    dbPath: path.join(tmp, "tls", "tls.db"),
    tls: { cert, key },
    env: { LICENSE_RATE_ADMIN: "1000" },
  });
  const body = await new Promise((resolve, reject) => {
    const req = https.get(`${s.base}/healthz`, { rejectUnauthorized: false }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
  ok("TLS: server melayani HTTPS (sertifikat diuji dengan rejectUnauthorized=false)",
    body.status === 200 && body.body.includes('"ok":true'), `status=${body.status}`);
  ok("TLS: log server menyatakan https", s.log().includes("https://127.0.0.1"), s.log().split("\n")[0].slice(0, 80));

  // HTTP polos ke port TLS harus gagal (bukan dilayani sebagai plaintext).
  const plain = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${s.port}/healthz`, { timeout: 3000 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on("error", () => resolve({ status: 0 }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0 }); });
  });
  ok("TLS: request HTTP polos ke port TLS tidak dilayani", plain.status === 0 || plain.status >= 400, `status=${plain.status}`);
  await s.stop();

  // Guard: bind non-loopback tanpa TLS harus menolak start.
  const guard = await new Promise((resolve) => {
    const proc = spawn(process.execPath, ["server.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        LICENSE_HOST: "0.0.0.0",
        LICENSE_PORT: String(nextPort++),
        LICENSE_SIGNING_KID: KID,
        LICENSE_KEYS_DIR: keysDir,
        LICENSE_DB: path.join(tmp, "tls", "guard.db"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    proc.on("exit", (code) => resolve({ code, out }));
    setTimeout(() => { proc.kill(); resolve({ code: -1, out: out + " (timeout)" }); }, 5000);
  });
  ok("bind: non-loopback tanpa TLS ditolak saat start (exit 1 + FATAL)",
    guard.code === 1 && guard.out.includes("FATAL"), `exit=${guard.code}`);
}

async function testDbFailures() {
  const spawnExit = (dbPath) =>
    new Promise((resolve) => {
      const proc = spawn(process.execPath, ["server.mjs"], {
        cwd: ROOT,
        env: {
          ...process.env,
          LICENSE_HOST: "127.0.0.1",
          LICENSE_PORT: String(nextPort++),
          LICENSE_SIGNING_KID: KID,
          LICENSE_KEYS_DIR: keysDir,
          LICENSE_DB: dbPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      proc.stdout.on("data", (d) => (out += d));
      proc.stderr.on("data", (d) => (out += d));
      proc.on("exit", (code) => resolve({ code, out }));
      setTimeout(() => { proc.kill(); resolve({ code: -1, out: out + " (timeout)" }); }, 5000);
    });

  // DB korup: file berisi sampah, bukan SQLite.
  const corruptDir = path.join(tmp, "corrupt");
  fs.mkdirSync(corruptDir, { recursive: true });
  const corrupt = path.join(corruptDir, "license.db");
  fs.writeFileSync(corrupt, crypto.randomBytes(8192));
  const r1 = await spawnExit(corrupt);
  ok("DB korup: server menolak start (exit 1 + FATAL)", r1.code === 1 && r1.out.includes("FATAL"), `exit=${r1.code}`);
  ok("DB korup: tidak mencetak stack internal ke output",
    !/\n\s+at\s/.test(r1.out) && !r1.out.includes("node:internal"), r1.out.split(/\r?\n/)[0]);

  // Path DB tidak dapat dipakai (direktori, bukan file).
  const dirAsDb = path.join(tmp, "dir-as-db");
  fs.mkdirSync(dirAsDb, { recursive: true });
  const r2 = await spawnExit(dirAsDb);
  ok("DB tidak tersedia: server menolak start (exit 1 + FATAL)", r2.code === 1 && r2.out.includes("FATAL"), `exit=${r2.code}`);

  // Error response tidak membocorkan detail internal.
  const s = await startServer({ dbPath: path.join(tmp, "leak", "license.db") });
  const malformed = await fetch(s.base + "/v1/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{rusak",
  });
  const text = await malformed.text();
  ok("request JSON rusak: 400 generik tanpa detail internal",
    malformed.status === 400 && text === JSON.stringify({ error: "bad_request" }), text);
  const unknown = await fetch(s.base + "/v1/tidak-ada", { method: "POST" });
  const unknownText = await unknown.text();
  ok("route tidak dikenal: 404 generik tanpa detail internal",
    unknown.status === 404 && unknownText === JSON.stringify({ error: "not_found" }), unknownText);
  await s.stop();
}

try {
  await testRateLimit();
  await testAdminRoles();
  await testTlsAndBind();
  await testDbFailures();
} catch (e) {
  fail++;
  console.log("FAIL harness — " + (e?.stack ?? e));
} finally {
  console.log(`RINGKASAN: ${pass} PASS / ${fail} FAIL`);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  process.exit(fail === 0 ? 0 : 1);
}