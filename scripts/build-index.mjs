// Build public/data/alpha-index.json (Indeks Alfabet Vol.3 ICD-10 2010) dari
// data/raw/vol3-pages.json — hasil ekstraksi teks PDF per halaman (2 kolom, dengan posisi x).
//
// Sumber: ICD10-aris.pdf, bagian "Alphabetical Index Of Diseases And Nature Of Injury"
// (halaman cetak 11-688). Tabel khusus neoplasma & obat/bahan kimia dibangun
// terpisah oleh scripts/build-tables.mjs. Matriks aborsi 4 karakter belum diimpor.
//
// Jalankan: node scripts/build-index.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSee, cleanSee, cleanTerm } from "./see.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "data", "raw", "vol3-pages.json");
const OUT = path.join(ROOT, "public", "data", "alpha-index.json");

const PAGE_OFFSET = 1118; // halaman PDF -> halaman cetak Vol.3
const SKIP_PDF_PAGES = new Set([1136, 1137]); // tabel matriks aborsi 4 karakter
const INDENT = [3, 24]; // selisih x baris lanjutan terhadap awal entri (4-17 px di PDF)

const CODE = "[A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–]?[†*+]?";
const RANGE = "[A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–][A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–]?[†*+]?";
const CODE_END = new RegExp(`(?:${RANGE}|${CODE})$`);

const isHeader = (s) =>
  /^Alphabetical Index Of Diseases/i.test(s) ||
  /^And Nature Of Injury$/i.test(s) ||
  /^Section\s+[IVX]+$/i.test(s) ||
  /^WHO.s ICD-10/i.test(s) ||
  /^\d{1,3}$/.test(s) ||
  /-{2,}\s*(continued|cont)\s*-*$/i.test(s) ||
  /^-{3,}/.test(s) ||
  /^____/.test(s) ||
  /^[A-Z]$/.test(s) ||
  /^\u2014/.test(s) || // baris catatan berawalan em dash (mis. "— code to F10–F19 ...")
  /^code to\s/i.test(s);

function cleanLine(s) {
  return s
    .replace(/…+/g, " ")
    .replace(/[.]{4,}/g, " ")
    .replace(/\s+([†*+])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tidy(t) {
  return t
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Pisahkan kode di akhir baris (boleh menempel, mis. "hemorrhagicA39.1†").
function splitCode(text) {
  const codes = [];
  let rest = text.trim();
  for (let i = 0; i < 2; i++) {
    const m = rest.match(CODE_END);
    if (!m) break;
    codes.unshift(m[0]);
    rest = rest.slice(0, m.index).trim();
  }
  return { codes, rest };
}

// "- see X" / "- see also X" / "(see also X)" / "see also X"
const splitSee = extractSee;

function joinTerm(prev, next) {
  if (/[-–]$/.test(prev)) return (prev + next).replace(/\s+/g, " ").trim();
  return (prev + " " + next).replace(/\s+/g, " ").trim();
}

const openParens = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;

const pages = JSON.parse(fs.readFileSync(SRC, "utf8"));
const entries = [];

// Kunci lead term tanpa keterangan kurung: "Abortion (complete)" -> "abortion".
const leadKey = (t) =>
  t
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9, ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,$/, "");

let lastLead = ""; // lead term terakhir, untuk mendeteksi kepala ulang setelah tabel

for (const pg of pages) {
  const pageNo = pg.p - PAGE_OFFSET;
  const matrixPage = SKIP_PDF_PAGES.has(pg.p);

  for (const col of [pg.cols[0], pg.cols[1]]) {
    let last = null;
    let entryX = 0;

    for (const [x, raw] of col) {
      // Halaman matriks aborsi (1136-1137) tetap memuat teks indeks di tepi
      // kiri kolom; sel matriks ada di x >= 150.
      if (matrixPage && x >= 150) continue;
      const s = cleanLine(raw);
      if (!s) continue;
      if (isHeader(s)) continue;
      // Penanda pindah halaman yang berdiri sendiri ("continued") bukan bagian
      // istilah, walau barisnya terpotong ke kolom berikut.
      if (last && /^(?:continued|cont\.?)$/i.test(s)) continue;
      if (/^Note\s*[-–:]/i.test(s)) break; // blok catatan tabel di ujung kolom

      const dash = s.match(/^(?:[-–]\s*)+/);
      if (dash) {
        const level = (dash[0].match(/[-–]/g) || []).length;
        const body = s.slice(dash[0].length).trim();
        const { codes, rest } = splitCode(body);
        const { t, see } = splitSee(rest);
        // Baris yang isinya hanya rujukan ("see also X") melanjutkan entri di atasnya.
        if (!t && see) {
          if (last) last.see = tidy(last.see ? joinTerm(last.see, see) : see);
          continue;
        }
        // Di halaman matriks, baris berstrip tanpa kode adalah label baris
        // tabel yang mengulang subterm halaman sebelumnya.
        if (matrixPage && !codes.length && !see) {
          // Simpan sebagai induk sementara (tak dimasukkan): baris lanjutan
          // label ikut tergabung ke sini, bukan ke entri sebelumnya.
          last = { t: tidy(t), c: null, c2: null, l: level, p: pageNo, see };
          continue;
        }
        last = { t: tidy(t), c: codes[0] ?? null, c2: codes[1] ?? null, l: level, p: pageNo, see };
        entries.push(last);
        entryX = x;
        continue;
      }

      const { codes, rest } = splitCode(s);
      const dx = x - entryX;
      const continuation =
        !!last &&
        ((dx >= INDENT[0] && dx <= INDENT[1]) ||
          last.see === "" ||
          (!rest && codes.length > 0) ||
          /^\(/.test(s) || // lanjutan parentetik yang terpotong
          // Baris lanjutan yang terpotong (x bisa > INDENT): dimulai huruf kecil
          // atau baris sebelumnya berakhir dengan tanda hubung/kata sambung.
          (/^[a-z(]/.test(s) || /^(?:NEC|NOS)$/i.test(s) || /[(,;–-]$/.test(last.t) || /\b(?:also|see|and|or|with|of|in|to|by|for|from|the)$/i.test(last.t)));

      if (continuation) {
        if (rest) {
          if (last.see !== null) {
            last.see = last.see ? joinTerm(last.see, rest) : rest;
            last.see = tidy(last.see);
          } else {
            const merged = joinTerm(last.t, rest);
            const sp = splitSee(merged);
            last.t = tidy(sp.t);
            if (sp.see !== null) last.see = sp.see;
          }
        }
        if (codes.length) {
          if (!last.c) {
            last.c = codes[0];
            last.c2 = codes[1] ?? null;
          } else if (!last.c2) last.c2 = codes[0];
        }
        continue;
      }

      const { t, see } = splitSee(rest);
      const term = tidy(t);
      if (!term && see) {
        if (last) last.see = tidy(last.see ? joinTerm(last.see, see) : see);
        continue;
      }
      const key = leadKey(term);
      // Kepala lead term dicetak ulang setelah tabel yang memotongnya
      // ("Abortion" di halaman matriks). Jangan bikin lead ganda.
      if (!codes.length && !see && key && key === lastLead) continue;
      if (key) lastLead = key;
      last = { t: term, c: codes[0] ?? null, c2: codes[1] ?? null, l: 0, p: pageNo, see };
      entries.push(last);
      entryX = x;
    }
  }
}

const clean = entries.filter((e) => e.t && !/^continued$/i.test(e.t));

// Baris "…… continued" / "…… cont." adalah penanda pindah halaman, bukan
// istilah: tak ber-kode, dan diklik tak membuka apa pun. Buang barisnya dan
// gabungkan subterm di bawahnya ke lead term asalnya.
function parseCont(t) {
  // "Febricula (continued)" = istilah asli, bukan penanda halaman.
  if (/\(\s*(?:continued|cont\.)\s*\)/i.test(t)) return null;
  const m = t.match(/^(.*?)[\s\-–—]*\b(?:continued|cont\.)\s*(?:[-–—]+\s*(.*))?$/i);
  if (!m) return null;
  const base = tidy(m[1]).replace(/[\s,;.\-–—]+$/, "");
  if (!base) return null;
  const tail = (m[2] ?? "").trim();
  const dash = tail.match(/^(?:[-–]\s*)+/);
  return {
    base,
    rest: dash ? tail.slice(dash[0].length).trim() : tail,
    level: dash ? (dash[0].match(/[-–]/g) || []).length : 1,
  };
}

const merged = [];
{
  const segByLead = new Map(); // kunci lead -> segmen (array entri)
  let cur = null;
  for (const e of clean) {
    if (e.l !== 0) {
      if (cur) cur.push(e);
      else {
        cur = [e];
        merged.push(cur);
      }
      continue;
    }
    // Header tanpa kode = penanda halaman; header ber-kode hanya bila ia
    // membawa baris istilah di belakangnya ("…… continued - eye, birth injury").
    const cont = e.l === 0 ? parseCont(e.t) : null;
    if (!cont || (!cont.rest && e.c)) {
      cur = [e];
      merged.push(cur);
      const key = leadKey(e.t);
      if (key && !segByLead.has(key)) segByLead.set(key, cur);
      continue;
    }
    // Lead asal: kunci sama, atau salah satu jadi awalan yang lain
    // ("Contraction, contracture" → "Contraction, contracture, contracted").
    const key = leadKey(cont.base);
    let seg = key ? segByLead.get(key) : null;
    if (!seg && key) {
      for (const [k, s] of segByLead) {
        if (k.startsWith(key) || key.startsWith(k)) {
          seg = s;
          break;
        }
      }
    }
    if (!seg) {
      // Tak ada lead asal: jadikan lead biasa dengan nama bersih.
      e.t = tidy(cont.base);
      cur = [e];
      merged.push(cur);
      if (key) segByLead.set(key, cur);
      continue;
    }
    if (cont.rest) seg.push({ ...e, t: tidy(cont.rest), l: cont.level });
    cur = seg;
  }
}

const flat = merged
  .flat()
  .map((e) => ({ ...e, t: cleanTerm(e.t), see: cleanSee(e.see) }));

const out = {
  meta: {
    src: "ICD-10 Volume 3 — Alphabetical Index of Diseases and Nature of Injury (WHO, 2010)",
    pages: "11-688",
    note: "Tabel khusus neoplasma (hlm. 456-491) dan obat & bahan kimia (hlm. 742-881) diimpor terpisah: neo-index.json, drugs-index.json.",
    count: flat.length,
    withCode: flat.filter((e) => e.c).length,
    built: new Date().toISOString().slice(0, 10),
  },
  // [istilah, kode, level, halaman, see, kode2]
  entries: flat.map((e) => [e.t, e.c, e.l, e.p, e.see, e.c2]),
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`alpha-index.json: ${flat.length} entri (${out.meta.withCode} ber-kode) — ${kb} KB`);
