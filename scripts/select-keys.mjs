// Memilih keyset trust signing untuk build desktop.
//
//   node scripts/select-keys.mjs test|production
//
// Menyalin electron/keysets/<set>.public-keys.json -> electron/public-keys.json
// (file hasil generate, tidak di-commit). Build hanya membawa SATU keyset:
// build produksi tidak boleh memuat kid testing. Skrip menolak keyset yang
// tumpang tindih kid, PEM yang bukan public key, atau PEM yang dapat diparse
// sebagai private key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETS = {
  test: "test.public-keys.json",
  production: "production.public-keys.json",
};

const arg = (process.argv[2] ?? process.env.ICD10_KEY_SET ?? "test").toLowerCase();
if (!SETS[arg]) {
  console.error(`GAGAL: keyset tidak dikenal '${arg}'. Pilihan: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}

const readSet = (name) => {
  const p = path.join(ROOT, "electron", "keysets", SETS[name]);
  if (!fs.existsSync(p)) {
    console.error(`GAGAL: keyset ${name} tidak ada: ${p}`);
    process.exit(1);
  }
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`GAGAL: keyset ${name} bukan JSON valid: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    console.error(`GAGAL: keyset ${name} harus array tidak kosong`);
    process.exit(1);
  }
  for (const k of arr) {
    if (!k || typeof k.kid !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(k.kid)) {
      console.error(`GAGAL: keyset ${name} berisi kid tidak valid`);
      process.exit(1);
    }
    if (typeof k.pem !== "string" || !k.pem.includes("BEGIN PUBLIC KEY")) {
      console.error(`GAGAL: ${name}/${k.kid} bukan PUBLIC KEY PEM`);
      process.exit(1);
    }
    if (/PRIVATE KEY/.test(k.pem)) {
      console.error(`GAGAL: ${name}/${k.kid} berisi material private key — tolak`);
      process.exit(1);
    }
    let key;
    try {
      key = crypto.createPublicKey(k.pem);
    } catch (e) {
      console.error(`GAGAL: ${name}/${k.kid} PEM tidak dapat diparse: ${e.message}`);
      process.exit(1);
    }
    if (key.asymmetricKeyType !== "ed25519") {
      console.error(`GAGAL: ${name}/${k.kid} bukan Ed25519 (${key.asymmetricKeyType})`);
      process.exit(1);
    }
  }
  const kids = arr.map((k) => k.kid);
  if (new Set(kids).size !== kids.length) {
    console.error(`GAGAL: keyset ${name} berisi kid duplikat`);
    process.exit(1);
  }
  return arr;
};

const chosen = readSet(arg);

// Kepercayaan testing dan produksi harus terpisah: kid tidak boleh muncul di
// dua keyset, dan public key (material) juga tidak boleh sama.
const otherName = arg === "production" ? "test" : "production";
let other = [];
try {
  other = readSet(otherName);
} catch {
  // Keyset lain belum ada (mis. saat awal provisioning) — bukan error.
  other = [];
}
const chosenKids = new Set(chosen.map((k) => k.kid));
const clash = other.filter((k) => chosenKids.has(k.kid));
if (clash.length) {
  console.error(`GAGAL: kid tumpang tindih antara keyset ${arg} dan ${otherName}: ${clash.map((k) => k.kid).join(", ")}`);
  process.exit(1);
}
const chosenPems = new Set(chosen.map((k) => crypto.createPublicKey(k.pem).export({ type: "spki", format: "der" }).toString("base64")));
const clashPem = other.filter((k) => chosenPems.has(crypto.createPublicKey(k.pem).export({ type: "spki", format: "der" }).toString("base64")));
if (clashPem.length) {
  console.error(`GAGAL: public key identik dipakai di dua keyset (${clashPem.map((k) => k.kid).join(", ")})`);
  process.exit(1);
}

const outPath = path.join(ROOT, "electron", "public-keys.json");
fs.writeFileSync(outPath, JSON.stringify(chosen, null, 2) + "\n");
console.log(`keyset aktif: ${arg}`);
console.log(`kid dipercaya: ${chosen.map((k) => k.kid).join(", ")}`);
console.log(`ditulis: electron/public-keys.json`);