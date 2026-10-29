// Generate keypair signing PRODUCTION di direktori di luar repository.
//
//   node scripts/generate-prod-keypair.mjs <kid> --out <dir-di-luar-repo> \
//        [--public-out electron/keysets/production.public-keys.json] [--force]
//
// Aturan:
// - Direktori private key WAJIB di luar repository (skrip menolak path di dalam repo).
// - Private key ditulis dengan izin ketat (0600 / icacls) dan tidak pernah dicetak.
// - Public key boleh ditulis ke keyset aplikasi; private key tidak.
// - Menolak menimpa private key yang sudah ada tanpa --force.
//
// Untuk produksi sesungguhnya, jalankan skrip ini DI SERVER TERPERCAYA (bukan
// laptop developer), lalu bawa HANYA public key ke proses build.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const kid = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--force") flags.force = true;
  else if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}

if (!kid || !/^[A-Za-z0-9._-]{1,64}$/.test(kid) || !flags.out) {
  console.error("pakai: node scripts/generate-prod-keypair.mjs <kid> --out <dir-di-luar-repo> [--public-out <json>] [--force]");
  process.exit(2);
}
if (/^test/i.test(kid)) {
  console.error("GAGAL: kid produksi tidak boleh diawali 'test' (pemisahan trust testing/produksi).");
  process.exit(1);
}

const outDir = path.resolve(flags.out);
const rel = path.relative(ROOT, outDir);
if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
  console.error("GAGAL: direktori private key berada di dalam repository:", outDir);
  console.error("Private key produksi tidak boleh disimpan di repository client.");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const privPath = path.join(outDir, `${kid}.private.pem`);
const pubPath = path.join(outDir, `${kid}.public.pem`);
if (!flags.force && (fs.existsSync(privPath) || fs.existsSync(pubPath))) {
  console.error("GAGAL: file kunci sudah ada (gunakan --force hanya bila rotasi disengaja):", privPath);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });

fs.writeFileSync(privPath, privPem, { mode: 0o600 });
fs.writeFileSync(pubPath, pubPem, { mode: 0o644 });

if (process.platform === "win32") {
  // Batasi ACL ke pemilik + SYSTEM + Administrators.
  spawnSync("icacls", [privPath, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:F`, "SYSTEM:F", "Administrators:F"], {
    stdio: "ignore",
  });
}

const der = publicKey.export({ type: "spki", format: "der" });
const fingerprint = crypto.createHash("sha256").update(der).digest("hex");

if (flags["public-out"]) {
  const target = path.resolve(flags["public-out"]);
  // Jangan pernah menulis key kandidat/testing ke keyset production final.
  if (/production\.public-keys\.json$/i.test(target) && /candidate|^test/i.test(kid)) {
    console.error("GAGAL: keyset production tidak boleh diisi kid test/candidate:", kid);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify([{ kid, pem: pubPem }], null, 2) + "\n");
  console.log("public key (aman, bukan secret) ditulis ke:", target);
}

console.log(JSON.stringify({
  kid,
  publicKeyPath: pubPath,
  privateKeyPath: privPath,
  spkiSha256Fingerprint: fingerprint,
  algorithm: "Ed25519",
}, null, 2));
console.log("PENTING: jangan commit/copy private key. Cadangkan ke secret store terenkripsi.");