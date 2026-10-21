// Tabel matriks Volume 3 — Abortus (hlm. 18–19) & Kecelakaan lalu lintas
// darat (hlm. 692). Data: public/data/special-tables.json
// (dibuat oleh scripts/build-special.mjs).
//
// Baris: [istilah, level, halaman cetak, sel per kolom, see, penanda?]
// Level 0 = istilah induk; level 1 = sub-induk ("- complicated (by)" /
// "- car (automobile)"); level 2+ = rincian.

import { navCode } from "./tables";

export type SpecialRow = [string, number, number, (string | null)[], string | null, string?];

export interface SpecialTable {
  id: string;
  title: { id: string; en: string };
  note: { id: string; en: string };
  pages: string;
  cols: string[];
  /** Sufiks 4-karakter yang diwakili tiap kolom (tabel abortus). */
  colSuffix: string[];
  /** Awalan kode untuk kolom bersufiks; "" = tidak dapat dipetakan ke satu kode. */
  colBase: string[];
  /** Kode kategori yang dapat diklik (mis. O03–O06 untuk tabel abortus). */
  families?: string[];
  rows: SpecialRow[];
}

export interface SpecialFile {
  meta: { source: string; count: number; tables: number };
  tables: SpecialTable[];
}

/**
 * Sasaran navigasi sebuah sel.
 * - Kode utuh ("V03.-", "(W51.-)") → kode tanpa akhiran tanda hubung/titik.
 * - Sufiks (".8") hanya bisa dipetakan bila kolom punya `colBase` (O08.8).
 * - "–" dan sel kosong tidak dapat diklik.
 */
export function cellTarget(table: SpecialTable, cell: string | null, ci: number): string | null {
  const raw = (cell ?? "").trim();
  if (!raw || /^[–—-]+$/.test(raw)) return null;

  if (raw.startsWith(".")) {
    const base = table.colBase[ci];
    return base ? base + raw : null;
  }
  const bare = raw.replace(/^\(/, "").replace(/\)$/, "").trim();
  return /^[A-Z]\d/.test(bare) ? navCode(bare) : null;
}
