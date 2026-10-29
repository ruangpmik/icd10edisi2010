# F6 Report — Production Infrastructure Activation

Produk: **ICD-10 Codex 2010** (`id.ruangpmik.icd10codex`)
Branch: `feat/f6-production-activation` (dari `cfe61d6` di `feat/f5-production-readiness`)
Commit F6: `fd22eea` (persiapan ops), `0fd94d5` (fix asar), laporan+metadata menyusul.
Versi artefak: **0.4.0 candidate, unsigned**
Tanggal: 2026-10-29

## 0. Keputusan release gate

| Gate | Status |
|---|---|
| **F6 produksi** | **BLOCKED** |
| Distribusi | **Beta terbatas / internal only** (unsigned, kandidat) |
| VPS / domain / DNS / HTTPS publik | **BLOCKED** (tidak ada kre dential/discoverable infra) |
| Provisioning key produksi final (Ed25519) | **BLOCKED** |
| Code signing + verifikasi Authenticode | **BLOCKED** |
| Pengujian eksternal (aktivasi HTTPS dari jaringan terpisah) | **BLOCKED** |
| Backup/restore & DR pada infrastruktur nyata | **BLOCKED** |
| Pekerjaan lokal F6 (uji client, skrip verifikasi eksternal, runbook operasi) | **PASS** |

## 1. Baseline & discovery (F6.0)

Diverifikasi ulang (bukan asumsi): branch `feat/f5-production-readiness` HEAD `cfe61d6`, tree bersih, artefak 0.4.0 hash `394cfbd9…` cocok dengan laporan F5, keyset tiga tingkat + guard utuh.

**Discovery infrastruktur:** tidak ada VPS, domain, akses DNS, akun admin server, atau sertifikat TLS yang tersedia/disediakan pada sesi ini; tidak ada kredensial deployment yang diberikan lewat mekanisme aman; tidak ada sertifikat code signing. Tidak ada prasyarat eksternal yang dikarang. Deployment aktual dipertahankan **BLOCKED**.

## 2. F6.1 / F6.2 / F6.3 / F6.6 — deployment, HTTPS, key provisioning, signing

Tetap **BLOCKED**; tidak ada langkah fiktif. Persiapan lokal yang sudah ada dari F5 dan dilengkapi di F6:

- `docs/F5-deployment-runbook.md` — runbook konkret sesuai variabel `license-server/config.mjs` (tanpa nama layanan/domain yang dikarang).
- `docs/F5-key-lifecycle.md` — provisioning key produksi di server tepercaya; keyset production dibiarkan kosong, build produksi ditolak (`keyset-guard-test` 9/9).
- `docs/F5-code-signing.md` — signing hanya mungkin setelah sertifikat tersedia; artefak dilabeli **unsigned**.
- `docs/F6-operations.md` — monitoring, verifikasi eksternal berkala, restart, kompromi key, rollback, perilaku saat API tak tersedia.

## 3. F6.4 — Perilaku client (uji baru, PASS)

`electron/test/run-client-tests.cjs` — **18/18 PASS** (dijalankan via Node dengan `electron` di-mock hanya untuk `app.getPath`+`safeStorage`; keyset kandidat asli + private key kandidat di luar repo). Poin kunci yang dibuktikan:

- Timeout server (AbortSignal 8 s) → `network`, state TETAP active, **bukan revoked**; data utuh.
- HTTP 500 dan `429 rate_limited` → diperlakukan gangguan, state dipertahankan.
- Renew gagal berulang **tidak memperpanjang grace** (`graceUntil` konstan).
- Grace: `exp + 4 hari` → `grace` + `canUseApp`; lewat grace → `expired` + `canUseApp=false`; `license.json` tak pernah dihapus.
- `kid` tidak dikenal → `invalid`; `serverState: revoked` terminal menang atas lease lokal; data tak dihapus.
- Koneksi pulih → renew otomatis → `active`.
- Guard rollback jam (`nowSec >= maxTime`).
- Deactivate offline → `ok + offline`, slot dilepas lokal.

## 4. F6.9 — Operasional / monitoring (dokumentasi + alat, PASS sebagai persiapan)

- `docs/F6-operations.md`: tabel sinyal monitoring (health endpoint, error rate, storage, backup failure, TLS expiry), contoh probe, restart, prosedur kompromi/rotasi key, rollback, dan perilaku saat lisensi API tak tersedia.
- `license-server/scripts/external-verify.mjs` (baru): checklist eksternal yang bisa dijalankan nanti — resolusi DNS, validasi TLS penuh (rantai+hostname, `rejectUnauthorized` default), healthz, penolakan admin tanpa token, aktivasi+verifikasi signature lease terhadap keyset production, renewal, deactivation, rate limit, anti-kebocoran error. Tidak pernah `NODE_TLS_REJECT_UNAUTHORIZED=0`; tidak mencetak key/token lengkap. **Belum dijalankan terhadap domain nyata** (BLOCKED); lintasan sintaks diperiksa `node --check`.

## 5. F6.5 — Backup/DR

Tooling + uji lokal tetap **PASS** (20/20 backup suite; kasus DB korup/taktersedia di ops 39/39). DR pada infrastruktur nyata tetap **BLOCKED** (docs/F5-backup-dr.md, RPO≤24h/RTO≤2h target).

## 6. F6.7 — Provenance & artefak final

Artefak kandidat **0.4.0** dibangun ulang dari commit F6 `0fd94d5` (clean) karena F6 mengubah `package.json` (yang ter-embed di asar). Saat validasi ditemukan **kebocoran license key uji ke asar** (file uji `electron/test/run-client-tests.cjs` ikut terpaket karena pola `electron/**/*`); diperbaiki dengan pengecualian `!electron/test/**` dan `verify-artifact` menangkapnya (ARTIFACT-GAGAL → ARTIFACT-OK).

| Artefak | SHA-256 |
|---|---|
| `dist/ICD10-Codex-Setup-0.4.0.exe` | `a0abd664d571932ff9e96d49fc12d00348a608824f4ee52a9616e4fb81b1fae6` |
| `ICD10-Codex-Setup-0.4.0.exe.blockmap` | `9c45ee8388cd5f0d28a1b5669a1efe51f95a595160fdad3662b0b7158554851c` |
| `win-unpacked/ICD-10 Codex 2010.exe` | `5047ef6c8d41596ad09d54ef585db202b8c9336d055e42e7ddef4ff85d116319` |
| `win-unpacked/resources/app.asar` | `433e497f3ced12454e357c0fa960a9c243520c41ba40db0adde9bf3bea59cc34` |

- Keyset tertanam `prod-candidate-2026-10` (fingerprint `8eb4f398…9a23`); `serverUrl` kosong (fail-secure); `testKeyTrusted:false`.
- Fuses dari exe final: RunAsNode/NodeOptions/NodeCliInspect DISABLE, OnlyLoadAppFromAsar + EmbeddedAsarIntegrity ENABLE (`FUSES-OK`).
- Metadata: `docs/release/F6-build-metadata.json` — source commit `0fd94d5`, endpoint tanpa secret, signature `unsigned`, gate `BLOCKED (produksi); beta terbatas`.
- Build **tidak** bit-reproducible (builtAt + CSP hash per build) — dinyatakan eksplisit.

## 7. F6.8 — Regression & resource integrity (diuji ulang pasca rebuild)

| Uji | Hasil |
|---|---|
| `verify-data.mjs` | IDENTIK — 22 bab, **437 idTerms**, 11.373 node, 44 modifiers |
| Web smoke (out final) | **6/6**, `KONSOL BERSIH (0 error)` |
| E2E build kandidat final | **7/7** — unactivated; test-key → `invalid`; aktivasi → `active`+`selfTest:ok`; offline `active`; revoke `revoked`; data utuh |
| Upgrade 0.3.0 → 0.4.0 | **15/15** — 1 entri registry, `installId`/`license.json`/Local Storage identik, lease tetap `active`, exe = `dist` |
| API / ops / backup / trust / guard / client | 46/46 · 39/39 · 20/20 · 17/17 · 9/9 · 18/18 |
| `tsc --noEmit` / `npm audit` | exit 0 / 0 vuln |
| `verify-artifact` / `verify-fuses` | ARTIFACT-OK / FUSES-OK |

CSP hash-based, sandbox, context isolation, IPC guard, `app://` tidak diubah.

## 8. Status akhir per komponen

| Komponen | Status |
|---|---|
| Infrastruktur deployment | **BLOCKED** |
| Domain/DNS/HTTPS publik + uji eksternal | **BLOCKED** |
| Provisioning key produksi final | **BLOCKED** |
| Code signing | **BLOCKED** |
| Endpoint produksi yang diuji | **NOT TESTED** (serverUrl build kosong) |
| Backup/DR nyata | **BLOCKED** |
| Uji client & server lokal | PASS |
| Clean build + provenance + metadata | PASS |
| Regression & resource | PASS |
| Multi-instance / HA | **NOT TESTED** |

## 9. Risiko tersisa

1. Tanpa deploy, aplikasi produksi `unactivated` sampai server + URL dikonfigurasi.
2. Unsigned → SmartScreen warning; verifikasi hanya lewat hash.
3. Key final belum diprovisikan; key kandidat berasal dari mesin developer.
4. SQLite single-node; fail-open rate limit; tanpa alerting produksi.
5. Lease offline maksimum 7 hari (jendela abuse pasca-revoke).
6. Lisensi lokal dapat dibongkar pemilik perangkat.

## 10. Syarat menuju READY FOR PRODUCTION

Ikuti urutan pada `docs/F5-release-gate.md` §C dan `docs/F6-release-gate.md`:
1. VPS + domain + DNS + sertifikat → deploy (runbook) → `verify:external` dari jaringan terpisah PASS.
2. Provision key produksi final di server tepercaya → isi keyset production → rebuild produksi → `verify-artifact --expect-keyset production`.
3. Sertifikat code signing → sign + verifikasi → metadata ter-sign.
4. Backup terjadwal + off-site + restore drill.