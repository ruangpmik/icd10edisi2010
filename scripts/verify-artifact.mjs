// Verifikasi artefak F3: isi asar + pemindaian kebocoran private key.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const ASAR = "dist/win-unpacked/resources/app.asar";
const EXE = "dist/win-unpacked/ICD-10 Codex 2010.exe";
const files = asar.listPackage(ASAR);
const norm = files.map((f) => f.replace(/\\/g, "/"));

const want = [
  "/electron/license.js",
  "/electron/ipc-guard.js",
  "/electron/preload-license.js",
  "/electron/public-keys.json",
  "/electron/license-config.json",
  "/shared/jws-verify.js",
  "/electron/main.js",
];
let missing = 0;
for (const w of want) {
  const ada = norm.includes(w);
  if (!ada) missing++;
  console.log(`${ada ? "ADA   " : "HILANG"} ${w}`);
}
console.log("total entri asar:", files.length);
console.log("entri license-server (harus 0):", norm.filter((x) => x.includes("license-server")).length);

const asarBuf = fs.readFileSync(ASAR);
const asarStr = asarBuf.toString("latin1");
const exeStr = fs.readFileSync(EXE).toString("latin1");
console.log('"PRIVATE KEY" di asar:', asarStr.includes("PRIVATE KEY"));
console.log('"PRIVATE KEY" di exe  :', exeStr.includes("PRIVATE KEY"));

const keyDir = "license-server/keys";
for (const f of fs.readdirSync(keyDir)) {
  if (!f.endsWith(".pem") || f.includes("public")) continue;
  const pem = fs.readFileSync(`${keyDir}/${f}`, "utf8");
  const b64 = pem.split(/\r?\n/).filter((l) => l && !l.startsWith("-----")).join("");
  const probe = b64.slice(20, 60);
  console.log(`material ${f} di asar/exe:`, asarStr.includes(probe) || exeStr.includes(probe));
}

// Kunci lisensi uji tidak boleh ikut terbangun.
const testKey = "ICD10-WCU2A-F4LZT-73JE3-KCQ2R";
console.log("key uji di asar/exe:", asarStr.includes(testKey) || exeStr.includes(testKey));
console.log(missing === 0 ? "ASAR-OK" : "ASAR-GAGAL");