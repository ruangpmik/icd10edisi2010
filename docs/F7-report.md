# F7 Report — Production Deployment & Signed Release

Produk: **ICD-10 Codex 2010** (`id.ruangpmik.icd10codex`)
Branch: `feat/f7-production-deployment` (dari `010f35b` di `feat/f6-production-activation`)
Versi artefak: **0.4.0 candidate, unsigned** (tidak ada rebuild F7; tidak ada perubahan source)
Tanggal: 2026-10-29

## 0. Keputusan

| Gate | Status |
|---|---|
| **F7 produksi** | **BLOCKED** |
| Distribusi | **Beta terbatas / internal only** (untuk dibawa ke produksi setelah prasyarat tersedia) |
| Deployment server produksi | **BLOCKED** |
| HTTPS publik + uji eksternal | **BLOCKED** |
| Provisioning key produksi final | **BLOCKED** |
| Code signing + Authenticode | **BLOCKED** |
| Backup/restore & DR nyata | **BLOCKED** |

Keputusan diambil dari jawaban pemilik proyek: **belum ada infrastruktur produksi**. Tidak ada deployment/domain/IP/sertifikat/signature yang dikarang.

## 1. F7.0 — Audit & branch safety

Diverifikasi aktual (bukan asumsi pada laporan lama):

- `git` branch kerja `feat/f7-production-deployment` dibuat dari baseline `010f35b`; branch F6 dan F5 tidak diubah/dihapus; tidak ada reset/rebase/force push.
- HEAD `010f35b` (F6 docs+metadata), tree bersih saat audit.
- Fix kebocoran test-key tetap berlaku: `package.json` masih memuat `"!electron/test/**"`.
- Tes dasar dijalankan ulang: `ARTIFACT-OK`, `FUSES-OK`, `verify-data` `IDENTIK: true`, client 18/18 (ringkasan terekam pada log run, status exit 0).

## 2. F7.1 — Infrastructure readiness

Tidak tersedia (tidak ada kredensial/domain/IP/sertifikat/akses yang diserahkan pada sesi ini):

- VPS / hosting produksi, domain, akses DNS, akses administratif, sertifikat TLS — semuanya **tidak ada**.
- Sertifikat/layanan code signing — **tidak ada**.
- Lingkungan tepercaya key provisioning — **tidak ada** (server produksi belum ada).

Daftar kebutuhan spesifik, siapa penyedia, dan urutan deployment dikunci di **`docs/F7-procurement.md`** (deliverable F7.1). Kolom "Yang menyediakan" dan "Nilai aktual" sengaja dikosongkan agar diisi saat akses nyata diserahkan.

## 3. F7.2 / F7.3 / code signing / backup nyata

Seluruhnya **BLOCKED**: tidak dapat deploy ke infrastruktur yang tidak ada. `license-server/scripts/external-verify.mjs` tidak dijalankan terhadap domain nyata (tetap hanya lolos `node --check` dari F6). Tidak ada installer yang ditandatangani; artefak 0.4.0 tetap labeled **candidate-unsigned**.

Tidak ada perubahan source F7, sehingga artefak F6 (hash installer `a0abd664d571932ff9e96d49fc12d00348a608824f4ee52a9616e4fb81b1fae6`) tetap berlaku untuk beta terbatas dan **belum** menjadi artefak produksi.

## 4. Status akhir

- **Implementasi selesai (F7):** audit baseline, daftar procurement/akses spesifik, verifikasi fix leak tetap utuh.
- **Pengujian lulus (diulang):** ARTIFACT-OK, FUSES-OK, verify-data IDENTIK, client 18/18.
- **BLOCKED:** deployment, HTTPS eksternal, key produksi final, code signing, backup/DR nyata.
- **NOT TESTED:** endpoint produksi (build masih `serverUrl` kosong), multi-instance/HA.
- **Persyaratan menuju rilis komersial:** lihat `docs/F7-procurement.md` §1–§7.

## 5. Langkah berikutnya (setelah akses tersedia)

1. Isi "Yang menyediakan" + "Nilai aktual" di `docs/F7-procurement.md`.
2. Ikuti urutan `docs/F7-procurement.md` §5 (DNS → TLS → deploy → external-verify → build produksi → backup → signing).
3. Isi `electron/keysets/production.public-keys.json` → `npm run build:desktop` → `verify-artifact --expect-keyset production`.
4. Code signing → verifikasi Authenticode → metadata ter-sign.