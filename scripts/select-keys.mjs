// Memilih keyset trust signing untuk build desktop.
//
//   node scripts/select-keys.mjs test|candidate|production
//
// Menyalin electron/keysets/<set>.public-keys.json -> electron/public-keys.json
// (file hasil generate, tidak di-commit). Build hanya membawa SATU keyset.
//
// Tiga tingkat trust yang terpisah:
//   test       — hanya untuk build pengujian (nama kid berawalan "test").
//   candidate  — kandidat produksi (kid mengandung "candidate"), belum tentu
//                menjadi key produksi final.
//   production — key produksi final. Keyset ini KOSONG sampai diisi lewat
//                provisioning di server tepercaya; build produksi gagal bila
//                belum diprovisikan (status BLOCKED, bukan diam-diam memakai
//                key kandidat).
//
// Skrip menolak keyset yang tumpang tindih kid/material, PEM yang bukan public
// key, dan PEM yang dapat diparse sebagai private key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETS = {
  test: "test.public-keys.json",
  candidate: "candidate.public-keys.json",
  production: "production.public-keys.json",
};

const arg = (process.argv[2] ?? process.env.ICD10_KEY_SET ?? "test").toLowerCase();
if (!SETS[arg]) {
  console.error(`GAGAL: keyset tidak dikenal '${arg}'. Pilihan: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}

const fail = (msg) => {
  console.error("GAGAL: " + msg);
  process.exit(1);
};

const readSet = (name, { allowEmpty = false } = {}) => {
  const p = path.join(ROOT, "electron", "keysets", SETS[name]);
  if (!fs.existsSync(p)) fail(`keyset ${name} tidak ada: ${p}`);
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`keyset ${name} bukan JSON valid: ${e.message}`);
  }
  if (!Array.isArray(arr)) fail(`keyset ${name} harus array`);
  if (arr.length === 0 && !allowEmpty) {
    if (name === "production") {
      fail(
        "keyset production kosong — key produksi final belum diprovisikan (BLOCKED). " +
          "Build produksi tidak boleh memakai key test/candidate; gunakan " +
          "`npm run build:desktop:candidate` untuk build kandidat, atau " +
          "provisikan key dulu (lihat docs/F5-key-lifecycle.md)."
      );
    }
    fail(`keyset ${name} harus array tidak kosong`);
  }
  for (const k of arr) {
    if (!k || typeof k.kid !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(k.kid)) {
      fail(`keyset ${name} berisi kid tidak valid`);
    }
    if (typeof k.pem !== "string" || !k.pem.includes("BEGIN PUBLIC KEY")) {
      fail(`${name}/${k.kid} bukan PUBLIC KEY PEM`);
    }
    if (/PRIVATE KEY/.test(k.pem)) {
      fail(`${name}/${k.kid} berisi material private key — tolak`);
    }
    let key;
    try {
      key = crypto.createPublicKey(k.pem);
    } catch (e) {
      fail(`${name}/${k.kid} PEM tidak dapat diparse: ${e.message}`);
    }
    if (key.asymmetricKeyType !== "ed25519") {
      fail(`${name}/${k.kid} bukan Ed25519 (${key.asymmetricKeyType})`);
    }
  }
  const kids = arr.map((k) => k.kid);
  if (new Set(kids).size !== kids.length) fail(`keyset ${name} berisi kid duplikat`);
  return arr;
};

const chosen = readSet(arg);

// Key produksi final tidak boleh berupa key test atau kandidat yang sekadar
// diganti namanya. Penanda kid hanya pengaman tambahan; material tetap berbeda.
if (arg === "production") {
  const suspect = chosen.filter((k) => /candidate|^test/i.test(k.kid));
  if (suspect.length) {
    fail(
      `keyset production memuat kid test/candidate (${suspect.map((k) => k.kid).join(", ")}). ` +
        "Provision key produksi baru; jangan memakai key kandidat sebagai produksi."
    );
  }
}

// Kepercayaan tiap tingkat harus terpisah: kid dan material public key tidak
// boleh muncul di dua keyset. Keyset lain boleh kosong (belum diprovisikan).
const others = Object.keys(SETS).filter((n) => n !== arg);
const chosenKids = new Set(chosen.map((k) => k.kid));
const chosenDer = new Set(
  chosen.map((k) => crypto.createPublicKey(k.pem).export({ type: "spki", format: "der" }).toString("base64"))
);
for (const otherName of others) {
  const other = readSet(otherName, { allowEmpty: true });
  const clash = other.filter((k) => chosenKids.has(k.kid));
  if (clash.length) {
    fail(`kid tumpang tindih antara keyset ${arg} dan ${otherName}: ${clash.map((k) => k.kid).join(", ")}`);
  }
  const clashPem = other.filter((k) =>
    chosenDer.has(crypto.createPublicKey(k.pem).export({ type: "spki", format: "der" }).toString("base64"))
  );
  if (clashPem.length) {
    fail(`public key identik dipakai di dua keyset (${clashPem.map((k) => k.kid).join(", ")})`);
  }
}

const outPath = path.join(ROOT, "electron", "public-keys.json");
fs.writeFileSync(outPath, JSON.stringify(chosen, null, 2) + "\n");
console.log(`keyset aktif: ${arg}`);
console.log(`kid dipercaya: ${chosen.map((k) => k.kid).join(", ")}`);
console.log(`ditulis: electron/public-keys.json`);
