#!/usr/bin/env node
// Backup konsisten database lisensi + verifikasi integritas.
//
//   node scripts/backup.mjs --db <path> --out <dir> [--keep 7]
//
// Memakai `VACUUM INTO` sehingga snapshot konsisten walau server sedang
// berjalan (termasuk isi WAL). Hasil backup diverifikasi dengan
// `PRAGMA integrity_check` dan dihash SHA-256. Backup yang gagal verifikasi
// dihapus dan proses keluar dengan kode 1 — tidak pernah meninggalkan file
// yang terlihat valid.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}

const dbPath = flags.db;
const outDir = flags.out;
const keep = Number(flags.keep ?? 7);
if (!dbPath || !outDir) {
  console.error("pakai: node scripts/backup.mjs --db <path> --out <dir> [--keep 7]");
  process.exit(2);
}
if (!fs.existsSync(dbPath)) {
  console.error("GAGAL: database tidak ditemukan:", dbPath);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalPath = path.join(outDir, `licenses-${stamp}.db`);
const tmpPath = finalPath + ".partial";

function counts(p) {
  const d = new DatabaseSync(p, { readOnly: true });
  try {
    const one = (sql) => d.prepare(sql).get()?.n ?? 0;
    return {
      licenses: one("SELECT COUNT(*) AS n FROM licenses"),
      activations: one("SELECT COUNT(*) AS n FROM activations"),
      audit: one("SELECT COUNT(*) AS n FROM audit"),
    };
  } finally {
    d.close();
  }
}

function fail(msg) {
  try {
    fs.rmSync(tmpPath, { force: true });
  } catch {}
  console.error("GAGAL:", msg);
  process.exit(1);
}

let source;
try {
  // readOnly:false karena VACUUM INTO butuh koneksi baca-tulis singkat ke sumber.
  source = new DatabaseSync(dbPath);
  source.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
} catch (e) {
  fail(`VACUUM INTO: ${e?.message ?? e}`);
} finally {
  try {
    source?.close();
  } catch {}
}

try {
  const check = new DatabaseSync(tmpPath, { readOnly: true });
  const integrity = check.prepare("PRAGMA integrity_check").get()?.integrity_check;
  const c = counts(tmpPath);
  check.close();
  if (integrity !== "ok") fail(`integrity_check = ${integrity}`);

  fs.renameSync(tmpPath, finalPath);
  const buf = fs.readFileSync(finalPath);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  fs.writeFileSync(finalPath + ".sha256", `${sha256}  ${path.basename(finalPath)}\n`);

  const meta = {
    createdAt: new Date().toISOString(),
    source: path.resolve(dbPath),
    backup: path.basename(finalPath),
    bytes: buf.length,
    sha256,
    integrity,
    counts: c,
  };
  fs.writeFileSync(finalPath + ".json", JSON.stringify(meta, null, 2));

  // Retensi: hanya hapus file backup yang dibuat skrip ini (pola nama + .sha256/.json).
  const all = fs
    .readdirSync(outDir)
    .filter((f) => /^licenses-.*\.db$/.test(f))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    for (const suffix of ["", ".sha256", ".json"]) {
      try {
        fs.rmSync(path.join(outDir, old + suffix), { force: true });
      } catch {}
    }
  }
  console.log(JSON.stringify(meta));
} catch (e) {
  fail(e?.message ?? String(e));
}