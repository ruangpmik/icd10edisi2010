// Rate limiter durable berbasis SQLite (node:sqlite) — bertahan setelah restart
// dan konsisten antar proses yang memakai file DB yang sama.
//
// Model: fixed window per (bucket, window_start). Satu statement UPSERT ...
// RETURNING membuat penambahan hit atomik, sehingga request simultan tidak
// dapat melampaui batas.
//
// Kebijakan saat penyimpanan gagal: FAIL-OPEN. Alasannya: lisensi harus tetap
// dapat divalidasi ketika tabel rate limit bermasalah (availability), sementara
// brute force license key 100-bit tidak realistis. Kegagalan ditandai lewat
// hasil `degraded` agar pemanggil mencatatnya di audit, bukan ditelan diam-diam.

const DEFAULTS = { windowMs: 60_000, cleanupEveryMs: 600_000, retentionMs: 3_600_000 };

export function createRateLimiter(db, opts = {}) {
  const { windowMs, cleanupEveryMs, retentionMs } = { ...DEFAULTS, ...opts };
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket       TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count        INTEGER NOT NULL,
      PRIMARY KEY (bucket, window_start)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits(window_start);
  `);

  const hitStmt = db.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  );
  const cleanupStmt = db.prepare("DELETE FROM rate_limits WHERE window_start < ?");
  let lastCleanup = 0;

  // Mengembalikan { allowed, count, limit, retryAfterSec, degraded }.
  function hit(bucket, limit, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    let row;
    try {
      row = hitStmt.get(bucket, windowStart);
    } catch (e) {
      return { allowed: true, degraded: true, error: e?.message ?? "rate_store_error" };
    }
    if (now - lastCleanup > cleanupEveryMs) {
      lastCleanup = now;
      try {
        cleanupStmt.run(windowStart - retentionMs);
      } catch {
        // pembersihan bersifat upaya terbaik; kegagalan tidak memblokir request
      }
    }
    const count = row?.count ?? 1;
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSec: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
    };
  }

  return { hit, windowMs };
}

// Cek beberapa bucket sekaligus. Semua bucket tetap dihitung (agar penyerang
// tidak mendapat "jatah" gratis), hasil gagal bila ada satu yang terlampaui.
export function enforce(limiter, buckets) {
  let denied = null;
  let degraded = false;
  let retryAfterSec = 0;
  for (const [bucket, limit] of buckets) {
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const r = limiter.hit(bucket, limit);
    if (r.degraded) degraded = true;
    if (!r.allowed && !denied) {
      denied = bucket;
      retryAfterSec = r.retryAfterSec;
    }
  }
  return { ok: !denied, deniedBucket: denied, retryAfterSec: retryAfterSec || 60, degraded };
}