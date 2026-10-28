// Metadata rilis F4: versi, commit sumber, artefak, hash, keyset, fuses.
// Tidak pernah menyertakan private key / token.
//
//   node scripts/release-metadata.mjs [--out docs/release/F4-build-metadata.json]
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
const outArg = argv.indexOf("--out") >= 0 ? argv[argv.indexOf("--out") + 1] : "docs/release/F4-build-metadata.json";
const OUT = path.resolve(ROOT, outArg);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const DIST = path.join(ROOT, "dist");
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

const embeddedKeys = JSON.parse(asar.extractFile(asarPath, "electron/public-keys.json").toString("utf8"));
const prodSet = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", "production.public-keys.json"), "utf8"));
const fingerprint = (pem) => crypto.createHash("sha256").update(crypto.createPublicKey(pem).export({ type: "spki", format: "der" })).digest("hex");
const wire = await getCurrentFuseWire(exePath);

const meta = {
  product: pkg.build.productName,
  appId: pkg.build.appId,
  version: pkg.version,
  source: {
    gitCommit: git(["rev-parse", "HEAD"]),
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    workingTreeDirty: git(["status", "--porcelain"]).length > 0,
  },
  build: {
    builtAt: fs.statSync(asarPath).mtime.toISOString(),
    electronVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "electron", "package.json"), "utf8")).version,
    nodeVersion: process.version,
    platform: process.platform + "-" + process.arch,
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
    embeddedKids: embeddedKeys.map((k) => k.kid),
    productionKeysetKids: prodSet.map((k) => k.kid),
    productionKeyFingerprintSpkiSha256: prodSet.map((k) => ({ kid: k.kid, fingerprint: fingerprint(k.pem) })),
  },
  fuses: Object.fromEntries(
    Object.entries(wire)
      .filter(([k]) => Number.isInteger(Number(k)))
      .map(([k, v]) => [FuseV1Options[k], FuseState[v] ?? v])
  ),
  signing: {
    codeSigned: false,
    status: "UNSIGNED — tidak ada sertifikat code signing; hanya untuk pengujian/beta terbatas",
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta, null, 2));
console.log("\nmetadata ditulis:", path.relative(ROOT, OUT));