// Skema database licensing (node:sqlite bawaan Node >= 22.5 — tanpa dependensi).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- Metadata lisensi. License key mentah TIDAK disimpan; hanya hash SHA-256.
    CREATE TABLE IF NOT EXISTS licenses (
      id              TEXT PRIMARY KEY,          -- uuid
      key_hash        TEXT NOT NULL UNIQUE,      -- sha256 hex license key
      features        TEXT NOT NULL DEFAULT '["full"]',
      max_activations INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'active',  -- active|disabled|revoked
      expires_at      TEXT,                      -- ISO-8601 atau NULL = permanen
      note            TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Aktivasi perangkat per lisensi. installation_id = uuid acak per instalasi
    -- (bukan fingerprint perangkat).
    CREATE TABLE IF NOT EXISTS activations (
      id              TEXT PRIMARY KEY,          -- uuid
      license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      installation_id TEXT NOT NULL,             -- uuid v4 dari client
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at    TEXT,
      UNIQUE (license_id, installation_id)
    );

    -- Audit log. Tidak pernah berisi license key mentah / token / secret.
    CREATE TABLE IF NOT EXISTS audit (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      license_id    TEXT,
      activation_id TEXT,
      event         TEXT NOT NULL,
      ip            TEXT,
      detail        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
    CREATE INDEX IF NOT EXISTS idx_audit_license ON audit(license_id, id);
  `);
  return db;
}
