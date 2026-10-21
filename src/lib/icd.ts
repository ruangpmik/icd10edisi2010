export type RubricVal = string | { t: string; h: number };
export type Rubrics = Record<string, RubricVal[]>;

/** Teks polos dari nilai rubrik (string atau {t,h} subjudul). */
export function rubText(v: RubricVal): string {
  return typeof v === "string" ? v : v.t;
}

export interface CodeMeta {
  lvl: number;
  term: number; // 1 = terminal (valid untuk koding), 0 = non-terminal
  aster: number; // 1 = asterisk (manifestasi, kode sekunder)
  disp: string; // bentuk display ala WHO, mis. A00.- / D63.0*
  title: string;
  mort: string[];
  morb: string;
}

export interface ModSub {
  c: string;
  label: string;
  usage: "dagger" | "aster" | null;
}

export interface ModifierInfo {
  intro: string;
  subs: ModSub[];
  scope?: { ranges: [string, string][]; except: string[] };
}

export interface VirtualInfo {
  base: string;
  label: string;
}

export interface IcdNode {
  code: string;
  kind: "chapter" | "block" | "category";
  parent: string | null;
  children: string[];
  rubrics: Rubrics;
  usage: "dagger" | "aster" | null;
  meta?: CodeMeta;
  modRefs?: { code: string; optional: boolean }[];
  kn?: { ref: string; text: string }[];
  qc?: { sex?: "M" | "F"; ast?: number; seq?: number; pp?: number };
  virtual?: VirtualInfo;
}

export interface IcdData {
  meta: { title: string; chapters: number; blocks: number; categories: number; builtAt: string };
  chapters: string[];
  nodes: Record<string, IcdNode>;
  idTerms: Record<string, string[]>;
  modifiers: Record<string, ModifierInfo>;
}

export const preferred = (n: IcdNode): string => {
  const p = n.rubrics.preferred?.[0] ?? n.rubrics.preferredLong?.[0];
  return p === undefined || p === null ? n.code : rubText(p);
};

/** Tanda dagger (†) / asterisk (*) ala cetakan WHO: A17†, D63.0* */
export function codeMark(n: IcdNode | undefined | null): string {
  if (!n) return "";
  if (n.usage === "dagger") return "†";
  if (n.usage === "aster" || n.meta?.aster === 1) return "*";
  return "";
}

export function breadcrumb(data: IcdData, code: string): IcdNode[] {
  const trail: IcdNode[] = [];
  let cur: IcdNode | undefined = getNode(data, code);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.code)) {
    guard.add(cur.code);
    trail.unshift(cur);
    cur = cur.parent ? getNode(data, cur.parent) : undefined;
  }
  return trail;
}

// ---------- Kode subdivisi virtual (V01.1, M54.55, S02.01, W01.4, E10.2, …) ----------

function stemInScope(stem: string, scope: ModifierInfo["scope"]): boolean {
  if (!scope || !scope.ranges || scope.ranges.length === 0) return true;
  const hit = scope.ranges.some(([a, b]) => stem >= a && stem <= b);
  if (!hit) return false;
  return !(scope.except ?? []).some(
    (e) => stem === e || (e.length === 3 && stem === e) || stem.startsWith(e + ".") || e.startsWith(stem + ".")
  );
}

/** Bentuk kode lengkap dari subdivisi: .1 / .4 / 5 bergantung posisi digit. */
export function subFull(baseCode: string, modCode: string, sub: string): string | null {
  const pos = /_(\d)$/.exec(modCode)?.[1];
  if (sub.startsWith(".")) {
    return baseCode.length === 3 ? baseCode + sub : null;
  }
  if (pos === "4") {
    return baseCode.length === 3 ? `${baseCode}.${sub}` : null;
  }
  // _5: digit tambahan pada kode 4-karakter
  return baseCode.length === 5 ? baseCode + sub : null;
}

export interface VirtualResolve {
  base: string;
  mod: string;
  sub: ModSub;
  full: string;
  title: string;
  optional: boolean;
}

/** Modifier efektif suatu node: milik sendiri + warisan ancestor, difilter scope. */
export function effectiveMods(
  data: IcdData, node: IcdNode
): { code: string; optional: boolean; intro: string; subs: ModSub[] }[] {
  const stem = node.code.slice(0, 3);
  const seen = new Set<string>();
  const out: { code: string; optional: boolean; intro: string; subs: ModSub[] }[] = [];
  let cur: IcdNode | undefined = node;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.code)) {
    guard.add(cur.code);
    for (const r of cur.modRefs ?? []) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      const mod = data.modifiers[r.code];
      if (!mod || !stemInScope(stem, mod.scope)) continue;
      out.push({ code: r.code, optional: r.optional, intro: mod.intro, subs: mod.subs });
    }
    cur = cur.parent ? getNode(data, cur.parent) : undefined;
  }
  return out;
}

export function resolveVirtual(data: IcdData, query: string): VirtualResolve | null {
  const q = query.trim().toUpperCase().replace(/\s+/g, "");
  if (!q || data.nodes[q]) return null;
  if (!/^[A-Z]\d{2}(\.\d{1,2})?$/.test(q)) return null;
  for (let len = q.length - 1; len >= 3; len--) {
    const b = q.slice(0, len);
    const base = data.nodes[b];
    if (!base || base.kind !== "category") continue;
    const rest = q.slice(len);
    if (!rest || rest === ".") continue;
    const mods = effectiveMods(data, base);
    for (const m of mods) {
      for (const s of m.subs) {
        if (subFull(base.code, m.code, s.c) === q) {
          return {
            base: base.code, mod: m.code, sub: s, full: q,
            title: `${preferred(base)} - ${s.label}`,
            optional: m.optional,
          };
        }
      }
    }
    // Karakter ke-5 pada kategori 3 huruf (V01.00, W00.00): karakter ke-4 datang
    // dari modifier lain (mis. .0 Nontraffic accident), karakter ke-5 dari
    // modifier berikutnya (mis. 0 While engaged in sports activity).
    for (const m4 of mods) {
      for (const s4 of m4.subs) {
        const four = subFull(base.code, m4.code, s4.c);
        if (!four || four.length !== 5) continue;
        for (const m5 of mods) {
          if (m5.code === m4.code) continue;
          for (const s5 of m5.subs) {
            if (subFull(four, m5.code, s5.c) === q) {
              return {
                base: four, mod: m5.code, sub: s5, full: q,
                title: `${preferred(base)} - ${s4.label} - ${s5.label}`,
                optional: m5.optional,
              };
            }
          }
        }
      }
    }
    // hanya basis terpanjang yang masuk akal — lanjut ke prefix lebih pendek
  }
  return null;
}

/** Status kelengkapan kode: final, atau masih butuh karakter ke-N. */
export type CodeStatus =
  | { t: "valid"; len: number }
  /** `opt` = karakter tambahan bersifat opsional (mis. 0 closed / 1 open pada S02). */
  | { t: "semi"; pos: number; n: number; eg: string[]; opt?: boolean }
  | { t: "none" };

const digitLen = (c: string) => c.replace(/\./g, "").length;

export function codeStatus(data: IcdData, node: IcdNode): CodeStatus {
  const len = digitLen(node.code);
  if (node.kind !== "category") return { t: "none" };
  // Karakter ke-5 opsional (S02.1 -> S02.10/S02.11) datang dari modifier induk,
  // jadi kode bertanda terminal pun belum tentu berhenti di situ.
  const modOpts = effectiveMods(data, node).flatMap((m) =>
    m.subs.map((s) => subFull(node.code, m.code, s.c)).filter((x): x is string => !!x)
  );
  const final = node.meta?.term === 1;
  const opts = final ? modOpts : node.children.length ? node.children : modOpts;
  const next = opts.filter((c) => digitLen(c) === len + 1);
  if (next.length === 0) return final ? { t: "valid", len } : { t: "none" };
  return { t: "semi", pos: len + 1, n: next.length, eg: next, opt: final };
}

/** Node asli atau sintetis (virtual). */
export function getNode(data: IcdData, code: string): IcdNode | undefined {
  const n = data.nodes[code];
  if (n) return n;
  const v = resolveVirtual(data, code);
  if (!v) return undefined;
  // Induk bisa berupa kode virtual lain (V01.00 → V01.0 → V01).
  const base = data.nodes[v.base] ?? (v.base !== code ? getNode(data, v.base) : undefined);
  if (!base) return undefined;
  const { preferredLong: _omit, ...rest } = base.rubrics;
  void _omit;
  const rub: Rubrics = { ...rest, preferred: [v.title] };
  return {
    code: v.full,
    kind: "category",
    parent: v.base,
    children: [],
    rubrics: rub,
    usage: v.sub.usage ?? base.usage ?? null,
    meta: { ...(base.meta ?? { lvl: 4, term: 0, aster: 0, disp: v.full, title: v.title, mort: [], morb: "" }), term: 1, disp: v.full },
    modRefs: [],
    virtual: { base: v.base, label: v.sub.label },
  };
}

/**
 * Kode target untuk sebuah rujukan di teks: node asli, kode virtual (V01.1, F10.6, …),
 * atau kategori terdekat bila kode butuh karakter ke-4/ke-5 yang tak punya node sendiri
 * (mis. I72.6 → I72). Mengembalikan null bila memang bukan kode yang bisa dituju.
 */
export function linkTarget(data: IcdData, code: string): string | null {
  const c = code.replace(/\.-$/, "").replace(/\.$/, "");
  if (getNode(data, c)) return c;
  for (let len = c.length - 1; len >= 3; len--) {
    const b = c.slice(0, len);
    if (b.endsWith(".")) continue;
    if (getNode(data, b)) return b;
  }
  return null;
}

// ---------- Advanced search: term, term & term, a | b, (…), wildcards * ? ----------
// Ala eComPress: "&" = AND, "|" = OR, "*" = cocok berapa pun karakter, "?" = satu karakter.

type Expr = { t: "term"; v: string } | { t: "and"; xs: Expr[] } | { t: "or"; xs: Expr[] };

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseExpr(s: string): Expr {
  s = s.trim();
  const ors = splitTop(s, "|");
  if (ors.length > 1) return { t: "or", xs: ors.map(parseExpr) };
  const ands = splitTop(s, "&");
  if (ands.length > 1) return { t: "and", xs: ands.map(parseExpr) };
  if (s.startsWith("(") && s.endsWith(")")) return parseExpr(s.slice(1, -1));
  return { t: "term", v: s };
}

function termToReg(term: string): RegExp | null {
  // wildcard -> regex; tanpa wildcard -> null (substring biasa)
  if (!term.includes("*") && !term.includes("?")) return null;
  const esc = term.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(esc, "i");
  } catch {
    return null;
  }
}

function matchTerm(hay: string, hayNoDot: string, term: string): boolean {
  term = term.trim();
  if (!term) return true;
  const re = termToReg(term);
  if (re) return re.test(hay) || re.test(hayNoDot);
  const t = term.toLowerCase();
  return hay.includes(t) || hayNoDot.includes(t.replace(/\./g, ""));
}

function evalExpr(hay: string, hayNoDot: string, e: Expr): boolean {
  if (e.t === "term") return matchTerm(hay, hayNoDot, e.v);
  if (e.t === "and") return e.xs.every((x) => evalExpr(hay, hayNoDot, x));
  return e.xs.some((x) => evalExpr(hay, hayNoDot, x));
}

export interface Hit {
  code: string;
  kind: string;
  en: string;
  id: string;
  src: string[]; // sumber cocok: kode, judul, inklusi, eksklusi, lainnya, indeks
}

export type Scope = Record<"kode" | "judul" | "inklusi" | "eksklusi" | "lainnya" | "indeks", boolean>;

export const ALL_SCOPE: Scope = { kode: true, judul: true, inklusi: true, eksklusi: true, lainnya: true, indeks: true };

export const SCOPE_LABEL: Record<keyof Scope, string> = {
  kode: "Kode",
  judul: "Judul",
  inklusi: "Inklusi",
  eksklusi: "Eksklusi",
  lainnya: "Catatan lain",
  indeks: "Indeks ID",
};

interface Fields {
  kode: string;
  judul: string;
  inklusi: string;
  eksklusi: string;
  lainnya: string;
  indeks: string;
}

function matchTermFields(f: Fields, scope: Scope, term: string): string[] {
  term = term.trim();
  if (!term) return [];
  const hit: string[] = [];
  (Object.keys(f) as (keyof Fields)[]).forEach((k) => {
    if (!scope[k]) return;
    const hay = f[k];
    if (matchTerm(hay, hay.replace(/\./g, ""), term)) hit.push(k);
  });
  return hit;
}

function evalFields(f: Fields, scope: Scope, e: Expr): string[] {
  if (e.t === "term") return matchTermFields(f, scope, e.v);
  if (e.t === "and") {
    const parts = e.xs.map((x) => evalFields(f, scope, x));
    if (parts.some((p) => p.length === 0)) return [];
    return Array.from(new Set(parts.flat()));
  }
  return Array.from(new Set(e.xs.flatMap((x) => evalFields(f, scope, x))));
}

export function search(
  data: IcdData, custom: Record<string, string[]>, q: string, limit = 200, scope: Scope = ALL_SCOPE
): Hit[] {
  q = q.trim();
  if (q.length < 2) return [];
  let expr: Expr;
  try {
    expr = parseExpr(q);
  } catch {
    return [];
  }
  const keys = (Object.keys(scope) as (keyof Scope)[]).filter((k) => scope[k]);
  if (keys.length === 0) return [];
  const out: Hit[] = [];
  for (const code of Object.keys(data.nodes)) {
    const n = data.nodes[code];
    const en = preferred(n);
    const ids = [...(data.idTerms[code] ?? []), ...(custom[code] ?? [])].join(" | ");
    const f: Fields = {
      kode: code.toLowerCase(),
      judul: en.toLowerCase(),
      inklusi: (n.rubrics.inclusion ?? []).map(rubText).join(" ").toLowerCase(),
      eksklusi: (n.rubrics.exclusion ?? []).map(rubText).join(" ").toLowerCase(),
      lainnya: Object.entries(n.rubrics)
        .filter(([k]) => k !== "preferred" && k !== "preferredLong" && k !== "inclusion" && k !== "exclusion")
        .flatMap(([, v]) => v.map(rubText)).join(" ").toLowerCase(),
      indeks: ids.toLowerCase(),
    };
    const src = evalFields(f, scope, expr);
    if (src.length > 0) {
      out.push({ code, kind: n.kind, en, id: ids, src });
      if (out.length >= 3000) break;
    }
  }
  const v = resolveVirtual(data, q);
  if (v && !out.some((h) => h.code === v.full)) {
    out.push({ code: v.full, kind: "virtual", en: v.title, id: "", src: ["kode"] });
  }
  const qLow = q.toLowerCase();
  const kindRank = (k: string) => (k === "category" || k === "virtual" ? 0 : k === "block" ? 1 : 2);
  return out
    .sort((a, b) => {
      const sa = a.code.toLowerCase() === qLow ? 0 : 1;
      const sb = b.code.toLowerCase() === qLow ? 0 : 1;
      return sa - sb || kindRank(a.kind) - kindRank(b.kind) || a.code.localeCompare(b.code);
    })
    .slice(0, limit);
}

/** Himpunan kode yang cocok + semua ancestor-nya (penanda hijau ala eComPress). */
export function matchAncestors(data: IcdData, hits: Hit[]): Set<string> {
  const s = new Set<string>();
  for (const h of hits) {
    s.add(h.code);
    for (const t of breadcrumb(data, h.code)) s.add(t.code);
  }
  return s;
}

/** Segmen teks: biasa | kode ICD | rujukan "see note N". */
export interface LinkSeg {
  text: string;
  code: string | null;
  note?: string;
  /** Rujukan morfologi neoplasma (M8000/3 atau M905). */
  morph?: string;
}

function linkifyCodes(text: string): LinkSeg[] {
  // potong rentang dulu: A15-A16, C76–C80, O00-O07
  const rangeRe = /([A-Z]\d{2}(?:\.\d{1,2})?)\s*([–-])\s*([A-Z]?\d{2}(?:\.\d{1,2})?)/g;
  const out: LinkSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const singles: LinkSeg[] = [];
  const pushSingles = (t: string) => {
    for (const p of t.split(/(M\d{4}\/\d|M\d{3}(?![\d/.\-])|[A-Z]\d{2}(?:\.\d{1,2})?(?:\.-)?)/g)) {
      if (p === "") continue;
      const clean = p.replace(/\.-$/, "").replace(/\.$/, "");
      if (/^M\d{3,4}(\/\d)?$/.test(p)) {
        singles.push({ text: p, code: null, morph: p });
      } else {
        singles.push(
          /^[A-Z]\d{2}(\.\d{1,2})?$/.test(clean)
            ? { text: p, code: clean }
            : { text: p, code: null }
        );
      }
    }
  };
  while ((m = rangeRe.exec(text)) !== null) {
    pushSingles(text.slice(last, m.index));
    out.push(...singles.splice(0));
    const [, a, sep, bRaw] = m;
    let b = bRaw;
    if (!/^[A-Z]/.test(b)) b = a[0] + b; // "A15-A16" -> "A16"
    out.push({ text: a, code: /^[A-Z]\d{2}(\.\d{1,2})?$/.test(a) ? a : null });
    out.push({ text: ` ${sep} `, code: null });
    const bc = b.replace(/\.-$/, "").replace(/\.$/, "");
    out.push({ text: bRaw, code: /^[A-Z]\d{2}(\.\d{1,2})?$/.test(bc) ? bc : null });
    last = m.index + m[0].length;
  }
  pushSingles(text.slice(last));
  out.push(...singles.splice(0));
  return out.filter((s) => s.text !== "");
}

/** Pecah teks rubrik: kode/rentang ter-link + rujukan "see note N". */
export function linkify(text: string): LinkSeg[] {
  const noteRe = /\[?\s*see note (\d+)[^\].,;]*\]?/gi;
  const out: LinkSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = noteRe.exec(text)) !== null) {
    out.push(...linkifyCodes(text.slice(last, m.index)));
    out.push({ text: m[0].trim(), code: null, note: m[1] });
    last = m.index + m[0].length;
  }
  out.push(...linkifyCodes(text.slice(last)));
  return out.filter((s) => s.text !== "");
}
