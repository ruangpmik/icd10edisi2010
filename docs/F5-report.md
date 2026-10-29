# F5 Report — Production Deployment & Signed Release Engineering

Produk: **ICD-10 Codex 2010** (`id.ruangpmik.icd10codex`)
Branch: `feat/f5-production-readiness` (dibuat dari `a02d814` di `feat/f3-licensing`)
Commit F5: `5db0480` (source + docs); commit metadata/laporan menyusul.
Versi artefak: **0.4.0 (candidate, unsigned)**
Tanggal: 2026-10-29

## 0. Keputusan release gate

| Gate | Status |
|---|---|
| **F5 produksi** | **BLOCKED** |
| Kelayakan distribusi | **Beta terbatas / internal only** (artefak kandidat unsigned) |
| Deployment server produksi (VPS/domain/HTTPS) | **BLOCKED** |
| Key produksi final (provisioning di server tepercaya) | **BLOCKED** |
| Code signing + verifikasi signature | **BLOCKED** |
| Backup/restore & uji jaringan eksternal di infrastruktur nyata | **BLOCKED** |
| Pekerjaan lokal F5 (key lifecycle, hardening, build, regresi) | **PASS** |

Detail checklist: `docs/F5-release-gate.md`.

## 1. Baseline & audit awal (F5.0)

Diverifikasi ulang sebelum perubahan: branch `feat/f3-licensing` HEAD `a02d814`, tree bersih, artefak 0.3.0 ada, keyset test+production(kandidat), tanpa DB lokal, tanpa sertifikat code signing (`Cert:\CurrentUser\My` kosong, tanpa `.pfx`, `signtool.exe` tidak terpasang), tanpa Windows Kits. Branch baru `feat/f5-production-readiness` dibuat tanpa menyentuh branch lain. Tidak ada reset/rebase/force push.

Pemisahan pekerjaan:

- **Dapat lokal (dikerjakan + diuji):** key lifecycle 3-tingkat, guard build produksi, hardening startup DB, guard test suite, metadata rilis, runbook, clean build, regresi penuh.
- **Butuh eksternal (BLOCKED):** deploy VPS, DNS/HTTPS publik, provisioning key produksi final, pembelian sertifikat signing, uji jaringan eksternal, backup off-site.

## 2. F5.1 — Infrastruktur (runbook, status BLOCKED)

`docs/F5-deployment-runbook.md`: kebutuhan minimum, arsitektur (reverse proxy + bind loopback), env production lengkap sesuai `license-server/config.mjs`, unit systemd, contoh Caddy/nginx, prosedur deploy pertama, upgrade + rollback, backup/monitoring/pemulihan, dan **checklist verifikasi dari jaringan eksternal** (10 item). Tidak ada domain/kredensial yang dikarang (`<domain-lisensi>` placeholder). Tidak ada server lokal yang disamarkan sebagai produksi.

## 3. F5.2 — Key lifecycle (PASS lokal; provisioning produksi BLOCKED)

Perubahan struktural:

- Keyset kini **tiga tingkat**: `test.public-keys.json` (`test-2026-10`), `candidate.public-keys.json` (`prod-candidate-2026-10`), `production.public-keys.json` (**kosong** — key final belum diprovisikan).
- `npm run build:desktop` (produksi) **gagal terkontrol** saat keyset production kosong: "keyset production kosong — key produksi final belum diprovisikan (BLOCKED)". Tidak ada fallback ke kandidat.
- `npm run build:desktop:candidate` baru untuk build kandidat → `dist/`.
- `scripts/generate-prod-keypair.mjs` menolak menulis kid `test*`/`*candidate*` ke keyset production (anti-spoof).
- `scripts/verify-artifact.mjs --expect-keyset production` menolak asar yang memuat kid kandidat; build non-test wajib bebas material test key.

Bukti:

- `scripts/keyset-guard-test.mjs` (baru): **9 PASS / 0 FAIL** — production kosong menolak build, kandidat terpilih benar, spoof kandidat→production ditolak & file tak tertulis, kid `test*` ditolak, keyset production benar-benar kosong, tanpa material private.
- `scripts/trust-selftest.mjs`: **17 PASS / 0 FAIL** — pemisahan test/candidate/production, lease test-key ditolak keyset kandidat & produksi, lease kandidat (private key asli) sah di kandidat & ditolak testing, unknown kid, rotasi dua-kid + pencabutan, `alg:none`, tamper.
- Kandidat tidak dijadikan produksi dengan mengganti nama — keyset production dibiarkan kosong.

Dokumentasi: `docs/F5-key-lifecycle.md` (peran keyset, provisioning di server tepercaya, rotasi tanpa memutus pelanggan, prosedur kompromi, penyimpanan/ACL, batasan lease offline maksimum 7 hari sebagai risiko residual).

## 4. F5.3 — Licensing API hardening (PASS lokal)

- Semua suite dijalankan ulang: **46/46** functional, **39/39** ops (34 lama + 5 baru).
- **Kasus baru (ops suite):** DB korup → server menolak start (exit 1 + `FATAL`, tanpa stack internal); path DB tidak dapat dipakai → menolak start; request JSON rusak → `400 {"error":"bad_request"}` persis (tanpa detail internal); route tak dikenal → `404 {"error":"not_found"}` persis.
- `server.mjs`: pembukaan DB kini dibungkus try/catch → gagal cepat dengan pesan jelas, tanpa stack trace.
- Rate limiter durable, peran admin/support, audit, TLS, bind guard: lulus kembali (tidak diubah).
- Otorisasi operasi penting tetap di backend (aktivasi/kuota/revoke di server; lisensi lokal bukan satu-satunya pengaman).
- Multi-instance: **NOT TESTED** — SQLite single-node; tidak diklaim HA.
- Pengujian eksternal (aktivasi via HTTPS publik, simultan dari jaringan nyata, dsb.): **BLOCKED**.

## 5. F5.4 — Backup & DR

- Suite backup **20/20 PASS** (dijalankan ulang).
- `docs/F5-backup-dr.md`: kebijakan (harian, retensi 14+8), **RPO ≤ 24 jam / RTO ≤ 2 jam (target, belum terukur di produksi)**, aturan restore-tidak-pernah-menimpa-DB-aktif, pemisahan key signing dari backup DB, migrasi skema additive, prosedur pemulihan.
- Backup terjadwal + off-site + drill di infrastruktur target: **BLOCKED**.

## 6. F5.5 — Code signing

`docs/F5-code-signing.md`: perbedaan OV/EV vs self-signed vs unsigned, prosedur signing via `electron-builder` (`CSC_LINK`/`CSC_KEY_PASSWORD`), timestamping, verifikasi `signtool verify /pa` + `Get-AuthenticodeSignature`, perlindungan private key (EV token disarankan), rotasi/pencabutan, checklist rilis. Status: **BLOCKED** — tidak ada sertifikat; artefak dilabeli **unsigned** eksplisit. SmartScreen/antivirus tidak pernah dinonaktifkan; tidak ada tool tidak resmi.

## 7. F5.6 — Clean build & provenance

- Build dijalankan dari tree bersih di commit `5db0480` (branch F5), konfigurasi kandidat terverifikasi.
- Artefak final yang diuji = artefak yang akan didistribusikan:

| Artefak | SHA-256 |
|---|---|
| `dist/ICD10-Codex-Setup-0.4.0.exe` (185.809.318 B) | `394cfbd9f2c657a988c50433796a4b0387d2387501f42b552a28f4182579487c` |
| `ICD10-Codex-Setup-0.4.0.exe.blockmap` | `3649d4fd93cfecdd7e5738bafcecd442d8a1736a811d0d5f692dcf2b67cf7e74` |
| `win-unpacked/ICD-10 Codex 2010.exe` | `9e406cc1e8ee079803bb28de091685ccaaf2ada1d913c4ce5a78aad7ed9db45a` |
| `win-unpacked/resources/app.asar` | `d02c656282dd6aa27c4362bcee0275d92b822216fab6b07f5fd406fde8f89bbc` |

- Build time: 2026-10-29T07:59:04.903Z; Electron 45.0.0; Node v24.22.1; win32-x64.
- Keyset tertanam: `prod-candidate-2026-10` (fingerprint SPKI SHA-256 `8eb4f398…9a23`); `serverUrl` kosong (fail-secure `unactivated`); `testKeyTrusted: false`.
- Fuses dari exe final: RunAsNode/NodeOptions/NodeCliInspect DISABLE, OnlyLoadAppFromAsar + EmbeddedAsarIntegrity ENABLE (`FUSES-OK`).
- Metadata: `docs/release/F5-build-metadata.json` (tanpa secret). `workingTreeDirty: true` pada metadata = churn file hasil generate (`csp-hashes.json`, `meta.builtAt`) yang dihasilkan build itu sendiri; **input source saat build dimulai bersih di `5db0480`**.
- **Build tidak bit-reproducible** (builtAt + CSP hash per build) — dinyatakan eksplisit di metadata; verifikasi memakai hash artefak yang diuji.
- Tidak ada klaim reproducible.

## 8. F5.7 — Resource & regression protection (semua PASS)

| Uji | Hasil |
|---|---|
| `verify-data.mjs` | IDENTIK — 11.373 node, 22 bab, **437 idTerms**, 44 modifiers |
| Web smoke (build out final) | **6/6 PASS**, `KONSOL BERSIH (0 error)` — bab 22, pencarian, detail+kamus ID, indeks A–Z |
| E2E desktop build kandidat final | **7/7 PASS** — unactivated; lease test-key → `invalid`; aktivasi kandidat → `active` + `selfTest: ok`; offline tetap `active`; `license.json`+`installation.json` utuh; revoke → `revoked`; data tak dihapus |
| Upgrade installer 0.3.0 → 0.4.0 | **15/15 PASS** — 1 entri registry, versi 0.4.0, lokasi sama, tanpa folder duplikat; `installId` `447cdb6c-4d74-4f27-84c9-4f906a7adc7c` identik; `license.json` byte-per-byte identik; Local Storage identik; lease kandidat tetap `active` setelah upgrade; 437/22/`errors:[]`; exe terpasang = `dist/win-unpacked` |
| `tsc --noEmit` | exit 0 |
| `npm audit` (all & `--omit=dev`) | 0 vulnerabilities |
| `verify-artifact` | ARTIFACT-OK |
| `verify-fuses` | FUSES-OK |
| API functional / ops / backup / trust / keyset-guard | 46/46 · 39/39 · 20/20 · 17/17 · 9/9 |

CSP hash-based, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, IPC guard, protokol `app://`: tidak diubah; smoke `nodeExposed:false`, `licenseApi:true`, 0 error konsol.

## 9. F5.8 — Web demo & distribusi

`docs/demo-matrix.md` diperbarui dengan keputusan F5: **keputusan F4 dipertahankan** — web tetap publik tanpa gating lisensi (data publik, tidak ada fitur berbayar web), kontrol entitlement (bila kelak ada) harus di backend. Dibedakan eksplisit: keputusan desain (F4/F5) vs implementasi (sudah ada sejak F1–F4) vs pengujian baru (tidak ada perubahan web di F5 → tidak ada uji baru yang diklaim).

## 10. Status akhir per area

| Area | Status |
|---|---|
| Key lifecycle lokal (test/candidate/production + guard) | PASS |
| Licensing API hardening lokal | PASS |
| Backup/restore tooling & uji lokal | PASS |
| Clean build + provenance + metadata | PASS |
| Regression & resource protection | PASS |
| Deployment produksi (VPS/domain/HTTPS) | **BLOCKED** |
| Uji eksternal (aktivasi HTTPS publik, checklist runbook) | **BLOCKED** |
| Key produksi final provisioning | **BLOCKED** |
| Code signing + verifikasi | **BLOCKED** |
| Backup terjadwal/off-site/drill produksi | **BLOCKED** |
| Multi-instance / HA | **NOT TESTED** |
| Rotasi key di produksi nyata | **NOT TESTED** (simulasi lulus) |

## 11. Risiko tersisa

1. Tanpa deployment, aplikasi produksi tidak dapat diaktifkan pelanggan (`serverUrl` kosong → fail-secure).
2. Artefak unsigned: SmartScreen warning; verifikasi hanya via SHA-256 kanal resmi.
3. Key kandidat dibuat di mesin developer — key final wajib dibuat di server tepercaya.
4. Fail-open rate limit saat DB bermasalah (keputusan sadar + audit; belum ada alerting).
5. SQLite single-node; belum diuji multi-instance.
6. Satu token per peran admin; tanpa 2FA.
7. Lease offline maksimum 7 hari (lease 3 + grace 4) — jendela abuse pasca-revoke.
8. Lisensi lokal dapat dibongkar pemilik perangkat (penahanan, bukan DRM absolut).

## 12. Langkah penutup blocker (urutan)

1. VPS + domain + TLS → deploy sesuai runbook → checklist eksternal §9.
2. Provision key produksi final di server → isi keyset production → rebuild produksi → verify-artifact production.
3. Sertifikat code signing → sign + verify → metadata ter-sign.
4. Backup terjadwal + off-site + drill.
5. Tinjau ulang gate: syarat READY FOR PRODUCTION ada di `docs/F5-release-gate.md` §A.
