// Konfigurasi licensing server — semua lewat environment variable.
// Tidak ada secret di kode. ADMIN token, TLS cert, dan path DB dari env.
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  host: process.env.LICENSE_HOST ?? "127.0.0.1",
  port: Number(process.env.LICENSE_PORT ?? 8443),
  // kid yang dipakai untuk menandatangani lease baru (harus ada di keysDir)
  signingKid: process.env.LICENSE_SIGNING_KID ?? "",
  keysDir: process.env.LICENSE_KEYS_DIR ?? path.join(dir, "keys"),
  dbPath: process.env.LICENSE_DB ?? path.join(dir, "data", "license.db"),
  // Token Bearer untuk endpoint /admin. Kosong = admin dinonaktifkan (503).
  adminToken: process.env.LICENSE_ADMIN_TOKEN ?? "",
  // Token opsional berperan "support": hanya baca + lepas aktivasi.
  // Kosong = tidak ada peran support terpisah.
  supportToken: process.env.LICENSE_SUPPORT_TOKEN ?? "",
  // Masa lease dalam hari (periode validasi offline yang dijamin server).
  // Kebijakan: leaseDays + graceDays klien <= 7 hari (grace maksimum 7 hari
  // sejak validasi sukses). Default 3 + 4.
  leaseDays: Number(process.env.LICENSE_LEASE_DAYS ?? 3),
  // Batas payload request (byte)
  maxPayloadBytes: 64 * 1024,
  // Rate limit durable per IP + identitas tambahan (request/menit).
  // Jendela tetap (fixed window); default 60 detik.
  rateWindowMs: Number(process.env.LICENSE_RATE_WINDOW_MS ?? 60_000),
  rate: {
    activate: Number(process.env.LICENSE_RATE_ACTIVATE ?? 10),
    renew: Number(process.env.LICENSE_RATE_RENEW ?? 30),
    deactivate: Number(process.env.LICENSE_RATE_DEACTIVATE ?? 5),
    admin: Number(process.env.LICENSE_RATE_ADMIN ?? 60),
    // bucket identitas tambahan (bukan hanya IP)
    activateKey: Number(process.env.LICENSE_RATE_ACTIVATE_KEY ?? 5),
    activateInstallation: Number(process.env.LICENSE_RATE_ACTIVATE_INSTALLATION ?? 10),
    renewLicense: Number(process.env.LICENSE_RATE_RENEW_LICENSE ?? 60),
    deactivateLicense: Number(process.env.LICENSE_RATE_DEACTIVATE_LICENSE ?? 5),
    adminRole: Number(process.env.LICENSE_RATE_ADMIN_ROLE ?? 120),
  },
  // HTTPS: hanya aktif jika kedua path sertifikat disediakan.
  // Tanpa TLS server berjalan HTTP dan log peringatan (jangan untuk produksi).
  tlsCert: process.env.LICENSE_TLS_CERT ?? "",
  tlsKey: process.env.LICENSE_TLS_KEY ?? "",
};
