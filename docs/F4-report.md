# F4 Report — Production Readiness & Secure Release

Produk: **ICD-10 Codex 2010** (`id.ruangpmik.icd10codex`)
Branch: `feat/f3-licensing`
Basis commit: `d345e6c` (F3)
Versi artefak: **0.3.0**
Tanggal pengujian: 2026-10-28

## 0. Keputusan akhir (release gate)

| Gate | Status | Alasan |
|---|---|---|
| Validasi installer & artefak 0.3.0 | **PASS** | Upgrade 0.2.0 → 0.3.0, fuses, smoke, checksum, regresi data lulus |
| Deployment licensing API produksi | **BLOCKED** | Tidak ada VPS, domain, DNS, atau sertifikat HTTPS |
| Code signing | **NOT AVAILABLE** | Tidak ada sertifikat code signing; artefak unsigned |
| Backup/restore pada infrastruktur produksi nyata | **BLOCKED** | Belum ada infrastruktur; hanya diuji lokal (SQLite) |
| Uji jaringan eksternal / multi-instance | **NOT TESTED** | Butuh deployment nyata |
| **F4 produksi** | **BLOCKED** | Sesuai F4.9: server produksi belum tersedia |
| Kelayakan distribusi | **BETA TERBATAS / INTERNAL ONLY** | Unsigned + tanpa server produksi; bukan rilis komersial luas |

Aplikasi existing dipertahankan: 437 istilah Indonesia, 22 bab, 11.373 node, 44 modifiers, kamus, search, detail, indeks A–Z, print, tema, CSP/sandbox/IPC/`app://` tidak berubah.

## 1. Artefak final

Sumber: `docs/release/F4-build-metadata.json` (dibuat oleh `scripts/release-metadata.mjs`).

| Item | Nilai |
|---|---|
| Installer | `dist/ICD10-Codex-Setup-0.3.0.exe` — 185.808.675 byte |
| SHA-256 installer | `d392b21f30725b67d8ad3dbdd04739c7c668a243b731ecbdb48f89761d203078` |
| SHA-256 blockmap | `33176bc3a83a1a96f0826cace0da9940a4dbf3e31ec3d0490a525f4878b826bf` |
| SHA-256 exe (`win-unpacked`) | `90bd58c395293943dbfdf330b282c214482e75c234565801a283e33799c7d272` |
| SHA-256 `app.asar` | `a10ac2f54f384028aacfc190aa89f78e80c90b71233f3d017d773ebc08e9cf5d` |
| Commit sumber build | `d345e6c1333424b3917e96a5c23d137aca62d5c2` + working tree F4 (dirty saat build) |
| Waktu build (mtime asar) | 2026-10-28T06:40:18.267Z |
| Electron / Node | 45.0.0 / v24.22.1 (win32-x64) |
| Keyset tertanam | `prod-candidate-2026-10` (satu-satunya) |
| Fingerprint public key (SPKI SHA-256) | `8eb4f398dae0c24e8f4fe4d2348686bec3584d3238ee9fd31ef0e267dbde9a23` |

Catatan kejujuran: build dilakukan dari working tree F4 sebelum commit final. Input asar bersifat deterministik dari isi yang di-commit (keyset produksi + `electron/public-keys.json` hasil generate). `npm run build` berikutnya tidak akan bit-identik karena `public/data/icd10.json` memuat `meta.builtAt` baru; hash installer di atas hanya berlaku untuk file yang benar-benar diuji.

## 2. F4.1 — Pemisahan TEST dan PRODUCTION

Perubahan:

- `electron/keysets/test.public-keys.json` (`test-2026-10`) dan `electron/keysets/production.public-keys.json` (`prod-candidate-2026-10`) dipisah.
- `scripts/select-keys.mjs` memilih satu keyset saat build, menolak kid tumpang tindih, menolak PEM private key, menolak non-Ed25519, dan memverifikasi public key dapat diparse.
- `electron/public-keys.json` tidak lagi di-commit (hasil generate, `.gitignore`); `electron/keysets/**` dikecualikan dari asar.
- Build produksi: `npm run build:desktop` → keyset production. Build testing: `npm run build:desktop:test` → keyset test, output `dist-test/`.
- `scripts/generate-prod-keypair.mjs` menolak direktori di dalam repository, menolak kid berawalan `test`, menulis private key 0600 + ACL ketat, tidak mencetak private material.
- Private key prod-candidate: `C:\Users\IT PROGRAMMER\.icd10-prod-keys\` (di luar repo, tidak pernah masuk asar/installer). **Catatan:** ini kandidat produksi yang dibuat di mesin developer; keypair produksi sesungguhnya wajib dibuat ulang di server tepercaya sebelum rilis komersial.

Bukti:

- `node scripts/trust-selftest.mjs` → **13 PASS / 0 FAIL**: keyset terpisah, lease test-key sah di keyset test, **ditolak keyset produksi**, kid tidak dikenal ditolak, rotasi 2 kid (lama+baru) lalu pencabutan kid lama, `alg: none` ditolak, signature diubah ditolak.
- Runtime build produksi: lease bertanda tangan `test-2026-10` → `state: invalid` (bukan `active`).
- `scripts/verify-artifact.mjs` → `ARTIFACT-OK`: asar hanya memuat `prod-candidate-2026-10`; string `test-2026-10` dan material public key testing **tidak ada** di asar/exe; tidak ada blok PEM private key; tidak ada entri `license-server`.

## 3. F4.3 — Rate limiter durable

Perubahan:

- `license-server/ratelimit.mjs`: fixed-window di SQLite (`rate_limits`, UPSERT … RETURNING atomik). Bertahan setelah restart dan konsisten untuk proses yang memakai file DB sama.
- Bucket: per IP, per hash license key, per installation id, per lisensi (renew/deactivate), per peran admin. IP bukan satu-satunya identitas.
- Kebijakan saat penyimpanan gagal: **fail-open** + audit `rate_store_error` (dipilih demi availability lisensi; brute force key 100-bit tidak realistis). Didokumentasikan di kode.
- `429` menyertakan `Retry-After`.
- Pengaman baru: server menolak start bila `LICENSE_HOST` non-loopback tanpa TLS (`FATAL`, exit 1).

Bukti `node license-server/test/run-ops-tests.mjs` → **34 PASS / 0 FAIL**, termasuk:

- 3 request lolos, ke-4 `429` + Retry-After.
- **Batas tetap berlaku setelah restart server** (DB sama).
- Pulih pada window berikutnya (tidak mengunci permanen).
- **30 request simultan → tepat 5 lolos, 25 ditolak** (limit 5).
- Batas per license key dan per installation id (IP sama) berlaku; key lain pada IP sama tetap dilayani.
- Penyimpanan rate limit gagal → fail-open (bukan 500) dan tercatat di audit.
- Endpoint admin dibatasi per IP (3 lalu 429).
- TLS: server melayani HTTPS (self-signed, `rejectUnauthorized=false` di uji), log menyatakan `https`, HTTP polos ke port TLS tidak dilayani.
- Bind non-loopback tanpa TLS ditolak saat start.

## 4. F4.4 — Administrasi & operasional

Perubahan:

- `license-server/admin-cli.mjs`: jalur administrasi minimum tanpa dashboard. Perintah: `health`, `create`, `list`, `show`, `disable`, `enable`, `revoke`, `release`, `audit`.
- Dua peran: `LICENSE_ADMIN_TOKEN` (penuh) dan `LICENSE_SUPPORT_TOKEN` (baca + lepas aktivasi saja). Perbandingan token timing-safe; peran support tidak dapat membuat/mengubah/mencabut lisensi.
- Operasi destruktif (`revoke`, `release`) wajib `--yes`; **tidak ada endpoint/perintah menghapus lisensi permanen** (revoke = soft).
- Audit mencatat pembuatan, perubahan, pencabutan, pelepasan aktivasi, penolakan admin, dan rate limit — tanpa key/token mentah.

Bukti (bagian dari 34 PASS di atas): tanpa token 401, token salah 401, support create/patch/revoke → 403 `forbidden_role`, admin create 201, DB menyimpan SHA-256 (bukan key mentah), support boleh list/aktivasi/audit/release, percobaan support tercatat di audit, CLI menolak `revoke` tanpa `--yes` (exit 2, tanpa request), `list` menampilkan `revoked`, baris lisensi tetap ada setelah revoke.

Belum tersedia (dengan keputusan): UI admin, akun admin per-orang (saat ini satu token per peran), 2FA. Untuk skala beta, CLI + token terpisah + akses jaringan terbatas dinilai cukup; rotasi token terdokumentasi.

## 5. F4.6 — Backup, restore, upgrade

Perubahan:

- `license-server/scripts/backup.mjs`: `VACUUM INTO` (snapshot konsisten saat server berjalan), `PRAGMA integrity_check`, sidecar `.sha256`, metadata `.json`, retensi `--keep`, hapus file parsial bila gagal.
- `license-server/scripts/restore-verify.mjs`: verifikasi sidecar hash, salin ke lokasi terpisah, `integrity_check` + `quick_check`, tolak menimpa tanpa `--force`, tolak backup terpotong/berubah.

Bukti `node license-server/test/run-backup-tests.mjs` → **20 PASS / 0 FAIL**:

- Backup saat server hidup; jumlah lisensi/aktivasi sama; sidecar hash cocok; server tetap melayani.
- Restore ke DB terpisah; hash license key utuh; status `revoked` tetap revoked; lisensi hasil restore dapat diaktivasi; lease lama tetap dapat di-renew; server pada DB hasil restore membaca lisensi yang sama.
- Backup terpotong → exit 1 tanpa output DB; SHA-256 tidak cocok → ditolak; menolak menimpa DB aktif tanpa `--force`; DB sumber tidak ada → exit 1; retensi `--keep` dihormati; DB aktif tidak berubah.

### Upgrade installer 0.2.0 → 0.3.0 (PASS, 22/22)

Lingkungan: instalasi per-user, `C:\Users\IT PROGRAMMER\AppData\Local\Programs\ICD-10 Codex 2010`, appId `id.ruangpmik.icd10codex`, product `ICD-10 Codex 2010`, userData `%APPDATA%\ICD-10 Codex 2010`.

| Pemeriksaan | Hasil |
|---|---|
| Installer 0.2.0 terpasang (`/S`), registry 1 entri, versi 0.2.0 | PASS |
| Lokasi instalasi di `%LOCALAPPDATA%\Programs` (bukan Program Files) | PASS |
| Aktivasi 0.2.0 (test key) + app berjalan, 437 istilah / 22 bab | PASS |
| Installer 0.3.0 dijalankan pada instalasi sama | PASS |
| Registry tetap 1 entri, versi 0.3.0, lokasi tidak berubah | PASS |
| Tidak ada folder instalasi duplikat | PASS |
| `installId` identik (`447cdb6c-4d74-4f27-84c9-4f906a7adc7c`) | PASS |
| `license.json` identik byte-per-byte setelah upgrade (`4237649d…`) | PASS |
| Local Storage identik setelah upgrade (`591c2649…`, 6 file) | PASS |
| `exe` terpasang identik dengan `dist/win-unpacked` (`90bd58c3…`) | PASS |
| 0.3.0 menolak lease test-key warisan 0.2.0 (`state: invalid`) | PASS |
| Resource utuh: 437 istilah, 22 bab, `errors: []` | PASS |
| Data pengguna tidak ditulis/dihapus saat lease ditolak | PASS |
| Aktivasi ulang dengan signing key produksi → `active`, `selfTest: ok` | PASS |

Catatan: Local Storage berubah setelah aplikasi 0.3.0 dijalankan (tulisan runtime normal), bukan akibat installer. Perbandingan integritas dilakukan tepat setelah upgrade, sebelum aplikasi dijalankan.

### Uninstall

Sebelum pengujian upgrade, 0.3.0 di-uninstall (`/S /currentuser`): direktori instalasi terhapus, registry 0 entri, **21 file userData tetap ada** (license, installation, Local Storage). Sesuai kontrak `deleteAppDataOnUninstall: false`.

## 6. F4.5 — Pengamanan versi web (keputusan eksplisit)

Keputusan: **web tetap publik tanpa gating lisensi**. Alasan: seluruh data yang disajikan (ICD-10 2010, kamus ID, modifiers) adalah data publik; tidak ada fitur proprietary/berbayar di web yang perlu dijual per-lisensi. Menyembunyikan tombol bukan kontrol lisensi.

Kontrol yang ada: build web statis tanpa `license-server`, tanpa private key, tanpa token, tanpa public key produksi; CSP hash-based; terjemahan mesin EN→ID diblokir untuk UA Electron (gate F1). Kontrol yang **belum** diterapkan: subset data demo, watermark paksa, pembatasan sesi, entitlement web. Detail dan tabel fitur: `docs/demo-matrix.md` (bagian "Keputusan demo web F4"). Endpoint admin tidak pernah diekspos ke web karena web hanya file statis.

## 7. F4.7 — Code signing & distribusi

Status: **UNSIGNED / NOT AVAILABLE**.

- Tidak ada sertifikat code signing (OV/EV) maupun anggaran untuk itu.
- `electron-builder` melaporkan `no code signing certificate configured, signing is skipped` untuk installer dan exe.
- Verifikasi signature setelah signing: **NOT TESTED** (tidak ada signature).
- Konsekuensi: SmartScreen akan memperingatkan; integritas hanya dapat diverifikasi lewat SHA-256 yang dipublikasikan di kanal resmi.
- Syarat distribusi saat ini: beta terbatas/internal, kanal unduhan terkontrol, hash dipublikasikan terpisah, pengguna diinstruksikan memverifikasi hash. **Bukan** untuk distribusi komersial luas.
- Antivirus/SmartScreen tidak dinonaktifkan; tidak ada instruksi menonaktifkan pengamanan Windows.

## 8. F4.8 — Matriks pengujian

Legenda: PASS = dijalankan dan lulus; FAIL = dijalankan dan gagal; BLOCKED = tidak dapat dijalankan karena prasyarat tidak ada; NOT TESTED = belum dijalankan.

### Licensing

| Uji | Status | Bukti |
|---|---|---|
| Aktivasi + renewal terhadap server | PASS (lokal, HTTP loopback) | E2E build produksi: aktivasi `active`, `selfTest: ok`, `tamperRejected: true`; API suite renew PASS |
| Aktivasi/renewal melalui HTTPS produksi | **BLOCKED** | Tidak ada domain/sertifikat; TLS server diuji lokal di ops suite |
| Token signature tidak valid ditolak | PASS | `trust-selftest` (`bad_signature`), unit F3, `tamperRejected` di E2E |
| Token test key ditolak build produksi | PASS | `trust-selftest` + runtime `state: invalid` + verify-artifact |
| Lisensi dicabut / kuota terlampaui | PASS | E2E revoked → `state: revoked`, data tetap; API suite kuota 403 + audit |
| Grace period & recovery | PASS (F3, client tidak berubah di F4) | Unit client 24/24, skenario active→grace→recovery→tamper |
| Server tidak tersedia tidak menghapus data | PASS | E2E offline `state: active`; `license.json` + `installation.json` tetap ada |

### Server

| Uji | Status | Bukti |
|---|---|---|
| Rate limit bertahan setelah restart | PASS | ops suite |
| Request simultan tidak melampaui batas | PASS | 30 simultan → 5 lolos |
| Endpoint admin menolak tanpa otorisasi | PASS | 401 / 403 role |
| Backup DB dapat dipulihkan | PASS (lokal) | 20/20 backup suite |
| Log tidak membocorkan kredensial | PASS | F3 API suite (tanpa key mentah/private material di log & audit) |
| TLS & akses jaringan | PASS (lokal), **BLOCKED** (publik) | HTTPS self-signed local; HTTP polos ditolak; bind non-loopback tanpa TLS ditolak |
| Deployment produksi + uji jaringan eksternal | **BLOCKED** | Tidak ada VPS/domain/DNS |

### Desktop

| Uji | Status | Bukti |
|---|---|---|
| Fuses sesuai target | PASS | `scripts/verify-fuses.mjs` (lihat tabel) |
| ASAR integrity / only-load-from-asar | PASS | Fuse ENABLE + aplikasi berjalan dari `app.asar`; verify-artifact |
| CSP, sandbox, context isolation | PASS | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; smoke `nodeExposed: false`; CSP header + 13 hash; 0 console error |
| Tidak ada private key di artefak | PASS | verify-artifact (blok PEM + probe material test & prod) |
| Tidak ada test key di trust produksi | PASS | verify-artifact + runtime invalid |
| Install / upgrade / uninstall | PASS | 22/22 upgrade; uninstall preserve data |
| IPC & protokol `app://` | PASS | smoke `licenseApi: true`, navigasi `app://local/`, `will-navigate` dibatasi, 0 error |

Fuses aktual (dibaca dari `dist/win-unpacked/ICD-10 Codex 2010.exe`, bukan config):

| Fuse | Aktual | Target | Status |
|---|---|---|---|
| RunAsNode | DISABLE | DISABLE | PASS |
| EnableNodeOptionsEnvironmentVariable | DISABLE | DISABLE | PASS |
| EnableNodeCliInspectArguments | DISABLE | DISABLE | PASS |
| OnlyLoadAppFromAsar | ENABLE | ENABLE | PASS |
| EnableEmbeddedAsarIntegrityValidation | ENABLE | ENABLE | PASS |
| GrantFileProtocolExtraPrivileges | ENABLE | ENABLE (F2, `app://`) | PASS |
| EnableCookieEncryption / V8Snapshot / WasmTrapHandlers | DISABLE / DISABLE / ENABLE | informasi | — |

### Regression

| Uji | Status | Bukti |
|---|---|---|
| 437 istilah Indonesia | PASS | smoke E2E semua run `idTerms: 437` |
| 22 bab ICD-10 | PASS | smoke `chapters: 22` |
| Hash & jumlah data sesuai baseline | PASS | `verify-data.mjs`: IDENTIK, 11.373 node, 22 bab, 437 idTerms, 44 modifiers |
| Search, detail kode, indeks A–Z | PASS | web smoke 6/6 |
| Web smoke | PASS | 6/6, `KONSOL BERSIH (0 error)` |
| Tidak ada error konsol baru | PASS | smoke web & desktop `errors: []` |
| Type check & dependency audit | PASS | `tsc --noEmit` exit 0; `npm audit` 0 vuln (all & production) |

## 9. Ringkasan perintah & hasil

| Perintah | Hasil |
|---|---|
| `node license-server/test/run-tests.mjs` | 46 PASS / 0 FAIL |
| `node license-server/test/run-ops-tests.mjs` | 34 PASS / 0 FAIL |
| `node license-server/test/run-backup-tests.mjs` | 20 PASS / 0 FAIL |
| `node scripts/trust-selftest.mjs` | 13 PASS / 0 FAIL |
| `node scripts/verify-fuses.mjs` | FUSES-OK |
| `node scripts/verify-artifact.mjs` | ARTIFACT-OK |
| `node scripts/release-metadata.mjs` | metadata ditulis |
| E2E build produksi (unactivated, test-key reject, activate, offline, revoked) | 7/7 PASS |
| Upgrade 0.2.0 → 0.3.0 | 22/22 PASS |
| Web smoke | 6/6 PASS, 0 error konsol |
| `npx tsc --noEmit` | exit 0 |
| `npm audit` | 0 vulnerabilities |

## 10. Risiko tersisa

1. **Deployment produksi (BLOCKED)** — belum ada VPS/domain/HTTPS/DB. Aplikasi produksi saat ini `serverUrl` kosong → fail-secure (`unactivated`), tidak dapat diaktifkan pelanggan tanpa konfigurasi server.
2. **Code signing (NOT AVAILABLE)** — unsigned; SmartScreen warning; tidak ada verifikasi signature; hash hanya dari kanal resmi.
3. **Key prod-candidate dibuat di mesin developer** — untuk rilis komersial, keypair harus dibuat di server tepercaya dan public key di-embed lewat rebuild + verify-artifact.
4. **Backup di infrastruktur nyata (BLOCKED)** — prosedur & alat terbukti lokal; jadwal backup, off-site copy, dan restore drill di produksi belum ada.
5. **Rate limit fail-open saat DB bermasalah** — keputusan sadar (availability) dengan audit; belum ada alerting.
6. **SQLite single-node** — belum diuji multi-instance/cluster; rate limit konsisten hanya bila file DB dibagi.
7. **Satu token per peran admin** — belum ada akun per-orang/2FA; rotasi manual.
8. **Local licensing dapat dibongkar pemilik perangkat** — dokumentasi F3 tetap berlaku: ini menaikkan hambatan, bukan DRM absolut.
9. **Uji jaringan eksternal & HTTPS publik** — belum dilakukan; hasil TLS lokal tidak menggantikan uji domain nyata.
10. **Build tidak bit-reproducible** — `meta.builtAt` berubah tiap build; verifikasi memakai hash artefak yang diuji, bukan rebuild.

## 11. Pekerjaan berikutnya (di luar F4 ini)

1. Sediakan VPS/domain/HTTPS → deploy `license-server` dengan systemd/reverse proxy, DB terbatas akses, backup terjadwal, monitoring `/healthz`.
2. Buat keypair produksi di server tepercaya → ganti keyset production → rebuild → verify-artifact → uji aktivasi dari jaringan eksternal.
3. Beli sertifikat code signing → sign installer + exe → verifikasi signature → publikasikan hash.
4. Uji multi-instance/rate limit terdistribusi bila trafik menuntut.
5. Opsional: UI admin, self-service deactivate sebelum beta eksternal.