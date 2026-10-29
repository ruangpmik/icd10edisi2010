# F6 — Operasional, Monitoring & Pemulihan

Status: mekanisme disiapkan & didokumentasikan; **belum dikonfigurasi/uji di server produksi** (BLOCKED). Bagian ini melengkapi `docs/F5-deployment-runbook.md` §8 dan `docs/F5-backup-dr.md`.

## 1. Monitoring

| Sinyal | Cara | Ambang/aksi |
|---|---|---|
| Kesehatan API | `GET /healthz` → `{"ok":true,"db":"ok"}` | Poll tiap 1–5 menit (uptime snitch/systemd timer); alert bila gagal ≥ 3× |
| Error rate | journald: hitung log `server_error` / 5xx | Alert bila > ambang per jam |
| Storage | `df` + ukuran `license.db`-wal | Alert bila disk > 80% atau WAL tumbuh tidak wajar |
| Backup | `backup.mjs` exit code ≠ 0 | Cron mengirim notifikasi bila gagal |
| Sertifikat TLS | Caddy/nginx+`certbot renew` dry-run | Alert bila < 14 hari kadaluarsa |

Contoh probe (loopback di server — BUKAN pengganti uji eksternal):

```
curl -fsS --retry 3 https://<domain-lisensi>/healthz || exit 1
```

## 2. Verifikasi eksternal berkala

`node license-server/scripts/external-verify.mjs --base https://<domain-lisensi> --key <key-uji> --keyset electron/keysets/production.public-keys.json [--admin-token ...] [--rate-burst 12]`

Dijalankan dari jaringan terpisah. Mencakup: resolusi DNS, validasi TLS penuh (rantai + hostname, `rejectUnauthorized` default), healthz, penolakan admin tanpa token, aktivasi + verifikasi signature lease, renewal, deactivation, rate limit, anti-kebocoran di error response. Exit 0 = semua PASS. Tidak mencetak key/token lengkap.

## 3. Restart & crash recovery

- `systemctl restart icd10-license`; unit `Restart=on-failure`, `RestartSec=3`.
- DB WAL + `CREATE TABLE IF NOT EXISTS` → restart aman tanpa migrasi.
- Setelah crash: cek `journalctl -u icd10-license` tidak memuat secret, `healthz` pulih, aktivasi uji lulus.

## 4. Private key dicurigai bocor

Lihat `docs/F5-key-lifecycle.md` §5: hapus kid terkompromi dari `LICENSE_KEYS_DIR`, cabut lisensi terkait, hapus kid dari trust store client build berikutnya, terbitkan key pengganti. Jangan dipakai lagi. Catat insiden auditable.

## 5. Rotasi key

`docs/F5-key-lifecycle.md` §4 (dual-trust window tanpa memutus pelanggan sah).

## 6. Rollback deployment

`docs/F5-deployment-runbook.md` §7 (backup → deploy versi baru → healthz; rollback = kembalikan direktori lama; skema DB additive).

## 7. Ketika licensing API tidak tersedia

Perilaku client (diverifikasi `electron/test/run-client-tests.cjs`, 18/18):

- Timeout / HTTP 5xx / `rate_limited` → **dipertahankan sebagai gangguan jaringan**, state aktif/grace tidak berubah; lisensi tidak dicabut oleh satu timeout.
- Grace = `exp + graceDays` (kontrak); tidak diperpanjang oleh kegagalan renew berulang.
- Koneksi pulih → renew otomatis → aktif kembali.
- Deactivate saat offline → slot dilepas lokal; tidak mengunci perangkat.
- Data lokal (`license.json`, `installation.json`) tidak pernah dihapus.

## 8. Batasan operasional

- Single-instance SQLite; tidak di-HA. Rate limiter durable untuk proses yang berbagi DB file yang sama.
- Fail-open rate limit saat store bermasalah (tercatat `rate_store_error`) — belum ada alerting terpisah.
- Satu token per peran admin; rotasi manual; tanpa 2FA.