// Indeks Alfabet Vol.3 — tipe data + pencarian.
// Data: public/data/alpha-index.json (dibuat oleh scripts/build-index.mjs).

/** [istilah, kode, level, halaman cetak, see, kode2] */
export type AlphaEntry = [string, string | null, number, number, string | null, string | null];

export interface AlphaIndex {
  meta: { src: string; pages: string; note: string; count: number; withCode: number; built: string };
  entries: AlphaEntry[];
}

export const ALPHA_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Huruf kecil, tanpa diakritik — untuk pencocokan. */
export function normTerm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/(?<=[a-z0-9])-(?=[a-z0-9])/g, ""); // "Glomerulo-nephritis" = "Glomerulonephritis"
}

export interface BrowseData {
  /** huruf -> indeks baris (lead term + seluruh subterm, semua tingkat) */
  rows: Record<string, number[]>;
  /** huruf -> jumlah lead term */
  counts: Record<string, number>;
}

/**
 * Susun daftar jelajah per huruf. Entri indeks tidak urut murni alfabetis
 * (subterm mengikuti lead term-nya), jadi dikelompokkan menurut lead term.
 * Semua tingkat subterm ikut ditampilkan (indentasi diatur oleh pemanggil),
 * supaya sub-subterm seperti "- - chemical (weapons)" tidak hilang.
 */
export function indexBrowse(entries: AlphaEntry[]): BrowseData {
  const rows: Record<string, number[]> = {};
  const counts: Record<string, number> = {};
  let leadLetter = "";

  for (let i = 0; i < entries.length; i++) {
    const level = entries[i][2];
    if (level === 0) {
      leadLetter = (normTerm(entries[i][0])[0] ?? "").toUpperCase();
      if (!leadLetter) continue;
      counts[leadLetter] = (counts[leadLetter] ?? 0) + 1;
      (rows[leadLetter] ??= []).push(i);
    } else if (level > 0 && leadLetter) {
      (rows[leadLetter] ??= []).push(i);
    }
  }

  return { rows, counts };
}

/** Cari entri yang memuat semua token kueri (AND). Urut: awalan, panjang, lalu urutan alfabet. */
export function searchAlpha(norms: string[], query: string, limit = 200): { hits: number[]; total: number } {
  const q = normTerm(query.trim());
  if (q.length < 2) return { hits: [], total: 0 };
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits: number[] = [];

  for (let i = 0; i < norms.length; i++) {
    const s = norms[i];
    let ok = true;
    for (const tk of tokens) {
      if (!s.includes(tk)) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }

  // Kueri berangka hampir selalu kode ("C80.9"). Panjang teks tak lagi
  // menentukan mutu di situ, jadi urutan tabel (indeks entri) yang dipakai —
  // baris kepala tabel jadi hasil pertama.
  const byCode = /\d/.test(q);
  hits.sort((a, b) => {
    const sa = norms[a];
    const sb = norms[b];
    const pa = sa.startsWith(q) ? 0 : 1;
    const pb = sb.startsWith(q) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (!byCode && sa.length !== sb.length) return sa.length - sb.length;
    return a - b;
  });

  return { hits: hits.slice(0, limit), total: hits.length };
}

/** Jalur induk (maks. 2 tingkat) untuk baris terpilih — satu lintasan atas seluruh entri. */export function buildPaths(entries: AlphaEntry[], wanted: Set<number>): Map<number, string> {
  const paths = new Map<number, string>();
  if (wanted.size === 0) return paths;
  const stack: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const level = entries[i][2];
    if (stack.length > level) stack.length = level;
    if (wanted.has(i) && level > 0) {
      const from = Math.max(0, level - 2);
      const parts = stack.slice(from, level).filter(Boolean);
      if (parts.length) paths.set(i, parts.join(" › "));
    }
    stack[level] = entries[i][0];
  }

  return paths;
}

/** Pecah target rujukan "Induk, sub, sub-sub" pada koma di luar tanda kurung. */
export function splitSeeTarget(target: string): string[] {
  const s = target.trim().replace(/^[-–—]\s*/, "");
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

/** Istilah tanpa keterangan dalam kurung: "Aneurysm (anastomotic) (artery)" -> "aneurysm". */
function termKey(t: string): string {
  return normTerm(t)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,;.\-–]+$/, "")
    .trim();
}

/**
 * Cari entri yang dituju sebuah rujukan "lihat: …". Rujukan berupa jalur
 * ("Neoplasm, sinus", "Aneurysm, brain"), sedangkan entri hanya menyimpan
 * istilahnya sendiri — jadi bagian pertama dicocokkan ke lead term, lalu
 * sisanya ditelusuri sebagai subterm. Bagian yang tak ada di daftar
 * ("by site", "NEC") menghentikan penelusuran di induk terakhir.
 * Kembalikan indeks entri, atau -1 bila tak ada yang cocok.
 */
export function resolveSee(terms: string[], levels: number[], target: string): number {
  // Buang ")" sisa pembungkusan, mis. "Neoplasm, connective tissue)".
  let t = target.trim();
  const open = (t.match(/\(/g) || []).length;
  const close = (t.match(/\)/g) || []).length;
  if (close > open && t.endsWith(")")) t = t.slice(0, -1).trim();

  const parts = splitSeeTarget(t).map(normTerm);
  if (!parts.length) return -1;

  // 1) Lead term terdekat untuk bagian pertama: level terdangkal menang,
  //    supaya "Disease" tidak mendarat di subterm "disease" di bawah huruf A.
  let start = -1;
  let startLevel = Infinity;
  let startTier = 9;
  for (let i = 0; i < terms.length; i++) {
    const key = termKey(terms[i]);
    const tier = key === parts[0] ? 0 : key.startsWith(parts[0]) ? 1 : 9;
    if (tier === 9) continue;
    const lv = levels[i];
    if (lv < startLevel || (lv === startLevel && tier < startTier)) {
      start = i;
      startLevel = lv;
      startTier = tier;
    }
  }

  // 2) Telusuri sisa bagian sebagai subterm, berhenti di induk terakhir bila
  //    bagian berikutnya tak ada (mis. "Abscess, by site" -> "Abscess").
  let cur = start;
  let curLevel = startLevel;
  for (let k = 1; cur >= 0 && k < parts.length; k++) {
    let found = -1;
    let foundLevel = Infinity;
    for (let i = cur + 1; i < terms.length; i++) {
      const lv = levels[i];
      if (lv <= curLevel) break; // keluar dari blok induk
      if (lv >= foundLevel) continue; // sudah ada yang lebih dangkal
      if (termKey(terms[i]).startsWith(parts[k]) || normTerm(terms[i]).startsWith(parts[k])) {
        found = i;
        foundLevel = lv;
      }
    }
    if (found < 0) break;
    cur = found;
    curLevel = foundLevel;
  }
  if (cur >= 0) return cur;

  const full = normTerm(t);
  const tokens = full.split(/[\s,]+/).filter(Boolean);

  let best = -1;
  let bestScore = 0;
  const stack: string[] = [];

  for (let i = 0; i < terms.length; i++) {
    const level = levels[i];
    if (stack.length > level) stack.length = level;
    const chain = stack.slice(0, level).filter(Boolean).concat(terms[i]);
    stack[level] = terms[i];

    const self = normTerm(terms[i]);
    const chainText = chain.map(normTerm).join(", ");
    let score = 0;

    // Bagian rujukan muncul berurutan sebagai awalan elemen rantai.
    let k = 0;
    for (const el of chain) {
      if (k < parts.length && normTerm(el).startsWith(parts[k])) k++;
    }
    const prefixHit = k === parts.length;

    if (level === 0 && prefixHit) {
      // Rujukan menunjuk lead term ("Disease" → "Disease, diseased"). Ini
      // tujuan yang dimaksud, meski ada subterm bernama persis sama di bawah
      // lead term lain (dulu mendarat di huruf A).
      score = 11000 + parts.length * 100 - chain.length;
    } else if (self === full) score = 10000;
    else if (chainText === full) score = 9000;
    else if (prefixHit) score = 5000 + parts.length * 100 - chain.length;
    else if (tokens.every((tk) => chainText.includes(tk))) score = 2000 - chain.length;
    else if (tokens.every((tk) => self.includes(tk))) score = 1000;

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}
