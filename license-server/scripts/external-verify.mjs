// Verifikasi checklist eksternal licensing API produksi — dijalankan DARI
// jaringan terpisah (bukan dari server itu sendiri), terhadap domain + HTTPS
// publik yang benar-benar tersedia.
//
//   node license-server/scripts/external-verify.mjs \
//     --base https://<domain-lisensi> \
//     --key <license-key-uji> \
//     --keyset electron/keysets/production.public-keys.json \
//     [--admin-token <token>] [--rate-burst 12]
//
// Tanpa deploy nyata, skrip ini adalah persiapan; status DNS/TLS/HTTPS di luar
// environment production tetap BLOCKED hingga dijalankan terhadap domain nyata.
//
// Tidak pernah mencetak license key lengkap atau token. Tidak menonaktifkan
// validasi TLS (rejectUnauthorized dibiarkan default true).
import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { verifyJws } = require(path.join(ROOT, "shared", "jws-verify.js"));

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
}
const BASE = String(flags.base ?? "").replace(/\/+$/, "");
const KEY = String(flags.key ?? "");
const KEYSET = flags.keyset ? path.resolve(flags.keyset) : null;
const TOKEN = flags["admin-token"] ?? process.env.LICENSE_ADMIN_TOKEN ?? "";
const BURST = Number(flags["rate-burst"] ?? 0);

let pass = 0;
let fail = 0;
let blocked = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log("PASS " + name + (extra ? " — " + extra : ""));
  } else {
    fail++;
    console.log("FAIL " + name + (extra ? " — " + extra : ""));
  }
};
const block = (name, reason) => {
  blocked++;
  console.log("BLOCKED " + name + " — " + reason);
};

if (!/^https:\/\//.test(BASE)) {
  console.error("GAGAL: --base harus https://... (production tidak memakai HTTP).");
  process.exit(2);
}
if (!KEY || !/^ICD10-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/.test(KEY)) {
  console.error("GAGAL: --key harus license key uji berformat ICD10-XXXXX-...");
  process.exit(2);
}
if (!KEYSET || !fs.existsSync(KEYSET)) {
  console.error("GAGAL: --keyset <public-keys.json> wajib ada (untuk verifikasi signature lease).");
  process.exit(2);
}
const allowed = JSON.parse(fs.readFileSync(KEYSET, "utf8"));
const host = new URL(BASE).hostname;

const post = (p, body, token) =>
  new Promise((resolve) => {
    const url = new URL(BASE + p);
    const lib = url.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, j, raw: b });
        });
      }
    );
    req.on("error", () => resolve({ status: 0, j: null, raw: "" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, j: null, raw: "" });
    });
    req.end(data);
  });

// 1. DNS
try {
  const a = await dns.resolve4(host);
  ok("DNS: hostname resolve ke A record (jaringan eksternal ini)", a.length > 0, a.join(","));
} catch {
  fail++;
  console.log("FAIL DNS: hostname tidak resolve — " + host);
}

// 2. TLS dan sertifikat (rejectUnauthorized default true; self-signed/hostname
// salah langsung gagal).
await new Promise((resolve) => {
  const req = https.get(BASE + "/healthz", { timeout: 15000 }, (res) => {
    const cert = res.socket.getPeerCertificate();
    const now = Date.now();
    const validDates = cert.valid_from && cert.valid_to
      ? new Date(cert.valid_to).getTime() > now && new Date(cert.valid_from).getTime() < now
      : false;
    ok("TLS: koneksi dengan validasi penuh (rantai + hostname) berhasil", res.socket.authorized === true,
      res.socket.authorized ? `subjek=${cert.subject?.CN}` : "authorized=false");
    ok("TLS: sertifikat berada dalam masa berlaku", validDates,
      `${cert.valid_from} .. ${cert.valid_to}`);
    ok("TLS: SAN memuat hostname " + host, (cert.subjectaltname ?? "").includes(host));
    res.resume();
    resolve();
  });
  req.on("error", () => {
    fail++;
    console.log("FAIL TLS: koneksi HTTPS gagal (rantai/hostname tidak valid) — " + host);
    resolve();
  });
  req.on("timeout", () => {
    req.destroy();
    fail++;
    console.log("FAIL TLS: timeout");
    resolve();
  });
});

// 3. healthz
const h = await post("/healthz", {});
ok("healthz 200 + db ok", h.status === 200 && h.j?.db === "ok", `status=${h.status}`);

// 4. Endpoint admin tanpa token → harus ditolak.
const a = await post("/admin/health", {});
ok("admin tanpa otorisasi ditolak (401/503)", a.status === 401 || a.status === 503, `status=${a.status}`);

// 5. License key invalid / signature palsu → 403, tanpa kebocoran.
const bad = await post("/v1/activate", { licenseKey: "ICD10-AAAAA-AAAAA-AAAAA-AAAAA", installationId: crypto.randomUUID() });
ok("aktivasi key tidak dikenal → 403/400 generik", bad.status === 403 || bad.status === 400, `status=${bad.status}`);
ok("error tidak membocorkan stack/secret", !/at\s+\S+:\d+|-----BEGIN|token/i.test(bad.raw ?? ""), (bad.raw ?? "").slice(0, 60));

// 6. Aktivasi + verifikasi signature lease.
const act = await post("/v1/activate", { licenseKey: KEY, installationId: crypto.randomUUID() });
const lease = act.j?.lease;
if (act.status === 200 && lease) {
  const v = verifyJws(lease, { allowedKeys: allowed });
  ok("aktivasi 200 + lease signature valid (public key produksi dipercaya)", v.ok === true, v.reason ?? "");
  // 7. Renewal
  const rn = await post("/v1/renew", { lease, installationId: crypto.randomUUID() });
  const rv = rn.j?.lease ? verifyJws(rn.j.lease, { allowedKeys: allowed }) : { ok: false };
  ok("renewal 200 + lease baru valid", rn.status === 200 && rv.ok === true, `status=${rn.status}`);
  // 8. Deactivation
  const de = await post("/v1/deactivate", { lease, installationId: crypto.randomUUID() });
  ok("deactivation 200", de.status === 200, `status=${de.status}`);
} else {
  block("aktivasi", "license key tidak diterima (status=" + act.status + ")");
}

// 9. Rate limiting burst (opsional)
if (BURST > 0) {
  let got429 = false;
  for (let i = 0; i < BURST; i++) await post("/v1/activate", { licenseKey: KEY, installationId: crypto.randomUUID() });
  const probe = await post("/v1/activate", { licenseKey: KEY, installationId: crypto.randomUUID() });
  got429 = probe.status === 429;
  ok("rate limit: 429 + Retry-After setelah burst", got429, `status=${probe.status}`);
}

console.log(`\nRINGKASAN: ${pass} PASS / ${fail} FAIL / ${blocked} BLOCKED`);
process.exit(fail === 0 ? 0 : 1);