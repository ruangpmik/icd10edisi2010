#!/usr/bin/env node
// Verifikasi + pemulihan backup ke LOKASI TERPISAH (bukan menimpa DB aktif).
//
//   node scripts/restore-verify.mjs --backup <file.db> --dest <file.db> [--force]
//
// Langkah: cek sidecar SHA-256 (bila ada) -> salin -> integrity_check ->
// quick_check -> hitung baris -> laporkan JSON. Exit 1 bila backup rusak,
// hash tidak cocok, atau file tujuan sudah ada tanpa --force.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--force") flags.force = true;
  else if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}
const backupPath = flags.backup;
const destPath = flags.dest;
if (!backupPath || !destPath) {
  console.error("pakai: node scripts/restore-verify.mjs --backup <file.db> --dest <file.db> [--force]");
  process.exit(2);
}
if (!fs.existsSync(backupPath)) {
  console.error("GAGAL: backup tidak ditemukan:", backupPath);
  process.exit(1);
}
if (fs.existsSync(destPath) && !flags.force) {
  console.error("GAGAL: tujuan sudah ada, gunakan --force hanya bila yakin:", destPath);
  process.exit(1);
}

function fail(msg) {
  console.error("GAGAL:", msg);
  process.exit(1);
}

const buf = fs.readFileSync(backupPath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const sidecar = backupPath + ".sha256";
if (fs.existsSync(sidecar)) {
  const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
  if (expected !== sha256) fail(`sha256 tidak cocok (sidecar ${expected.slice(0, 12)}…, file ${sha256.slice(0, 12)}…)`);
}

fs.mkdirSync(path.dirname(destPath), { recursive: true });
const tmp = destPath + ".restoring";
fs.copyFileSync(backupPath, tmp);

let result;
try {
  const db = new DatabaseSync(tmp, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
  const quick = db.prepare("PRAGMA quick_check").get()?.quick_check;
  const one = (sql) => db.prepare(sql).get()?.n ?? 0;
  result = {
    integrity,
    quick,
    counts: {
      licenses: one("SELECT COUNT(*) AS n FROM licenses"),
      activations: one("SELECT COUNT(*) AS n FROM activations"),
      audit: one("SELECT COUNT(*) AS n FROM audit"),
    },
  };
  db.close();
} catch (e) {
  try {
    fs.rmSync(tmp, { force: true });
  } catch {}
  fail(`database tidak dapat dibuka/dibaca: ${e?.message ?? e}`);
}

if (result.integrity !== "ok" || result.quick !== "ok") {
  try {
    fs.rmSync(tmp, { force: true });
  } catch {}
  fail(`integritas gagal: integrity=${result.integrity} quick=${result.quick}`);
}

fs.renameSync(tmp, destPath);
console.log(JSON.stringify({ ok: true, restoredTo: path.resolve(destPath), sha256, ...result }));