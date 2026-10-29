// F5.2 guard test: build produksi tidak dapat berjalan tanpa key produksi,
// dan key kandidat tidak dapat menyusup sebagai produksi.
//
//   node scripts/keyset-guard-test.mjs
//
// Tidak mengubah keyset di repository; hanya mengeksekusi skrip dan membaca
// hasil generate (electron/public-keys.json, gitignored).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8", timeout: 30_000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

// 1. Build produksi (keyset production kosong) harus gagal dengan pesan BLOCKED.
const rProd = run("select-keys.mjs", ["production"]);
ok("build produksi ditolak saat keyset production kosong",
  rProd.code === 1 && rProd.out.includes("BLOCKED") && rProd.out.includes("production"), rProd.out.split(/\r?\n/)[0]);

// 2. Pemilihan kandidat harus berhasil dan menghasilkan trust store kandidat.
const rCand = run("select-keys.mjs", ["candidate"]);
let embedded = null;
try {
  embedded = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "public-keys.json"), "utf8"));
} catch {}
ok("pemilihan keyset candidate berhasil (exit 0)", rCand.code === 0, rCand.out.split(/\r?\n/)[0]);
ok("trust store hasil generate memuat hanya kid kandidat",
  Array.isArray(embedded) && embedded.length === 1 && embedded[0].kid === "prod-candidate-2026-10",
  embedded?.map((k) => k.kid).join(",") ?? "(tidak ada)");

// 3. Key kandidat tidak boleh ditulis ke keyset production final.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keyset-guard-"));
const fakeProd = path.join(tmp, "production.public-keys.json");
const rSpoof = run("generate-prod-keypair.mjs", ["prod-candidate-spoof", "--out", tmp, "--public-out", fakeProd]);
ok("generate keypair menolak kid kandidat ke keyset production",
  rSpoof.code === 1 && rSpoof.out.includes("candidate"), rSpoof.out.split(/\r?\n/)[0]);
ok("file production keyset tidak tertulis oleh percobaan spoof", !fs.existsSync(fakeProd));

// 4. kid berawalan test ditolak di semua jalur produksi.
const rTestKid = run("generate-prod-keypair.mjs", ["test-2026-11", "--out", tmp]);
ok("generate keypair menolak kid berawalan test", rTestKid.code === 1 && rTestKid.out.includes("test"));

// 5. Keyset production di repo benar-benar kosong (bukan kandidat yang diganti nama).
const prodFile = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", "production.public-keys.json"), "utf8"));
ok("electron/keysets/production.public-keys.json kosong", Array.isArray(prodFile) && prodFile.length === 0,
  `${prodFile.length} kid`);

// 6. Keyset test & candidate tidak memuat material private.
for (const n of ["test", "candidate"]) {
  const set = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", `${n}.public-keys.json`), "utf8"));
  ok(`keyset ${n} tidak memuat material private`, set.every((k) => !/PRIVATE KEY/.test(k.pem ?? "")));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`RINGKASAN: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
