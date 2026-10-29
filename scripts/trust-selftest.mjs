// F4.1 selftest: pemisahan trust testing vs produksi, rotasi & pencabutan kid,
// dan penolakan kid tidak dikenal. Memakai verifier yang SAMA dengan client
// (shared/jws-verify.js) dan penanda tangan server (license-server/jws.mjs).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadSigningKeys, signLease, publicKeysOf } from "../license-server/jws.mjs";

const require = createRequire(import.meta.url);
const { verifyJws } = require("../shared/jws-verify.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = Math.floor(Date.now() / 1000);
const claims = (extra = {}) => ({
  iss: "license-server",
  aud: "icd10-desktop",
  sub: "11111111-1111-4111-8111-111111111111",
  product: "icd10-codex-2010",
  activation_id: "22222222-2222-4222-8222-222222222222",
  features: ["full"],
  iat: now - 10,
  nbf: now - 10,
  exp: now + 3600,
  jti: crypto.randomUUID(),
  ...extra,
});

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

const loadKeyset = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "keysets", `${name}.public-keys.json`), "utf8"));
const testSet = loadKeyset("test");
const candSet = loadKeyset("candidate");
const prodSet = loadKeyset("production");
const verify = (lease, allowedKeys) => verifyJws(lease, { allowedKeys });

// ---------- keyset nyata: harus terpisah ----------
const testKids = new Set(testSet.map((k) => k.kid));
const candKids = new Set(candSet.map((k) => k.kid));
const prodKids = new Set(prodSet.map((k) => k.kid));
ok("keyset: kid testing dan kandidat tidak tumpang tindih", [...testKids].every((k) => !candKids.has(k)),
  `test=[${[...testKids]}] candidate=[${[...candKids]}]`);
ok("keyset: production kosong = key produksi final belum diprovisikan (build produksi BLOCKED)",
  prodSet.length === 0, `${prodSet.length} kid`);
ok("keyset: build kandidat tidak mempercayai test-2026-10", !candKids.has("test-2026-10"), [...candKids].join(","));

const keyMat = (k) => crypto.createPublicKey(k.pem).export({ type: "spki", format: "der" }).toString("base64");
ok("keyset: material public key testing != kandidat",
  !testSet.some((t) => candSet.some((p) => keyMat(t) === keyMat(p))));

// ---------- signing dengan keyset nyata (private key di luar repo) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trust-selftest-"));

function makeKey(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const dir = path.join(tmp, "keys-" + kid);
  fs.mkdirSync(dir, { recursive: true });
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(path.join(dir, `${kid}.private.pem`), privPem);
  return { kid, dir, pub: { kid, pem: publicKey.export({ type: "spki", format: "pem" }) } };
}

const ephemeral = makeKey("ephemeral-rotation-a");
const kA = loadSigningKeys(ephemeral.dir);

// ---------- cross-rejection test vs produksi ----------
// Klaim: token yang ditandatangani test key DITOLAK oleh keyset produksi.
// Server test nyata memakai private key test-2026-10 bila tersedia di
// license-server/keys (tidak di-commit). Bila tidak ada, gunakan keypair
// sementara dengan kid test-2026-10 dan public key dari keyset test.
const testKeysDir = path.join(ROOT, "license-server", "keys");
let testSigner = null;
try {
  const loaded = loadSigningKeys(testKeysDir);
  if (loaded["test-2026-10"]) testSigner = { keys: loaded, kid: "test-2026-10" };
} catch {}
if (!testSigner) {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const dir = path.join(tmp, "test-signer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "test-2026-10.private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
  testSigner = { keys: loadSigningKeys(dir), kid: "test-2026-10" };
  console.log("INFO: private key test-2026-10 tidak ada di license-server/keys — memakai keypair sementara untuk uji silang");
}

const testLease = signLease(claims(), { kid: testSigner.kid, keys: testSigner.keys });
ok("klaim: lease bertanda tangan kid test-2026-10 sah terhadap keyset testing",
  verify(testLease, testSet).ok === true, verify(testLease, testSet).reason ?? "");
ok("klaim: lease bertanda tangan kid test-2026-10 DITOLAK keyset kandidat",
  verify(testLease, candSet).ok === false, verify(testLease, candSet).reason ?? "");
ok("klaim: lease bertanda tangan kid test-2026-10 DITOLAK keyset produksi (kosong)",
  verify(testLease, prodSet).ok === false, verify(testLease, prodSet).reason ?? "");

// Lease sah dari key kandidat (bila private key kandidat tersedia di mesin ini).
const candKeysDir = path.join(os.homedir(), ".icd10-prod-keys");
let candSigner = null;
try {
  const loaded = loadSigningKeys(candKeysDir);
  if (loaded["prod-candidate-2026-10"] && candKids.has("prod-candidate-2026-10")) {
    candSigner = { keys: loaded, kid: "prod-candidate-2026-10" };
  }
} catch {}
if (candSigner) {
  const candLease = signLease(claims(), candSigner);
  ok("klaim: lease kandidat sah terhadap keyset kandidat",
    verify(candLease, candSet).ok === true, verify(candLease, candSet).reason ?? "");
  ok("klaim: lease kandidat DITOLAK keyset testing",
    verify(candLease, testSet).ok === false, verify(candLease, testSet).reason ?? "");
} else {
  console.log("INFO: private key kandidat tidak tersedia — uji positif kandidat dilewati (NOT TESTED lokal)");
}

const ephLease = signLease(claims(), { kid: ephemeral.kid, keys: kA });
ok("klaim: lease bertanda tangan kid tidak terdaftar DITOLAK keyset testing",
  verify(ephLease, testSet).ok === false, verify(ephLease, testSet).reason ?? "");
ok("klaim: lease kid tidak terdaftar sah bila public key-nya ditambahkan ke trust store (rotasi)",
  verify(ephLease, [...candSet, ephemeral.pub]).ok === true);

// ---------- kid tidak dikenal ----------
const unknownLease = signLease(claims(), { kid: ephemeral.kid, keys: kA });
ok("kid tidak dikenal ditolak (bukan diterima lalu divalidasi)",
  verify(unknownLease, candSet).reason === "unknown_kid", verify(unknownLease, candSet).reason ?? "");

// ---------- rotasi: dua kid dipercaya, lalu kid lama dicabut ----------
const kOld = makeKey("rotate-old");
const kNew = makeKey("rotate-new");
const oldKeys = loadSigningKeys(kOld.dir);
const newKeys = loadSigningKeys(kNew.dir);
const oldLease = signLease(claims(), { kid: kOld.kid, keys: oldKeys });
const newLease = signLease(claims(), { kid: kNew.kid, keys: newKeys });

const duringRotation = [...publicKeysOf(oldKeys), ...publicKeysOf(newKeys)];
ok("rotasi: selama transisi, lease kid lama DAN baru diterima",
  verify(oldLease, duringRotation).ok === true && verify(newLease, duringRotation).ok === true);
ok("rotasi: setelah kid lama dicabut, lease lama ditolak",
  verify(oldLease, publicKeysOf(newKeys)).reason === "unknown_kid", verify(oldLease, publicKeysOf(newKeys)).reason ?? "");
ok("rotasi: lease kid baru tetap diterima setelah pencabutan kid lama",
  verify(newLease, publicKeysOf(newKeys)).ok === true);

// ---------- alg allowlist & tamper (regresi F3) ----------
const [h, p, s] = unknownLease.split(".");
const badAlg = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: ephemeral.kid })).toString("base64url");
ok("alg 'none' ditolak", verify(`${badAlg}.${p}.${s}`, [...prodSet, ephemeral.pub]).reason === "alg_not_allowed");
const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
ok("signature diubah ditolak", verify(`${h}.${p}.${flipped}`, [...prodSet, ephemeral.pub]).reason === "bad_signature");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`RINGKASAN: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);