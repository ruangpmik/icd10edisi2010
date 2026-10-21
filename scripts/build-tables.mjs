// Build public/data/neo-index.json (Tabel Neoplasma) dan public/data/drugs-index.json
// (Tabel Obat & Bahan Kimia) dari data/raw/vol3-tables.json — hasil ekstraksi teks PDF
// per halaman dengan posisi x (lihat catatan di build-index.mjs).
//
// Sumber: ICD10-aris.pdf
//   - Tabel Neoplasma          : halaman PDF 1574-1609 (cetak 456-491), 5 kolom kode
//   - Tabel Obat & Bahan Kimia : halaman PDF 1860-1999 (cetak 742-881), 5 kolom kode
//
// Jalankan: node scripts/build-tables.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSee, cleanSee, cleanTerm } from "./see.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "data", "raw", "vol3-tables.json");
const OUT_DIR = path.join(ROOT, "public", "data");

const PAGE_OFFSET = 1118; // halaman PDF -> halaman cetak Vol.3

const TABLES = [
  {
    id: "neo",
    from: 1574,
    to: 1609,
    startPage: 1574, // halaman ini masih berisi indeks alfabet di atas tabel
    startAt: /^Neoplasm,\s*neoplastic/i,
    stopPage: 1609, // tabel berakhir di tengah halaman, indeks alfabet lanjut
    stopAt: /^Neovascularization$/i,
    codeMin: 200,
    offsets: [0, 32, 65, 93, 128],
    meta: {
      title: "Neoplasma menurut lokasi anatomis",
      src: "ICD-10 Volume 3 — Neoplasm (WHO, 2010)",
      pages: "456-491",
      cols: [
        "Maligna, primer",
        "Maligna, sekunder",
        "In situ",
        "Jinak (benign)",
        "Tidak pasti / tidak jelas",
      ],
    },
  },
  {
    id: "drugs",
    from: 1860,
    to: 1999,
    codeMin: 170,
    offsets: [0, 35, 71, 110, 148],
    meta: {
      title: "Obat & bahan kimia",
      src: "ICD-10 Volume 3 — Table of Drugs and Chemicals (WHO, 2010)",
      pages: "742-881",
      cols: [
        "Keracunan (Bab XIX)",
        "Kecelakaan",
        "Menyakiti diri sendiri",
        "Intensi tidak jelas",
        "Efek samping pengobatan",
      ],
    },
  },
];

// Kata yang hanya muncul di baris judul kolom tabel — bukan isi catatan.
const NOTE_HEAD_WORDS = new Set([
  "malignant", "maligna", "in", "situ", "benign", "jinak", "or", "unknown",
  "uncertain", "primary", "secondary", "behaviour", "behavior", "neoplasm",
]);

// Terjemahan catatan pengantar tabel (teks asli tetap disimpan di `en`).
const NOTE_ID = {
  neo: [
    "1. Daftar di bawah memuat nomor kode neoplasma menurut lokasi anatomis. Untuk setiap lokasi ada lima kemungkinan kode sesuai sifat neoplasma: maligna (primer); maligna sekunder; in situ; jinak; atau perilaku tidak pasti/tidak jelas. Deskripsi neoplasma biasanya sudah menunjukkan kolom yang tepat, mis. melanoma maligna kulit, karsinoma in situ serviks uteri, fibroadenoma jinak payudara. Bila deskriptor itu tidak ada, rujuk sisa Indeks yang memberi panduan kolom untuk tiap jenis morfologis (histologis), mis. Mesonephroma — lihat Neoplasma, maligna; Embrioma — lihat juga Neoplasma, perilaku tidak pasti; penyakit Bowen — lihat Neoplasma, kulit, in situ. Panduan Indeks dapat diabaikan bila salah satu deskriptor di atas ada, mis. adenoma maligna kolon dikode C18.9 (bukan D12.6) karena kata \"maligna\" mengesampingkan entri Indeks — lihat juga Neoplasma, jinak.",
    "2. Lokasi bertanda # (mis. wajah NEC #) diklasifikasikan sebagai neoplasma maligna kulit pada lokasi itu bila jenis neoplasmanya karsinoma sel skuamosa atau karsinoma epidermoid, dan sebagai neoplasma jinak kulit pada lokasi itu bila jenis neoplasmanya papiloma (segala jenis).",
    "3. Karsinoma dan adenokarsinoma, segala jenis kecuali intraoseus atau odontogenik, pada lokasi bertanda [<>] (mis. iskium [<>]) dianggap metastatik dari primer tak spesifik dan dikode C79.5.",
  ],
};

const HEADERS = new Set([
  "Poisoning",
  "Adverse",
  "effect in",
  "Intentional",
  "Undetermined",
  "therapeutic",
  "Substance",
  "Chapter XIX Accidental",
  "Self-harm",
  "intent",
  "use",
  "Malignant",
  "In situ",
  "Benign",
  "Uncertain",
  "or unknown",
  "behaviour",
  "Primary Secondary",
]);

const isHeader = (s) =>
  HEADERS.has(s) ||
  HEADERS.has(s.split(/\s{2,}/)[0]) ||
  /^Alphabetical Index Of Diseases/i.test(s) ||
  /^And Nature Of Injury$/i.test(s) ||
  /^WHO.s ICD-10/i.test(s) ||
  /^Table Of Drugs/i.test(s) ||
  /^Section\s+[IVX]+$/i.test(s) ||
  /^\d{1,3}$/.test(s) ||
  /^[A-Z]$/.test(s) ||
  /^____/.test(s) ||
  /^-{3,}/.test(s) ||
  /[-–]{2,}\s*(continued|cont)\s*-*$/i.test(s) ||
  /^Neoplasm, neoplastic\s*[-–]\s*continued/i.test(s);

function tidy(t) {
  return t
    .replace(/[.…]{2,}/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const normCode = (s) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/[.…]+$/, "")
    .trim();

// Petakan item kode (x >= codeMin) ke 5 kolom berdasarkan offset dari kolom pertama.
function mapCodes(codeItems, offsets, c0) {
  const out = [null, null, null, null, null];
  for (const [x, s] of codeItems) {
    let best = -1;
    let bestD = 17; // toleransi geser kolom antar halaman
    offsets.forEach((o, i) => {
      const d = Math.abs(x - (c0 + o));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) continue;
    const v = normCode(s);
    if (!v || v === "-" || out[best]) continue;
    out[best] = v;
  }
  return out;
}

const pages = JSON.parse(fs.readFileSync(SRC, "utf8"));
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const cfg of TABLES) {
  const entries = [];
  let last = null;
  // Catatan pengantar tabel (blok "Note:" sebelum tabel dimulai).
  const notes = [];
  let noteBuf = null;
  const flushNotes = () => {
    if (noteBuf) {
      const text = tidy(noteBuf);
      const parts = text
        .split(/(?=\b\d+\.\s)/)
        .map((s) => s.trim())
        .filter((s) => /^\d+\.\s/.test(s));
      parts.forEach((en, i) =>
        notes.push({ n: i + 1, en, id: NOTE_ID[cfg.id]?.[i] ?? null }),
      );
    }
    noteBuf = null;
  };

  for (const pg of pages) {
    if (pg.p < cfg.from || pg.p > cfg.to) continue;
    const pageNo = pg.p - PAGE_OFFSET;

    // Buang item titik-titik pemisah dan siapkan baris.
    const rows = pg.rows
      .map((r) => r.filter(([, s]) => !/^[.…\s]+$/.test(s)))
      .filter((r) => r.length);

    // Kolom kode pertama di halaman ini (posisi bisa bergeser antar halaman).
    let c0 = Infinity;
    for (const r of rows)
      for (const [x, s] of r) if (x >= cfg.codeMin && !/^[A-Z]$/.test(s)) c0 = Math.min(c0, x);
    if (!Number.isFinite(c0)) c0 = cfg.codeMin + 10;

    // Posisi x awal istilah = x tersering pada baris ber-kode (bukan nilai minimum,
    // karena halaman campuran 1574/1609 masih memuat kolom indeks alfabet).
    const freq = new Map();
    for (const r of rows) {
      const hasCode = r.some(([x, s]) => x >= cfg.codeMin && !/^[A-Z]$/.test(s));
      const first = r.find(([x]) => x < cfg.codeMin);
      if (hasCode && first) freq.set(first[0], (freq.get(first[0]) ?? 0) + 1);
    }
    let baseX = Infinity;
    let bestN = -1;
    for (const [x, n] of freq)
      if (n > bestN || (n === bestN && x < baseX)) {
        bestN = n;
        baseX = x;
      }
    if (!Number.isFinite(baseX))
      baseX = Math.min(
        ...rows.flatMap((r) => r.filter(([x]) => x < cfg.codeMin).map(([x]) => x)),
      );

    let started = pg.p !== cfg.startPage;
    let inNote = false;

    for (const row of rows) {
      const joined = row.map(([, s]) => s).join(" ");

      if (inNote) {
        if (cfg.startAt && cfg.startAt.test(joined)) {
          flushNotes();
          inNote = false;
          continue; // baris pembuka tabel sudah tercatat dari halaman sebelumnya
        } else {
          // Baris judul kolom / garis pemisah bukan bagian catatan.
          const words = joined.toLowerCase().split(/[^a-z]+/).filter(Boolean);
          const headish = words.length > 0 && words.every((w) => NOTE_HEAD_WORDS.has(w));
          if (!isHeader(joined) && !/^_{3,}/.test(joined) && !headish)
            noteBuf = noteBuf ? noteBuf + " " + joined : joined;
          continue;
        }
      }
      if (!started) {
        if (cfg.startAt && cfg.startAt.test(row[0][1])) started = true;
        else continue;
      }
      if (cfg.stopPage === pg.p && cfg.stopAt && cfg.stopAt.test(row[0][1])) break;
      if (/^Note\s*[-–:]/i.test(joined)) {
        inNote = true; // blok catatan pengantar tabel
        continue;
      }

      const textItems = row.filter(([x]) => x < cfg.codeMin);
      const codeItems = row.filter(([x]) => x >= cfg.codeMin);
      if (!textItems.length) continue;
      if (isHeader(textItems[0][1]) || isHeader(joined)) continue;

      const x0 = textItems[0][0];
      let term = textItems[0][1];
      let see = null;

      for (const [, s] of textItems.slice(1)) {
        if (/^[-–—]?\s*see\b/i.test(s)) see = (see ? see + " " : "") + s;
        else term += " " + s;
      }

      const bare = !codeItems.length && !/^[-–]/.test(term);
      const contRow =
        !!last && bare && (x0 > baseX + 1 || last.see === "" || /^\(/.test(term));

      if (contRow) {
        // Lanjutan baris: menempel ke istilah atau ke teks "see".
        if (last.see !== null) last.see = tidy(last.see ? last.see + " " + term : term);
        else {
          // Rujukan di tabel sering terpotong antar baris ("(see also" lalu
          // "Anesthesia)"), jadi cek ulang setelah penggabungan.
          const sp = extractSee(last.t + " " + term);
          last.t = sp.t;
          if (sp.see) last.see = sp.see;
        }
        continue;
      }

      const dash = term.match(/^(?:[-–]\s*)+/);
      const level = dash ? (dash[0].match(/[-–]/g) || []).length : 0;
      let body = dash ? term.slice(dash[0].length) : term;

      // Kode yang menempel di ujung istilah setelah titik-titik (mis. "cavity……… C76.2").
      let glued = null;
      const gm = body.match(/[.…]{3,}\s*([A-Z]\d{2}(?:[.\-]\d{1,2})?)$/);
      if (gm) {
        glued = gm[1];
        body = body.slice(0, gm.index);
      }

      body = tidy(body)
        .replace(/\s*[-–—]$/, "") // sisa pemisah sebelum "see"
        .trim();
      if (!body) continue;

      // Penanda catatan kaki tabel: # (catatan 2), <> (catatan 3).
      let mark = null;
      const mm = body.match(/\s*(?:\[\s*<>\s*\]|<>|#)\s*$/);
      if (mm) {
        mark = mm[0].includes("<") ? "<>" : "#";
        body = body.slice(0, mm.index).trim();
      }
      // Rujukan yang tercetak menyatu dengan istilah: "(see also X)",
      // "… - see X", "… see also X", atau baris yang isinya hanya rujukan.
      const sp = extractSee(body);
      body = sp.t;
      if (sp.see) see = see ? tidy(see + " " + sp.see) : sp.see;
      if (!body) {
        if (see && last) last.see = tidy(last.see ? last.see + " " + see : see);
        continue;
      }

      const codes = mapCodes(codeItems, cfg.offsets, c0);
      if (glued) {
        const slot = codes.findIndex((c) => !c);
        if (slot >= 0) codes[slot] = normCode(glued);
      }

      const e = {
        t: body,
        l: level,
        p: pageNo,
        c: codes,
        see: see ? tidy(see.replace(/^[-–—]\s*/, "").replace(/^see\b\s*(also\s+)?/i, "")) : null,
        mark,
      };
      entries.push(e);
      last = e;
    }
  }

  const clean = entries
    .filter((e) => e.t && !/^continued$/i.test(e.t))
    .map((e) => ({ ...e, t: cleanTerm(e.t), see: cleanSee(e.see) }));
  const out = {
    meta: {
      ...cfg.meta,
      count: clean.length,
      note: "Diekstrak otomatis dari PDF; kolom kode dipetakan berdasarkan posisi x.",
      notes,
      built: new Date().toISOString().slice(0, 10),
    },
    // [istilah, level, halaman, [5 kode], see, penanda catatan (# / <>)]
    entries: clean.map((e) => [e.t, e.l, e.p, e.c, e.see, ...(e.mark ? [e.mark] : [])]),
  };

  const file = path.join(OUT_DIR, `${cfg.id}-index.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  const withCode = clean.filter((e) => e.c.some(Boolean)).length;
  console.log(`${cfg.id}-index.json: ${clean.length} entri (${withCode} ber-kode) — ${kb} KB`);
}
