// Licensing server ICD-10 Codex 2010.
// Node bawaan saja (http/https, crypto, sqlite) — tanpa dependensi npm.
//
// Endpoint publik:
//   POST /v1/activate    {licenseKey, installationId}
//   POST /v1/renew       {lease, installationId}
//   POST /v1/deactivate  {lease, installationId}
// Endpoint admin (Bearer $LICENSE_ADMIN_TOKEN):
//   POST   /admin/licenses                 buat lisensi
//   GET    /admin/licenses                 daftar
//   PATCH  /admin/licenses/:id             ubah status/entitlement/batas
//   POST   /admin/licenses/:id/revoke      cabut (permanen)
//   GET    /admin/licenses/:id/activations daftar aktivasi
//   DELETE /admin/activations/:id          lepas aktivasi (admin)
//   GET    /admin/audit                    riwayat
//
// Kebijakan:
// - License key disimpan sebagai hash SHA-256, bukan mentah.
// - Aktivasi atomik (transaksi) → race condition kuota terakhir aman.
// - Rate limit durable (SQLite): per IP + per license key/installation/lisensi;
//   bertahan setelah restart. Kebijakan gagal: fail-open + audit.
// - Peran admin (penuh) dan support (baca + lepas aktivasi).
// - Audit log tanpa credential / token / key mentah.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { config } from "./config.mjs";
import { openDb } from "./db.mjs";
import { loadSigningKeys, signLease, verifyJws, publicKeysOf } from "./jws.mjs";
import { createRateLimiter, enforce } from "./ratelimit.mjs";

const ISSUER = "icd10-licensing";
const AUDIENCE = "icd10-codex-2010";
const PRODUCT = "icd10-codex";

const LICENSE_KEY_RE = /^ICD10-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/; // 20 simbol base32 = 100 bit entropy
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------- util ----------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function safeIp(req) {
  return req.socket?.remoteAddress ?? "?";
}

function timingSafeEq(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- rate limit (durable, SQLite) ----------

let limiter = null;
let rateDegradedLoggedAt = 0;

function rateDeny(res, ip, bucket, retryAfterSec) {
  audit(null, null, "rate_limited", ip, String(bucket).slice(0, 80));
  res.writeHead(429, {
    "retry-after": String(retryAfterSec),
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ error: "rate_limited" }));
}

// Fail-open bila penyimpanan rate limit error (lihat ratelimit.mjs) — tetapi
// kegagalan selalu tercatat di audit, bukan diabaikan diam-diam.
function checkBuckets(res, ip, buckets) {
  const r = enforce(limiter, buckets);
  if (r.degraded && Date.now() - rateDegradedLoggedAt > 60_000) {
    rateDegradedLoggedAt = Date.now();
    audit(null, null, "rate_store_error", ip, "fail-open");
    console.warn("PERINGATAN: penyimpanan rate limit gagal — fail-open, tercatat di audit");
  }
  if (!r.ok) {
    rateDeny(res, ip, r.deniedBucket, r.retryAfterSec);
    return false;
  }
  return true;
}

// Subjek lease untuk bucketing. Payload TIDAK dipercaya untuk otorisasi —
// hanya dipakai sebagai nama bucket; verifikasi tetap dilakukan handler.
function leaseSubject(lease) {
  if (typeof lease !== "string") return "none";
  const p = lease.split(".")[1];
  if (!p) return "none";
  try {
    const j = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    return typeof j.sub === "string" ? j.sub.slice(0, 36) : "none";
  } catch {
    return "none";
  }
}

function extraBuckets(fam, body) {
  const out = [];
  if (fam === "activate") {
    if (typeof body.licenseKey === "string") {
      const h = crypto.createHash("sha256").update(body.licenseKey, "utf8").digest("hex").slice(0, 32);
      out.push([`act:key:${h}`, config.rate.activateKey]);
    }
    if (typeof body.installationId === "string") {
      out.push([`act:inst:${body.installationId}`, config.rate.activateInstallation]);
    }
  } else if (fam === "renew" || fam === "deactivate") {
    const lim = fam === "renew" ? config.rate.renewLicense : config.rate.deactivateLicense;
    out.push([`${fam}:lic:${leaseSubject(body.lease)}`, lim]);
  }
  return out;
}

async function readJsonBody(req) {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return { error: "content_type" };
  }
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > config.maxPayloadBytes) return { error: "too_large" };
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > config.maxPayloadBytes) {
      return { error: "too_large" };
    }
    chunks.push(c);
  }
  if (size === 0) return { error: "empty" };
  try {
    const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof j !== "object" || j === null || Array.isArray(j)) {
      return { error: "shape" };
    }
    return { body: j };
  } catch {
    return { error: "json" };
  }
}

// ---------- db helpers ----------

let db;
function audit(licenseId, activationId, event, ip, detail) {
  db.prepare(
    "INSERT INTO audit (license_id, activation_id, event, ip, detail) VALUES (?,?,?,?,?)"
  ).run(licenseId, activationId, event, ip, detail ?? null);
}

function generateLicenseKey() {
  // 20 simbol base32 (32 huruf, tanpa I/O/0/1) = 100 bit, diambil acak kripto.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ234567";
  let s = "";
  for (let i = 0; i < 20; i++) {
    s += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `ICD10-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`;
}

function licenseStatusCheck(row) {
  if (!row) return { code: "invalid_key" };
  if (row.status === "revoked") return { code: "revoked" };
  if (row.status === "disabled") return { code: "license_disabled" };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { code: "license_expired" };
  }
  return { ok: true, row };
}

function makeLease(row, activationId) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: row.id,
    product: PRODUCT,
    activation_id: activationId,
    features: JSON.parse(row.features),
    iat: now,
    nbf: now,
    exp: now + config.leaseDays * 86400,
    jti: crypto.randomUUID(),
  };
  return signLease(claims, { kid: config.signingKid, keys: signingKeys });
}

// Verifikasi lease masuk (dari client) → {row, activation} atau {error}.
function verifyInboundLease(lease, installationId) {
  const r = verifyJws(lease, { allowedKeys: publicKeysOf(signingKeys) });
  if (!r.ok) return { error: "invalid_lease", detail: r.reason };
  const c = r.claims;
  if (c.iss !== ISSUER || c.aud !== AUDIENCE || c.product !== PRODUCT) {
    return { error: "invalid_lease", detail: "wrong_audience" };
  }
  if (typeof c.activation_id !== "string" || typeof c.sub !== "string") {
    return { error: "invalid_lease", detail: "missing_claims" };
  }
  const activation = db
    .prepare("SELECT * FROM activations WHERE id = ?")
    .get(c.activation_id);
  if (!activation) return { error: "unknown_activation" };
  if (activation.license_id !== c.sub) {
    return { error: "wrong_activation", detail: "lease bukan milik lisensi ini" };
  }
  if (installationId && activation.installation_id !== installationId) {
    return { error: "wrong_activation", detail: "activasi milik instalasi lain" };
  }
  const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(activation.license_id);
  return { row, activation, claims: c };
}

// ---------- operasi bisnis ----------

function handleActivate(ip, body) {
  const key = body.licenseKey;
  const installationId = body.installationId;
  if (typeof key !== "string" || !LICENSE_KEY_RE.test(key)) {
    return { code: 400, res: { error: "bad_request" } };
  }
  if (typeof installationId !== "string" || !UUID_RE.test(installationId)) {
    return { code: 400, res: { error: "bad_request" } };
  }
  const keyHash = crypto.createHash("sha256").update(key, "utf8").digest("hex");
  const row = db.prepare("SELECT * FROM licenses WHERE key_hash = ?").get(keyHash);
  const chk = licenseStatusCheck(row);
  if (!chk.ok) {
    audit(row?.id ?? null, null, "activate_denied", ip, chk.code);
    return { code: 403, res: { error: chk.code } };
  }
  // Transaksi atomik: cek kuota lalu insert. UNIQUE(license_id, installation_id)
  // membuat re-aktivasi instalasi yang sama idempoten (bukan double-kuota).
  let activationId;
  try {
    db.exec("BEGIN IMMEDIATE");
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM activations WHERE license_id = ?")
      .get(row.id).n;
    const existing = db
      .prepare("SELECT * FROM activations WHERE license_id = ? AND installation_id = ?")
      .get(row.id, installationId);
    if (existing) {
      activationId = existing.id;
      db.prepare("UPDATE activations SET last_seen_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        existing.id
      );
    } else if (count >= row.max_activations) {
      db.exec("ROLLBACK");
      audit(row.id, null, "activate_quota_exceeded", ip, `count=${count} max=${row.max_activations}`);
      return { code: 409, res: { error: "quota_exceeded" } };
    } else {
      activationId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO activations (id, license_id, installation_id, last_seen_at) VALUES (?,?,?,?)"
      ).run(activationId, row.id, installationId, new Date().toISOString());
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    audit(row.id, null, "activate_error", ip, "db_error");
    return { code: 500, res: { error: "internal" } };
  }
  audit(row.id, activationId, "activate", ip, "ok");
  return { code: 200, res: { lease: makeLease(row, activationId), activation_id: activationId } };
}

function checkInstallation(body) {
  const installationId = body.installationId;
  if (typeof installationId !== "string" || !UUID_RE.test(installationId)) {
    return { code: 400, res: { error: "bad_request" } };
  }
  return { installationId };
}

function mapLeaseError(r) {
  const code = r.error === "wrong_activation" ? 403 : r.error === "unknown_activation" ? 404 : 401;
  return { code, res: { error: r.error, ...(r.detail ? { detail: r.detail } : {}) } };
}

function handleRenew(ip, body) {
  const inst = checkInstallation(body);
  if (inst.code) return inst;
  const r = verifyInboundLease(body.lease, inst.installationId);
  if (!r.row) {
    audit(r.row?.id ?? null, null, "renew_denied", ip, r.error);
    return mapLeaseError(r);
  }
  const { row, activation } = r;
  const chk = licenseStatusCheck(row);
  if (!chk.ok) {
    audit(row.id, activation.id, "renew_denied", ip, chk.code);
    return { code: 403, res: { error: chk.code } };
  }
  db.prepare("UPDATE activations SET last_seen_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    activation.id
  );
  audit(row.id, activation.id, "renew", ip, "ok");
  return { code: 200, res: { lease: makeLease(row, activation.id) } };
}

function handleDeactivate(ip, body) {
  const inst = checkInstallation(body);
  if (inst.code) return inst;
  const r = verifyInboundLease(body.lease, inst.installationId);
  if (!r.row) {
    return mapLeaseError(r);
  }
  const { row, activation } = r;
  db.prepare("DELETE FROM activations WHERE id = ? AND license_id = ?").run(
    activation.id,
    row.id
  );
  audit(row.id, activation.id, "deactivate", ip, "ok");
  return { code: 200, res: { ok: true } };
}

// ---------- admin ----------

function adminEnabled() {
  return Boolean(config.adminToken || config.supportToken);
}

// Mengembalikan "admin" | "support" | null. Perbandingan timing-safe.
function adminRole(req, ip) {
  const h = req.headers["authorization"] ?? "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) {
    audit(null, null, "admin_denied", ip, "no_token");
    return null;
  }
  if (config.adminToken && timingSafeEq(m[1], config.adminToken)) return "admin";
  if (config.supportToken && timingSafeEq(m[1], config.supportToken)) return "support";
  audit(null, null, "admin_denied", ip, "bad_token");
  return null;
}

// Peran support: hanya baca + lepas aktivasi (tidak boleh membuat/mengubah/
// mencabut lisensi, tidak boleh mengubah kuota/entitlement).
function supportMay(method, p) {
  if (method === "GET" && (p === "/admin/licenses" || p === "/admin/audit")) return true;
  if (method === "GET" && /^\/admin\/licenses\/[0-9a-f-]{36}\/activations$/.test(p)) return true;
  if (method === "DELETE" && /^\/admin\/activations\/[0-9a-f-]{36}$/.test(p)) return true;
  return false;
}

function handleAdmin(req, ip, body, url, role) {
  const p = url.pathname;
  const bad = { code: 400, res: { error: "bad_request" } };

  if (role !== "admin" && !supportMay(req.method, p)) {
    audit(null, null, "admin_denied", ip, `role=${role} ${req.method} ${p}`.slice(0, 120));
    return { code: 403, res: { error: "forbidden_role" } };
  }

  if (req.method === "POST" && p === "/admin/licenses") {
    const maxAct = body.maxActivations;
    const features = body.features;
    const expiresAt = body.expiresAt;
    if (typeof maxAct !== "number" || !Number.isInteger(maxAct) || maxAct < 1 || maxAct > 1000) {
      return bad;
    }
    if (features !== undefined && (!Array.isArray(features) || features.some((f) => typeof f !== "string"))) {
      return bad;
    }
    if (expiresAt !== undefined && (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt)))) {
      return bad;
    }
    const id = crypto.randomUUID();
    const key = generateLicenseKey();
    db.prepare(
      `INSERT INTO licenses (id, key_hash, features, max_activations, expires_at, note)
       VALUES (?,?,?,?,?,?)`
    ).run(
      id,
      crypto.createHash("sha256").update(key, "utf8").digest("hex"),
      JSON.stringify(features ?? ["full"]),
      maxAct,
      expiresAt ?? null,
      typeof body.note === "string" ? body.note.slice(0, 200) : null
    );
    audit(id, null, "license_created", ip, `max=${maxAct}`);
    // Key mentah hanya dikembalikan SEKALI di sini. Tidak disimpan, tidak di-log.
    return { code: 201, res: { license: { id, licenseKey: key, maxActivations: maxAct } } };
  }

  if (req.method === "GET" && p === "/admin/licenses") {
    const rows = db
      .prepare(
        `SELECT l.id, l.features, l.max_activations, l.status, l.expires_at, l.note, l.created_at,
                (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id) AS activations
         FROM licenses l ORDER BY l.created_at DESC LIMIT 200`
      )
      .all();
    return { code: 200, res: { licenses: rows } };
  }

  if (req.method === "GET" && p === "/admin/audit") {
    const lid = url.searchParams.get("licenseId");
    const rows = lid
      ? db.prepare("SELECT * FROM audit WHERE license_id = ? ORDER BY id DESC LIMIT 200").all(lid)
      : db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 200").all();
    return { code: 200, res: { audit: rows } };
  }

  let m;
  if ((m = p.match(/^\/admin\/licenses\/([0-9a-f-]{36})$/)) && req.method === "PATCH") {
    const id = m[1];
    const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(id);
    if (!row) return { code: 404, res: { error: "not_found" } };
    const sets = [];
    const args = [];
    if (body.status !== undefined) {
      if (!["active", "disabled"].includes(body.status)) return bad;
      sets.push("status = ?"); args.push(body.status);
    }
    if (body.features !== undefined) {
      if (!Array.isArray(body.features) || body.features.some((f) => typeof f !== "string")) return bad;
      sets.push("features = ?"); args.push(JSON.stringify(body.features));
    }
    if (body.maxActivations !== undefined) {
      if (typeof body.maxActivations !== "number" || !Number.isInteger(body.maxActivations) ||
          body.maxActivations < 1 || body.maxActivations > 1000) {
        return bad;
      }
      sets.push("max_activations = ?"); args.push(body.maxActivations);
    }
    if (body.expiresAt !== undefined) {
      if (body.expiresAt === null) sets.push("expires_at = NULL");
      else if (typeof body.expiresAt === "string" && !Number.isNaN(Date.parse(body.expiresAt))) {
        sets.push("expires_at = ?"); args.push(body.expiresAt);
      } else return bad;
    }
    if (sets.length === 0) return bad;
    db.prepare(`UPDATE licenses SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    audit(id, null, "license_updated", ip, sets.join(","));
    return { code: 200, res: { ok: true } };
  }

  if ((m = p.match(/^\/admin\/licenses\/([0-9a-f-]{36})\/revoke$/)) && req.method === "POST") {
    const id = m[1];
    const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(id);
    if (!row) return { code: 404, res: { error: "not_found" } };
    db.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?").run(id);
    audit(id, null, "license_revoked", ip, typeof body.reason === "string" ? body.reason.slice(0, 200) : null);
    return { code: 200, res: { ok: true } };
  }

  if ((m = p.match(/^\/admin\/licenses\/([0-9a-f-]{36})\/activations$/)) && req.method === "GET") {
    const rows = db
      .prepare("SELECT * FROM activations WHERE license_id = ? ORDER BY created_at")
      .all(m[1]);
    return { code: 200, res: { activations: rows } };
  }

  if ((m = p.match(/^\/admin\/activations\/([0-9a-f-]{36})$/)) && req.method === "DELETE") {
    const act = db.prepare("SELECT * FROM activations WHERE id = ?").get(m[1]);
    if (!act) return { code: 404, res: { error: "not_found" } };
    db.prepare("DELETE FROM activations WHERE id = ?").run(m[1]);
    audit(act.license_id, m[1], "admin_deactivate", ip, "ok");
    return { code: 200, res: { error: undefined, ok: true } };
  }

  return { code: 404, res: { error: "not_found" } };
}

// ---------- server ----------

let signingKeys = {};

async function main() {
  signingKeys = loadSigningKeys(config.keysDir);
  if (Object.keys(signingKeys).length === 0) {
    console.error("FATAL: tidak ada kunci signing di " + config.keysDir + " — jalankan `npm run keys`");
    process.exit(1);
  }
  if (!signingKeys[config.signingKid]) {
    console.error("FATAL: LICENSE_SIGNING_KID='" + config.signingKid + "' tidak ada di keysDir. Tersedia: " + Object.keys(signingKeys).join(", "));
    process.exit(1);
  }
  db = openDb(config.dbPath);
  limiter = createRateLimiter(db, { windowMs: config.rateWindowMs });

  // Pengaman konfigurasi: jangan pernah membuka endpoint publik tanpa TLS.
  // Produksi yang memakai reverse proxy tetap bind ke loopback.
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopback.has(config.host) && !(config.tlsCert && config.tlsKey)) {
    console.error(
      "FATAL: LICENSE_HOST='" + config.host + "' bukan loopback tetapi TLS tidak dikonfigurasi. " +
        "Set LICENSE_TLS_CERT + LICENSE_TLS_KEY, atau bind ke 127.0.0.1 di belakang reverse proxy."
    );
    process.exit(1);
  }

  const handler = async (req, res) => {
    const ip = safeIp(req);
    const url = new URL(req.url, "http://x");
    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        db.prepare("SELECT 1 AS ok").get();
        return sendJson(res, 200, { ok: true, db: "ok" });
      }
      if (url.pathname.startsWith("/v1/")) {
        const fam = url.pathname.slice(4);
        if (!["activate", "renew", "deactivate"].includes(fam) || req.method !== "POST") {
          return sendJson(res, 404, { error: "not_found" });
        }
        if (!checkBuckets(res, ip, [[`${fam}:ip:${ip}`, config.rate[fam]]])) return;
        const { error, body } = await readJsonBody(req);
        if (error) return sendJson(res, 400, { error: "bad_request" });
        if (!checkBuckets(res, ip, extraBuckets(fam, body))) return;
        const out =
          fam === "activate" ? handleActivate(ip, body)
          : fam === "renew" ? handleRenew(ip, body)
          : handleDeactivate(ip, body);
        return sendJson(res, out.code, out.res);
      }
      if (url.pathname.startsWith("/admin")) {
        if (!checkBuckets(res, ip, [[`admin:ip:${ip}`, config.rate.admin]])) return;
        const role = adminRole(req, ip);
        if (!role) {
          return sendJson(res, adminEnabled() ? 401 : 503, {
            error: adminEnabled() ? "unauthorized" : "admin_disabled",
          });
        }
        if (!checkBuckets(res, ip, [[`admin:role:${role}`, config.rate.adminRole]])) return;
        const noBody = req.method === "GET" || req.method === "DELETE";
        const { error, body } = noBody ? { body: {} } : await readJsonBody(req);
        if (error) return sendJson(res, 400, { error: "bad_request" });
        const out = handleAdmin(req, ip, body, url, role);
        return sendJson(res, out.code, out.res);
      }
      return sendJson(res, 404, { error: "not_found" });
    } catch (e) {
      // Jangan pernah bocorkan stack / detail internal ke client.
      audit(null, null, "server_error", ip, e.code ?? "unhandled");
      return sendJson(res, 500, { error: "internal" });
    }
  };

  let server;
  if (config.tlsCert && config.tlsKey) {
    server = https.createServer(
      { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) },
      handler
    );
  } else {
    console.warn("PERINGATAN: berjalan tanpa TLS (HTTP). Hanya untuk environment testing.");
    server = http.createServer(handler);
  }
  server.listen(config.port, config.host, () => {
    console.log(
      `license-server: ${config.tlsCert ? "https" : "http"}://${config.host}:${config.port} ` +
      `kid=[${Object.keys(signingKeys).join(",")}] db=${config.dbPath} ` +
      `admin=${config.adminToken ? "on" : "off"} support=${config.supportToken ? "on" : "off"} ` +
      `lease=${config.leaseDays}d`
    );
  });
}

main();
