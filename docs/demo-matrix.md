# Matriks Fitur: Web Publik vs ICD-10 Codex 2010 (Desktop)

Status: F2 (2026-10-28). Sumber kebenaran: `src/app/page.tsx`, `electron/main.js`.

## Fitur inti

| Fitur | Web publik (GitHub Pages) | Desktop Codex 2010 | Backend (proprietair, rencana) |
|---|---|---|---|
| Jelajah ICD-10 2010 lengkap (22 bab, 274 blok, 11.077 kategori) | Ya | Ya | Ya |
| Pencarian 11.373 entri + sintaks (`*`, `\|`, `&`, `-`) | Ya | Ya | Ya |
| Kamus ID lokal (437 istilah) | Ya | Ya | Ya |
| Modifiers (44) | Ya | Ya | Ya |
| Catatan pribadi (localStorage) | Ya (per browser) | Ya (per mesin, tahan uninstall) | Rencana: sinkron cloud |
| Cetak / print | Ya | Ya | Ya |
| Tema gelap/terang | Ya | Ya | Ya |
| Zoom | Ya | Ya | Ya |
| Lompat antar kode (reference links) | Ya | Ya | Ya |
| Masukan via Google Form | Ya (popup in-app) | Ya (dibuka di browser sistem) | Saluran sendiri |

## Dibatasi / berbeda

| Aspek | Web publik | Desktop Codex 2010 | Backend (rencana) |
|---|---|---|---|
| Terjemahan mesin EN↔ID (Google) | Ya | **Tidak** (gate UA `/Electron\//`, F1) | Rencana: terjemahan offline/lokal |
| Lisensi | Tidak perlu | Aktivasi online, batas device, grace 7 hari (F3) | Terikat lisensi |
| Batasan demo | Rencana F3+: subset data / watermark / batas sesi | Penuh setelah aktivasi | Penuh |
| Watermark RUANGPMIK | Ya | Ya | Ya |

## Keamanan (desktop only)

| Lapis | Status F2 |
|---|---|
| Renderer sandbox + contextIsolation, tanpa Node | Ya (diverifikasi: `nodeExposed=false`) |
| Protokol `app://` (bukan `file://` / port lokal) | Ya (traversal & encoded path ditolak) |
| CSP: `script-src 'self'` + 13 hash SHA-256 (CSP3 2026, hash berkutip) | Ya (diverifikasi: 0 violation, UI penuh) |
| Permission request ditolak semua | Ya |
| Navigasi hanya `app://local/*`; `window.open` hanya WHO/Google Docs | Ya (diverifikasi: EXT-OPEN/EXT-DENY) |
| Fuses: RunAsNode off, node-options off, inspect off, onlyLoadAppFromAsar on, asar integrity on | Ya (diverifikasi `electron-fuses read`) |
| DevTools mati di rilis (menu + F12/Ctrl+Shift+I) | Ya |

## Catatan

- Web dan desktop memakai build `out/` yang sama; perbedaan perilaku hanya
  via gate UA (terjemahan) dan lapisan Electron. Tidak ada build ganda.
- Data kamus identik di kedua platform (SHA-256 tanpa `meta.builtAt`:
  `1c3abdb7…bd57ba`, 437 idTerms).
- Upgrade in-place (Browser → Codex) tidak diuji karena `appId` berubah di F2;
  jalur upgrade versi Codex diuji saat bump versi di F3 (Codex 0.2.0 → 0.3.0 diuji penuh di F4).

## Keputusan demo web F4 (2026-10-28)

**Status: web tetap publik, tanpa gating lisensi.** Keputusan ini eksplisit,
bukan kelalaian.

Alasan:

1. Seluruh konten web adalah data publik (ICD-10 2010 WHO, kamus istilah ID
   internal, modifiers). Tidak ada data proprietary yang dijual di web.
2. Tidak ada fitur web yang bergantung pada server berbayar; lisensi hanya
   mengikat aplikasi desktop.
3. Menyembunyikan tombol/menu bukan kontrol lisensi. Kontrol yang tidak dapat
   ditegakkan di backend tidak dipasang.

Batas demo yang **tidak** diterapkan (dan mengapa):

| Kontrol | Status | Alasan |
|---|---|---|
| Subset data / batas sesi di web | Tidak diterapkan | Data publik; pembatasan tanpa manfaat bisnis dan merusak akses publik |
| Watermark paksa | Tidak diterapkan | Watermark RUANGPMIK sudah ada sebagai atribusi |
| Login/entitlement web | Tidak diterapkan | Tidak ada akun web maupun fitur berbayar |
| Pemeriksaan entitlement di backend untuk fitur web | Tidak relevan | Tidak ada endpoint/fitur proprietary di web |
| Endpoint admin dari web | Tidak ada | Web hanya file statis `out/`; admin API terpisah, tidak diekspos |

Kontrol yang berlaku:

- Build web tidak memuat `license-server`, private key, token admin, atau
  public key produksi (diverifikasi F4: `verify-artifact` pada asar desktop;
  build web `out/` hanya berisi konten + data).
- CSP hash-based, tanpa Node, tanpa IPC di web.
- Terjemahan mesin EN→ID diblokir untuk UA Electron.

Jika kelak ada fitur berbayar (mis. sinkron cloud), kontrol harus berupa
pemeriksaan entitlement di backend — bukan menyembunyikan UI — dan keputusan
ini harus ditinjau ulang.

## Keputusan F5 (2026-10-29)

Keputusan F4 dipertahankan tanpa perubahan: web tetap publik tanpa gating
lisensi; tidak ada fitur proprietary baru di web; tidak ada endpoint server
yang diekspos ke web (web tetap file statis `out/`). Tidak ada pekerjaan
implementasi baru yang diperlukan pada web di F5 — keputusan desain, bukan
hasil pengujian baru.
