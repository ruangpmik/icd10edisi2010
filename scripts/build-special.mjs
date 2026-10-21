import fs from "node:fs";
import path from "node:path";

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "raw", "vol3-special.json"), "utf8"));
const byPage = new Map(raw.map((p) => [p.p, p]));

// ---------------------------------------------------------------- Abortion
// Halaman 1136–1137: tabel 4-karakter untuk abortus. Tiga kolom kode
// (x ≈ 227/273/326 di hlm. 1136, 232/278/331 di hlm. 1137) berisi sufiks
// karakter ke-4; baris tanpa kode (mis. "NEC") adalah lanjutan baris di atasnya.
const COLS_ABORT = [
  { x: 227, suffix: ".8", head: "complete or unspecified" },
  { x: 273, suffix: ".3", head: "incomplete" },
  { x: 326, suffix: ".9", head: "subsequent episode (O08)" },
];

const TOL = 2.2;

function rowsOf(items) {
  // Kelompokkan item per baris berdasarkan y (koordinat tampilan, y ke bawah).
  const sorted = [...items].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rows = [];
  for (const it of sorted) {
    const r = rows.find((x) => Math.abs(x.y - it[1]) <= TOL);
    if (r) r.items.push(it);
    else rows.push({ y: it[1], items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a[0] - b[0]);
  return rows.sort((a, b) => a.y - b.y);
}

function buildAbortion() {
  const rows = [];
  const pages = [1136, 1137];
  let started = false;
  let cur = null;

  for (const p of pages) {
    const pg = byPage.get(p);
    if (!pg) throw new Error("halaman tidak ada: " + p);
    for (const r of rowsOf(pg.items)) {
      const text = r.items.map((i) => i[2]).join(" ");
      const first = r.items[0];

      // Mulai dari baris "Abortion" (lead term), berhenti di "Abrami's disease".
      if (!started) {
        if (/^Abortion$/.test(text.trim())) started = true;
        else continue;
      }
      if (/^Abrami/.test(text.trim())) return rows;

      // Kolom kode: item pendek (.8 / .3 / .9 / –) di x ≥ 200.
      const codeItems = r.items.filter((i) => i[0] >= 200 && i[0] <= 400 && /^[.–—-]?\d?$/.test(i[2].trim()) && i[2].trim().length <= 2);
      const termItems = r.items.filter((i) => !codeItems.includes(i));
      const term = termItems.map((i) => i[2]).join(" ").trim();

      // Level = jumlah tanda hubung di awal istilah.
      const dashes = (term.match(/^-+/) ?? [""])[0].length;
      const clean = term.replace(/^-+\s*/, "").trim();

      const cells = ["", "", ""];
      for (const c of codeItems) {
        const t = c[2].trim();
        // Kolom terdekat
        let best = 0;
        for (let k = 1; k < COLS_ABORT.length; k++) {
          if (Math.abs(c[0] - COLS_ABORT[k].x) < Math.abs(c[0] - COLS_ABORT[best].x)) best = k;
        }
        cells[best] = t === "–" || t === "-" || t === "—" ? "–" : t;
      }

      if (!clean) continue;

      // Baris tanpa kode & tanpa tanda hubung = lanjutan istilah sebelumnya.
      if (!codeItems.length && dashes === 0 && cur) {
        cur[0] = `${cur[0]} ${clean}`.replace(/\s+/g, " ").trim();
        continue;
      }

      cur = [clean, dashes, p, cells, null];
      rows.push(cur);
    }
  }
  return rows;
}

// ------------------------------------------------------- Land transport (V01–V99)
// Halaman 1810 dicetak 90°; koordinat di JSON sudah dalam ruang tampilan,
// jadi baris = y dan kolom = x. Label baris di x ≈ 53, kolom mulai x ≈ 178.
const ROW_Y = [205, 218, 230, 244, 257, 272, 286, 300, 314, 328];
const COL_X = [178, 213, 242, 277, 313, 341, 369, 401, 431, 473, 513];
const COL_NAMES = [
  "Pedestrian",
  "Pedal cycle",
  "Two- or three-wheeled motor vehicle",
  "Car (automobile), pick-up truck or van",
  "Heavy transport vehicle or bus (coach)",
  "Other motor vehicle",
  "Railway train or vehicle",
  "Other nonmotor vehicle",
  "Fixed or stationary object",
  "Noncollision",
  "Other or transport accident, unspecified",
];

function buildLand() {
  const pg = byPage.get(1810);
  if (!pg) throw new Error("halaman 1810 tidak ada");

  // Baris: kumpulkan label di x < 170 per y.
  const labelAt = new Map();
  for (const it of pg.items) {
    if (it[0] >= 170) continue;
    const y = ROW_Y.find((v) => Math.abs(v - it[1]) <= 4);
    if (y === undefined) continue;
    if (!labelAt.has(y)) labelAt.set(y, []);
    labelAt.get(y).push(it);
  }

  const rows = [];
  for (const y of ROW_Y) {
    const parts = (labelAt.get(y) ?? []).sort((a, b) => a[0] - b[0]);
    let label = parts.map((p) => p[2]).join(" ").replace(/\s+/g, " ").trim();
    if (!label) continue;

    // "Occupant of" adalah judul grup; anak-anaknya berawalan "- ". Buang
    // tanda hubungnya dan biarkan indentasi level yang menunjukkan hierarki.
    label = label.replace(/^-\s*/, "");

    // "(or animal rider)" kecil di bawah "Pedestrian" → gabungkan.
    if (/^Pedestrian$/.test(label)) {
      const rider = pg.items.find((i) => /animal rider/.test(i[2]) && Math.abs(i[1] - 337.6) < 6 && i[0] < 170);
      if (rider) label = `${label} ${rider[2].trim()}`;
    }

    // Sel: nilai kode (V..) atau tanda "–" per kolom.
    // Sel "Pedestrian × Pedestrian" berisi kode W dalam tanda kurung, mis.
    // "(W51.-)"; sel tetap dipertahankan agar matriks tidak berlubang.
    const cells = COL_X.map((x) => {
      const hit = pg.items.find(
        (i) => i[0] >= 170 && Math.abs(i[0] - x) <= 14 && Math.abs(i[1] - y) <= 6 && /^(\(?[VW]\d|–|—|-)/.test(i[2].trim())
      );
      return hit ? hit[2].trim() : "";
    });

    // "Occupant of" adalah judul grup; sisanya anak dengan awalan "- ".
    const isGroup = /^Occupant of/.test(label);
    rows.push([label, isGroup ? 0 : 1, 692, cells, null, isGroup ? "group" : undefined]);
  }
  return rows;
}

const abort = buildAbortion();
const land = buildLand();

const out = {
  meta: {
    source: "ICD-10 Vol.3 (2010)",
    count: abort.length + land.length,
    tables: 2,
  },
  tables: [
    {
      id: "abortion",
      title: { id: "Abortus — komplikasi kehamilan", en: "Abortion — pregnancy complications" },
      note: {
        id: "Empat karakter keempat: .8 (complete/unspecified), .3 (incomplete), .9 (episode lanjutan O08).",
        en: "Fourth character: .8 (complete/unspecified), .3 (incomplete), .9 (subsequent episode O08).",
      },
      pages: "18-19",
      cols: COLS_ABORT.map((c) => c.head),
      colSuffix: COLS_ABORT.map((c) => c.suffix),
      // Kolom 1–2 memakai aksis 4-karakter bersama O03–O06 (tidak bisa
      // dipetakan ke satu kategori); kolom 3 adalah O08.x yang nyata.
      colBase: ["", "", "O08"],
      families: ["O03", "O04", "O05", "O06", "O08"],
      rows: abort,
    },
    {
      id: "land",
      title: { id: "Kecelakaan lalu lintas (V01–V99)", en: "Transport accidents (V01–V99)" },
      note: {
        id: "Pilih korban (baris) lalu jenis kendaraan/tabrakan (kolom) untuk mendapat kode V.",
        en: "Pick the victim (row), then the vehicle/collision type (column) to get the V code.",
      },
      pages: "692",
      cols: COL_NAMES,
      colSuffix: [],
      colBase: [],
      rows: land,
    },
  ],
};

const dir = path.join(process.cwd(), "public", "data");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "special-tables.json"), JSON.stringify(out));

const coded = (rs) => rs.filter((r) => r[3].some((c) => /\d/.test(c))).length;
console.log(`special-tables.json: ${(fs.statSync(path.join(dir, "special-tables.json")).size / 1024).toFixed(0)} KB`);
console.log(`  abort: ${abort.length} baris (${coded(abort)} ber-kode) — level: ${abort.map((r) => r[1]).join(",")}`);
for (const r of abort.slice(0, 6)) console.log("   ", JSON.stringify(r));
console.log(`  land: ${land.length} baris (${coded(land)} ber-kode)`);
for (const r of land) console.log("   ", r[0], "|", r[3].join(" / "));
