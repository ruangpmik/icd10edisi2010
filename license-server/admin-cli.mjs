#!/usr/bin/env node
// CLI administrasi lisensi — jalur minimum yang aman tanpa dashboard.
// Memakai HTTP admin API; tidak pernah menyimpan/mencetak token.
//
// Pemakaian:
//   LICENSE_ADMIN_URL=https://license.example.id \
//   LICENSE_ADMIN_TOKEN=... node admin-cli.mjs <perintah> [...]
//
// Perintah:
//   health
//   create --max N [--features a,b] [--expires ISO] [--note "..." ]
//   list
//   show <licenseId>                 (aktivasi perangkat)
//   disable <licenseId>
//   enable <licenseId>
//   revoke <licenseId> --yes [--reason "..."]
//   release <activationId> --yes     (lepas slot perangkat)
//   audit [--license <id>] [--limit N]
//
// Peran: LICENSE_ADMIN_TOKEN = admin penuh; LICENSE_SUPPORT_TOKEN = support
// (hanya list/show/audit/release). Bila keduanya ada, admin dipakai lebih dulu.
// Operasi destruktif WAJIB --yes; tidak ada perintah menghapus lisensi permanen.
import crypto from "node:crypto";

const URL_BASE = (process.env.LICENSE_ADMIN_URL ?? "http://127.0.0.1:8443").replace(/\/+$/, "");
const TOKEN = process.env.LICENSE_ADMIN_TOKEN || process.env.LICENSE_SUPPORT_TOKEN || "";
const IS_SUPPORT = !process.env.LICENSE_ADMIN_TOKEN && Boolean(process.env.LICENSE_SUPPORT_TOKEN);

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--yes") flags.yes = true;
  else if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    flags[k] = v;
  } else positional.push(a);
}

function usage(code = 2) {
  console.error(
    "perintah: health | create --max N | list | show <id> | disable <id> | enable <id> |\n" +
      "          revoke <id> --yes | release <activationId> --yes | audit [--license id]"
  );
  process.exit(code);
}
if (!cmd) usage();
if (!TOKEN && cmd !== "health") {
  console.error("GAGAL: set LICENSE_ADMIN_TOKEN atau LICENSE_SUPPORT_TOKEN");
  process.exit(2);
}

async function call(method, p, body) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  let r;
  try {
    r = await fetch(URL_BASE + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("GAGAL jaringan:", e?.message ?? e);
    process.exit(1);
  }
  let j = null;
  try {
    j = await r.json();
  } catch {}
  if (!r.ok) {
    console.error(`GAGAL ${r.status}: ${j?.error ?? "tanpa_body"}${j?.detail ? " (" + j.detail + ")" : ""}`);
    process.exit(1);
  }
  return j;
}

function needYes(what) {
  if (!flags.yes) {
    console.error(`DITOLAK: ${what} bersifat destruktif. Tinjau dulu, lalu ulangi dengan --yes.`);
    process.exit(2);
  }
}

async function main() {
  if (cmd === "health") {
    const r = await fetch(URL_BASE + "/healthz").catch(() => null);
    if (!r || !r.ok) {
      console.error("GAGAL: healthz tidak merespons");
      process.exit(1);
    }
    console.log(JSON.stringify(await r.json()));
    return;
  }
  if (cmd === "create") {
    const max = Number(flags.max);
    if (!Number.isInteger(max) || max < 1) {
      console.error("GAGAL: --max wajib berupa bilangan bulat >= 1");
      process.exit(2);
    }
    const body = { maxActivations: max };
    if (flags.features) body.features = String(flags.features).split(",").map((s) => s.trim()).filter(Boolean);
    if (flags.expires) body.expiresAt = flags.expires;
    if (flags.note) body.note = String(flags.note);
    const out = await call("POST", "/admin/licenses", body);
    const lic = out.license;
    console.log(JSON.stringify(lic, null, 2));
    console.error("PENTING: licenseKey hanya ditampilkan sekali. Simpan di tempat aman.");
    void crypto;
    return;
  }
  if (cmd === "list") {
    const out = await call("GET", "/admin/licenses");
    for (const l of out.licenses ?? []) {
      console.log(
        `${l.id}  ${l.status.padEnd(8)} max=${l.max_activations} aktif=${l.activations} ` +
          `expires=${l.expires_at ?? "-"} note=${l.note ?? "-"}`
      );
    }
    return;
  }
  if (cmd === "show") {
    if (!positional[0]) usage();
    const out = await call("GET", `/admin/licenses/${positional[0]}/activations`);
    for (const a of out.activations ?? []) {
      console.log(`${a.id}  instalasi=${a.installation_id}  dibuat=${a.created_at}  terakhir=${a.last_seen_at ?? "-"}`);
    }
    if (!(out.activations ?? []).length) console.log("(belum ada aktivasi)");
    return;
  }
  if (cmd === "disable" || cmd === "enable") {
    if (!positional[0]) usage();
    await call("PATCH", `/admin/licenses/${positional[0]}`, {
      status: cmd === "disable" ? "disabled" : "active",
    });
    console.log("OK:", cmd, positional[0]);
    return;
  }
  if (cmd === "revoke") {
    if (!positional[0]) usage();
    needYes(`pencabutan lisensi ${positional[0]}`);
    await call("POST", `/admin/licenses/${positional[0]}/revoke`, {
      reason: flags.reason ? String(flags.reason) : "revoked via admin-cli",
    });
    console.log("OK: lisensi dicabut", positional[0]);
    return;
  }
  if (cmd === "release") {
    if (!positional[0]) usage();
    needYes(`pelepasan aktivasi ${positional[0]}`);
    await call("DELETE", `/admin/activations/${positional[0]}`);
    console.log("OK: aktivasi dilepas", positional[0]);
    return;
  }
  if (cmd === "audit") {
    const qs = new URLSearchParams();
    if (flags.license) qs.set("licenseId", String(flags.license));
    const out = await call("GET", `/admin/audit${qs.toString() ? "?" + qs : ""}`);
    const rows = (out.audit ?? []).slice(0, Number(flags.limit ?? 40));
    for (const a of rows) console.log(`${a.ts}  ${a.event.padEnd(22)} lic=${a.license_id ?? "-"} ip=${a.ip ?? "-"} ${a.detail ?? ""}`);
    return;
  }
  console.error("perintah tidak dikenal:", cmd);
  if (IS_SUPPORT) console.error("(peran support aktif: hanya list/show/audit/release)");
  usage();
}

main().catch((e) => {
  console.error("GAGAL:", e?.message ?? e);
  process.exit(1);
});