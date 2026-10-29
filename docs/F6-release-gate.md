# F6 Release Gate

Produk: ICD-10 Codex 2010 · Versi 0.4.0 (candidate, unsigned)
Branch: `feat/f6-production-activation` · Commit: `0fd94d5`

Status gate keseluruhan: **READY FOR BETA (terbatas, internal)** — bukan READY FOR PRODUCTION.

## A. Definisi status

- **PASS** — uji dijalankan, bukti ada.
- **FAIL** — uji dijalankan, hasil tak lolos kriteria.
- **BLOCKED** — prasyarat eksternal belum tersedia.
- **NOT TESTED** — belum dijalankan, belum ada bukti cukup.

## B. Checklist

| # | Item | Status | Bukti |
|---|---|---|---|
| 1 | Repo/branch/HEAD bersih, artefak terverifikasi (bukan asumsi) | PASS | `0fd94d5`, tree bersih saat build |
| 2 | VPS tersedia (OS supported, hak minimum) | BLOCKED | tak ada infra |
| 3 | Domain + akses DNS sah | BLOCKED | — |
| 4 | HTTPS publik + uji dari jaringan eksternal | BLOCKED | — |
| 5 | Key produksi final diprovisikan di lingkungan tepercaya | BLOCKED | keyset production `[]` |
| 6 | Build produksi menolak key test & candidate | PASS | `keyset-guard-test` 9/9 |
| 7 | Server DB-startup hardening | PASS | ops 39/39 |
| 8 | Rate limiter + kontrol admin | PASS | ops 39/39 |
| 9 | Aktivasi/renewal/revocation/entitlement (lokal) | PASS | API 46/46 |
| 10 | Perilaku client: timeout/grace/recovery tak mencabut lisensi | PASS | client 18/18 |
| 11 | Backup/restore lokal | PASS | 20/20 |
| 12 | Backup/restore + DR pada infrastruktur nyata | BLOCKED | — |
| 13 | Code signing + verifikasi Authenticode | BLOCKED | unsigned |
| 14 | Clean build dari source disetujui | PASS | commit `0fd94d5` |
| 15 | Hash + metadata artefak final | PASS | `F6-build-metadata.json` |
| 16 | Fuses/ASAR integrity/trust store | PASS | FUSES-OK, ARTIFACT-OK |
| 17 | Regression + resource integrity | PASS | 437 istilah, 22 bab, 11.373 node |
| 18 | Monitoring + prosedur pemulihan aktif (dikonfigurasi & diuji) | NOT TESTED | docs/F6-operations.md (persiapan) |
| 19 | Multi-instance / HA | NOT TESTED | SQLite single-node |
| 20 | Vuln critical/high ditangani | PASS | `npm audit` 0 |

## C. Syarat naik ke READY FOR PRODUCTION

1. VPS + domain + DNS + sertifikat → deploy (runbook) → `verify:external --base https://... --keyset electron/keysets/production.public-keys.json` PASS dari jaringan terpisah.
2. Provision key produksi final di server tepercaya → isi `electron/keysets/production.public-keys.json` → `build:desktop` → `verify-artifact --expect-keyset production`.
3. Sertifikat code signing → sign exe+installer → verifikasi Authenticode → metadata ter-sign.
4. Backup terjadwal + off-site + restore drill di infra nyata.
5. Monitoring aktif (healthz/error/storage/backup/rotasi) diuji.

## D. Blocker wajib (harus clear sebelum produksi)

- Tidak ada server/domain/HTTPS publik.
- Key produksi final belum diprovisikan.
- Code signing belum ada.
- Uji eksternal dan DR nyata belum dijalankan.