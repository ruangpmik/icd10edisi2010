# F7 — Production Procurement & Access Checklist

Daftar kebutuhan spesifik untuk membuka F7 dari BLOCKED menuju READY FOR PRODUCTION.
Isi kolom **"Yang menyediakan"** dan **"Nilai aktual"** saat akses tersedia. Jangan mengisi nilai fiktif.

## 1. Blocker & siapa yang menyediakan

| # | Blocker | Yang menyediakan | Nilai aktual (ISI NANTI) |
|---|---|---|---|
| 1 | VPS / server produksi (Linux, OS supported, least privilege) | Pemilik infrastruktur | — |
| 2 | Domain + akses DNS (A/AAAA record ke IP server) | Pemilik domain / admin DNS | — |
| 3 | Sertifikat TLS publik (Let's Encrypt atau cert resmi) | Otomatis via ACME setelah #1+#2, atau pemilik cert | — |
| 4 | Akses administratif server (SSH, akun non-root) | Admin server | — |
| 5 | Lingkungan tepercaya untuk provisioning key produksi | Server produksi (atau host khusus) | — |
| 6 | Sertifikat code signing Windows (OV/EV) + hardware token | Legal/Finance + pemilik (beli dari CA) | — |
| 7 | Lokasi backup off-site | Pemilik infrastruktur | — |
| 8 | Kredensial deployment via mekanisme aman (vault/secret manager) | Admin server | — |

## 2. Spesifikasi server minimal

- OS: Ubuntu LTS (atau distro supported), kernel patched, security update aktif.
- Port terbuka: **443 saja** (SSH dibatasi IP, port 22 ke IP admin). `LICENSE_PORT` tidak perlu diekspos langsung; reverse proxy (Caddy) terminate TLS ke `127.0.0.1`.
- Proses Node jalan sebagai user non-root; systemd unit `icd10-license` dengan `Restart=on-failure`.
- Disk untuk `LICENSE_DB` (SQLite + WAL) di lokasi non-web-root; monitoring ruang disk aktif.
- Backup off-site terpisah dari host utama (objek storage / host lain), akses dibatasi.

## 3. Variabel environment produksi (audit dari `license-server/config.mjs`)

| Variabel | Wajib diisi | Keterangan |
|---|---|---|
| `LICENSE_HOST` | ya | bind (rekomendasi `127.0.0.1` di belakang proxy) |
| `LICENSE_PORT` | ya | port proses (cth `8443`) |
| `LICENSE_SIGNING_KID` | ya | kid key produksi final (mis. `prod-2026-11`) |
| `LICENSE_KEYS_DIR` | ya | dir private key, ACL hanya service identity |
| `LICENSE_DB` | ya | path SQLite (di luar web root) |
| `LICENSE_ADMIN_TOKEN` | ya | token peran admin, simpan di secret manager |
| `LICENSE_SUPPORT_TOKEN` | ya | token peran support, simpan di secret manager |
| `LICENSE_TLS_CERT` / `LICENSE_TLS_KEY` | opsional | bila TLS di Node langsung; kalau reverse proxy, kosongkan |
| `LICENSE_LEASE_DAYS`, `LICENSE_RATE_*` | ya | tetapkan sesuai kebijakan |
| `ICD10_LICENSE_URL` (build client) | ya | `https://<domain-lisensi>` saat build produksi |

Jangan menyimpan nilai di atas di source code, `package.json`, asar, atau log.

## 4. Provisioning key produksi (di host tepercaya)

1. Di server produksi (bukan mesin developer), jalankan `scripts/generate-prod-keypair.mjs` dengan output di luar repo.
2. Batasi `LICENSE_KEYS_DIR`: `chown service-user:service-user` + `chmod 700`; private key tidak di web root, tidak di backup yang sama dengan DB, tidak pernah di repo/installer/log.
3. Kid yang dihasilkan → set `LICENSE_SIGNING_KID`; public key → isi `electron/keysets/production.public-keys.json` (dari build pipeline, bukan copy manual di mesin developer).
4. Verifikasi: `node scripts/trust-selftest.mjs` dan `node scripts/keyset-guard-test.mjs` → 17/17 dan 9/9.
5. Kunci backup private key terpisah (enkripsi, offline/HSM); catat prosedur kompromi (docs/F5-key-lifecycle.md §5).

## 5. Urutan deployment (jalankan saat #1–#4 tersedia)

1. `git status` bersih di commit rilis yang disetujui.
2. DNS A/AAAA record → IP server; verifikasi `dig +short <domain-lisensi>`.
3. Provision TLS (ACME/Caddy) untuk `<domain-lisensi>`.
4. `systemd` unit → start → `curl -fsS https://<domain-lisensi>/healthz` dari server.
5. Set env production (tabel §3) + restart → cek log tidak memuat secret.
6. Run `node license-server/scripts/external-verify.mjs --base https://<domain-lisensi> --key <key-uji> --keyset electron/keysets/production.public-keys.json [--admin-token ...] [--rate-burst 12]` **dari jaringan eksternal/terpisah** → semua PASS.
7. Build produksi: isi keyset production → `npm run build:desktop` → `node scripts/verify-artifact.mjs --expect-keyset production` → ARTIFACT-OK.
8. Backup terjadwal + restore drill di infra nyata (docs/F5-backup-dr.md RPO/RTO).
9. Code signing: sign installer + exe, verifikasi Authenticode, regenerate metadata ter-sign.

## 6. Syarat code signing

- Sertifikat OV/EV dari CA tepercaya Windows (Sectigo/DigiCert/GlobalSign), bukan self-signed.
- Private key di hardware token/HSM; `signtool.exe` dari Windows SDK; timestamping wajib.
- Verifikasi: `Get-AuthenticodeSignature` → `Valid`, lalu catat publisher + thumbprint ke metadata.

## 7. Status

Seluruh langkah di atas **BLOCKED** sampai kolom "Yang menyediakan" terisi dan akses diserahkan lewat mekanisme aman. Tidak ada deployment atau signing yang diklaim sebelum itu.