# F5 — Key Lifecycle & Trust Separation

Status keseluruhan: **candidate aktif, production provisioning BLOCKED** (tidak ada server tepercaya untuk membuat key produksi final).

## 1. Tiga tingkat keyset

| Keyset | File | kid | Private key | Dipakai untuk |
|---|---|---|---|---|
| Testing | `electron/keysets/test.public-keys.json` | `test-2026-10` | `license-server/keys/` (gitignored, mesin dev) | Build pengujian (`build:desktop:test` → `dist-test/`), server uji lokal |
| Candidate | `electron/keysets/candidate.public-keys.json` | `prod-candidate-2026-10` | `%USERPROFILE%\.icd10-prod-keys\` (di luar repo, ACL ketat) | Build kandidat/beta (`build:desktop:candidate` → `dist/`), server kandidat |
| Production | `electron/keysets/production.public-keys.json` | **kosong** | **belum ada** | Build produksi final — **BLOCKED** sampai diprovisikan |

Aturan yang ditegakkan kode (`scripts/select-keys.mjs`, `scripts/generate-prod-keypair.mjs`, `scripts/verify-artifact.mjs`, `scripts/keyset-guard-test.mjs`):

1. Satu build hanya membawa SATU keyset (`electron/public-keys.json` hasil generate, gitignored; `keysets/**` dikecualikan dari asar).
2. kid dan material public key tidak boleh sama di dua keyset.
3. Keyset production kosong → `npm run build:desktop` **gagal** dengan pesan BLOCKED; tidak ada fallback diam-diam ke kandidat.
4. kid `test*` / `*candidate*` ditolak masuk keyset production (generate + select).
5. `verify-artifact --expect-keyset production` menolak asar yang memuat kid kandidat; asar/exe tidak boleh memuat kid/material keyset lain.
6. Private key tidak pernah masuk repo, build, installer, log, atau laporan (dicek probe material di `verify-artifact`).

## 2. Peta skrip

| Skrip | Fungsi |
|---|---|
| `scripts/select-keys.mjs test\|candidate\|production` | Pilih keyset → `electron/public-keys.json` |
| `npm run build:desktop:test` | Build testing → `dist-test/` |
| `npm run build:desktop:candidate` | Build kandidat → `dist/` |
| `npm run build:desktop` | Build produksi (gagal bila keyset production kosong) |
| `scripts/generate-prod-keypair.mjs <kid> --out <dir-luar-repo> [--public-out <keyset>]` | Provision keypair Ed25519; tolak path di dalam repo, kid `test*`, kid kandidat → keyset production |
| `scripts/trust-selftest.mjs` | 17 uji pemisahan/rotasi/penolakan (kid tidak dikenal, `alg:none`, tamper) |
| `scripts/keyset-guard-test.mjs` | 9 uji guard: production kosong menolak build, anti-spoof, anti private key |
| `scripts/verify-artifact.mjs --expect-keyset <set>` | Release gate isi asar/exe |

## 3. Provisioning key produksi final (BLOCKED — jalankan saat server tepercaya tersedia)

1. Di **server tepercaya** (bukan mesin developer): `node scripts/generate-prod-keypair.mjs prod-2026-XX --out /etc/icd10-license/keys --public-out /tmp/production.public-keys.json`.
   - Private key tetap di server, izin `0600`, pemilik khusus service.
   - `--out` WAJIB di luar repository client.
2. Bawa **hanya** file public key (atau fingerprint SPKI SHA-256) ke proses build melalui kanal terverifikasi.
3. Isi `electron/keysets/production.public-keys.json` dengan kid + PEM public key.
4. `npm run build:desktop` → `node scripts/verify-artifact.mjs --expect-keyset production` → `node scripts/verify-fuses.mjs`.
5. Jalankan server produksi dengan `LICENSE_SIGNING_KID=prod-2026-XX` dan `LICENSE_KEYS_DIR` yang memuat private key.
6. Aktivasi uji end-to-end dari jaringan eksternal sebelum rilis.

**Larangan:** jangan menyalin/mengganti nama key kandidat menjadi produksi; jangan menaruh private key di repo, asar, installer, CI cache, atau log.

## 4. Rotasi (tanpa memutus pelanggan sah)

Client menerima beberapa kid sekaligus (array keyset) dan menolak `unknown_kid`:

1. Terbitkan kid baru di server; tambahkan public key-nya ke keyset client **tanpa menghapus kid lama**.
2. Build + distribusikan versi client baru (kid lama + baru dipercaya). Lisensi aktif lama tetap valid sampai lease berikutnya.
3. Setelah populasi client bermigrasi (pantau `kid` di audit server), hapus kid lama dari `LICENSE_KEYS_DIR` server (berhenti menandatangani) dan dari keyset client di build berikutnya.
4. Lease lama bertanda kid lama → `unknown_kid` → state `invalid` → pelanggan mengaktivasi ulang (data tidak dihapus).

## 5. Kompromi / pencabutan key

1. Hapus kid terkompromi dari `LICENSE_KEYS_DIR` server → server berhenti menandatangani dengannya.
2. Cabut lisensi yang dicurigai lewat admin CLI (`revoke --yes`) — audit otomatis.
3. Hapus kid dari keyset client di build berikutnya (client menolak lease lama).
4. Terbitkan kid pengganti, rotasi sesuai §4.
5. Catat insiden di audit/log; lease yang sudah ditandatangani kid terkompromi tetap berlaku offline sampai `exp` (maksimum `leaseDays + graceDays` = 7 hari) — risiko residual yang diterima dan didokumentasikan.

## 6. Penyimpanan & kontrol akses

- Private key kandidat: `%USERPROFILE%\.icd10-prod-keys\`, ACL `icacls` hanya pemilik + SYSTEM + Administrators, tidak pernah dicetak.
- Backup private key: hanya ke secret store terenkripsi terpisah dari backup database; tidak pernah ke repo/arsitek umum.
- Server produksi: private key di direktori khusus service, pemilik = user service, `0600`.
- Rotasi token admin/support terpisah dari key signing (env server, bukan file di repo).

## 7. Status saat ini

| Item | Status |
|---|---|
| Pemisahan test/candidate/production di build & server | **PASS** (guard test 9/9, trust selftest 17/17) |
| Negative test: test key ditolak build kandidat/produksi | **PASS** |
| Material private key di artefak | **PASS** (tidak ada) |
| Provisioning key produksi final di server tepercaya | **BLOCKED** |
| Rotasi nyata di produksi | **NOT TESTED** (simulasi diuji di trust selftest) |
