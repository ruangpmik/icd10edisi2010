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
  jalur upgrade versi Codex diuji saat bump versi di F3.
