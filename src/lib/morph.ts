// Daftar morfologi neoplasma (ICD-O) dari Volume 1 — dipakai panel morfologi.
export interface MorphBehaviour {
  b: string;
  id: string;
  en: string;
  cats: string;
}

export interface MorphGroup {
  c: string;
  t: string;
}

export interface MorphEntry {
  c: string;
  t: string;
}

export interface MorphFile {
  meta: { source: string; pdfPages: string; builtAt: string };
  behaviours: MorphBehaviour[];
  groups: MorphGroup[];
  entries: MorphEntry[];
}

/** M8000/3 → M800 */
export const morphStem = (code: string) => code.slice(0, 4);
/** M8000/3 → 3 */
export const morphBehav = (code: string) => code.split("/")[1] ?? "";

const rangeOf = (c: string): [number, number] => {
  const nums = c.match(/\d{3}/g) ?? [];
  const a = Number(nums[0] ?? 0);
  const b = Number(nums[1] ?? nums[0] ?? 0);
  return [a, b];
};

export function morphGroupOf(groups: MorphGroup[], code: string): MorphGroup | null {
  const n = Number(morphStem(code).slice(1));
  for (const g of groups) {
    const [a, b] = rangeOf(g.c);
    if (n >= a && n <= b) return g;
  }
  return null;
}

/** Kode situs dalam istilah, mis. "Osteoma (D16.-)" → ["D16"]. */
export function morphSites(term: string): string[] {
  const m = /\(([A-Z]\d{2}(?:\.-|\.\d)?(?:,\s*[A-Z]\d{2}(?:\.-|\.\d)?)*)\)/.exec(term);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/\.-$/, "").replace(/\.$/, ""))
    .filter((s) => /^[A-Z]\d{2}(\.\d)?$/.test(s));
}
