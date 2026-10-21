// Build public/data/icd10.json + search-index.json from ClaML XML + Kamus ICD (ID).
// Usage: node scripts/build-data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XML_PATH = path.join(ROOT, "data", "raw", "icd102010en.xml");
const CODES_TXT = path.join(ROOT, "data", "raw", "codes.txt");
const BLOCKS_TXT = path.join(ROOT, "data", "raw", "blocks.txt");
const CHAPTERS_TXT = path.join(ROOT, "data", "raw", "chapters.txt");
const OUT_ICD = path.join(ROOT, "public", "data", "icd10.json");
const OUT_IDX = path.join(ROOT, "public", "data", "search-index.json");

const KAMUS_CANDIDATES = [
  path.join(ROOT, "data", "raw", "Kamus ICD by RIZ.xlsx"),
  "D:\\ACER ASPIRE ONE 722\\D\\PORMIKI (old)\\Pelatihan 2015\\bahan materi aris\\Kamus ICD by RIZ.xlsx",
];

// Synchronous load: try local, then klaimintel's copy (no install needed)
function requireXlsxSync() {
  const req = createRequire(path.join(ROOT, "package.json"));
  const tries = ["xlsx", "C:\\laragon\\www\\klaimintel\\node_modules\\xlsx"];
  for (const p of tries) {
    try {
      return req(p);
    } catch {}
  }
  return null;
}

function cutWord(s, max) {
  if (s.length <= max) return s;
  const sp = s.lastIndexOf(" ", max - 1);
  return (sp > max * 0.5 ? s.slice(0, sp) : s.slice(0, max - 1)).trimEnd() + "…";
}

function tidyProse(s) {
  return s
    .replace(/([A-Za-z]{2,})(\d+\.)/g, "$1 $2") // "Notes1." -> "Notes 1." (min 2 huruf agar kode "T82." aman)
    .replace(/\.([A-ZÀ-Ž])/g, ". $1") // "activity.All" -> "activity. All"
    .replace(/\b([A-Z]) (\d{2,3}(?:\.\d{1,2})?)/g, "$1$2") // "E 27.5"/"C 02.8Overlapping" -> joined
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s) {
  return s
    .replace(/<Reference([^>]*)>([\s\S]*?)<\/Reference>/g, (_, attrs, inner) => {
      const code = /code="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const dagger = /usage="dagger"/.test(attrs) ? " †" : "";
      const aster = /usage="aster"/.test(attrs) ? " *" : "";
      const t = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const core = t + (code && !t.includes(code) ? ` (${code})` : "") + dagger + aster;
      return core ? ` ${core}` : "";
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseClaML(xml) {
  // --- Modifiers: intro + daftar subdivisi + label tiap subdivisi ---
  const modifiers = {}; // code -> {intro, subs:[{c,label,usage}]}
  const modRe = /<Modifier\s+code="([^"]+)"[^>]*>([\s\S]*?)<\/Modifier>/g;
  let mm;
  while ((mm = modRe.exec(xml)) !== null) {
    const [, mcode, minner] = mm;
    const introM = /<Rubric[^>]*>([\s\S]*?)<\/Rubric>/.exec(minner);
    const intro = introM ? cutWord(tidyProse(stripTags(/<Label[^>]*>([\s\S]*?)<\/Label>/.exec(introM[1])?.[1] ?? introM[1])), 500) : "";
    const order = [...minner.matchAll(/<SubClass\s+code="([^"]+)"\s*\/>/g)].map((x) => x[1]);
    modifiers[mcode] = { intro: intro.slice(0, 500), order, subs: [] };
  }
  const mcRe = /<ModifierClass\s+code="([^"]+)"\s+modifier="([^"]+)"([^>]*)>([\s\S]*?)<\/ModifierClass>/g;
  let mc;
  while ((mc = mcRe.exec(xml)) !== null) {
    const [, ccode, mref, attrs, minner] = mc;
    const mod = modifiers[mref];
    if (!mod) continue;
    const labelM = /<Label[^>]*>([\s\S]*?)<\/Label>/.exec(minner);
    const label = stripTags(labelM ? labelM[1] : minner).slice(0, 300);
    const usage = /usage="(dagger|aster)"/.exec(attrs)?.[1] ?? (/usage="(dagger|aster)"/.exec(minner)?.[1] ?? null);
    mod.subs.push({ c: ccode, label, usage });
  }
  // urutkan subs sesuai order SubClass di Modifier
  for (const m of Object.values(modifiers)) {
    const rank = new Map(m.order.map((c, i) => [c, i]));
    m.subs.sort((a, b) => (rank.get(a.c) ?? 99) - (rank.get(b.c) ?? 99));
    delete m.order;
  }

  const nodes = new Map();
  const classRe = /<Class\s+code="([^"]+)"\s+kind="([^"]+)"([^>]*)>([\s\S]*?)<\/Class>/g;
  let m;
  while ((m = classRe.exec(xml)) !== null) {
    const [, code, kind, attrs, inner] = m;
    const parent = /<SuperClass\s+code="([^"]+)"\s*\/>/.exec(inner)?.[1] ?? null;
    const children = [...inner.matchAll(/<SubClass\s+code="([^"]+)"\s*\/>/g)].map((x) => x[1]);
    const rubrics = {};
    const rubRe = /<Rubric[^>]*kind="([^"]+)"[^>]*>([\s\S]*?)<\/Rubric>/g;
    let r;
    while ((r = rubRe.exec(inner)) !== null) {
      const [, rkind, rinner] = r;
      if (rkind === "modifierlink") continue; // di-resolve jadi seksi Subdivisi, bukan teks mentah
      // Pecah per <Para> agar pengantar panjang tampil sebagai beberapa paragraf rapi.
      // Para kelas headingIntro ("Notes", "1. Primary, …") ditandai sebagai subjudul.
      const paras = [];
      const paraRe = /<Para([^>]*)>([\s\S]*?)<\/Para>/g;
      let pm;
      while ((pm = paraRe.exec(rinner)) !== null) paras.push({ attrs: pm[1], html: pm[2] });
      if (paras.length === 0) {
        const labelM = /<Label[^>]*>([\s\S]*?)<\/Label>/.exec(rinner);
        paras.push({ attrs: "", html: labelM ? labelM[1] : rinner });
      }
      for (const p of paras) {
        const text = tidyProse(stripTags(p.html));
        if (!text) continue;
        const val = /headingIntro/.test(p.attrs) ? { t: cutWord(text, 300), h: 1 } : cutWord(text, 1500);
        (rubrics[rkind] ??= []).push(val);
        if ((rubrics[rkind] ?? []).length >= 16) break;
      }
      if (Object.values(rubrics).flat().length > 40) break;
    }
    // Modifier yang berlaku untuk kode ini: <ModifiedBy all="true" code="..."> (+ optional)
    const modRefs = [...inner.matchAll(/<ModifiedBy[^>]*code="([^"]+)"[^>]*>([\s\S]*?)<\/ModifiedBy>/g)].map(
      (x) => ({ code: x[1], optional: /value="optional"/.test(x[2]) })
    );
    // ModifiedBy self-closing tanpa isi
    for (const x of inner.matchAll(/<ModifiedBy[^>]*code="([^"]+)"\s*\/>/g)) {
      if (!modRefs.some((m) => m.code === x[1])) modRefs.push({ code: x[1], optional: false });
    }
    const usage = /usage="(dagger|aster)"/.exec(attrs)?.[1] ?? null; // atribut tag <Class> (A17†, A06.5†, D63.0*)
    nodes.set(code, { code, kind, parent, children, rubrics, usage, modRefs });
  }
  return { nodes, modifiers };
}

function normCode(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/,$/, "")
    .replace(/\.$/, "")
    .replace(",", ".");
}

// Ambil semua kode ICD dari satu sel (atasi koma desimal "I21,9" vs pemisah).
function extractCodes(cell) {
  const s = String(cell ?? "").trim();
  if (!s) return [];
  const parts = s.split(/[;\/|]/).flatMap((p) => p.split(/\s{2,}/));
  const out = [];
  for (const p of parts) {
    const t = p.trim().toUpperCase().replace(/\s+/g, "");
    if (!t) continue;
    // satu kode dengan koma desimal: I21,9 / O47,0 / H35.1,
    if (/^[A-Z]\d{2}[,.]\d{1,2}$/.test(t.replace(/,$/, ""))) {
      out.push(normCode(t));
      continue;
    }
    const toks = t.match(/[A-Z]\d{2}(?:[.,]\d{1,2})?/g) ?? [];
    for (const tk of toks) {
      const n = normCode(tk);
      if (/^[A-Z]\d{2}(\.\d{1,2})?$/.test(n)) out.push(n);
    }
    if (toks.length === 0 && /^[A-Z]\d{2,3}$/.test(t)) out.push(t);
  }
  return [...new Set(out)];
}

function buildIdTerms() {
  const XLSX = requireXlsxSync();
  const terms = {}; // code -> string[]
  const xlsxPath = KAMUS_CANDIDATES.find((p) => fs.existsSync(p));
  if (!XLSX) {
    console.warn("[build] xlsx lib tidak ketemu (lokal maupun klaimintel). ID dilewati.");
    return { terms, xlsxPath: null };
  }
  if (!xlsxPath) {
    console.warn("[build] Kamus xlsx tidak ketemu. ID dilewati.");
    return { terms, xlsxPath: null };
  }
  console.log("[build] kamus:", xlsxPath);
  const wb = XLSX.readFile(xlsxPath, { sheetRows: 200000 });
  const ws = wb.Sheets["ICD10"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  const head = rows[0].map((h) => String(h).toLowerCase());
  const iId = head.findIndex((h) => h.includes("deskripsi icd10"));
  const iCode = head.findIndex((h) => h === "kode icd-10" || h.includes("kode icd-10"));
  console.log("[build] header:", JSON.stringify(rows[0]), "->", { iId, iCode }, "rows:", rows.length);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const codes = [...extractCodes(r[iCode]), ...extractCodes(r[2])];
    const id = String(r[iId] ?? "").trim().replace(/\s+/g, " ");
    if (codes.length === 0 || !id || id.length < 2) continue;
    for (const code of codes) {
      if (!/^[A-Z]\d/.test(code)) continue;
      (terms[code] ??= []);
      const arr = terms[code];
      if (!arr.includes(id) && arr.length < 25) arr.push(id.slice(0, 200));
    }
  }
  console.log("[build] kode ber-ID:", Object.keys(terms).length);
  return { terms, xlsxPath };
}

// ---- Key Knowledge Vol.2: catatan penting per rentang kode (dari ICD10Volume2_en_2010) ----
function stem3(code) {
  return String(code).slice(0, 3).toUpperCase();
}
function inRange(code, a, b) {
  const s = stem3(code);
  return s >= a && s <= b;
}
// [testFn, ref, text]
const KEY_RULES = [
  [(c) => inRange(c, "B20", "B24"), "Vol.2 §4.4.4 Bab I", "Subkategori 4-karakter B20–B23 bersifat opsional (keputusan kebijakan saat implementasi). B22.7 untuk gabungan kondisi B20–B22; subkategori .7 untuk beberapa kondisi dalam satu kategori."],
  [(c) => inRange(c, "B90", "B94"), "Vol.2 §4.4.4 Bab I", "Jangan jadikan kode utama bila sifat kondisi residual tercatat — kodekan kondisi residualnya, B90–B94 sebagai kode tambahan opsional. Bukan untuk infeksi kronis; infeksi aktif dikode ke penyakitnya."],
  [(c) => inRange(c, "B95", "B98"), "Vol.2 §4.4.4 Bab I", "Tidak boleh sebagai kode utama. Hanya kode tambahan opsional untuk mengidentifikasi agen infeksi pada penyakit di bab lain; infeksi tanpa tempat spesifik tetap di Bab I."],
  [(c) => ["C80", "C97"].includes(stem3(c)), "Vol.2 §4.4.4 Bab II", "C80 hanya bila praktisi mencatat neoplasma tanpa spesifikasi lokus. C97 untuk ≥2 primer independen, tidak ada yang predominan; tambah kode individualnya."],
  [(c) => /^C\d\d\.8$/.test(stem3(c) + (String(c).includes(".") ? "." + String(c).split(".")[1] : "")), "Vol.2 §4.4.4 Bab II", "Subkategori .8 = overlapping lesion: tumor melintasi ≥2 lokus berdekatan dalam satu kategori 3-karakter dan titik asal tak dapat ditentukan (mis. C02.8, C26.8)."],
  [(c) => inRange(c, "E10", "E14"), "Vol.2 §4.4.4 Bab IV", "Subkategori .7 hanya bila beberapa komplikasi diabetik tercatat tanpa preferensi; tambah kode tiap komplikasi (mis. E10.2† + N08.3*)."],
  [(c) => stem3(c) === "E34", "Vol.2 §4.4.4 Bab IV", "E34.0 bukan kode utama bila tumor karsinoid tercatat, kecuali perawatan ditujukan ke sindrom endokrinnya."],
  [(c) => inRange(c, "E64", "E64") || stem3(c) === "E68", "Vol.2 §4.4.4 Bab IV", "Sekuele malnutrisi/hiperalimentasi: bukan kode utama bila kondisi residual tercatat; pakai sebagai kode tambahan."],
  [(c) => stem3(c) === "G09", "Vol.2 §4.4.4 Bab VI", "Bukan kode utama bila penyebab kini tercatat. Sekuele G01*, G02*, G05*, G07* dikode ke kategori sekuele kondisi dasarnya (mis. B90–B94), bukan G09."],
  [(c) => inRange(c, "G81", "G83"), "Vol.2 §4.4.4 Bab VI", "Sindrom paralitik: bukan kode utama bila penyebab kini tercatat, kecuali perawatan ditujukan ke paralisisnya."],
  [(c) => stem3(c) === "H54", "Vol.2 §4.4.4 Bab VII", "Gangguan penglihatan termasuk buta: bukan kode utama bila penyebab tercatat, kecuali perawatan ditujukan ke kebutaannya."],
  [(c) => inRange(c, "H90", "H91"), "Vol.2 §4.4.4 Bab VIII", "Gangguan pendengaran: bukan kode utama bila penyebab tercatat, kecuali perawatan ditujukan ke gangguan dengarnya."],
  [(c) => stem3(c) === "I15", "Vol.2 §4.4.4 Bab IX", "Hipertensi sekunder: bukan kode utama bila penyebab tercatat, kecuali perawatan ditujukan ke hipertensinya."],
  [(c) => stem3(c) === "I69", "Vol.2 §4.4.4 Bab IX", "Sekuele serebrovaskular: bukan kode utama bila sifat residual tercatat; kodekan residualnya."],
  [(c) => stem3(c) === "O08", "Vol.2 §4.4.4 Bab XV", "Bukan kode utama kecuali episode baru semata untuk komplikasi (mis. komplikasi abortus sebelumnya). O08.1–O08.9 sebagai tambahan untuk O00–O02/O03–O07; rujuk inclusion terms O08 untuk subkategori O03–O07."],
  [(c) => inRange(c, "O80", "O84"), "Vol.2 §4.4.4 Bab XV", "O80–O84 hanya bila satu-satunya informasi adalah pernyataan persalinan/cara persalinan. Boleh sebagai kode tambahan untuk cara persalinan bila tak ada klasifikasi prosedur terpisah."],
  [(c) => inRange(c, "O30", "O36"), "Vol.2 §4.4.4 Bab XV", "Perhatikan contoh Vol.2: O30.0 kehamilan ganda, O36.4 perawatan maternal untuk kematian janin, O42.9 pecah ketuban dini, O66.3–O66.4 distosia/failed trial."],
  [(c) => stem3(c) === "Z03", "Vol.2 §4.4.2", "Z03 untuk diagnosis suspect yang tersingkir setelah investigasi. Diagnosis 'suspected' yang menetap dikode seolah established."],
  [(c) => ["T90","T91","T92","T93","T94","T95","T96","T97","T98","Y85","Y86","Y87","Y88","Y89","O97"].some((s) => stem3(c) === s), "Vol.2 §4.4.2", "Kode 'Sequelae of…': kode utama yang dipilih adalah sifat sekuele-nya; kode sekuele sebagai tambahan opsional. Tak ada interval waktu minimum ('old', 'late effect' cukup)."],
];
function keyKnowledge(code) {
  const out = [];
  for (const [test, ref, text] of KEY_RULES) {
    try {
      if (test(code)) out.push({ ref, text });
    } catch {}
    if (out.length >= 3) break;
  }
  return out;
}

// ---- QC Vol.2 §3.1.5: sex-limited, asterisk-never-alone, sequelae, postprocedural ----
const MALE_ONLY = ["B26.0","C60-C63","D07.4-D07.6","D17.6","D29.-","D40.-","E29.-","E89.5","F52.4","I86.1","L29.1","N40-N51","Q53-Q55","R86","S31.2-S31.3","Z12.5"];
const FEMALE_ONLY = ["A34","B37.3","C51-C58","C79.6","D06.-","D07.0-D07.3","D25-D28","D39.-","E28.-","E89.4","F52.5","F53.-","I86.3","L29.2","L70.5","M80.0-M80.1","M81.0-M81.1","M83.0","N70-N98","N99.2-N99.3","O00-O99","P54.6","Q50-Q52","R87","S31.4","S37.4-S37.6","T19.2-T19.3","T83.3","Y76.-","Z01.4","Z12.4","Z30.1","Z30.3","Z30.5","Z31.1","Z31.2","Z32-Z36","Z39.-","Z43.7","Z87.5","Z97.5"];
const AST_NEVER_ALONE = ["D63","D77","E35","E90","F00","F02","G01","G02","G05","G07","G13","G22","G26","G32","G46","G53","G55","G59","G63","G73","G94","G99","H03","H06","H13","H19","H22","H28","H32","H36","H42","H45","H48","H58","H62","H67","H75","H82","H94","I32","I39","I41","I43","I52","I68","I79","I98","J17","J91","J99","K23","K67","K77","K87","K93","L14","L45","L54","L62","L86","L99","M01","M03","M07","M09","M14","M36","M49","M63","M68","M73","M82","M90","N08","N16","N22","N29","N33","N37","N51","N74","N77","P75"];
const SEQ_CATS = ["B90-B94","E64.-","E68","G09","I69.-","O97","T90-T98","Y85-Y89"];
const POSTPROC = ["E89.-","G97.-","H59.-","H95.-","I97.-","J95.-","K91.-","M96.-","N99.-"];

function qcMatch(code, entry) {
  const c = String(code).toUpperCase();
  const e = String(entry).replace(/–/g, "-");
  if (e.endsWith(".-")) return stem3(c) === e.slice(0, 3);
  if (e.includes("-")) {
    const [a, b] = e.split("-");
    const pad = (s) => s.replace(".", "").padEnd(4, "0");
    const cn = pad(c);
    return cn >= pad(a) && cn <= pad(b);
  }
  return c === e || c.startsWith(e + ".") || (e.length === 3 && stem3(c) === e);
}
function qcFlags(code) {
  const q = {};
  if (MALE_ONLY.some((e) => qcMatch(code, e))) q.sex = "M";
  else if (FEMALE_ONLY.some((e) => qcMatch(code, e))) q.sex = "F";
  if (AST_NEVER_ALONE.includes(stem3(code))) q.ast = 1;
  if (SEQ_CATS.some((e) => qcMatch(code, e))) q.seq = 1;
  if (POSTPROC.some((e) => qcMatch(code, e))) q.pp = 1;
  return Object.keys(q).length ? q : null;
}

// ---- Scope modifier: rentang kategori berlakunya subdivisi ----
const SCOPE_OVERRIDE = {
  S13M00_5: [["M00", "M25"]],
  S13M40_5: [["M00", "M54"]],
  S13M23_5: [["M23", "M23"]],
  S13M99_5: [["M99", "M99"]],
  I70M10_4: [["I70", "I70"]],
};
const SCOPE_EXCEPT = {
  S13M40_5: ["M50", "M51"],
};
function parseScope(intro, mcode, holders) {
  if (SCOPE_OVERRIDE[mcode]) return { ranges: SCOPE_OVERRIDE[mcode], except: SCOPE_EXCEPT[mcode] ?? [] };
  const ranges = [...intro.matchAll(/([A-Z]\d{2})\s*[–-]\s*([A-Z]\d{2})/g)].map((m) => [m[1], m[2]]);
  const except = [];
  const excM = intro.match(/except([^.]*)/i);
  if (excM) for (const t of excM[1].matchAll(/([A-Z]\d{2}(?:\.\d{1,2})?)/g)) except.push(t[1]);
  if (ranges.length) return { ranges, except };
  const hs = [...new Set(holders.map((h) => stem3(h)))];
  return { ranges: hs.map((s) => [s, s]), except: [] };
}

function parseMeta() {
  const meta = {}; // code -> {lvl, term, aster, disp, title, mort[], morb}
  if (!fs.existsSync(CODES_TXT)) {
    console.warn("[build] codes.txt tidak ada, meta dilewati.");
    return meta;
  }
  const lines = fs.readFileSync(CODES_TXT, "latin1").split(/\r?\n/);
  let nAster = 0;
  for (const ln of lines) {
    if (!ln.trim()) continue;
    // level;term;expl;chap;block;codeRaw;code;nodot;title;mort1..4;morb  (14 kolom)
    const f = ln.split(";");
    if (f.length < 9) continue;
    const [lvl, term, expl, chap, block, raw, code, nodot, title] = f;
    const key = code.trim();
    if (!/^[A-Z0-9]/.test(key)) continue;
    const aster = raw.includes("*");
    if (aster) nAster++;
    meta[key] = {
      lvl: parseInt(lvl, 10) || 0,
      term: term === "T" ? 1 : 0, // T = terminal = valid untuk koding
      aster: aster ? 1 : 0,
      disp: raw.trim(), // mis. A00.- / D63.0*
      title: title.trim().slice(0, 255),
      mort: [f[9] ?? "", f[10] ?? "", f[11] ?? "", f[12] ?? ""].filter((x) => x && x !== "UNDEF"),
      morb: f[13] && f[13] !== "UNDEF" ? f[13] : "",
    };
  }
  const nCh = fs.existsSync(CHAPTERS_TXT) ? fs.readFileSync(CHAPTERS_TXT, "latin1").split(/\r?\n/).filter((l) => l.trim()).length : 0;
  const nBl = fs.existsSync(BLOCKS_TXT) ? fs.readFileSync(BLOCKS_TXT, "latin1").split(/\r?\n/).filter((l) => l.trim()).length : 0;
  console.log("[build] meta codes:", Object.keys(meta).length, "| asterisk:", nAster, "| chapters.txt:", nCh, "| blocks.txt:", nBl);
  return meta;
}

function main() {
  if (!fs.existsSync(XML_PATH)) throw new Error("XML tidak ada: " + XML_PATH);
  console.log("[build] baca XML", (fs.statSync(XML_PATH).size / 1048576).toFixed(2), "MB");
  const xml = fs.readFileSync(XML_PATH, "utf8");
  const { nodes, modifiers } = parseClaML(xml);
  console.log("[build] class terparse:", nodes.size, "| modifier:", Object.keys(modifiers).length);

  const chapters = [...nodes.values()].filter((n) => n.kind === "chapter").map((n) => n.code);
  const blocks = [...nodes.values()].filter((n) => n.kind === "block").length;
  const cats = [...nodes.values()].filter((n) => n.kind === "category").length;

  const { terms: idTerms } = buildIdTerms();
  const codeMeta = parseMeta();

  const obj = {};
  let nMetaHit = 0, nKn = 0, nQc = 0;
  for (const [k, v] of nodes) {
    if (codeMeta[k]) {
      v.meta = codeMeta[k];
      nMetaHit++;
    }
    const kn = keyKnowledge(k);
    if (kn.length) {
      v.kn = kn;
      nKn++;
    }
    const qc = qcFlags(k);
    if (qc) {
      v.qc = qc;
      nQc++;
    }
    obj[k] = v;
  }
  console.log("[build] node ber-meta:", nMetaHit, "/", nodes.size, "| ber-KN:", nKn, "| ber-QC:", nQc);

  // scope tiap modifier dari intro + holder
  const holdersByMod = {};
  for (const [k, v] of nodes) {
    for (const r of v.modRefs ?? []) (holdersByMod[r.code] ??= []).push(k);
  }
  for (const [mc, m] of Object.entries(modifiers)) {
    m.scope = parseScope(m.intro, mc, holdersByMod[mc] ?? []);
  }
  console.log("[build] contoh scope:",
    "S20V01_4=" + JSON.stringify(modifiers.S20V01_4.scope),
    "S13M40_5=" + JSON.stringify(modifiers.S13M40_5.scope),
    "S20W00_4=" + JSON.stringify(modifiers.S20W00_4.scope));

  fs.mkdirSync(path.dirname(OUT_ICD), { recursive: true });
  fs.writeFileSync(
    OUT_ICD,
    JSON.stringify({ meta: { title: "ICD-10 2010 EN+ID", chapters: chapters.length, blocks, categories: cats, builtAt: new Date().toISOString() }, chapters, nodes: obj, idTerms, modifiers })
  );
  console.log("[build] tulis", OUT_ICD, (fs.statSync(OUT_ICD).size / 1048576).toFixed(2), "MB");

  // search index ringan
  const idx = [];
  const rtext = (v) => (typeof v === "string" ? v : v?.t ?? "");
  for (const [code, n] of nodes) {
    const en = rtext(n.rubrics.preferred?.[0] ?? n.rubrics.preferredLong?.[0] ?? "").slice(0, 200);
    const id = (idTerms[code]?.slice(0, 6) ?? []).join(" | ").slice(0, 300);
    idx.push({ c: code, k: n.kind[0], en, id, v: n.meta?.term ?? -1, a: n.meta?.aster ?? 0 });
  }
  fs.writeFileSync(OUT_IDX, JSON.stringify(idx));
  console.log("[build] tulis", OUT_IDX, (fs.statSync(OUT_IDX).size / 1024).toFixed(0), "KB, entri:", idx.length);
}

main();
