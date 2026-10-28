// F4.6: uji backup konsisten, verifikasi integritas, restore ke lingkungan
// TERPISAH, dan penolakan backup rusak. Tidak pernah menimpa DB aktif.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, "..");
const KID = "backup-test";
const ADMIN = "admin-backup-" + crypto.randomBytes(8).toString("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lic-backup-"));
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
let nextPort = 19900 + Math.floor(Math.random() * 90);

async function startServer(dbPath) {
  const port = nextPort++;
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
      LICENSE_LEASE_DAYS: "3",
      LICENSE_RATE_ACTIVATE: "1000",
      LICENSE_RATE_ACTIVATE_KEY: "1000",
      LICENSE_RATE_ACTIVATE_INSTALLATION: "1000",
      LICENSE_RATE_ADMIN: "1000",
      LICENSE_RATE_ADMIN_ROLE: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error("server keluar: " + log);
    try {
      if ((await fetch(base + "/healthz")).ok) break;
    } catch {}
    await sleep(100);
    if (i === 99) throw new Error("server tidak siap: " + log);
  }
  return {
    base,
    log: () => log,
    stop: async () => {
      if (proc.exitCode === null) proc.kill();
      for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(50);
    },
  };
}

const req = async (base, method, p, body, token) => {
  const r = await fetch(base + p, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j };
};

const runNode = (script, args) => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
};

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

try {
  const dbPath = path.join(tmp, "live", "license.db");
  const s = await startServer(dbPath);

  // ---- data awal: 3 lisensi, 2 aktivasi, 1 revoke ----
  const created = [];
  for (let i = 0; i < 3; i++) {
    const r = await req(s.base, "POST", "/admin/licenses", { maxActivations: 2, note: "backup-" + i }, ADMIN);
    created.push(r.j.license);
  }
  const instA1 = uuid();
  const a1 = await req(s.base, "POST", "/v1/activate", { licenseKey: created[0].licenseKey, installationId: instA1 });
  const a2 = await req(s.base, "POST", "/v1/activate", { licenseKey: created[1].licenseKey, installationId: uuid() });
  ok("backup: data uji terbentuk (2 aktivasi)", a1.status === 200 && a2.status === 200, `${a1.status},${a2.status}`);
  await req(s.base, "POST", `/admin/licenses/${created[2].id}/revoke`, { reason: "uji-backup" }, ADMIN);

  const liveDb = new DatabaseSync(dbPath, { readOnly: true });
  const baseline = {
    licenses: liveDb.prepare("SELECT COUNT(*) AS n FROM licenses").get().n,
    activations: liveDb.prepare("SELECT COUNT(*) AS n FROM activations").get().n,
    statuses: liveDb.prepare("SELECT id, status FROM licenses ORDER BY id").all(),
    hashes: liveDb.prepare("SELECT id, key_hash FROM licenses ORDER BY id").all(),
  };
  liveDb.close();

  // ---- backup konsisten saat server berjalan ----
  const outDir = path.join(tmp, "backups");
  const b = runNode("scripts/backup.mjs", ["--db", dbPath, "--out", outDir, "--keep", "3"]);
  let meta = null;
  try {
    meta = JSON.parse(b.out);
  } catch {}
  ok("backup: berhasil + metadata JSON", b.code === 0 && Boolean(meta?.backup), b.err.trim().slice(0, 100));
  ok("backup: integrity_check = ok", meta?.integrity === "ok", String(meta?.integrity));
  ok("backup: jumlah lisensi/aktivasi sama dengan DB aktif",
    meta?.counts?.licenses === baseline.licenses && meta?.counts?.activations === baseline.activations,
    `lisensi=${meta?.counts?.licenses} aktivasi=${meta?.counts?.activations}`);
  const backupPath = path.join(outDir, meta.backup);
  ok("backup: sidecar SHA-256 cocok dengan file", fs.existsSync(backupPath + ".sha256") &&
    fs.readFileSync(backupPath + ".sha256", "utf8").trim().split(/\s+/)[0] === sha256File(backupPath));
  ok("backup: server tetap melayani setelah backup", (await fetch(s.base + "/healthz")).ok);

  // ---- restore ke lokasi terpisah ----
  const restoredPath = path.join(tmp, "restored", "license.db");
  const r1 = runNode("scripts/restore-verify.mjs", ["--backup", backupPath, "--dest", restoredPath]);
  let rj = null;
  try {
    rj = JSON.parse(r1.out);
  } catch {}
  ok("restore: verifikasi + salin ke DB terpisah", r1.code === 0 && rj?.ok === true, r1.err.trim().slice(0, 100));
  ok("restore: integrity + quick_check ok dan jumlah baris sama",
    rj?.integrity === "ok" && rj?.quick === "ok" && rj?.counts?.licenses === baseline.licenses &&
      rj?.counts?.activations === baseline.activations,
    JSON.stringify(rj?.counts ?? {}));

  const rs = new DatabaseSync(restoredPath, { readOnly: true });
  const restHashes = rs.prepare("SELECT id, key_hash FROM licenses ORDER BY id").all();
  const restStatuses = rs.prepare("SELECT id, status FROM licenses ORDER BY id").all();
  rs.close();
  ok("restore: hash license key utuh (lisensi lama tetap dapat diaktifkan)",
    JSON.stringify(restHashes) === JSON.stringify(baseline.hashes));
  ok("restore: status revoked ikut pulih (bukan kembali aktif)",
    JSON.stringify(restStatuses) === JSON.stringify(baseline.statuses));

  // ---- server dijalankan pada DB hasil restore ----
  const rsrv = await startServer(restoredPath);
  const listRestored = await req(rsrv.base, "GET", "/admin/licenses", undefined, ADMIN);
  ok("restore: server pada DB hasil restore membaca lisensi yang sama",
    listRestored.status === 200 && listRestored.j.licenses.length === baseline.licenses,
    `jumlah=${listRestored.j?.licenses?.length}`);

  const reuse = await req(rsrv.base, "POST", "/v1/activate", { licenseKey: created[0].licenseKey, installationId: uuid() });
  ok("restore: lisensi hasil restore dapat diaktivasi (kuota masih berlaku)", reuse.status === 200 && Boolean(reuse.j?.lease),
    `status=${reuse.status}`);

  const revoked = await req(rsrv.base, "POST", "/v1/activate", { licenseKey: created[2].licenseKey, installationId: uuid() });
  ok("restore: lisensi revoked tetap ditolak setelah restore", revoked.status === 403 && revoked.j?.error === "revoked",
    `status=${revoked.status} error=${revoked.j?.error}`);

  // Renew dengan lease dari aktivasi sebelum backup → membuktikan baris aktivasi &
  // signing key hasil restore konsisten.
  const before = await req(s.base, "POST", "/v1/renew", { lease: a1.j.lease, installationId: instA1 });
  const after = await req(rsrv.base, "POST", "/v1/renew", { lease: a1.j.lease, installationId: instA1 });
  ok("restore: renewal lease lama tetap sah di DB hasil restore",
    before.status === 200 && after.status === 200 && Boolean(after.j?.lease),
    `${before.status} → ${after.status}`);
  await rsrv.stop();

  // ---- penolakan backup rusak / tidak lengkap ----
  const corrupt = path.join(tmp, "corrupt.db");
  fs.writeFileSync(corrupt, Buffer.from(fs.readFileSync(backupPath).subarray(0, 100)));
  const r2 = runNode("scripts/restore-verify.mjs", ["--backup", corrupt, "--dest", path.join(tmp, "corrupt-out.db")]);
  ok("restore: file terpotong ditolak (exit 1, tanpa output DB)",
    r2.code === 1 && !fs.existsSync(path.join(tmp, "corrupt-out.db")), r2.err.trim().slice(0, 100));

  const tampered = path.join(tmp, "tampered.db");
  fs.copyFileSync(backupPath, tampered);
  fs.writeFileSync(tampered + ".sha256", `${"0".repeat(64)}  tampered.db\n`);
  const r3 = runNode("scripts/restore-verify.mjs", ["--backup", tampered, "--dest", path.join(tmp, "tampered-out.db")]);
  ok("restore: SHA-256 tidak cocok ditolak (backup diubah)", r3.code === 1 && r3.err.includes("sha256"),
    r3.err.trim().slice(0, 80));

  const r4 = runNode("scripts/restore-verify.mjs", ["--backup", backupPath, "--dest", restoredPath]);
  ok("restore: menolak menimpa DB yang sudah ada tanpa --force", r4.code === 1 && r4.err.includes("--force"),
    r4.err.trim().slice(0, 80));

  const r5 = runNode("scripts/backup.mjs", ["--db", path.join(tmp, "tidak-ada.db"), "--out", outDir]);
  ok("backup: DB sumber tidak ada → exit 1 (tidak membuat backup palsu)", r5.code === 1, r5.err.trim().slice(0, 80));

  // Retensi: buat 4 backup tambahan, --keep 3 → maksimum 3 file .db
  for (let i = 0; i < 4; i++) {
    await sleep(10);
    runNode("scripts/backup.mjs", ["--db", dbPath, "--out", outDir, "--keep", "3"]);
  }
  const dbs = fs.readdirSync(outDir).filter((f) => /^licenses-.*\.db$/.test(f));
  ok("backup: retensi --keep 3 dihormati", dbs.length === 3, `jumlah=${dbs.length}`);

  // DB aktif tidak tersentuh oleh backup/restore.
  const liveDb2 = new DatabaseSync(dbPath, { readOnly: true });
  const liveCounts = {
    licenses: liveDb2.prepare("SELECT COUNT(*) AS n FROM licenses").get().n,
    activations: liveDb2.prepare("SELECT COUNT(*) AS n FROM activations").get().n,
  };
  liveDb2.close();
  ok("backup: DB aktif tidak berubah oleh proses backup/restore",
    liveCounts.licenses === baseline.licenses && liveCounts.activations === baseline.activations,
    JSON.stringify(liveCounts));
  await s.stop();
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