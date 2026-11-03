// Test matrix licensing server (F3.8) — dijalankan terhadap server nyata
// (child process) dengan DB temp dan keypair test temp.
// Jalan:  node test/run-tests.mjs   (dari folder license-server/ atau root)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { verifyJws } = require("../../shared/jws-verify.js");

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, ".."); // license-server/
const PORT = 18900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const KID = "test-run";
const ADMIN = "admin-test-token-" + crypto.randomBytes(8).toString("hex");

// ---- env temp ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lic-test-"));
const keysDir = path.join(tmp, "keys");
fs.mkdirSync(keysDir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(path.join(keysDir, `${KID}.private.pem`), privateKey.export({ type: "pkcs8", format: "pem" }));
fs.writeFileSync(path.join(keysDir, `${KID}.public.pem`), publicKey.export({ type: "spki", format: "pem" }));
const PUB = { kid: KID, pem: publicKey.export({ type: "spki", format: "pem" }) };
const dbPath = path.join(tmp, "db", "test.db");

// Lease pendek (~20 detik) supaya skenario "lease kedaluwarsa" teruji nyata.
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    LICENSE_HOST: "127.0.0.1",
    LICENSE_PORT: String(PORT),
    LICENSE_SIGNING_KID: KID,
    LICENSE_KEYS_DIR: keysDir,
    LICENSE_DB: dbPath,
    LICENSE_ADMIN_TOKEN: ADMIN,
    LICENSE_LEASE_DAYS: "0.00023",
    // Suite fungsional butuh banyak request; batas rate diuji terpisah di
    // run-ops-tests.mjs dengan server dan DB sendiri.
    LICENSE_RATE_ACTIVATE: "500",
    LICENSE_RATE_ACTIVATE_KEY: "500",
    LICENSE_RATE_ACTIVATE_INSTALLATION: "500",
    LICENSE_RATE_RENEW: "500",
    LICENSE_RATE_RENEW_LICENSE: "500",
    LICENSE_RATE_DEACTIVATE: "500",
    LICENSE_RATE_DEACTIVATE_LICENSE: "500",
    LICENSE_RATE_ADMIN: "500",
    LICENSE_RATE_ADMIN_ROLE: "500",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

// ---- helper ----
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS " + name + (extra ? " — " + extra : "")); }
  else { fail++; console.log("FAIL " + name + (extra ? " — " + extra : "")); }
};
const post = async (p, body, token) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const get = async (p, token) => {
  const r = await fetch(BASE + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const patch = async (p, body, token) => {
  const r = await fetch(BASE + p, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const del = async (p, token) => {
  const r = await fetch(BASE + p, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const adminCreate = async (maxActivations, extra = {}) => {
  const r = await post("/admin/licenses", { maxActivations, ...extra }, ADMIN);
  if (r.status !== 201) throw new Error("admin create gagal: " + JSON.stringify(r.j));
  return r.j.license; // {id, licenseKey, maxActivations}
};
const uuid = () => crypto.randomUUID();
const verifyLease = (lease) => verifyJws(lease, { allowedKeys: [PUB] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // tunggu health
  for (let i = 0; i < 50; i++) {
    try {
      const h = await fetch(BASE + "/healthz");
      if (h.ok) break;
    } catch {}
    await sleep(200);
  }
  const h = await get("/healthz");
  ok("healthz", h.status === 200 && h.j?.ok === true);

  // ============ POSITIVE ============
  const lic2 = await adminCreate(2);
  ok("admin: buat lisensi (key format ICD10-XXXXX-...)",
    /^ICD10-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/.test(lic2.licenseKey) && lic2.maxActivations === 2,
    lic2.id.slice(0, 8));

  const devA = uuid();
  const devB = uuid();
  const a1 = await post("/v1/activate", { licenseKey: lic2.licenseKey, installationId: devA });
  ok("aktivasi valid → 200 + lease", a1.status === 200 && typeof a1.j?.lease === "string");

  const v1 = verifyLease(a1.j.lease);
  ok("lease: signature Ed25519 valid", v1.ok);
  const c = v1.claims ?? {};
  ok("lease: klaim lengkap (iss/aud/sub/product/activation_id/features/iat/nbf/exp/jti)",
    c.iss === "icd10-licensing" && c.aud === "icd10-codex-2010" && c.product === "icd10-codex" &&
    c.sub === lic2.id && c.activation_id === a1.j.activation_id &&
    Array.isArray(c.features) && c.features.includes("full") &&
    typeof c.iat === "number" && typeof c.nbf === "number" && typeof c.exp === "number" &&
    typeof c.jti === "string" && c.exp > c.iat && c.nbf <= c.iat,
    `exp-iat=${(c.exp - c.iat).toFixed(0)}s (lease pendek uji; default 7d via env)`);

  const a1b = await post("/v1/activate", { licenseKey: lic2.licenseKey, installationId: devA, extraField: "diabaikan" });
  ok("re-aktivasi instalasi sama (idempoten) → activation_id sama + field extra diabaikan",
    a1b.status === 200 && a1b.j?.activation_id === a1.j.activation_id);

  const a2 = await post("/v1/activate", { licenseKey: lic2.licenseKey, installationId: devB });
  ok("perangkat kedua (kuota 2) → 200", a2.status === 200 && a2.j?.activation_id !== a1.j.activation_id);

  const renew1 = await post("/v1/renew", { lease: a1b.j.lease, installationId: devA });
  ok("renewal valid → 200 + lease baru (jti berbeda)",
    renew1.status === 200 && verifyLease(renew1.j.lease).ok &&
    verifyLease(renew1.j.lease).claims.jti !== c.jti);

  // ============ NEGATIVE: kuota & aktivasi ============
  const a3 = await post("/v1/activate", { licenseKey: lic2.licenseKey, installationId: uuid() });
  ok("aktivasi ke-3 melampaui kuota → 409 quota_exceeded", a3.status === 409 && a3.j?.error === "quota_exceeded");

  // race: kuota terakhir, 5 request simultan
  const lic1 = await adminCreate(1);
  const race = await Promise.all(
    Array.from({ length: 5 }, () =>
      post("/v1/activate", { licenseKey: lic1.licenseKey, installationId: uuid() })
    )
  );
  const raceOk = race.filter((r) => r.status === 200).length;
  const raceQuota = race.filter((r) => r.status === 409).length;
  ok("race 5 simultan utk kuota 1 → tepat 1 menang, 4 quota_exceeded",
    raceOk === 1 && raceQuota === 4, `ok=${raceOk} quota=${raceQuota}`);

  ok("key format salah (lowercase) → 400",
    (await post("/v1/activate", { licenseKey: "icd10-aaaaa-bbbbb-ccccc-ddddd", installationId: uuid() })).status === 400);
  ok("key acak format benar tapi tidak dikenal → 403 invalid_key",
    (await post("/v1/activate", { licenseKey: "ICD10-ZZZZZ-77777-XXXXX-YYYYY", installationId: uuid() })).status === 403);
  ok("installationId bukan UUID → 400",
    (await post("/v1/activate", { licenseKey: lic2.licenseKey, installationId: "bukan-uuid" })).status === 400);
  ok("tipe salah (licenseKey=123) → 400",
    (await post("/v1/activate", { licenseKey: 123, installationId: uuid() })).status === 400);

  // ============ NEGATIVE: lease tampered ============
  const goodLease = renew1.j.lease;
  const [hh, pp, ss] = goodLease.split(".");
  const tamperSig = hh + "." + pp + "." + (ss === "AAA" ? "AAB" : "AAA");
  ok("renewal signature dimodifikasi → 401 invalid_lease",
    (await post("/v1/renew", { lease: tamperSig, installationId: devA })).status === 401);

  // payload tampered: ubah claims.features lalu tanpakkan signature tetap
  const forgedPayload = Buffer.from(
    JSON.stringify({ ...verifyLease(goodLease).claims, features: ["full", "superadmin"] })
  ).toString("base64url");
  ok("renewal payload claim dimodifikasi → 401 (signature tidak cocok)",
    (await post("/v1/renew", { lease: hh + "." + forgedPayload + "." + ss, installationId: devA })).status === 401);

  const algForge = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: KID })).toString("base64url");
  ok("renewal alg tidak diizinkan (HS256) → 401",
    (await post("/v1/renew", { lease: algForge + "." + pp + "." + ss, installationId: devA })).status === 401);

  const kidForge = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "unknown-kid" })).toString("base64url");
  ok("renewal kid tidak dikenal → 401",
    (await post("/v1/renew", { lease: kidForge + "." + pp + "." + ss, installationId: devA })).status === 401);

  ok("renewal dengan installationId lain (bukan pemilik) → 403 wrong_activation",
    (await post("/v1/renew", { lease: goodLease, installationId: uuid() })).status === 403);

  // ============ ANTI-COPY: sidik perangkat (device_id) ============
  const licDev = await adminCreate(1);
  const devInst = uuid();
  const fpReal = "win:" + "a".repeat(32);
  const fpClone = "win:" + "b".repeat(32);
  const devAct = await post("/v1/activate", { licenseKey: licDev.licenseKey, installationId: devInst, deviceId: fpReal });
  ok("aktivasi dgn deviceId → 200", devAct.status === 200);
  const devRenewOk = await post("/v1/renew", { lease: devAct.j.lease, installationId: devInst, deviceId: fpReal });
  ok("renew dgn deviceId sama → 200", devRenewOk.status === 200);
  const devRenewClone = await post("/v1/renew", { lease: devAct.j.lease, installationId: devInst, deviceId: fpClone });
  ok("renew installationId sama tapi deviceId beda (clone) → 403 wrong_activation",
    devRenewClone.status === 403 && devRenewClone.j?.error === "wrong_activation");
  const devRenewNoFp = await post("/v1/renew", { lease: devAct.j.lease, installationId: devInst });
  ok("renew tanpa deviceId tetap 200 (kompatibel klien lama)", devRenewNoFp.status === 200);
  ok("deviceId format tidak sah → 400",
    (await post("/v1/activate", { licenseKey: licDev.licenseKey, installationId: uuid(), deviceId: "x" })).status === 400);
  // Re-aktivasi dari clone (installationId sama, deviceId beda) tidak boleh menimpa ikatan.
  const cloneRe = await post("/v1/activate", { licenseKey: licDev.licenseKey, installationId: devInst, deviceId: fpClone });
  const cloneRenew = await post("/v1/renew", { lease: cloneRe.j?.lease, installationId: devInst, deviceId: fpClone });
  ok("clone tak bisa mengikat ulang device_id lewat aktivasi → tetap 403",
    cloneRe.status === 200 && cloneRenew.status === 403 && cloneRenew.j?.error === "wrong_activation");

  // ============ IDENTITAS LISENSI: owner + masa berlaku di lease ============
  const licOwn = await adminCreate(1, { owner: "RS Contoh", expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
  const ownAct = await post("/v1/activate", { licenseKey: licOwn.licenseKey, installationId: uuid() });
  const ownClaims = verifyLease(ownAct.j?.lease).claims ?? {};
  ok("lease memuat owner lisensi", ownClaims.owner === "RS Contoh", String(ownClaims.owner));
  ok("lease memuat masa berlaku lisensi (license_exp)",
    typeof ownClaims.license_exp === "number" && ownClaims.license_exp > Math.floor(Date.now() / 1000));

  // ============ NEGATIVE: status lisensi ============
  const licRev = await adminCreate(1);
  const rDev = uuid();
  const rAct = await post("/v1/activate", { licenseKey: licRev.licenseKey, installationId: rDev });
  ok("setup: aktivasi lisensi yang akan dicabut", rAct.status === 200);
  await post(`/admin/licenses/${licRev.id}/revoke`, { reason: "test" }, ADMIN);
  const rRenew = await post("/v1/renew", { lease: rAct.j.lease, installationId: rDev });
  ok("lisensi dicabut → renewal 403 revoked", rRenew.status === 403 && rRenew.j?.error === "revoked");
  ok("lisensi dicabut → aktivasi baru 403 revoked",
    (await post("/v1/activate", { licenseKey: licRev.licenseKey, installationId: uuid() })).j?.error === "revoked");

  const licDis = await adminCreate(1);
  await patch(`/admin/licenses/${licDis.id}`, { status: "disabled" }, ADMIN);
  ok("lisensi disabled → 403 license_disabled",
    (await post("/v1/activate", { licenseKey: licDis.licenseKey, installationId: uuid() })).j?.error === "license_disabled");

  const licExp = await adminCreate(1, { expiresAt: new Date(Date.now() - 86400000).toISOString() });
  ok("lisensi masa berlakunya habis → 403 license_expired",
    (await post("/v1/activate", { licenseKey: licExp.licenseKey, installationId: uuid() })).j?.error === "license_expired");

  // renewal aktivasi yang sudah dihapus admin → unknown_activation
  const licDel = await adminCreate(1);
  const dDev = uuid();
  const dAct = await post("/v1/activate", { licenseKey: licDel.licenseKey, installationId: dDev });
  const dList = await get(`/admin/licenses/${licDel.id}/activations`, ADMIN);
  const dActId = dList.j.activations[0].id;
  const dDel = await del(`/admin/activations/${dActId}`, ADMIN);
  ok("setup: admin melepas aktivasi → 200", dDel.status === 200, `dapat ${dDel.status}`);
  const dRenew = await post("/v1/renew", { lease: dAct.j.lease, installationId: dDev });
  ok("renewal aktivasi yang dilepas admin → 404 unknown_activation",
    dRenew.status === 404 && dRenew.j?.error === "unknown_activation",
    `dapat ${dRenew.status} ${JSON.stringify(dRenew.j)}`);

  // ============ NEGATIVE: lease kedaluwarsa (real wait ~21 dtk) ============
  const licWait = await adminCreate(1);
  const wDev = uuid();
  const wAct = await post("/v1/activate", { licenseKey: licWait.leaseKey ?? licWait.licenseKey, installationId: wDev });
  ok("setup: aktivasi utk uji lease kedaluwarsa", wAct.status === 200);
  console.log("   (menunggu 21 detik agar lease kedaluwarsa...)");
  await sleep(21000);
  const wRenew = await post("/v1/renew", { lease: wAct.j.lease, installationId: wDev });
  ok("lease kedaluwarsa → renewal 401 invalid_lease (pemulihan via activate ulang)",
    wRenew.status === 401 && wRenew.j?.error === "invalid_lease");
  const wRe = await post("/v1/activate", { licenseKey: licWait.licenseKey, installationId: wDev });
  ok("pemulihan: activate ulang dgn key tersimpan setelah lease expired → 200 + lease baru",
    wRe.status === 200 && verifyLease(wRe.j.lease).ok);

  // ============ NEGATIVE: deactivation ============
  const licDe = await adminCreate(2);
  const deDev = uuid();
  const deAct = await post("/v1/activate", { licenseKey: licDe.licenseKey, installationId: deDev });
  ok("deactivate dgn lease valid + installationId benar → 200",
    (await post("/v1/deactivate", { lease: deAct.j.lease, installationId: deDev })).status === 200);
  const deList = await get(`/admin/licenses/${licDe.id}/activations`, ADMIN);
  ok("aktivasi benar-benar lepas dari daftar", deList.j.activations.length === 0);
  const deRe = await post("/v1/activate", { licenseKey: licDe.licenseKey, installationId: deDev });
  ok("re-aktivasi setelah deactivate → 200 (kuota kembali)", deRe.status === 200);
  ok("deactivate installationId salah (lease aktif) → 403 wrong_activation",
    (await post("/v1/deactivate", { lease: deRe.j.lease, installationId: uuid() })).status === 403);

  // ============ NEGATIVE: admin auth & validasi ============
  ok("admin tanpa token → 401", (await get("/admin/licenses")).status === 401);
  ok("admin token salah → 401", (await get("/admin/licenses", "salah-token")).status === 401);
  ok("admin: PATCH status tidak valid → 400",
    (await patch(`/admin/licenses/${licDe.id}`, { status: "hacked" }, ADMIN)).status === 400);
  ok("admin: PATCH maxActivations=0 → 400",
    (await patch(`/admin/licenses/${licDe.id}`, { maxActivations: 0 }, ADMIN)).status === 400);
  ok("admin: buat dgn expiresAt sampah → 400",
    (await post("/admin/licenses", { maxActivations: 1, expiresAt: "bukan-tanggal" }, ADMIN)).status === 400);
  ok("admin: route tidak dikenal → 404", (await get("/admin/apa-itu", ADMIN)).status === 404);

  // ============ NEGATIVE: transport ============
  const rCt = await fetch(BASE + "/v1/activate", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "hello",
  });
  ok("content-type bukan JSON → 400", rCt.status === 400);
  const big = await post("/v1/activate", { licenseKey: "ICD10-ZZZZZ-99999-XXXXX-YYYYY", installationId: uuid(), pad: "x".repeat(200000) });
  ok("payload > 64KB → 400", big.status === 400);

  // rate limit & peran admin diuji di run-ops-tests.mjs (server + DB terpisah)

  // ============ AUDIT & kebocoran ============
  const aud = await get(`/admin/audit?licenseId=${lic2.id}`, ADMIN);
  const evts = (aud.j?.audit ?? []).map((a) => a.event);
  ok("audit log merekam activate/renew lisensi",
    evts.includes("activate") && evts.includes("renew"), evts.slice(0, 6).join(","));
  const audAll = (await get("/admin/audit", ADMIN)).j?.audit ?? [];
  ok("audit: revoke + admin op tercatat",
    audAll.some((a) => a.event === "license_revoked") && audAll.some((a) => a.event === "license_created"));
  ok("TIDAK ADA bocor: key mentah tidak ada di log server",
    !serverLog.includes(lic2.licenseKey) && !serverLog.includes(licRev.licenseKey));
  ok("TIDAK ADA bocor: material private key tidak ada di log server",
    !serverLog.includes("PRIVATE KEY"));
  ok("TIDAK ADA bocor: audit DB tidak memuat key mentah",
    !JSON.stringify(audAll).includes(lic2.licenseKey));

  // ============ RINGKASAN ============
  console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
  server.kill();
  await new Promise((r) => server.once("exit", r));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SUITE-FAIL", e);
  server.kill();
  process.exit(2);
});
