// Verifikasi artefak: isi asar, keyset trust yang tertanam, dan kebocoran secret.
//
//   node scripts/verify-artifact.mjs [--out dist] [--expect-keyset production|test]
//
// Exit 1 bila ada satu pun pelanggaran. Dipakai sebagai release gate, bukan
// sekadar laporan.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}
const OUT = path.resolve(ROOT, flags.out ?? "dist");
const EXPECT = (flags["expect-keyset"] ?? "production").toLowerCase();
if (!["test", "production"].includes(EXPECT)) {
  console.error("GAGAL: --expect-keyset harus test|production");
  process.exit(2);
}

const ASAR = path.join(OUT, "win-unpacked", "resources", "app.asar");
if (!fs.existsSync(ASAR)) {
  console.error("GAGAL: asar tidak ditemukan:", ASAR);
  process.exit(1);
}

const problems = [];
const check = (name, cond, detail = "") => {
  if (cond) console.log(`OK    ${name}${detail ? " — " + detail : ""}`);
  else {
    problems.push(name);
    console.log(`GAGAL ${name}${detail ? " — " + detail : ""}`);
  }
};

const files = asar.listPackage(ASAR).map((f) => f.replace(/\\/g, "/"));
console.log("asar:", ASAR, `(${files.length} entri)`);

const required = [
  "/electron/license.js",
  "/electron/ipc-guard.js",
  "/electron/preload-license.js",
  "/electron/public-keys.json",
  "/electron/license-config.json",
  "/shared/jws-verify.js",
  "/electron/main.js",
];
for (const r of required) check(`asar memuat ${r}`, files.includes(r));

const keySetEntries = files.filter((f) => f.includes("/keysets/"));
check("tidak ada keyset mentah di asar (hanya public-keys.json terpilih)", keySetEntries.length === 0, keySetEntries.join(","));

const serverEntries = files.filter((f) => f.includes("license-server"));
check("tidak ada kode server lisensi di asar", serverEntries.length === 0, `${serverEntries.length} entri`);

// --- keyset yang benar-benar tertanam ---
const embedded = JSON.parse(asar.extractFile(ASAR, "electron/public-keys.json").toString("utf8"));
const expectedSet = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", `${EXPECT}.public-keys.json`), "utf8"));
const embeddedKids = embedded.map((k) => k.kid).sort();
const expectedKids = expectedSet.map((k) => k.kid).sort();
check(`keyset tertanam = ${EXPECT}`, JSON.stringify(embeddedKids) === JSON.stringify(expectedKids),
  `tertanam=[${embeddedKids}] harap=[${expectedKids}]`);

const otherSetName = EXPECT === "production" ? "test" : "production";
const otherSet = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", `${otherSetName}.public-keys.json`), "utf8"));
const otherKids = otherSet.map((k) => k.kid);

const asarStr = fs.readFileSync(ASAR).toString("latin1");
const exePath = path.join(OUT, "win-unpacked", "ICD-10 Codex 2010.exe");
const exeStr = fs.existsSync(exePath) ? fs.readFileSync(exePath).toString("latin1") : "";

for (const kid of otherKids) {
  check(`asar/exe tidak memuat kid keyset ${otherSetName} '${kid}'`, !asarStr.includes(kid) && !exeStr.includes(kid));
}

// Production build tidak boleh mempercayai kunci testing (baik kid maupun material).
if (EXPECT === "production") {
  check("produksi tidak memuat kid test-2026-10", !asarStr.includes("test-2026-10") && !exeStr.includes("test-2026-10"));
  for (const t of otherSet) {
    const b64 = t.pem.split(/\r?\n/).filter((l) => l && !l.startsWith("-----")).join("");
    check(`produksi tidak memuat material public key testing (${t.kid})`, !asarStr.includes(b64) && !exeStr.includes(b64));
  }
}

// --- private key / secret ---
const pemPrivate = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
check("tidak ada blok PEM PRIVATE KEY di asar", !pemPrivate.test(asarStr));
check("tidak ada blok PEM PRIVATE KEY di exe", !pemPrivate.test(exeStr));

const keysDir = path.join(ROOT, "license-server", "keys");
if (fs.existsSync(keysDir)) {
  for (const f of fs.readdirSync(keysDir)) {
    if (!f.endsWith(".private.pem")) continue;
    const pem = fs.readFileSync(path.join(keysDir, f), "utf8");
    const probe = pem.split(/\r?\n/).filter((l) => l && !l.startsWith("-----")).join("").slice(20, 60);
    if (probe) check(`material private '${f}' tidak ada di asar/exe`, !asarStr.includes(probe) && !exeStr.includes(probe));
  }
}

const prodDir = path.join(os.homedir(), ".icd10-prod-keys");
if (fs.existsSync(prodDir)) {
  for (const f of fs.readdirSync(prodDir)) {
    if (!f.endsWith(".private.pem")) continue;
    const pem = fs.readFileSync(path.join(prodDir, f), "utf8");
    const probe = pem.split(/\r?\n/).filter((l) => l && !l.startsWith("-----")).join("").slice(20, 60);
    if (probe) check(`material private produksi '${f}' tidak ada di asar/exe`, !asarStr.includes(probe) && !exeStr.includes(probe));
  }
}

const testLicenseKey = "ICD10-WCU2A-F4LZT-73JE3-KCQ2R";
check("license key uji tidak tertanam di build", !asarStr.includes(testLicenseKey) && !exeStr.includes(testLicenseKey));

// --- konfigurasi serverUrl build produksi ---
const cfg = JSON.parse(asar.extractFile(ASAR, "electron/license-config.json").toString("utf8"));
if (EXPECT === "production") {
  const u = String(cfg.serverUrl ?? "");
  const loopback = /^https?:\/\/(127\.|localhost|\[::1\])/.test(u);
  check("produksi: serverUrl bukan loopback", !loopback, `serverUrl='${u}'`);
  check("produksi: serverUrl memakai https atau kosong (gate unactivated)", u === "" || u.startsWith("https://"), `serverUrl='${u}'`);
} else {
  check("test: serverUrl boleh kosong/loopback", true, `serverUrl='${cfg.serverUrl}'`);
}

// SHA-256 artefak installer versi ini untuk metadata rilis.
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const setupDir = OUT;
const setup = fs.readdirSync(setupDir).find((f) => f === `ICD10-Codex-Setup-${version}.exe`);
if (setup) {
  const buf = fs.readFileSync(path.join(setupDir, setup));
  console.log(`SHA-256 ${setup}: ${crypto.createHash("sha256").update(buf).digest("hex")}`);
} else {
  console.log(`INFO: installer ICD10-Codex-Setup-${version}.exe belum ada di ` + setupDir);
}

console.log(problems.length === 0 ? "ARTIFACT-OK" : `ARTIFACT-GAGAL (${problems.length} masalah)`);
process.exit(problems.length === 0 ? 0 : 1);