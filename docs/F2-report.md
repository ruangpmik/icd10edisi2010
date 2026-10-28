# Laporan Deliverables F2 — ICD-10 Codex 2010

Tanggal: 2026-10-28 · Branch: `feat/f0-f1-desktop` · Commit F2: `4f105bd`
Artefak: `dist/ICD10-Codex-Setup-0.1.0.exe` (185,8 MB) + `dist/win-unpacked/`

## 1. Commits (F0 → F2)

| Commit | Isi |
|---|---|
| `38097da` | F0: kembalikan 437 istilah kamus ID yang hilang (regresi `09863f7`) |
| `eecf73c` | F0: harness regresi UI `scripts/smoke.mjs` (6 cek) |
| `3abbc37` | F1: Electron 45 + NSIS, protokol `app://`, rename ICD-10 Codex 2010 |
| `4f105bd` | F2: hardening — 0 vuln, CSP hash, permission deny, audit, matriks demo |

## 2. F2-A — Security audit

Sebelum (hasil `npm audit` di `HEAD` F1):

| Cakupan | Hasil | Detail |
|---|---|---|
| Full (termasuk dev) | 3 vulnerabilities (1 moderate, 2 high) | `postcss <=8.5.22` (nested di `next`: GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849) · `xlsx` (npm registry, max 0.18.5: GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9, "no fix available") |
| Production (`--omit=dev`) | 2 vulnerabilities (1 moderate, 1 high) | `postcss` nested di `next` |

Perbaikan (tanpa `audit fix --force` — itu memaksa upgrade `next@16.4.3`, breaking):

- `postcss` dipin `8.5.32` (di atas 8.5.22) via `overrides` + dipindah ke devDependencies (alat build, bukan runtime).
- `xlsx` diganti SheetJS `0.20.3` dari tarball CDN resmi SheetJS (registry npm mentok 0.18.5 yang rentan), **devDependency build-time saja** — tidak masuk asar, tidak di-ship.

Sesudah (diverifikasi ulang 2026-10-28):

| Cakupan | Hasil |
|---|---|
| Full | `found 0 vulnerabilities` |
| Production | `found 0 vulnerabilities` |

Tidak ada kerentanan yang tersisa / tak dapat diperbaiki.

## 3. F2-B — Security review Electron

| Kontrol | Status | Bukti |
|---|---|---|
| `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, tanpa preload/IPC | Ya | `nodeExposed=false` di smoke (dev, packaged, installed) |
| Permission request (geo/camera/dll.) ditolak semua | Ya | `setPermissionRequestHandler` → `cb(false)` |
| `window.open` hanya ke allowlist (icd.who.int, www.who.int, docs.google.com) via browser sistem; lainnya ditolak; `window.open` selalu mengembalikan `null` | Ya | log `EXT-OPEN` / `EXT-DENY`; smoke `noWindowAllowed=true`, `noWindowDenied=true` |
| Navigasi dibatasi `app://local/*` | Ya | `will-navigate` / `setWindowOpenHandler` |
| Protokol `app://` (standard+secure), path traversal & encoded path ditolak | Ya | F1 + re-verify |
| DevTools mati di rilis (menu + F12/Ctrl+Shift+I) | Ya | F1 |
| Fuses | Ya | `electron-fuses read` pada exe baru: RunAsNode **off**, NodeOptionsEnv **off**, NodeCliInspect **off**, OnlyLoadAppFromAsar **on**, EmbeddedAsarIntegrity **on**, GrantFileProtocolExtraPrivileges on (dibutuhkan utk `app://`) |

Bug F1 yang ditemukan dan diperbaiki di F2: export `Shell` (kapital) tidak ada — yang benar `shell`. Main process crash saat `window.open` pertama; hanya terdeteksi karena smoke F2 baru memicu jalur ini.

## 4. F2-C — CSP

- Inline script yang dibutuhkan: 13 (hydration Next `self.__next_f` + next-themes), tersebar di `out/**/*.html`. Isi statis per halaman → cukup hash SHA-256.
- `scripts/csp-hashes.mjs` menghitung 13 hash → `electron/csp-hashes.json`, dijalankan di rantai build (`build` = build-data && next build && obfuscate && csp-hashes). File dikommit agar repo self-consistent.
- **Temuan penting**: CSP3 (W3C WD, 2026-10-27) mengubah sintaks hash-source menjadi **berkutip** — `'sha256-…'` (sama seperti nonce). Chromium 156 (system) dan Chromium Electron 45 menolak format lama tanpa kutip dengan `The source list … contains an invalid source`. Diverifikasi empiris: hash berkutip yang benar → script jalan; hash berkutip yang salah → diblok; nonce juga jalan.
- CSP akhir di `electron/main.js`:

  ```
  default-src 'self';
  script-src 'self' 'sha256-…' ×13;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self' data:; connect-src 'self';
  frame-src https://docs.google.com; object-src 'none';
  base-uri 'none'; form-action 'none'
  ```

- `unsafe-inline` **dihapus** dari `script-src`. Fallback ke `'unsafe-inline'` hanya jika `csp-hashes.json` hilang (mode dev), agar pengembangan tidak patah.
- Hasil: 0 CSP violation di smoke dev, packaged, dan installed (`errors: []`, UI penuh).

## 5. F2-D — Resource integrity

| Item | Hasil |
|---|---|
| `icd10.json` kerja vs `HEAD` (tanpa `meta.builtAt`) | SHA-256 **identik**: `1c3abdb73da0c02300cbd321edbc54b80ad471628a5f5fb12a159b63f0bd57ba` |
| Count entri (HEAD = kerja = asar) | nodes 11.373 · chapters 22 · idTerms 437 · modifiers 44 |
| `out/data/icd10.json` di dalam `app.asar` (paket) | 4.619.120 B; hash tanpa `builtAt` sama (`1c3abdb7…`); full file `14c76474cb55…` (mengikuti `builtAt`, berubah tiap build) |
| `electron/csp-hashes.json` di asar | ada (653 B) |
| `scripts/verify-data.mjs` | cek regresi data vs HEAD, exit 0 |

Pernyataan jujur (sesuai syarat F2): data kamus **tidak dienkripsi**; chunk JS diobfuscate oleh `scripts/obfuscate.mjs`; JSON tetap terbaca di dalam asar. Proteksi konten sesungguhnya datang dari lisensi online (F3), bukan dari pengaburan.

## 6. F2-E — Regresi penuh

| Uji | Hasil |
|---|---|
| `tsc --noEmit` | exit 0 |
| Web smoke `scripts/smoke.mjs` (dev server :3001) | 6/6 PASS |
| Smoke app dev (`ICD10_SMOKE=1 npx electron .`) | `{"idTerms":437,"bodyLen":3168,"chapters":22,"noWindowAllowed":true,"noWindowDenied":true,"nodeExposed":false,"errors":[]}` · EXIT=0 |
| Build `electron-builder --win --x64` | BUILD=0 → `ICD10-Codex-Setup-0.1.0.exe` + `win-unpacked/` |
| Smoke packaged (`win-unpacked`) | payload sama · EXIT=0 · EXT-OPEN/EXT-DENY benar |
| Install ke `C:\icd10test` (silent `/S /D=`) | sukses; smoke installed SMOKE=0, payload sama |
| User data | `%APPDATA%\ICD-10 Codex 2010` terbentuk (Local Storage, Cache, dst.) |
| Uninstall (silent) | 0 file tersisa di dir install; Local Storage leveldb **6 file utuh** (nama + ukuran identik sebelum/setelah) — `deleteAppDataOnUninstall: false` bekerja |
| Upgrade in-place | N/A — `appId` berubah (F1 `ICD-10 2010 Browser` → Codex); jalur upgrade versi Codex diuji saat bump versi di F3 |
| Fuses / ASAR / CSP re-verify | selesai (bagian 3, 4, 5) |
| UI vs baseline F1 | screenshot `smoke-f2.png` cocok dengan `smoke-prod4.png` (22 bab, panel detail, kamus, catatan) |

## 7. F2-F — Matriks fitur demo

Lengkap di [`docs/demo-matrix.md`](demo-matrix.md). Ringkas: web publik dan desktop memakai build `out/` yang sama; terjemahan mesin EN↔ID (Google) hanya di web (gate UA `/Electron\//`); batas demo web direncanakan di F3+; lapisan keamanan desktop terverifikasi (bagian 3–5).

## 8. Risiko tersisa

1. **Tanpa code signing** (keputusan beta). Exe unsigned memicu SmartScreen di mesin pengguna. Wajib diputuskan sebelum distribusi publik: sertifikat OV/EV.
2. **Format hash CSP mengikuti CSP3 2026** (berkutip). Jika Electron/Chromium masa depan mengubah perilaku, hash bisa berhenti berlaku → halaman kosong. Pengaman: smoke cek `bodyLen`/`errors` menangkap halaman kosong; fallback `unsafe-inline` jika file hash hilang. Perubahan format tinggal satu baris di `main.js`.
3. **Rename mengorbankan user data lama**: `%APPDATA%\ICD-10 2010 Browser` tidak dimigrasikan ke `%APPDATA%\ICD-10 Codex 2010` (beta-only, tanpa migrasi).
4. **Jalur upgrade in-place belum diuji** (akibat perubahan `appId`).
5. **Web masih publik penuh**; pembatasan demo (subset data/batas sesi) baru di F3+.
6. **Tanpa anti-debug/anti-reverse-engineering** (ditunda sesuai keputusan F0–F1).
7. `xlsx` 0.20.3 berasal dari tarball CDN resmi SheetJS (bukan registry npm) — dev-only, tidak di-ship; sumber download harus tetap SheetJS.

## 9. Rekomendasi F3

1. **Lisensi online**: token Ed25519 ditandatangani server (private key di server VPS Laragon), binding device, grace offline 7 hari (configurable), mode gagal-aman = read-only (tidak pernah hapus data pengguna).
2. **Bump versi** (0.2.0) + uji jalur upgrade NSIS in-place + migrasi user data jika diperlukan.
3. **Keputusan code signing** sebelum rilis publik.
4. **Batasan demo web** (subset data / watermark / batas sesi).
5. Jalankan ulang suite regresi F2-E penuh sebagai gate F3 (tsc, web smoke, smoke packaged+installed, fuses, verify-data).
