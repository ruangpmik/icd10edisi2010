# F5 — Backup, Restore & Disaster Recovery (Licensing Server)

Status tooling & pengujian lokal: **PASS** (20/20 backup suite + kasus DB korup/tidak tersedia di ops suite). Penerapan pada infrastruktur produksi nyata: **BLOCKED**.

## 1. Tooling aktual

- `license-server/scripts/backup.mjs --db <path> --out <dir> [--keep N]`
  - `VACUUM INTO` → snapshot konsisten **saat server berjalan** (tidak perlu stop service).
  - `PRAGMA integrity_check` sebelum ditulis; sidecar `.sha256` + metadata `.json`.
  - Retensi `--keep`; file parsial dihapus otomatis bila gagal.
- `license-server/scripts/restore-verify.mjs --backup <file> --target <path> [--force]`
  - Verifikasi sidecar SHA-256, salin ke **lokasi terpisah**, `integrity_check` + `quick_check`.
  - Menolak backup terpotong/berubah; menolak menimpa DB aktif tanpa `--force`.
- Bukti: `run-backup-tests.mjs` 20 PASS / 0 FAIL — termasuk restore ke DB terpisah, status `revoked` dipertahankan, renewal pasca-restore, penolakan file rusak, DB aktif tak tersentuh.

## 2. Kebijakan target (di produksi)

| Parameter | Nilai target | Alasan |
|---|---|---|
| Jadwal | Harian (02:00) + sebelum setiap deploy | Kehilangan maksimum 1 hari data aktivasi |
| Retensi | 14 harian + 8 mingguan | Kompromi biaya/risiko |
| RPO | ≤ 24 jam | Data yang bisa hilang: aktivasi < 24 jam terakhir |
| RTO | ≤ 2 jam | Restore + verifikasi + start service |
| Off-site | Salinan terenkripsi ke lokasi kedua (disk/cloud) | Ketahanan bila VPS hilang |
| Drill | Restore uji bulanan ke DB terpisah | Backup yang tak pernah di-restore = belum terbukti |

RPO/RTO di atas adalah target yang diusulkan, bukan hasil pengukuran produksi.

## 3. Aturan keras

1. **Jangan pernah** me-restore menimpa satu-satunya DB aktif; restore selalu ke path terpisah lalu swap.
2. Backup database **tidak mengandung secret**: license key hanya SHA-256 hash, tanpa token admin, tanpa private key.
3. Private key signing **dikelola terpisah** dari backup DB (docs/F5-key-lifecycle.md §6): backup DB tanpa key = tidak bisa memalsukan lisensi; key tanpa DB = lisensi hilang. Keduanya harus ada di rencana pemulihan.
4. Backup file di direktori yang tidak bisa ditulis service (prinsip least privilege).

## 4. Migrasi skema

- Skema dibuat additive (`CREATE TABLE IF NOT EXISTS`); tidak ada migrasi destruktif.
- Restore backup lama ke kode baru aman; kode baru tidak menurunkan skema.
- Bila kelak ada migrasi destruktif: wajib backup penuh + uji restore pada salinan sebelum deploy.

## 5. Prosedur pemulihan layanan (saat infrastruktur tersedia)

1. `systemctl stop icd10-license`.
2. `node scripts/restore-verify.mjs --backup <terbaru> --target /var/lib/icd10-license/restore.db` → exit 0.
3. `integrity_check` lulus → ganti `license.db` (simpan DB rusak untuk forensik).
4. `systemctl start icd10-license` → `healthz` → aktivasi uji dengan lisensi sah.
5. Catat insiden: waktu mati, RPO aktual, akar masalah.

## 6. Status

| Item | Status |
|---|---|
| Backup konsisten saat server hidup | PASS (lokal) |
| Restore ke lingkungan terpisah | PASS (lokal) |
| Penolakan backup rusak / timpa DB aktif | PASS |
| Backup terjadwal + off-site di produksi | **BLOCKED** |
| Restore drill di infrastruktur target | **BLOCKED** |
