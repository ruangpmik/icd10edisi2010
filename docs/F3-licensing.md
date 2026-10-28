# F3 — Lisensi Online (Ed25519) untuk ICD-10 Codex 2010

Dokumen ini menjelaskan arsitektur, kontrak API, kebijakan, dan prosedur operasional
layanan lisensi F3. Sifat dokumen: teknis-operasional. Batas keamanan dijelaskan jujur
di bagian 9.

## 1. Ringkasan

- Aplikasi desktop memverifikasi **lease** bertanda tangan **Ed25519** (JWS compact,
  `alg: EdDSA`) sebelum masuk mode kerja penuh.
- Verifikasi dilakukan di **main process** Electron. Renderer tidak pernah menerima
  atau memegang license key maupun lease mentah.
- Server lisensi: `license-server/` — `node:http` + `node:sqlite` + `node:crypto`,
  **tanpa dependensi npm**. Berjalan di Node 24.
- Produk: **ICD-10 Codex 2010**, `appId: id.ruangpmik.icd10codex`.
- Data ICD-10 tetap **lokal** di aplikasi. Tidak ada data medis yang dikirim ke server.

Komponen:

```
┌──────────────────────────── Electron (main process) ─────────────────────────────┐
│ electron/license.js                                                              │
│   - identitas instalasi (uuid acak, installation.json)                           │
│   - simpanan key+lease (safeStorage/DPAPI, fallback plaintext + peringatan)       │
│   - mesin status: unactivated | active | grace | expired | invalid | revoked ...  │
│   - klien HTTP (fetch) ke server lisensi; renderer bebas CSP connect-src          │
│   - timer renew tiap 15 menit (bila sisa < 50% masa lease)                        │
│        │ verifyJws (public key allowlist)                                         │
│        └── shared/jws-verify.js  ◄──── dipakai juga oleh server                   │
│                                                                                   │
│ electron/ipc-guard.js  → hanya frame top-level app://local/ boleh IPC             │
│ electron/preload-license.js → window.icd10License (status/activate/renew/…)       │
└───────────────────────────────────────────────────────────────────────────────────┘
                 ▲ IPC sempit                         │ HTTPS (produksi)
                 │                                    ▼
        ┌────────┴─────────┐        ┌────────────────────────────────────────────┐
        │ Renderer (sandbox)│        │ license-server/server.mjs                   │
        │ LicenseGate.tsx   │        │  POST /v1/activate /renew /deactivate       │
        │ overlay + banner  │        │  POST/GET/PATCH /admin/…                    │
        └───────────────────┘        │  node:sqlite: licenses, activations, audit  │
                                     │  license-server/jws.mjs: SIGNING (private)  │
                                     └────────────────────────────────────────────┘
```

Private key **hanya** ada di `license-server/keys/` (gitignored) dan tidak pernah masuk
artefak aplikasi. Artefak diverifikasi oleh `scripts/verify-artifact.mjs`.

## 2. Status klien

| state | canUseApp | Arti |
|---|---|---|
| `unactivated` | tidak | Belum ada lease/key. Overlay aktivasi. |
| `active` | ya | Lease sah dan belum kedaluwarsa. |
| `grace` | ya | Lease kedaluwarsa, masih dalam `graceDays`. Banner + tombol validasi ulang. |
| `expired` | tidak | Grace habis. Butuh koneksi untuk validasi ulang. |
| `invalid` | tidak | Lease rusak / signature / klaim / kid / alg tidak sah. |
| `revoked` | tidak | Server menyatakan lisensi dicabut (terminal, menang atas lease lokal). |
| `license_expired` | tidak | Masa berlaku lisensi habis (terminal). |
| `license_disabled` | tidak | Lisensi dinonaktifkan admin (terminal). |

Catatan:
- Status terminal dari server **tidak** menghapus lease atau data pengguna; hanya
  memblokir. Aktivasi sukses dengan kunci sah berikutnya membersihkan status terminal.
- Kegagalan aktivasi kunci lain (mis. `invalid_key`, `quota_exceeded`) **tidak**
  mengunci perangkat yang lisensinya masih sah.
- Satu timeout/jaringan mati **tidak** sama dengan revoked: state tetap `active`
  selama lease sah.
- Semua state terblokir tetap memuat konten aplikasi di DOM (data, catatan, preferensi
  utuh); overlay hanya menutupi secara visual. Tidak ada kode yang menghapus data.

## 3. Kebijakan waktu (default)

| Parameter | Default | Keterangan |
|---|---|---|
| `LICENSE_LEASE_DAYS` (server) | 3 | Masa berlaku lease yang dijamin offline. |
| `graceDays` (klien, `electron/license-config.json`) | 4 | Perpanjangan setelah lease kedaluwarsa. |
| Total offline maksimum | **7 hari** sejak validasi sukses | Aturan: `leaseDays + graceDays <= 7`. |
| Interval tick renew | 15 menit | Renew bila sisa lease < 50% (`(exp-iat)/2`). |
| Timeout HTTP klien | 8 detik | Kegagalan jaringan ≠ revoked. |

Grace tidak dapat diperpanjang tanpa batas: `graceUntil = exp + graceDays` dihitung dari
lease bertanda tangan, bukan dari penghitung lokal.

## 4. Kontrak API

Semua endpoint memerlukan `Content-Type: application/json`; body maksimum 64 KB;
rate limit per IP per menit (default: activate 10, renew 30, deactivate 5, admin 60).
Error selalu generik (`{ "error": "<kode>" }`), tidak membocorkan detail internal.

### POST /v1/activate
```json
{ "licenseKey": "ICD10-XXXXX-XXXXX-XXXXX-XXXXX", "installationId": "<uuid v4>" }
```
200: `{ "lease": "<JWS>", "activation_id": "<uuid>" }` — idempoten per
`(license_id, installation_id)`; kuota dijaga dalam `BEGIN IMMEDIATE` (race-safe).
Error: 400 `bad_request`, 403 `invalid_key|revoked|license_disabled|license_expired`,
409 `quota_exceeded`, 429 `rate_limited`.

### POST /v1/renew
```json
{ "lease": "<JWS>", "installationId": "<uuid v4>" }
```
200: `{ "lease": "<JWS baru>" }` (jti baru). Error: 401 `invalid_lease`,
403 `wrong_activation|revoked|license_disabled|license_expired`,
404 `unknown_activation`.

### POST /v1/deactivate
Body sama dengan renew. 200: `{ "ok": true }`. Menghapus baris aktivasi sehingga slot
kuota kembali.

### Admin (wajib `Authorization: Bearer $LICENSE_ADMIN_TOKEN`)
| Metode | Path | Fungsi |
|---|---|---|
| POST | `/admin/licenses` | Buat lisensi → `{ license: { id, licenseKey, maxActivations } }`. **Kunci mentah hanya muncul sekali.** |
| GET | `/admin/licenses` | Daftar lisensi (tanpa kunci). |
| PATCH | `/admin/licenses/:id` | `status` (`active`/`disabled`), `features`, `maxActivations`, `expiresAt` (ISO / null). |
| POST | `/admin/licenses/:id/revoke` | Cabut permanen (`status=revoked`). |
| GET | `/admin/licenses/:id/activations` | Riwayat aktivasi perangkat. |
| DELETE | `/admin/activations/:id` | Lepas satu aktivasi (transfer perangkat). |
| GET | `/admin/audit?licenseId=` | Audit log. |

Token admin kosong → seluruh `/admin` mengembalikan 503 (`admin_disabled`). Perbandingan
token memakai `timingSafeEqual`.

### Lease claims
`iss`, `aud`, `sub` (license id), `product`, `activation_id`, `features`, `iat`, `nbf`,
`exp`, `jti`. Header wajib `alg: EdDSA`, `kid` dikenal. Verifikasi menolak: signature
salah, alg di luar allowlist (mis. `HS256`), `kid` tak dikenal, `exp`/`nbf` dilanggar,
`iat` > 5 menit di masa depan, aud/product/iss salah.

## 5. Basis data

```
licenses(id PK, key_hash UNIQUE, features JSON, max_activations, status, expires_at, note, created_at)
activations(id PK, license_id FK, installation_id, created_at, last_seen_at,
            UNIQUE(license_id, installation_id))
audit(id PK, ts, license_id, activation_id, event, ip, detail)
```
- **Kunci mentah tidak disimpan**: hanya `sha256(key)` hex.
- Kunci: 20 simbol base32 (`ABCDEFGHJKLMNPQRSTUVWXYZ234567`) = 100 bit entropi,
  format `ICD10-XXXXX-XXXXX-XXXXX-XXXXX`.
- Audit tidak pernah berisi kunci, lease, atau token. Log server hanya pesan fatal/TLS.

## 6. Penyimpanan klien

`%APPDATA%\ICD-10 Codex 2010\`
- `installation.json` — `{ installationId: uuid, createdAt }`. UUID acak; **bukan**
  fingerprint perangkat.
- `license.json` — `{ v:1, enc:<base64> }` bila `safeStorage` tersedia (DPAPI Windows),
  fallback `{ v:1, plain:{…} }` dengan peringatan log. Isi: `key`, `lease`, `maxTime`,
  `skew`, `serverState`.

`maxTime` adalah penjaga rollback jam: waktu efektif = `max(now + skew, maxTime)`.
Mundurkan jam tidak memperpanjang lease/grace.

Menghapus kedua file = instalasi baru (butuh kuota baru). Data aplikasi (Local Storage,
catatan) tidak tersentuh.

## 7. Penyediaan produksi (belum dieksekusi — tidak ada infrastruktur)

Prasyarat: domain + VPS, HTTPS, firewall. Langkah:

1. **Keypair produksi** (jangan pakai kunci uji):
   ```
   cd license-server
   node scripts/generate-keys.mjs --kid prod-2026-11
   ```
   Private key tetap di `license-server/keys/` pada mesin server; backup terenkripsi
   offline. Jangan commit, jangan kirim lewat chat/email.
2. **Public key ke klien**: tambahkan entri `{ "kid": "prod-2026-11", "pem": "…" }` ke
   `electron/public-keys.json`, lalu build ulang aplikasi. Entri kunci uji
   (`test-2026-10`) boleh dipertahankan atau dihapus saat rilis.
3. **Isi URL server** di `electron/license-config.json` (`serverUrl:
   "https://license.<domain>"`), build ulang.
4. **Environment server** (contoh):
   ```
   LICENSE_HOST=127.0.0.1
   LICENSE_PORT=8443
   LICENSE_SIGNING_KID=prod-2026-11
   LICENSE_KEYS_DIR=/srv/icd10/keys
   LICENSE_DB=/srv/icd10/data/license.db
   LICENSE_ADMIN_TOKEN=<token acak >=32 byte, dari password manager>
   LICENSE_LEASE_DAYS=3
   LICENSE_TLS_CERT=/srv/icd10/tls/fullchain.pem
   LICENSE_TLS_KEY=/srv/icd10/tls/privkey.pem
   ```
   `LICENSE_ADMIN_TOKEN` kosong = admin mati. Tanpa TLS server mencetak peringatan.
5. **Jaringan**: bind ke `127.0.0.1`, letakkan di belakang reverse proxy TLS
   (nginx/Caddy). `/v1/*` boleh publik; `/admin/*` **wajib** dibatasi (VPN/allowlist IP
   atau basic-auth tambahan). Buka hanya 443.
6. **Basis data**: jalankan sebagai user OS khusus, direktori `data/` mode 700. Backup
   harian `license.db` (SQLite WAL: salin `.db`, `-wal`, `-shm` atau pakai
   `VACUUM INTO`). Uji restore.
7. **Rotasi kunci**: buat keypair `kid` baru, tambahkan public key baru ke
   `public-keys.json`, rilis klien, lalu ganti `LICENSE_SIGNING_KID` di server.
   Lease lama tetap sah selama public key lama masih ada di klien. Setelah semua klien
   terbarui, hapus kunci lama dari server dan (pada rilis berikutnya) dari klien.
8. **Monitoring**: `/healthz`, ukuran `audit`, lonjakan `activate_denied` /
   `quota_exceeded` (indikasi pembagian kunci).

## 8. Operasional

- **Buat lisensi**: `POST /admin/licenses` dengan `maxActivations`; simpan kunci yang
  dikembalikan (hanya sekali).
- **Transfer perangkat**: `GET /admin/licenses/:id/activations` → `DELETE
  /admin/activations/:id`. Pengguna lalu aktivasi di perangkat baru.
- **Reinstall / ganti hardware**: hapus `%APPDATA%\ICD-10 Codex 2010` → aktivasi ulang
  dengan kunci yang sama. Bila kuota penuh, lepas aktivasi lama lewat admin. Tidak ada
  lockout permanen berbasis hardware (tidak ada fingerprint).
- **Klien offline**: `active` sampai `exp`, lalu `grace` sampai `exp + graceDays`,
  lalu `expired`. Begitu online, tick renew memulihkan otomatis; bila lease sudah
  kedaluwarsa, klien melakukan aktivasi ulang idempoten dengan kunci tersimpan.
- **Mencabut**: `POST /admin/licenses/:id/revoke`. Efek ke klien terjadi pada validasi
  online berikutnya (maksimal satu masa lease + grace).

## 9. Batas keamanan (jujur)

- Lisensi **lokal** menaikkan ambang, bukan mustahil dibypass. Pemilik mesin dapat
  memodifikasi biner/renderer. Pertahanan berlapis: verifikasi Ed25519 di main process,
  Fuses, asar integrity, CSP, IPC sempit + sender guard, dan status terminal dari server.
- `LicenseGate.tsx` adalah **UI**, bukan batas keamanan. Batas ada di `license.js`
  (main process) dan server.
- Penyimpanan lokal memakai DPAPI; penyerang dengan akses ke sesi pengguna yang sama
  dapat membacanya. Kunci lisensi bukan setara secret server: pemiliknya sudah tahu.
- Rollback jam hanya lapisan tambahan. Sumber kebenaran saat online adalah server.
- Tidak ada anti-tamper biner tingkat lanjut (code signing belum aktif di beta; lihat
  F2 report).

## 10. Referensi variabel lingkungan

Server: `LICENSE_HOST`, `LICENSE_PORT`, `LICENSE_SIGNING_KID`, `LICENSE_KEYS_DIR`,
`LICENSE_DB`, `LICENSE_ADMIN_TOKEN`, `LICENSE_LEASE_DAYS`, `LICENSE_RATE_ACTIVATE`,
`LICENSE_RATE_RENEW`, `LICENSE_RATE_DEACTIVATE`, `LICENSE_RATE_ADMIN`,
`LICENSE_TLS_CERT`, `LICENSE_TLS_KEY`.

Klien: `ICD10_LICENSE_URL` (override URL), `ICD10_LICENSE_GRACE_DAYS`,
`ICD10_LIC_KEY` (khusus smoke/uji), `ICD10_SMOKE*` (khusus harness uji).

## 11. Pengujian

Matriks lengkap dan hasil nyata ada di `docs/F3-report.md`.