// Metadata rilis: versi, commit sumber, tag, artefak, hash, keyset, fuses,
// status signature, hasil regresi, dan release gate.
// Tidak pernah menyertakan private key / token / password.
//
//   node scripts/release-metadata.mjs \
//     [--out docs/release/F5-build-metadata.json] [--dir dist] \
//     [--expect-keyset candidate|test|production] \
//     [--label "candidate-unsigned"] [--gate "BLOCKED"] \
//     [--tests "api:46/46;ops:34/34"]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const { getCurrentFuseWire, FuseV1Options, FuseState } = require("@electron/fuses");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}
const OUT = path.resolve(ROOT, flags.out ?? "docs/release/F5-build-metadata.json");
const DIST = path.resolve(ROOT, flags.dir ?? "dist");
const KEYSET = (flags["expect-keyset"] ?? "candidate").toLowerCase();
if (!["test", "candidate", "production"].includes(KEYSET)) {
  console.error("GAGAL: --expect-keyset harus test|candidate|production");
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const setupName = `ICD10-Codex-Setup-${pkg.version}.exe`;
const setupPath = path.join(DIST, setupName);
const exePath = path.join(DIST, "win-unpacked", "ICD-10 Codex 2010.exe");
const asarPath = path.join(DIST, "win-unpacked", "resources", "app.asar");

const missing = [setupPath, exePath, asarPath].filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error("GAGAL: artefak belum lengkap:\n" + missing.join("\n"));
  process.exit(1);
}

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const fingerprint = (pem) =>
  crypto.createHash("sha256").update(crypto.createPublicKey(pem).export({ type: "spki", format: "der" })).digest("hex");

const embeddedKeys = JSON.parse(asar.extractFile(asarPath, "electron/public-keys.json").toString("utf8"));
const cfg = JSON.parse(asar.extractFile(asarPath, "electron/license-config.json").toString("utf8"));
const keysetFile = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", `${KEYSET}.public-keys.json`), "utf8"));
const wire = await getCurrentFuseWire(exePath);

const tests = (flags.tests ?? "")
  .split(";")
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => {
    const i = t.indexOf(":");
    return i > 0 ? { name: t.slice(0, i), result: t.slice(i + 1) } : { name: t, result: "" };
  });

const meta = {
  product: pkg.build.productName,
  appId: pkg.build.appId,
  version: pkg.version,
  artifactLabel: flags.label ?? "candidate-unsigned",
  source: {
    gitCommit: git(["rev-parse", "HEAD"]),
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    releaseTag: git(["describe", "--tags", "--exact-match", "HEAD"]) || null,
    workingTreeDirty: git(["status", "--porcelain"]).length > 0,
  },
  build: {
    builtAt: fs.statSync(asarPath).mtime.toISOString(),
    electronVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "electron", "package.json"), "utf8")).version,
    nodeVersion: process.version,
    platform: process.platform + "-" + process.arch,
    builder: "electron-builder 26.x (NSIS, per-user)",
    reproducible: false,
    reproducibleNote:
      "Build tidak bit-reproducible: public/data/icd10.json memuat meta.builtAt dan CSP hash dihitung ulang per build. Verifikasi memakai SHA-256 artefak yang diuji.",
  },
  artifacts: {
    installer: { file: setupName, bytes: fs.statSync(setupPath).size, sha256: sha256(setupPath) },
    blockmap: fs.existsSync(setupPath + ".blockmap")
      ? { file: setupName + ".blockmap", bytes: fs.statSync(setupPath + ".blockmap").size, sha256: sha256(setupPath + ".blockmap") }
      : null,
    exe: { file: "win-unpacked/ICD-10 Codex 2010.exe", bytes: fs.statSync(exePath).size, sha256: sha256(exePath) },
    asar: { file: "win-unpacked/resources/app.asar", bytes: fs.statSync(asarPath).size, sha256: sha256(asarPath) },
  },
  trust: {
    expectedKeyset: KEYSET,
    embeddedKids: embeddedKeys.map((k) => k.kid),
    embeddedFingerprints: embeddedKeys.map((k) => ({ kid: k.kid, spkiSha256: fingerprint(k.pem) })),
    keysetFileMatchesEmbedded:
      JSON.stringify(embeddedKeys.map((k) => k.kid).sort()) === JSON.stringify(keysetFile.map((k) => k.kid).sort()),
    embeddedServerUrl: cfg.serverUrl ?? "",
    testKeyTrusted: embeddedKeys.some((k) => /^test/i.test(k.kid)),
  },
  fuses: Object.fromEntries(
    Object.entries(wire)
      .filter(([k]) => Number.isInteger(Number(k)))
      .map(([k, v]) => [FuseV1Options[k], FuseState[v] ?? v])
  ),
  signing: {
    status: "unsigned",
    codeSigned: false,
    publisher: null,
    signatureVerified: false,
    timestamped: false,
    note: "Tidak ada sertifikat code signing tepercaya; artefak hanya untuk pengujian/beta terbatas.",
  },
  deployment: {
    productionServer: "BLOCKED",
    publicHttpsTested: false,
    note: "VPS/domain/sertifikat TLS publik belum tersedia; serverUrl build kosong (fail-secure).",
  },
  tests,
  releaseGate: flags.gate ?? "unknown",
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta, null, 2));
console.log("\nmetadata ditulis:", path.relative(ROOT, OUT));
