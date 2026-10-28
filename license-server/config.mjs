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
  // Masa lease dalam hari (periode validasi offline yang dijamin server).
  // Kebijakan: leaseDays + graceDays klien <= 7 hari (grace maksimum 7 hari
  // sejak validasi sukses). Default 3 + 4.
  leaseDays: Number(process.env.LICENSE_LEASE_DAYS ?? 3),
  // Batas payload request (byte)
  maxPayloadBytes: 64 * 1024,
  // Rate limit per IP (request/menit)
  rate: {
    activate: Number(process.env.LICENSE_RATE_ACTIVATE ?? 10),
    renew: Number(process.env.LICENSE_RATE_RENEW ?? 30),
    deactivate: Number(process.env.LICENSE_RATE_DEACTIVATE ?? 5),
    admin: Number(process.env.LICENSE_RATE_ADMIN ?? 60),
  },
  // HTTPS: hanya aktif jika kedua path sertifikat disediakan.
  // Tanpa TLS server berjalan HTTP dan log peringatan (jangan untuk produksi).
  tlsCert: process.env.LICENSE_TLS_CERT ?? "",
  tlsKey: process.env.LICENSE_TLS_KEY ?? "",
};
