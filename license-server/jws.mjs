// Tanda tangan Ed25519 (JWS compact, EdDSA) untuk license lease.
// Private key HANYA dibaca di sini, dari direktori kunci di server.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Modul verifikasi bersama (dipakai client dan server) — satu implementasi.
export const verifyJws = require("../shared/jws-verify.js").verifyJws;

/** Muat keypair signing dari keysDir: file <kid>.private.pem (+ publik diturunkan). */
export function loadSigningKeys(keysDir) {
  const keys = {};
  if (!fs.existsSync(keysDir)) return keys;
  for (const f of fs.readdirSync(keysDir)) {
    const m = f.match(/^(.+)\.private\.pem$/);
    if (!m) continue;
    const kid = m[1];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(keysDir, f)));
    keys[kid] = {
      kid,
      privateKey,
      publicKeyPem: crypto
        .createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" }),
    };
  }
  return keys;
}

/** Kunci publik saja (untuk allowlist verifikasi tanpa private key). */
export function publicKeysOf(keys) {
  return Object.values(keys).map((k) => ({ kid: k.kid, pem: k.publicKeyPem }));
}

/** Tanda tangan claims menjadi JWS compact (EdDSA). */
export function signLease(claims, { kid, keys }) {
  const k = keys[kid];
  if (!k) throw new Error("unknown signing kid: " + kid);
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT", kid }),
    "utf8"
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = crypto
    .sign(null, Buffer.from(header + "." + payload, "utf8"), k.privateKey)
    .toString("base64url");
  return header + "." + payload + "." + sig;
}
