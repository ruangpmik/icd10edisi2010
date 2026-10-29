# F5 — Runbook Deployment Licensing API Produksi

Status: **BLOCKED** — belum ada VPS, domain, DNS, dan sertifikat TLS publik. Runbook ini ditulis agar sesuai kode aktual (`license-server/`); tidak ada nama layanan/endpoint/kredensial yang dikarang. Domain ditulis `<domain-lisensi>` sebagai placeholder yang harus diisi saat provisioning.

## 1. Kebutuhan minimum

| Item | Minimum | Catatan |
|---|---|---|
| VPS | 1 vCPU, 1 GB RAM, 10 GB disk | Beban licensing ringan (SQLite) |
| OS | Ubuntu 24.04 LTS (atau setara) | Instruksi memakai systemd |
| Runtime | Node.js ≥ 22.5 | `node:sqlite` bawaan; tanpa dependensi eksternal |
| Domain | `<domain-lisensi>` + A/AAAA record | TLS via Let's Encrypt |
| Port publik | 80, 443 (HTTPS) | 22 dibatasi sumber tepercaya |
| Port internal | server lisensi bind `127.0.0.1:8443` | Tidak pernah diekspos langsung |

## 2. Arsitektur

```
Internet ── HTTPS:443 ──> reverse proxy (Caddy/nginx, TLS terminasi)
                            └── proxy_pass http://127.0.0.1:8443  (license-server, bind loopback)
DB: /var/lib/icd10-license/license.db  (WAL; TIDAK diekspos ke publik)
Keys: /etc/icd10-license/keys/<kid>.private.pem (0600, di luar direktori aplikasi)
```

Server sudah menolak bind non-loopback tanpa TLS (`FATAL`), jadi di belakang reverse proxy selalu `LICENSE_HOST=127.0.0.1`.

## 3. Environment production (semua lewat env, tidak ada secret di kode/repo)

File `/etc/icd10-license.env` (chmod 600, pemilik root/service):

```
LICENSE_HOST=127.0.0.1
LICENSE_PORT=8443
LICENSE_SIGNING_KID=<kid-produksi-final>
LICENSE_KEYS_DIR=/etc/icd10-license/keys
LICENSE_DB=/var/lib/icd10-license/license.db
LICENSE_ADMIN_TOKEN=<token-acak-32-byte>        # openssl rand -hex 32
LICENSE_SUPPORT_TOKEN=<token-acak-32-byte>      # opsional, peran baca + lepas aktivasi
LICENSE_LEASE_DAYS=3
# rate limit default config.mjs sudah aman; sesuaikan bila perlu:
# LICENSE_RATE_ACTIVATE=10  LICENSE_RATE_ACTIVATE_KEY=5  LICENSE_RATE_ACTIVATE_INSTALLATION=10
# LICENSE_TLS_CERT=/...  LICENSE_TLS_KEY=/...   # hanya jika TANPA reverse proxy
```

- `LICENSE_ADMIN_TOKEN`/`SUPPORT_TOKEN` kosong = admin dinonaktifkan (503) — jangan dibiarkan kosong di produksi.
- TLS di terminasi reverse proxy; opsi alternatif (tanpa proxy): set `LICENSE_TLS_CERT` + `LICENSE_TLS_KEY` dan bind `0.0.0.0` — hanya bila firewall menutup port lain.

## 4. Contoh systemd unit

`/etc/systemd/system/icd10-license.service`:

```ini
[Unit]
Description=ICD-10 Codex licensing API
After=network-online.target

[Service]
User=icd10lic
Group=icd10lic
EnvironmentFile=/etc/icd10-license.env
WorkingDirectory=/opt/icd10-license/license-server
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/icd10-license
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## 5. Contoh reverse proxy (Caddy)

```
<domain-lisensi> {
  reverse_proxy 127.0.0.1:8443
  # Caddy otomatis ACME (Let's Encrypt); TLS ≥ 1.2 default
}
```

nginx setara: `server_name <domain-lisensi>; ssl_certificate ...; location / { proxy_pass http://127.0.0.1:8443; }` + `certbot --nginx`.

## 6. Prosedur deploy pertama

1. Buat user + direktori: `useradd -r icd10lic`; `mkdir -p /opt/icd10-license /etc/icd10-license/keys /var/lib/icd10-license`; chown `icd10lic`.
2. Deploy kode: `git clone <repo> /opt/icd10-license` (atau rsync `license-server/` saja) → `cd license-server && npm ci --omit=dev` (tidak ada dependensi runtime eksternal).
3. Provision key produksi final **di server ini** (docs/F5-key-lifecycle.md §3); jangan pakai key kandidat.
4. Isi `/etc/icd10-license.env` (chmod 600).
5. `systemctl daemon-reload && systemctl enable --now icd10-license`.
6. Verifikasi lokal: `curl -s http://127.0.0.1:8443/healthz` → `{"ok":true,"db":"ok"}`.
7. Pasang reverse proxy + DNS → `curl -s https://<domain-lisensi>/healthz` dari jaringan eksternal.

## 7. Pembaruan (upgrade) layanan

1. `node license-server/scripts/backup.mjs --db <LICENSE_DB> --out <dir-backup>` (snapshot konsisten, sidecar SHA-256).
2. Deploy versi baru ke `/opt/icd10-license-new`, uji `node server.mjs` dengan DB **salinan** di port acak.
3. `systemctl stop icd10-license` → ganti direktori → `systemctl start icd10-license`.
4. `healthz` + aktivasi uji. Rollback: kembalikan direktori lama; DB kompatibel (skema additive `CREATE TABLE IF NOT EXISTS`).

## 8. Backup, monitoring, pemulihan

- Backup harian (cron/systemd timer): `backup.mjs --db ... --out /var/backups/icd10-license --keep 14`; salin off-site terenkripsi (docs/F5-backup-dr.md).
- Monitoring: polling `https://<domain-lisensi>/healthz` tiap 1–5 menit; alert bila gagal ≥ 3 kali atau `db != "ok"`.
- Pemulihan: stop service → `restore-verify.mjs` ke path terpisah → verifikasi integrity → ganti DB → start → healthz + aktivasi uji.
- Log: journald (`journalctl -u icd10-license`); log tidak memuat token/key mentah (diverifikasi test suite).

## 9. Checklist verifikasi dari jaringan eksternal (wajib sebelum klaim PASS)

Jalankan dari jaringan berbeda (mis. hotspot ponsel):

- [ ] `https://<domain-lisensi>/healthz` 200, sertifikat valid (hostname + CA), TLS ≥ 1.2.
- [ ] Aktivasi lisensi sah → 200 + lease JWS; client desktop produksi → `active`.
- [ ] Renewal dan deactivation → 200.
- [ ] Aktivasi melebihi kuota → 403 `quota_exceeded`; lisensi revoked → 403.
- [ ] Key palsu (alphabet Base32) → 403; JSON rusak → 400 generik.
- [ ] `/admin/*` tanpa token → 401; token support mencoba create → 403 `forbidden_role`.
- [ ] Rate limit: 429 + `Retry-After` setelah batas; pulih di window berikutnya.
- [ ] Gangguan: matikan service → client masuk grace/offline tanpa kehilangan data; nyalakan lagi → recovery.
- [ ] Request simultan (30 paralel) tidak melampaui batas kuota/batas rate.
- [ ] Backup harian terbentuk dan restore-verify lulus di server.

## 10. Batasan yang diakui

- **Single-instance SQLite.** Belum diuji multi-instance/cluster; rate limit durable konsisten hanya bila semua proses memakai file DB yang sama. Jangan klaim HA.
- **Fail-open rate limit** saat store bermasalah (keputusan terdokumentasi, tercatat di audit `rate_store_error`).
- Pengujian eksternal di atas semuanya **BLOCKED** sampai infrastruktur nyata tersedia.
