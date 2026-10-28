# F3 — Laporan Implementasi & Hasil Uji

Versi aplikasi: **0.2.0** · Branch: `feat/f3-licensing` · Tanggal: 2026-10-28
Artefak: `dist\ICD10-Codex-Setup-0.2.0.exe` (177,2 MB)
SHA-256: `C6FB0887A771BBC96A72F71D17E3CE8669FE8E6371EBCCCE995299BC241FD109`

## 1. Yang dikerjakan

| Komponen | Berkas |
|---|---|
| Verifikasi JWS EdDSA (klien + server) | `shared/jws-verify.js` |
| Server lisensi (API, kuota atomik, audit, rate limit, TLS opsional) | `license-server/{server,config,db,jws}.mjs` |
| Pembuat keypair | `license-server/scripts/generate-keys.mjs` |
| Layanan lisensi main process (state, storage DPAPI, HTTP, renew) | `electron/license.js` |
| Penjaga IPC | `electron/ipc-guard.js` |
| Preload sempit (`window.icd10License`) | `electron/preload-license.js` |
| Konfigurasi klien | `electron/license-config.json`, `electron/public-keys.json` |
| UI gerbang + banner grace | `src/app/LicenseGate.tsx`, `src/app/layout.tsx` |
| Uji API | `license-server/test/run-tests.mjs` |
| Uji unit klien (Electron) | `scripts/license-unit/` |
| Verifikasi artefak (asar/kunci) | `scripts/verify-artifact.mjs` |
| Dokumentasi arsitektur & operasional | `docs/F3-licensing.md` |

F2 dipertahankan: `contextIsolation`, `sandbox`, tanpa `nodeIntegration`, CSP berbasis
hash (13 hash, 0 pelanggaran), Fuses, protokol `app://`, navigasi/tautan eksternal
dibatasi, IPC sempit + validasi parameter.

## 2. Hasil uji (output nyata)

### 2.1 API server — 47 PASS / 0 FAIL
`node license-server/test/run-tests.mjs`

Mencakup: healthz; pembuatan lisensi + format kunci; aktivasi valid + lease Ed25519;
kelengkapan klaim; re-aktivasi idempoten; kuota 2 perangkat; renew (jti berubah);
kuota ke-3 → 409; **race 5 aktivasi simultan pada kuota 1 → tepat 1 menang, 4
`quota_exceeded`**; format kunci salah → 400; kunci tak dikenal → 403 `invalid_key`;
installationId bukan UUID → 400; tipe salah → 400; signature lease diubah → 401;
payload lease diubah → 401; alg `HS256` ditolak → 401; `kid` tak dikenal → 401;
renew dari instalasi lain → 403 `wrong_activation`; lisensi dicabut → renew & aktivasi
ditolak 403; lisensi disabled → 403; lisensi kedaluwarsa → 403; aktivasi dilepas admin →
404 `unknown_activation`; deaktivasi benar → slot kembali; deaktivasi dengan
installationId salah → 403; admin tanpa token / token salah → 401; token admin kosong →
503; rate limit → 429; payload > 64 KB → 413; audit terisi; **log tidak memuat kunci/lease**;
lease kedaluwarsa riil (tunggu 21 detik) → renew 401.

### 2.2 Unit klien (Electron, tanpa server) — 24 PASS / 0 FAIL
`node_modules\electron\dist\electron.exe scripts\license-unit`

Tanpa simpanan → `unactivated`; lease sah → `active`; lease kedaluwarsa + grace → `grace`
(boleh pakai); grace 0 → `expired` (diblokir); signature diubah → `invalid`; payload
diubah (menaikkan `exp`) → `invalid`; `kid` tak dikenal → `invalid`; `alg HS256` →
`invalid`; `aud` salah → `invalid`; `product` salah → `invalid`; **rollback jam (`maxTime`
di masa depan) tidak menghasilkan `active`**; simpanan rusak → `invalid`; status terminal
`revoked`/`license_disabled` menang atas lease sah; kegagalan kuota tidak mengunci lease
sah; format kunci salah/kurang panjang/bukan string → `bad_key_format`; guard IPC:
`app://local` top-level diizinkan, iframe `app://`, origin `https`, `file://`, dan event
tanpa `senderFrame` ditolak; server tak dikonfigurasi → `network` (bukan crash).

### 2.3 Matriks negatif runtime (server nyata) — 11 PASS / 0 FAIL

| Kasus | State | Error aktivasi | Exit | Data |
|---|---|---|---|---|
| N1 format kunci salah | `unactivated` | `bad_key_format` | 0 | 437/22 |
| N2 kunci tidak dikenal | `unactivated` | `invalid_key` | 0 | 437/22 |
| N3 lisensi dicabut | `revoked` | `revoked` | 0 | 437/22 |
| N4 lisensi disabled | `license_disabled` | `license_disabled` | 0 | 437/22 |
| N5 lisensi kedaluwarsa | `license_expired` | `license_expired` | 0 | 437/22 |
| N6a perangkat pertama | `active` | — | 0 | 437/22 |
| N6b perangkat baru (kuota 1) | `unactivated` | `quota_exceeded` | 0 | 437/22 |
| N7a aktivasi untuk uji offline | `active` | — | 0 | 437/22 |
| N7b server mati, lease masih sah | `active` | — | 0 | — |
| N8 lease lokal dirusak | `invalid` | — | — | — |
| N9 lease daluwarsa + grace 0 | `expired` | — | 0 | — |

Kolom "Data" = `idTerms` / jumlah bab yang masih terdeteksi di DOM saat status terblokir →
membuktikan data tidak dihapus dan aplikasi tetap terpasang di balik overlay.

### 2.4 Skenario klien (build sebelum final, kode state tidak berubah)
| Run | Kondisi | Hasil |
|---|---|---|
| 1 | aktivasi (lease ~20 dtk) | `active`, selfTest `ok`, exit 0 |
| 2 | server mati, lease kedaluwarsa | `grace`, exit 0 |
| 3 | server hidup lagi | renew → `invalid_lease` → aktivasi ulang otomatis → `active`, exit 0 |
| 4 | lease lokal dirusak | `invalid`, diblokir |

### 2.5 Build final (0.2.0)
| Uji | Hasil |
|---|---|
| Packaged offline, profil bersih | exit 0, `licenseApi:true`, `state:unactivated`, `errors:[]` |
| Packaged integrasi (server nyata) | exit 0, `state:active`, `activateOk`, `selfTest:ok`, `goodSignature`, `tamperRejected`, `errors:[]`, stderr kosong |
| Packaged offline dengan lease sah | exit 0, `state:active` |
| Fuses | RunAsNode **Disabled**, NodeOptions **Disabled**, NodeCliInspect **Disabled**, EmbeddedAsarIntegrity **Enabled**, OnlyLoadAppFromAsar **Enabled** |
| Isi asar | `electron/license.js`, `ipc-guard.js`, `preload-license.js`, `public-keys.json`, `license-config.json`, `shared/jws-verify.js` ada; **0** entri `license-server` |
| Pemindaian kunci | material `test-2026-10.private.pem` **tidak ada** di asar/exe; kunci lisensi uji **tidak ada**; string `PRIVATE KEY` yang terdeteksi berasal dari tabel library Node/Electron (bukan material kita) |
| Web publik | smoke 6/6 PASS, konsol bersih, tanpa gerbang (window.icd10License absen) |
| Integritas data | `verify-data.mjs`: IDENTIK (11.373 node, 22 bab, **437 idTerms**, 44 modifier) |
| Dependensi | `npm audit` 0 kerentanan, `npm audit --omit=dev` 0 |

### 2.6 Instalasi / upgrade / uninstall
| Langkah | Hasil |
|---|---|
| Pasang 0.1.0 (NSIS `/S`) | exit 0, entri registri `ICD-10 Codex 2010 0.1.0`, smoke 0.1.0 exit 0 |
| Pasang 0.2.0 di atasnya | exit 0, versi terdaftar `0.2.0` |
| Data sebelum vs sesudah upgrade | `installationId` **sama**, hash `license.json` **sama**, hash Local Storage **sama** |
| Jalankan 0.2.0 terinstal | exit 0, `licenseApi:true`, `state:active` |
| Uninstall (`/S /currentuser`) | exit 0, exe & entri registri hilang |
| `%APPDATA%\ICD-10 Codex 2010` setelah uninstall | utuh: `license.json`, `installation.json`, 6 berkas Local Storage |

## 3. Cacat yang ditemukan saat pengujian dan diperbaiki

1. **Regex kunci vs generator tidak cocok** — regex menuntut 5 grup, generator membuat 4;
   server menolak kuncinya sendiri (400). Diperbaiki menjadi
   `^ICD10-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$`.
2. **`DELETE` tanpa body ditolak 400** — `readJsonBody` mewajibkan `content-type`;
   admin tidak pernah bisa melepas aktivasi. `DELETE` kini tidak membaca body.
3. **Grace tidak pernah tercapai** — `verifyJws` mengembalikan gagal tanpa `claims` saat
   lease kedaluwarsa, sehingga klien menandai `invalid`, bukan `grace`; timer renew juga
   tidak jalan. Kegagalan waktu sekarang membawa `claims`; server tetap menolak (401).
4. **`decryptStringAsync` Electron 45 mengembalikan objek** `{result, shouldReEncrypt}`,
   bukan string → `JSON.parse` gagal → simpanan dianggap rusak. Klien kini menangani
   kedua bentuk dan memakai API yang tidak deprecated (`isAsyncEncryptionAvailable`).
5. **Kegagalan aktivasi menghapus lease sah** → risiko lockout bila pengguna salah
   mengetik kunci lain. Lease kini dipertahankan; hanya status terminal server yang
   memblokir.
6. **Status terminal hilang saat lease kosong** — `revoked` tampil sebagai `unactivated`.
   Status terminal kini diputuskan lebih awal dan menang atas lease lokal.
7. **Kebijakan offline melebihi 7 hari** — default lease 7 hari + grace 4 hari. Default
   server diubah ke 3 hari (+ grace 4 hari klien) sehingga total ≤ 7 hari, sesuai
   spesifikasi; aturan didokumentasikan.
8. **Renew terlalu sering** — ambang tetap 3 hari membuat lease 3 hari selalu renew tiap
   tick. Ambang kini proporsional: sisa < 50% masa lease.
9. **Self-test tamper lemah (uji, bukan produk)** — membalik karakter terakhir signature
   base64 tidak selalu mengubah byte (karakter terakhir hanya 2 bit signifikan). Uji kini
   membalik karakter pertama; `tamperRejected` kembali bermakna.

## 4. Risiko & pekerjaan tersisa

- **Server produksi belum dideploy**: tidak ada VPS/domain/HTTPS. Prosedur penyediaan ada
  di `docs/F3-licensing.md` §7; belum dieksekusi dan tidak diklaim selesai.
- **Kunci uji (`kid: test-2026-10`) tertanam** di `electron/public-keys.json`. Untuk
  rilis, ganti dengan `kid` produksi (rotasi didukung; public key boleh lebih dari satu).
- **Admin belum punya UI**: semua operasi admin lewat API. `/admin/*` wajib dibatasi
  jaringan saat produksi (VPN/allowlist).
- **Deaktivasi mandiri belum ada tombolnya di UI**; tersedia lewat API admin dan kanal
  IPC `license:deactivate`. Transfer perangkat saat ini lewat admin.
- **Rate limiter in-memory**: reset saat restart, tidak terdistribusi. Cukup untuk satu
  instans; naikkan ke Redis/DB bila server lebih dari satu.
- **Tanpa code signing**: SmartScreen akan memperingatkan (keputusan beta F2).
- **Batas keamanan**: lisensi lokal menaikkan ambang, bukan mustahil dibypass; overlay UI
  bukan batas keamanan. Sumber kebenaran saat online adalah server.
- **Rollback jam** hanya lapisan tambahan; `maxTime` dapat dihapus pemilik mesin.
- Backup/restore SQLite hanya diproses secara prosedural, belum diuji pada infrastruktur
  nyata.

## 5. Perintah verifikasi ulang

```powershell
node license-server/test/run-tests.mjs                       # 47 PASS
& ".\node_modules\electron\dist\electron.exe" scripts\license-unit   # 24 PASS
node scripts/verify-artifact.mjs                             # ASAR-OK
node scripts/smoke.mjs                                       # web 6/6 (dev :3001)
node scripts/verify-data.mjs                                 # IDENTIK 437/22
npx.cmd electron-fuses read --app ".\dist\win-unpacked\ICD-10 Codex 2010.exe"
```