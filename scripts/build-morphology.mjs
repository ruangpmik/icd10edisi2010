// Bangun daftar morfologi neoplasma (ICD-O) dari Volume 1, hlm. 1066–1084.
// Tiap baris cetak: kode di kolom kiri, istilah di kolom kanan. Baris tanpa kode
// adalah lanjutan istilah baris sebelumnya (dibungkus antar-kolom).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const req = createRequire("C:\\laragon\\www\\klaimintel\\package.json");
const pdfjs = await import(pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

const PDF = "data/raw/ICD10-aris.pdf";
const OUT = "public/data/morphology.json";
const FROM = 1066;
const TO = 1084;

const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(PDF)), useSystemFonts: true }).promise;

const groups = [];
const entries = [];
let last = null;
for (let p = FROM; p <= TO; p++) {
  const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str.trim());
  const rows = new Map();
  for (const it of items) {
    const y = Math.round(it.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const cells = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
    const left = cells[0].str.trim();
    const rest = cells
      .slice(1)
      .map((c) => c.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^(Version for 2010|WHO.s ICD-10|\d+|Coded nomenclature)/.test(left)) continue;
    const ent = /^(M\d{4}\/\d)\s*(.*)$/.exec(left);
    if (ent) {
      last = { c: ent[1], t: (ent[2] + " " + rest).replace(/\s+/g, " ").trim() };
      entries.push(last);
      continue;
    }
    const grp = /^(M\d{3}(?:[–-]M\d{3})?)\s*(.*)$/.exec(left);
    if (grp) {
      groups.push({ c: grp[1].replace("-", "–"), t: (grp[2] + " " + rest).replace(/\s+/g, " ").trim() });
      last = null;
      continue;
    }
    // lanjutan istilah baris sebelumnya
    if (last) last.t = (last.t + " " + (left + " " + rest)).replace(/\s+/g, " ").trim();
  }
}

const behaviours = [
  { b: "0", id: "Jinak", en: "Benign neoplasms", cats: "D10–D36" },
  { b: "1", id: "Belum pasti / batas", en: "Neoplasms of uncertain and unknown behaviour", cats: "D37–D48" },
  { b: "2", id: "In situ", en: "In situ neoplasms", cats: "D00–D09" },
  { b: "3", id: "Ganas primer", en: "Malignant neoplasms, stated or presumed to be primary", cats: "C00–C76, C80–C96" },
  { b: "6", id: "Ganas sekunder (metastatik)", en: "Malignant neoplasms, stated or presumed to be secondary", cats: "C77–C79" },
];

const data = {
  meta: { source: "WHO ICD-10 Volume 1 (2010), Morphology of neoplasms", pdfPages: `${FROM}–${TO}`, builtAt: new Date().toISOString() },
  behaviours,
  groups,
  entries,
};
await writeFile(OUT, JSON.stringify(data));
console.log("groups", groups.length, "entries", entries.length);
console.log(entries.slice(0, 3), entries.slice(-3));
console.log("no-term", entries.filter((e) => !e.t || e.t.length < 3).length);
