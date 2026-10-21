// Tabel khusus Volume 3 — Neoplasma & Obat/Bahan Kimia.
// Data: public/data/neo-index.json dan public/data/drugs-index.json
// (dibuat oleh scripts/build-tables.mjs).

import { normTerm } from "./alpha";

/** [istilah, level, halaman cetak, 5 kode kolom, see, penanda catatan (# / <>)] */
export type TableEntry = [string, number, number, (string | null)[], string | null, string?];

export interface TableNote {
  n: number;
  en: string;
  id: string | null;
}

export interface TableIndex {
  meta: {
    title: string;
    src: string;
    pages: string;
    cols: string[];
    count: number;
    note: string;
    notes?: TableNote[];
    built: string;
  };
  entries: TableEntry[];
}

export interface TableBrowse {
  rows: Record<string, number[]>;
  counts: Record<string, number>;
}

/**
 * Kelompokkan entri tabel per huruf. `leadLevel` = tingkat "induk" tabel
 * (0 untuk obat, 1 untuk neoplasma karena seluruh tabel bernaung di bawah
 * satu istilah "Neoplasm, neoplastic" — entri level 0 itu sendiri ikut
 * dimasukkan agar baris kepalanya bisa dicari dan dijelajahi).
 */
export function tableBrowse(entries: TableEntry[], leadLevel = 0): TableBrowse {
  const rows: Record<string, number[]> = {};
  const counts: Record<string, number> = {};
  let cur = "";

  for (let i = 0; i < entries.length; i++) {
    const [term, level] = entries[i];
    if (level <= leadLevel) {
      const L = (normTerm(term)[0] ?? "").toUpperCase();
      if (!/^[A-Z]$/.test(L)) {
        cur = "";
        continue;
      }
      cur = L;
      counts[L] = (counts[L] ?? 0) + 1;
      (rows[L] ??= []).push(i);
    } else if (level > leadLevel && cur) {
      (rows[cur] ??= []).push(i);
    }
  }

  return { rows, counts };
}

/** Kode tabel sering berakhiran ".-" (mis. X40.-) — buang untuk navigasi. */
export const navCode = (c: string) => c.replace(/[.\-–—]+$/, "").trim();
