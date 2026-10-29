# F5 — Release Gate Checklist

Legenda: PASS = dijalankan dan lulus · FAIL = dijalankan dan gagal · BLOCKED = prasyarat eksternal tidak ada · NOT TESTED = belum dijalankan.

## A. Syarat READY FOR PRODUCTION

| # | Syarat | Status | Bukti |
|---|---|---|---|
| 1 | Infrastruktur produksi tersedia | **BLOCKED** | Tidak ada VPS/domain — `docs/F5-deployment-runbook.md` |
| 2 | HTTPS publik terverifikasi dari jaringan eksternal | **BLOCKED** | Checklist §9 runbook belum dapat dijalankan |
| 3 | Keyset production diprovisikan & divalidasi | **BLOCKED** | Keyset production kosong; provisioning harus di server tepercaya |
| 4 | Test key tidak dipercaya build produksi | PASS (guard) | `keyset-guard-test` 9/9, `trust-selftest` 17/17, build produksi menolak start tanpa key |
| 5 | Aktivasi/renewal/revocation via endpoint produksi | **BLOCKED** | Hanya diuji lokal (loopback HTTP + TLS lokal) |
| 6 | Backup & restore di infrastruktur target | **BLOCKED** | PASS lokal 20/20; drill produksi belum ada |
| 7 | Kontrol administrasi & rate limiter terverifikasi | PASS (lokal) | ops suite 39/39 |
| 8 | Code signing dilaksanakan & diverifikasi | **BLOCKED** | Tidak ada sertifikat; artefak unsigned |
| 9 | Artefak dari source disetujui | PASS | Clean build dari commit F5 (lihat metadata) |
| 10 | Regression lulus | PASS | Lihat F5-report §tes |
| 11 | Kerentanan kritis/tinggi tidak tertangani | PASS | `npm audit` 0 vuln (all & production) |
| 12 | Metadata, checksum, dokumentasi operasional | PASS | `docs/release/F5-build-metadata.json` + 4 dokumen F5 |
| 13 | Tidak ada blocker disembunyikan | PASS | Semua BLOCKED/NOT TESTED tercantum |

**Keputusan F5: BLOCKED untuk produksi.** Kelayakan distribusi: beta terbatas/internal dengan artefak kandidat unsigned.

## B. Checklist rilis per artefak

- [x] Build dari tree bersih, commit tercatat.
- [x] `verify-artifact` ARTIFACT-OK (keyset, tanpa private key/test key/server code).
- [x] `verify-fuses` FUSES-OK dari exe final.
- [x] Smoke desktop E2E 7/7 (unactivated, test-key reject, aktivasi, offline, revoke).
- [x] Upgrade installer dari versi sebelumnya lulus (lihat F5-report).
- [x] Web smoke 6/6, konsol bersih.
- [x] SHA-256 installer + exe + asar tercatat di metadata.
- [ ] Code signing + verifikasi signature — **BLOCKED**.
- [ ] Publikasi hash di kanal resmi — menunggu kanal distribusi.

## C. Blocker eksternal (urutan penyelesaian)

1. VPS + domain + DNS + sertifikat TLS → deploy sesuai runbook → jalankan checklist eksternal.
2. Provision key produksi final di server tepercaya → isi keyset production → rebuild → verify-artifact production.
3. Sertifikat code signing (OV/EV) + Windows SDK → signing + `signtool verify` → metadata ter-sign.
4. Backup terjadwal + off-site + restore drill di server.
5. Setelah 1–4 lulus: gate dapat ditinjau ulang ke READY FOR PRODUCTION.
