# F5 — Windows Code Signing

Status: **BLOCKED** — tidak ada sertifikat code signing tepercaya, tidak ada `.pfx`/token, `signtool.exe` belum terpasang (Windows SDK tidak ada), anggaran belum disetujui. Artefak rilis saat ini **unsigned** dan hanya layak beta terbatas/internal.

## 1. Mengapa perlu

Windows SmartScreen/antivirus memperingatkan file unsigned; identitas publisher tidak dapat diverifikasi; reputasi tidak terkumpul. Untuk distribusi komersial luas, signing adalah syarat, bukan opsional.

## 2. Perbedaan opsi

| Opsi | Efek di Windows | Dipakai? |
|---|---|---|
| Sertifikat CA tepercaya (OV/EV) | Publisher terverifikasi; EV langsung mengurangi SmartScreen warning | **Target F5** (BLOCKED) |
| Sertifikat self-signed | Tidak dipercaya client lain; hanya berguna untuk uji internal | Hanya uji internal, tidak pernah dilabeli "signed" |
| Unsigned | SmartScreen warning; verifikasi hanya via SHA-256 dari kanal resmi | Status saat ini |

Larangan: jangan membuat sertifikat lokal lalu mengklaim "ditandatangani penerbit tepercaya"; jangan menonaktifkan SmartScreen/antivirus; jangan mengunduh signing tool dari sumber tidak resmi (gunakan Windows SDK resmi).

## 3. Prasyarat resmi (saat sertifikat tersedia)

1. Sertifikat code signing dari CA (OV: file `.pfx` + password; EV: hardware token/HSM dengan driver).
2. Windows SDK → `signtool.exe` (jangan unduh binary terpisah tidak resmi).
3. `electron-builder` sudah mendukung signing via env:
   - `CSC_LINK` (path `.pfx` atau URL) + `CSC_KEY_PASSWORD`, atau
   - `win.certificateSubjectName` bila sertifikat ada di certificate store mesin build (EV token).
4. Timestamp server: `http://timestamp.digicert.com` (atau CA terkait) agar signature tetap valid setelah sertifikat kadaluarsa.

## 4. Prosedur penandatanganan (saat tersedia)

1. Build kandidat dari tree bersih (`npm run build:desktop` untuk produksi final).
2. Set `CSC_LINK` + `CSC_KEY_PASSWORD` di environment sesi build (bukan di repo/`.env` yang di-commit).
3. `electron-builder --win --x64` — installer NSIS dan `ICD-10 Codex 2010.exe` ditandatangani otomatis (konfigurasi `win.signAndEditExecutable` default).
4. Verifikasi:
   - `signtool verify /pa /v /all "dist\ICD10-Codex-Setup-<ver>.exe"`
   - PowerShell: `Get-AuthenticodeSignature "...\ICD-10 Codex 2010.exe" | Format-List Status,StatusMessage,SignerCertificate`
   - Status wajib `Valid`; publisher cocok dengan identitas sertifikat.
5. Catat SHA-256 artefak **ter-sign** di metadata rilis (hash berubah setelah signing).
6. Uji unduhan + instalasi di mesin bersih: SmartScreen tidak memblokir (EV) atau menampilkan publisher (OV setelah reputasi).

## 5. Perlindungan private key signing

- EV: private key tidak pernah keluar dari token/HSM — pilihan utama.
- OV `.pfx`: simpan di secret store terenkripsi; ACL ketat; **tidak pernah** di repo, asar, installer, CI log, atau email.
- Mesin build = mesin tepercaya; password tidak masuk skrip yang di-commit.

## 6. Pembaruan, rotasi, pencabutan

- Sertifikat kadaluarsa: rilis baru ditandatangani dengan sertifikat baru; timestamp menjaga signature lama tetap valid.
- Sertifikat dicabut/kompromi: cabut via CA, rilis installer baru, publikasikan hash baru di kanal resmi, instruksikan pengguna memverifikasi publisher.
- Ganti publisher identity → dokumentasikan di metadata rilis.

## 7. Checklist rilis (berlaku juga untuk unsigned)

- [ ] Artefak yang didistribusikan = artefak yang diuji (SHA-256 sama).
- [ ] SHA-256 dipublikasikan di kanal resmi terpisah dari file installer.
- [ ] Status signature dicatat eksplisit (`unsigned` / `signed: <publisher>`).
- [ ] Instruksi pengguna: verifikasi hash; tidak ada instruksi menonaktifkan proteksi Windows.

## 8. Status saat ini

| Item | Status |
|---|---|
| Prosedur & konfigurasi siap | **PASS** (didokumentasikan; electron-builder mendukung) |
| Sertifikat tepercaya | **BLOCKED** |
| Signing + verifikasi nyata | **BLOCKED** |
| Artefak saat ini | **UNSIGNED** — beta terbatas/internal saja |
