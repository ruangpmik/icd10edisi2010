// Uji unit klien lisensi — berjalan di dalam Electron (main process), karena
// electron/license.js memakai app.getPath + safeStorage. Tanpa server, tanpa GUI.
// Cakupan: mesin status (active/grace/expired/invalid/revoked), tamper, alg/kid,
// rollback jam, simpanan rusak, validasi format key, dan penjaga IPC.
"use strict";

const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "icd10-lic-unit-"));
app.setPath("userData", TMP);

const license = require(path.join(ROOT, "electron", "license.js"));
const { allowLicenseIpc } = require(path.join(ROOT, "electron", "ipc-guard.js"));

const PRIV = fs.readFileSync(
  path.join(ROOT, "license-server", "keys", "test-2026-10.private.pem"),
  "utf8"
);
const KID = "test-2026-10";
const now = () => Math.floor(Date.now() / 1000);

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("PASS", name, extra ? `— ${extra}` : "");
  } else {
    fail++;
    console.log("FAIL", name, extra ? `— ${extra}` : "");
  }
}

function b64u(v) {
  return Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
}
function sign(claims, hdr = { alg: "EdDSA", typ: "JWT", kid: KID }) {
  const h = b64u(hdr);
  const p = b64u(claims);
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), crypto.createPrivateKey(PRIV));
  return `${h}.${p}.${sig.toString("base64url")}`;
}
function claims(over = {}) {
  const t = now();
  return {
    iss: "icd10-licensing",
    aud: "icd10-codex-2010",
    sub: "uj@ruangpmik.id",
    product: "icd10-codex",
    activation_id: "11111111-1111-4111-8111-111111111111",
    features: ["core"],
    iat: t - 60,
    nbf: t - 60,
    exp: t + 3600,
    jti: crypto.randomUUID(),
    ...over,
  };
}
const STORE = path.join(TMP, "license.json");
function putStore(obj) {
  fs.writeFileSync(STORE, JSON.stringify({ v: 1, plain: obj }));
}
function clearStore() {
  try {
    fs.unlinkSync(STORE);
  } catch {}
}

async function main() {
  // 1. tanpa simpanan
  clearStore();
  ok("tanpa simpanan → unactivated", (await license.getStatus()).state === "unactivated");

  // 2. lease sah
  putStore({ lease: sign(claims()) });
  let st = await license.getStatus();
  ok("lease sah → active + canUseApp", st.state === "active" && st.canUseApp === true, st.state);

  // 3. kedaluwarsa + grace 4 hari
  process.env.ICD10_LICENSE_GRACE_DAYS = "4";
  const expired = claims({ iat: now() - 9000, nbf: now() - 9000, exp: now() - 600 });
  putStore({ lease: sign(expired) });
  st = await license.getStatus();
  ok("lease kedaluwarsa 10 mnt → grace + boleh pakai", st.state === "grace" && st.canUseApp === true, st.state);

  // 4. kedaluwarsa + grace 0
  process.env.ICD10_LICENSE_GRACE_DAYS = "0";
  st = await license.getStatus();
  ok("grace 0 hari → expired + diblokir", st.state === "expired" && st.canUseApp === false, st.state);
  process.env.ICD10_LICENSE_GRACE_DAYS = "4";

  // 5. signature diubah
  const good = sign(claims());
  const [h, p, s] = good.split(".");
  putStore({ lease: `${h}.${p}.${(s[0] === "A" ? "B" : "A") + s.slice(1)}` });
  ok("signature diubah → invalid", (await license.getStatus()).state === "invalid");

  // 6. payload diubah, signature lama
  const claimsObj = claims();
  const forgedPayload = b64u({ ...claimsObj, features: ["premium"], exp: now() + 999999 });
  putStore({ lease: `${h}.${forgedPayload}.${s}` });
  ok("payload diubah (naikkan exp) → invalid", (await license.getStatus()).state === "invalid");

  // 7. kid tidak dikenal
  putStore({ lease: sign(claims(), { alg: "EdDSA", typ: "JWT", kid: "attacker-1" }) });
  ok("kid tak dikenal → invalid", (await license.getStatus()).state === "invalid");

  // 8. alg dilarang (HS256) — HMAC dgn rahasia sembarang
  const hs = b64u({ alg: "HS256", typ: "JWT", kid: KID });
  const hp = b64u(claims());
  const hsig = crypto.createHmac("sha256", "rahasia").update(`${hs}.${hp}`).digest("base64url");
  putStore({ lease: `${hs}.${hp}.${hsig}` });
  ok("alg HS256 ditolak → invalid", (await license.getStatus()).state === "invalid");

  // 9. aud salah
  putStore({ lease: sign(claims({ aud: "produk-lain" })) });
  ok("aud salah → invalid", (await license.getStatus()).state === "invalid");

  // 10. product salah
  putStore({ lease: sign(claims({ product: "icd10-other" })) });
  ok("product salah → invalid", (await license.getStatus()).state === "invalid");

  // 11. rollback jam tidak memperpanjang: maxTime dipaksa jauh ke depan
  const live = claims();
  putStore({ lease: sign(live), maxTime: live.exp + 1000 });
  st = await license.getStatus();
  ok("rollback jam (maxTime > exp) tidak bikin active", st.state !== "active", st.state);

  // 12. simpanan rusak
  fs.writeFileSync(STORE, JSON.stringify({ v: 1, enc: "bukan-cipher-valid" }));
  ok("simpanan rusak → invalid", (await license.getStatus()).state === "invalid");

  // 13. status terminal server menang atas lease sah
  putStore({ lease: sign(claims()), serverState: "revoked" });
  st = await license.getStatus();
  ok("revoked dari server → revoked + diblokir", st.state === "revoked" && st.canUseApp === false, st.state);

  putStore({ lease: sign(claims()), serverState: "license_disabled" });
  ok("disabled dari server → license_disabled", (await license.getStatus()).state === "license_disabled");

  // 14. kegagalan kunci lain (kuota) TIDAK mengunci lisensi yang masih sah
  putStore({ lease: sign(claims()), serverState: "quota_exceeded" });
  st = await license.getStatus();
  ok("kuota gagal tidak mengunci lease sah", st.state === "active" && st.canUseApp === true, st.state);

  // 15. format key salah ditolak lokal (tanpa jaringan)
  clearStore();
  const bad = await license.activate("icd10-rendah-00000-00000-00000");
  ok("format key salah → bad_key_format", bad.ok === false && bad.error === "bad_key_format", bad.error);
  const bad2 = await license.activate("ICD10-AAAAA-AAAAA-AAAAA-AAA");
  ok("key kurang panjang → bad_key_format", bad2.error === "bad_key_format", bad2.error);
  const bad3 = await license.activate(12345);
  ok("key bukan string → bad_key_format", bad3.error === "bad_key_format", bad3.error);

  // 16. penjaga IPC
  const top = { senderFrame: { url: "app://local/", parent: null } };
  const frame = { senderFrame: { url: "app://local/", parent: { url: "app://local/" } } };
  const evil = { senderFrame: { url: "https://evil.example.com/", parent: null } };
  const fileUrl = { senderFrame: { url: "file:///C:/x.html", parent: null } };
  ok("IPC: app://local top-level diizinkan", allowLicenseIpc(top) === true);
  ok("IPC: iframe app:// ditolak", allowLicenseIpc(frame) === false);
  ok("IPC: origin https ditolak", allowLicenseIpc(evil) === false);
  ok("IPC: file:// ditolak", allowLicenseIpc(fileUrl) === false);
  ok("IPC: event tanpa senderFrame ditolak", allowLicenseIpc({}) === false);

  // 17. putar ulang: kunci sah tapi server tak dikonfigurasi → error jaringan,
  //     bukan crash, dan state tidak berubah menjadi terminal.
  clearStore();
  const noSrv = await license.activate("ICD10-AAAAA-BBBBB-CCCCC-DDDDD");
  ok("server tak dikonfigurasi → network (bukan crash)", noSrv.ok === false && noSrv.error === "network", noSrv.error);

  console.log(`\nHASIL UNIT: ${pass} PASS, ${fail} FAIL`);
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {}
  app.exit(fail === 0 ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error("UNIT-FAIL", e);
  app.exit(2);
});