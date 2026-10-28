// Verifikasi Electron Fuses langsung dari executable hasil build (bukan config).
//
//   node scripts/verify-fuses.mjs [--exe <path>]
//
// Exit 1 bila ada fuse yang tidak sesuai target hardening F2/F4.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options, FuseState } = require("@electron/fuses");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const exeArg = argv.indexOf("--exe") >= 0 ? argv[argv.indexOf("--exe") + 1] : null;
const EXE = exeArg ? path.resolve(exeArg) : path.join(ROOT, "dist", "win-unpacked", "ICD-10 Codex 2010.exe");
if (!fs.existsSync(EXE)) {
  console.error("GAGAL: executable tidak ditemukan:", EXE);
  process.exit(1);
}

const stateName = (v) => FuseState[v] ?? `UNKNOWN(${v})`;
const wire = await getCurrentFuseWire(EXE);

// Target hardening: tiga fuse eksekusi Node dimatikan, asar-only + integrity
// dinyalakan. GrantFileProtocolExtraPrivileges tetap ENABLE agar protokol
// app:///file internal F2 berjalan (tidak dipakai untuk membuka file arbitrer).
const targets = [
  [FuseV1Options.RunAsNode, FuseState.DISABLE, "RunAsNode disabled"],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE, "NodeOptionsEnv disabled"],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE, "NodeCliInspect disabled"],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE, "OnlyLoadAppFromAsar enabled"],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE, "EmbeddedAsarIntegrity enabled"],
];

console.log("exe:", EXE);
console.log("fuse wire version:", wire.version);
console.log("");
console.log("idx  fuse                                      aktual    target    status");
let bad = 0;
const reported = new Set();
for (const [idx, want, label] of targets) {
  const got = wire[idx];
  const ok = got === want;
  if (!ok) bad++;
  reported.add(idx);
  console.log(
    `${String(idx).padEnd(4)} ${FuseV1Options[idx].padEnd(41)} ${stateName(got).padEnd(9)} ${stateName(want).padEnd(9)} ${ok ? "OK" : "MISMATCH"}  ${label}`
  );
}
console.log("");
console.log("fuse lain (informasi):");
for (const [k, v] of Object.entries(wire)) {
  const idx = Number(k);
  if (!Number.isInteger(idx) || reported.has(idx)) continue;
  console.log(`     ${FuseV1Options[idx].padEnd(41)} ${stateName(v)}`);
}

console.log("");
console.log(bad === 0 ? "FUSES-OK" : `FUSES-GAGAL (${bad} mismatch)`);
process.exit(bad === 0 ? 0 : 1);