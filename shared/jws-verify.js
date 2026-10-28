// Verifikasi JWS compact (RFC 7515 / RFC 7517) dengan algoritma EdDSA (Ed25519).
// Format standar — bukan skema kriptografi buatan sendiri.
// Dipakai server (memverifikasi lease dari client) dan client desktop
// (memverifikasi lease yang ditandatangani server).
//
// Aturan verifikasi (fail-secure):
// - header.alg harus persis "EdDSA" (allowlist eksplisit, default satu-satunya)
// - header.kid harus ada dalam allowlist kunci publik yang diizinkan
// - signature divalidasi terhadap data byte persis (header.payload)
// - klaim waktu: iat/exp wajib; nbf dihormati; iat jauh di masa depan = ditolak
//   (lapisan tambahan anti clock-rollback; server tetap sumber kebenaran online)
"use strict";

const crypto = require("node:crypto");

function b64urlToJson(s) {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
}

/**
 * Verifikasi token JWS compact.
 * @param {string} token  JWS compact "h.p.s"
 * @param {object} opts
 * @param {Array<{kid:string, pem:string}>} opts.allowedKeys  Allowlist kunci publik
 * @param {string[]} [opts.allowedAlgs]  Default ["EdDSA"]
 * @param {number} [opts.now]  Detik epoch, default sekarang
 * @returns {{ok:true, claims:object} | {ok:false, reason:string}}
 */
function verifyJws(token, opts) {
  const { allowedKeys, allowedAlgs = ["EdDSA"], now = Math.floor(Date.now() / 1000) } = opts;
  const fail = (reason) => ({ ok: false, reason });
  if (typeof token !== "string") return fail("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return fail("malformed");
  let header;
  let claims;
  try {
    header = b64urlToJson(parts[0]);
    claims = b64urlToJson(parts[1]);
  } catch {
    return fail("malformed");
  }
  if (header.alg !== "EdDSA" || !allowedAlgs.includes(header.alg)) {
    return fail("alg_not_allowed");
  }
  if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 64) {
    return fail("no_kid");
  }
  const key = allowedKeys.find((k) => k.kid === header.kid);
  if (!key) return fail("unknown_kid");
  let pub;
  try {
    pub = crypto.createPublicKey(key.pem);
  } catch {
    return fail("bad_key");
  }
  let valid;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(parts[0] + "." + parts[1], "utf8"),
      pub,
      Buffer.from(parts[2], "base64url")
    );
  } catch {
    return fail("bad_signature");
  }
  if (!valid) return fail("bad_signature");
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
    return fail("missing_time_claims");
  }
  // Kegagalan waktu tetap membawa claims (signature sudah sah) — client
  // membutuhkannya untuk membedakan "kedaluwarsa → grace" dari "rusak → invalid".
  const timeFail = (reason) => ({ ok: false, reason, claims });
  if (claims.nbf !== undefined && now < claims.nbf) return timeFail("not_yet_valid");
  if (now >= claims.exp) return timeFail("expired");
  // iat > 5 menit di masa depan = jam tidak tepercaya / token replaysan
  if (claims.iat > now + 300) return timeFail("iat_in_future");
  return { ok: true, claims };
}

module.exports = { verifyJws };
