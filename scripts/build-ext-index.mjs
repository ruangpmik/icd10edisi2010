// Build public/data/ext-index.json — Section II Vol.3 ICD-10 2010
// ("External Causes Of Injury", halaman cetak 691-740).
//
// Sumber: data/raw/vol3-ext-pages.json (hasil ekstraksi PDF, 2 kolom + posisi x).
// Halaman 1810 (cetak 692) adalah "Table of Land Transport Accidents" (matriks
// lanskap) dan dilewati di sini; matriks itu dibangun oleh scripts/build-matrix.mjs.
//
// Jalankan: node scripts/build-ext-index.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSee, cleanSee, cleanTerm } from "./see.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "data", "raw", "vol3-ext-pages.json");
const OUT = path.join(ROOT, "public", "data", "ext-index.json");

const PAGE_OFFSET = 1118;
const SKIP_PDF_PAGES = new Set([1810]); // matriks lanskap
const INDENT = [3, 45]; // selisih x baris lanjutan (di Section II ada yang 28 px)

const CODE = "[A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–]?[†*+]?";
const RANGE = "[A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–][A-Z]\\d{2}(?:[.\\-–](?:\\d{1,2}|-))?[-–]?[†*+]?";
const CODE_END = new RegExp(`(?:${RANGE}|${CODE})$`);

const isHeader = (s) =>
  /^External Causes Of Injury$/i.test(s) ||
  /^WHO.s ICD-10/i.test(s) ||
  /^\d{1,3}$/.test(s) ||
  /\.{2,}\s*(continued|cont)\s*$/i.test(s) || // "Accident ..Continued"
  /^(?:…+|\.{2,})\s*(continued|cont)\s*$/i.test(s) ||
  /-{2,}\s*(continued|cont)\s*-*$/i.test(s) ||
  /^-{3,}/.test(s) ||
  /^____/.test(s) ||
  /^[A-Z]$/.test(s) ||
  /^\u2014/.test(s) ||
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

function splitCode(text) {
  const codes = [];
  let rest = text.trim();
  for (let i = 0; i < 2; i++) {
    const m = rest.match(CODE_END);
    if (!m) break;
    codes.unshift(m[0]);
    rest = rest.slice(0, m.index).trim();
  }
  // Kode yang "nyelip" di tengah istilah karena urutan teks PDF, mis.
  // "specified V39.8 NEC" atau "ski-lift V98 (chair) (gondola)".
  if (!codes.length) {
    const glued = rest.match(/([A-Z]{2})([VWXY]\d{2}(?:[.\-–](?:\d|-))?)$/);
    if (glued) {
      codes.push(glued[2]);
      rest = rest.slice(0, glued.index + glued[1].length).trim();
    } else {
      const emb = findEmbeddedCode(rest);
      if (emb) {
        codes.push(emb.code);
        rest = (rest.slice(0, emb.at) + " " + rest.slice(emb.at + emb.code.length)).replace(/\s+/g, " ").trim();
      }
    }
  }
  // Kode di ujung baris yang ternyata bagian dari tanda kurung belum tertutup,
  // mis. "(classifiable to W00–" → kode W00– dikembalikan jadi teks.
  if (codes.length && openParens(rest) > 0) {
    rest = (rest + " " + codes.join(" ")).trim();
    codes.length = 0;
  }
  return { codes, rest };
}

// Cari kode V/W/X/Y di luar tanda kurung (depth 0).
function findEmbeddedCode(text) {
  const re = /[VWXY]\d{2}(?:[.\-–](?:\d|-))?/g;
  let depth = 0;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    depth = (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length;
    if (depth !== 0) continue;
    const prev = text[m.index - 1] ?? " ";
    const next = text[m.index + m[0].length] ?? " ";
    if (/[A-Za-z0-9]/.test(prev) || /[A-Za-z0-9]/.test(next)) continue;
    return { code: m[0], at: m.index };
  }
  return null;
}

const openParens = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;

const splitSee = extractSee;

function joinTerm(prev, next) {
  if (/[-–]$/.test(prev)) return (prev + next).replace(/\s+/g, " ").trim();
  return (prev + " " + next).replace(/\s+/g, " ").trim();
}

const pages = JSON.parse(fs.readFileSync(SRC, "utf8"));
const entries = [];

for (const pg of pages) {
  if (SKIP_PDF_PAGES.has(pg.p)) continue;
  const pageNo = pg.p - PAGE_OFFSET;

  for (const col of [pg.cols[0], pg.cols[1]]) {
    let last = null;
    let entryX = 0;

    for (const [x, raw] of col) {
      const s = cleanLine(raw);
      if (!s || isHeader(s)) continue;
      if (/^Note\s*[-–:]/i.test(s)) break;

      const dash = s.match(/^(?:[-–]\s*)+/);
      if (dash) {
        const level = (dash[0].match(/[-–]/g) || []).length;
        const body = s.slice(dash[0].length).trim();
        const { codes, rest } = splitCode(body);
        const { t, see } = splitSee(rest);
        // Baris yang isinya hanya rujukan ("— see X") melanjutkan entri di atasnya.
        if (!t && see) {
          if (last) last.see = tidy(last.see ? joinTerm(last.see, see) : see);
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
          /^\(/.test(s) ||
          (openParens(last.t) > 0 && !dash)); // baris lanjutan yang terpotong tanda kurung

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
      if (!t && see) {
        if (last) last.see = tidy(last.see ? joinTerm(last.see, see) : see);
        continue;
      }
      last = { t: tidy(t), c: codes[0] ?? null, c2: codes[1] ?? null, l: 0, p: pageNo, see };
      entries.push(last);
      entryX = x;
    }
  }
}

const clean = entries
  .filter((e) => e.t && !/^continued$/i.test(e.t))
  .map((e) => ({ ...e, t: cleanTerm(e.t), see: cleanSee(e.see) }));

const out = {
  meta: {
    src: "ICD-10 Volume 3 — Section II: External Causes of Injury (WHO, 2010)",
    pages: "691-740",
    note: "Tabel lalu lintas darat (hlm. 692) diimpor terpisah di special-tables.json.",
    count: clean.length,
    withCode: clean.filter((e) => e.c).length,
    built: new Date().toISOString().slice(0, 10),
  },
  // [istilah, kode, level, halaman, see, kode2]
  entries: clean.map((e) => [e.t, e.c, e.l, e.p, e.see, e.c2]),
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`ext-index.json: ${clean.length} entri (${out.meta.withCode} ber-kode) — ${kb} KB`);
