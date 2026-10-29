// F6.4 — Uji perilaku client lisensi (electron/license.js) di Node (modul
// `electron` di-mock karena lisensi hanya mengambil `app.getPath` dan
// `safeStorage`; safeStorage di-mock OFF agar memakai jalur plaintext yang
// stabil untuk uji). Fokus: kegagalan jaringan TIDAK mencabut lisensi,
// grace period sesuai kontrak, rollback jam, dan pemulihan.
//
//   node electron/test/run-client-tests.cjs
//
// Memakai keyset kandidat yang benar-benar tertanam (electron/public-keys.json)
// dan private key kandidat di luar repo (%USERPROFILE%\.icd10-prod-keys).
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lic-client-"));
const CAND_KEYS = path.join(os.homedir(), ".icd10-prod-keys");
const KID = "prod-candidate-2026-10";

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

// Pastikan trust store hasil generate = keyset kandidat.
const sel = spawnSync(process.execPath, [path.join(ROOT, "scripts", "select-keys.mjs"), "candidate"], { encoding: "utf8" });
if (sel.status !== 0) {
  console.error("GAGAL: select-keys candidate\n" + (sel.stdout ?? "") + (sel.stderr ?? ""));
  process.exit(2);
}

// Mock modul `electron`: license.js hanya butuh app.getPath + safeStorage.
const electronMock = {
  app: { getPath: () => TMP, setPath: () => {}, quit: () => {}, on: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    isAsyncEncryptionAvailable: () => Promise.resolve(false),
    getEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s, "utf8"),
    decryptString: (b) => Buffer.from(b).toString("utf8"),
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return electronMock;
  return origLoad.call(this, request, ...rest);
};

const license = require(path.join(ROOT, "electron", "license.js"));

async function main() {
  const { loadSigningKeys, signLease } = await import(pathToFileURL(path.join(ROOT, "license-server", "jws.mjs")).href);
  const keys = loadSigningKeys(CAND_KEYS);
  if (!keys[KID]) {
    console.error("GAGAL: private key kandidat tidak ada di " + CAND_KEYS);
    app.exit(2);
    return;
  }
  const storeFile = path.join(TMP, "license.json");
  const now = Math.floor(Date.now() / 1000);
  const claims = (extra = {}) => ({
    iss: "icd10-licensing",
    aud: "icd10-codex-2010",
    sub: "11111111-1111-4111-8111-111111111111",
    product: "icd10-codex",
    activation_id: "22222222-2222-4222-8222-222222222222",
    features: ["full"],
    iat: now - 10,
    nbf: now - 10,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    ...extra,
  });
  const lease = signLease(claims(), { kid: KID, keys });

  // Server uji dengan perilaku yang bisa diganti-ganti.
  let behavior = { mode: "ok" }; // ok | hang | status:500 | rate | revoked | quota
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (behavior.mode === "hang") return; // tidak pernah membalas → client timeout
      if (behavior.mode === "status") {
        res.writeHead(behavior.code, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: behavior.body ?? "x" }));
      }
      if (behavior.mode === "rate") {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "30" });
        return res.end(JSON.stringify({ error: "rate_limited" }));
      }
      if (behavior.mode === "error") {
        res.writeHead(behavior.code ?? 403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: behavior.body }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ lease, activation_id: "22222222-2222-4222-8222-222222222222" }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.ICD10_LICENSE_URL = base;
  process.env.ICD10_LICENSE_GRACE_DAYS = "4";

  // 1. Aktivasi sukses → active.
  behavior = { mode: "ok" };
  const r1 = await license.activate("ICD10-WCU2A-F4LZT-73JE3-KCQ2R");
  ok("aktivasi sukses → state active", r1.ok === true && r1.status?.state === "active", r1.status?.state);

  // 2. Server hang (timeout 8s) → network, state TETAP active (bukan revoked).
  behavior = { mode: "hang" };
  const t0 = Date.now();
  const r2 = await license.renew();
  const dt = Date.now() - t0;
  ok("timeout server → error network (bukan revoked)", r2.ok === false && r2.error === "network", `${r2.error} ${Math.round(dt / 1000)}s`);
  ok("timeout dalam batas (AbortSignal ~8s)", dt > 7000 && dt < 15000, `${dt}ms`);
  const s2 = await license.getStatus();
  ok("setelah timeout: state tetap active, data utuh", s2.state === "active" && fs.existsSync(storeFile), s2.state);

  // 3. Server 500 → diperlakukan gangguan, bukan pencabutan.
  behavior = { mode: "status", code: 500, body: "internal" };
  const r3 = await license.renew();
  ok("HTTP 500 → network (state dipertahankan)", r3.ok === false && r3.error === "network", r3.error);
  ok("setelah 500: state tetap active", (await license.getStatus()).state === "active");

  // 4. Rate limited → network, bukan revoked.
  behavior = { mode: "rate" };
  const r4 = await license.renew();
  ok("429 rate_limited → network (state dipertahankan)", r4.ok === false && r4.error === "network", r4.error);

  // 5. Renew gagal berulang TIDAK memperpanjang grace: graceUntil konstan.
  // Buat lease kedaluwarsa di dalam grace.
  const expSoon = now - 3600; // kedaluwarsa 1 jam lalu; grace 4 hari
  const staleLease = signLease(claims({ iat: expSoon - 7200, nbf: expSoon - 7200, exp: expSoon }), { kid: KID, keys });
  fs.writeFileSync(storeFile, JSON.stringify({ v: 1, plain: { key: "ICD10-WCU2A-F4LZT-73JE3-KCQ2R", lease: staleLease, maxTime: 0, skew: 0 } }));
  const g1 = await license.getStatus();
  ok("lease kedaluwarsa dalam grace → state grace + canUseApp", g1.state === "grace" && g1.canUseApp === true, g1.state);
  behavior = { mode: "hang" };
  await license.renew();
  await license.renew();
  behavior = { mode: "ok" };
  const g2 = await license.getStatus();
  ok("renew gagal berulang tidak menggeser graceUntil", g1.graceUntil === g2.graceUntil, `${g1.graceUntil} vs ${g2.graceUntil}`);

  // 6. Grace lewat → expired, canUseApp false, data TIDAK dihapus.
  const expOld = now - 5 * 86400; // melewati grace 4 hari
  const oldLease = signLease(claims({ iat: expOld - 7200, nbf: expOld - 7200, exp: expOld }), { kid: KID, keys });
  fs.writeFileSync(storeFile, JSON.stringify({ v: 1, plain: { key: "ICD10-WCU2A-F4LZT-73JE3-KCQ2R", lease: oldLease, maxTime: 0, skew: 0 } }));
  const e1 = await license.getStatus();
  ok("grace lewat → state expired + canUseApp false", e1.state === "expired" && e1.canUseApp === false, e1.state);
  ok("expired: license.json tidak dihapus", fs.existsSync(storeFile));

  // 7. kid tidak dikenal → invalid (bukan active).
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rogueDir = path.join(TMP, "rogue");
  fs.mkdirSync(rogueDir, { recursive: true });
  fs.writeFileSync(path.join(rogueDir, "rogue-kid.private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
  const rogue = loadSigningKeys(rogueDir);
  const rogueLease = signLease(claims(), { kid: "rogue-kid", keys: rogue });
  void publicKey;
  fs.writeFileSync(storeFile, JSON.stringify({ v: 1, plain: { key: "ICD10-WCU2A-F4LZT-73JE3-KCQ2R", lease: rogueLease, maxTime: 0, skew: 0 } }));
  const u1 = await license.getStatus();
  ok("kid tidak dikenal → state invalid", u1.state === "invalid", u1.state);

  // 8. Status terminal server (revoked) menang atas lease lokal; data utuh.
  fs.writeFileSync(storeFile, JSON.stringify({ v: 1, plain: { key: "ICD10-WCU2A-F4LZT-73JE3-KCQ2R", lease, maxTime: 0, skew: 0, serverState: "revoked" } }));
  const v1 = await license.getStatus();
  ok("serverState revoked → state revoked (terminal menang)", v1.state === "revoked" && v1.canUseApp === false, v1.state);
  ok("revoked: data lokal tidak dihapus", fs.existsSync(storeFile));

  // 9. Pemulihan: server kembali → renew sukses → active kembali.
  fs.writeFileSync(storeFile, JSON.stringify({ v: 1, plain: { key: "ICD10-WCU2A-F4LZT-73JE3-KCQ2R", lease: staleLease, maxTime: 0, skew: 0 } }));
  behavior = { mode: "ok" };
  const r9 = await license.renew();
  const s9 = await license.getStatus();
  ok("jaringan pulih → renew sukses → state active", r9.ok === true && s9.state === "active", s9.state);

  // 10. Rollback jam: nowSec tidak pernah di bawah maxTime.
  const future = now + 7 * 86400;
  const rolled = license._internals.nowSec({ skew: 0, maxTime: future });
  ok("guard rollback jam: nowSec >= maxTime", rolled >= future, `nowSec=${rolled} maxTime=${future}`);

  // 11. Deactivate saat offline → slot dilepas lokal, ok:true + offline.
  behavior = { mode: "hang" };
  const d1 = await license.deactivate();
  ok("deactivate offline → ok + offline, lease dilepas lokal", d1.ok === true && d1.offline === true, JSON.stringify({ ok: d1.ok, offline: d1.offline }));
  const d2 = await license.getStatus();
  ok("setelah deactivate offline: state unactivated (data tetap ada)", d2.state === "unactivated" && fs.existsSync(storeFile), d2.state);

  srv.close();
  console.log(`\nRINGKASAN: ${pass} PASS / ${fail} FAIL`);
  console.log("TMP=" + TMP);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("GAGAL harness:", e?.stack ?? e);
  process.exit(2);
});
