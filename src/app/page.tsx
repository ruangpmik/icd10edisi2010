"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyEvent } from "react";
import { useTheme } from "next-themes";
import {
  Ambulance, ArrowLeft, ArrowRight, ArrowUp, Asterisk, BadgeCheck, BookMarked, BookOpen, Check, ChevronDown, ChevronRight,
  Circle, Copy, Dna, ExternalLink, FileText, Info, Languages, ListCollapse, ListOrdered, ListTree, Loader2, Moon, Pencil, Pill, Plus,
  Printer, Search, SearchX, ShieldAlert, Stethoscope, StickyNote, Sun, Sword, Table2, Trash2, TriangleAlert, X, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  ALL_SCOPE, breadcrumb, codeMark, codeStatus, effectiveMods, getNode, linkify, linkTarget, matchAncestors, preferred, rubText,
  resolveVirtual, search, subFull,
  type IcdData, type RubricVal, type Scope,
} from "@/lib/icd";
import { STR, loadLang, type Lang } from "@/lib/i18n";
import { morphBehav, morphGroupOf, morphSites, morphStem, type MorphFile } from "@/lib/morph";
import { ALPHA_LETTERS, buildPaths, indexBrowse, normTerm, resolveSee, searchAlpha, splitSeeTarget, type AlphaEntry, type AlphaIndex } from "@/lib/alpha";
import { navCode, tableBrowse, type TableEntry, type TableIndex } from "@/lib/tables";
import { fetchJson } from "@/lib/fetchJson";
import { cellTarget, type SpecialFile, type SpecialTable } from "@/lib/special";
import { translateEnId } from "@/lib/translate";

const LS_CUSTOM = "icd10-id-custom-v1";
const LS_NOTES = "icd10-notes-v1";
const LS_LANG = "icd10-lang";

/** Sumber data tab "Indeks A–Z": 4 daftar + 1 tampilan tabel matriks. */
type IdxSrc = "alpha" | "ext" | "neo" | "drugs" | "tables";
const TBL_SRC = ["neo", "drugs"] as const;

// Warna chip per kolom tabel Vol.3 (5 kolom kode).
const TBL_CHIP = [
  "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:border-sky-500",
  "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:border-indigo-500",
  "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:border-violet-500",
  "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:border-emerald-500",
  "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:border-amber-500",
];
const TBL_DOT = ["bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500"];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Rujukan "lihat: …" yang tak punya tujuan sama sekali (artefak parse). */
function seeUsable(t: string): boolean {
  return !/^(also|note at|Leuk\(o)$/i.test(t.trim());
}

/** Navigasi tablist ala ARIA APG: panah/Home/End memindah fokus + mengaktifkan tab. */
function tabKeyNav(e: ReactKeyEvent<HTMLDivElement>) {
  const nav = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
  if (!nav.includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0 || tabs.length === 0) return;
  let n = i;
  if (e.key === "Home") n = 0;
  else if (e.key === "End") n = tabs.length - 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % tabs.length;
  else n = (i - 1 + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[n]?.focus();
  tabs[n]?.click();
}

/**
 * Fokus untuk modal: pindahkan fokus ke elemen pertama saat dibuka, kurung Tab di
 * dalam dialog, dan kembalikan fokus ke pemicu saat ditutup.
 */
function useDialogFocus(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (!el) return;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    (items()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const act = document.activeElement as HTMLElement | null;
      if (!act || !el.contains(act)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && act === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && act === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);
  return ref;
}

function readLS(key: string): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}
function readNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_NOTES) ?? "{}");
  } catch {
    return {};
  }
}

const TONE: Record<string, string> = {
  sky: "border-sky-200 bg-sky-50 text-blue-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
};

function Badge({ tone, children, title }: { tone: keyof typeof TONE; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function HBtn({ title, onClick, disabled, children }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={typeof children === "string" ? title : undefined}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function GBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-600 transition hover:border-teal-400 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-white/15 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-300"
    >
      {children}
    </button>
  );
}

/** Chip penanda catatan kaki tabel (# = catatan 2, <> = catatan 3). */
function MarkBtn({ mark, noteNo, onClick, title }: { mark: string; noteNo: number; onClick: (n: number) => void; title: string }) {
  return (
    <sup className="shrink-0">
      <button
        type="button"
        onClick={() => onClick(noteNo)}
        title={title}
        aria-label={title}
        className="rounded bg-amber-100 px-1 text-[9.5px] font-bold leading-tight text-amber-800 transition hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-900"
      >
        {mark}
      </button>
    </sup>
  );
}

function SecTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      <span className="text-teal-600 dark:text-teal-400">{icon}</span>
      {children}
    </h3>
  );
}

function saveLS(key: string, val: unknown) {
  try {
    localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
  } catch {}
}

const SCOPE_KEYS = ["kode", "judul", "inklusi", "eksklusi", "lainnya", "indeks"] as const;

export default function Page() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState<Lang>("id");
  const t = STR[lang];
  const [data, setData] = useState<IcdData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>("A00");
  const [open, setOpen] = useState<Set<string>>(new Set(["I", "A00-A09"]));
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newTerm, setNewTerm] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGuide, setShowGuide] = useState(false);
  const [validOnly, setValidOnly] = useState(false);
  const [scope, setScope] = useState<Scope>({ ...ALL_SCOPE });
  const [mode, setMode] = useState<"tree" | "index">("tree");
  const [idx, setIdx] = useState<AlphaIndex | null>(null);
  const [idxBusy, setIdxBusy] = useState(false);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [letter, setLetter] = useState("A");
  const [idxLimit, setIdxLimit] = useState(400);
  const [idxFilter, setIdxFilter] = useState<"all" | "lead" | "sub">("all");
  const [idxSrc, setIdxSrc] = useState<IdxSrc>("alpha");
  const [ext, setExt] = useState<AlphaIndex | null>(null);
  const [extBusy, setExtBusy] = useState(false);
  const [extErr, setExtErr] = useState<string | null>(null);
  const [special, setSpecial] = useState<SpecialFile | null>(null);
  const [specialBusy, setSpecialBusy] = useState(false);
  const [specialErr, setSpecialErr] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<string | null>(null);
  const [morph, setMorph] = useState<MorphFile | null>(null);
  const [morphOpen, setMorphOpen] = useState(false);
  const [morphQ, setMorphQ] = useState("");
  const [tbls, setTbls] = useState<Partial<Record<"neo" | "drugs", TableIndex>>>({});
  const [tblBusy, setTblBusy] = useState<"neo" | "drugs" | null>(null);
  const [tblErr, setTblErr] = useState<string | null>(null);
  const keepView = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const matrixDlg = useDialogFocus(!!matrix);
  const morphDlg = useDialogFocus(morphOpen);
  const guideDlg = useDialogFocus(showGuide);
  const [mt, setMt] = useState<Record<string, { title: string; rub: Record<string, string[]> }>>({});
  const [mtBusy, setMtBusy] = useState(false);
  const [mtErr, setMtErr] = useState<string | null>(null);
  const [showMt, setShowMt] = useState(false);
  const pickMtView = (v: boolean) => {
    setShowMt(v);
    saveLS("icd10-mtview", v ? "1" : "0");
  };
  const [hist, setHist] = useState<string[]>(["A00"]);
  const [hi, setHi] = useState(0);
  // Progres unduh berkas data (byte nyata; ukuran acuan dari data/sizes.json).
  const [prog, setProg] = useState<{ k: string; loaded: number; total: number } | null>(null);
  const progPct = prog && prog.total > 0 ? Math.min(100, Math.round((prog.loaded / prog.total) * 100)) : null;
  const sizesRef = useRef<Record<string, number>>({});
  const sizeOf = (f: string) => sizesRef.current[f] ?? 0;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setLang(loadLang());
    // Ukuran acuan (kecil) dimuat lebih dulu agar bar progres punya penyebut.
    (async () => {
      try {
        const r = await fetch("data/sizes.json");
        if (r.ok) sizesRef.current = await r.json();
      } catch {}
      fetchJson<IcdData>("data/icd10.json", (loaded, total) => setProg({ k: "icd", loaded, total }), sizeOf("icd10.json"))
        .then(setData)
        .catch((e) => setErr(STR[loadLang()].loadFail + e.message))
        .finally(() => setProg(null));
    })();
    setCustom(readLS(LS_CUSTOM));
    setNotes(readNotes());
    try {
      setMt(JSON.parse(localStorage.getItem("icd10-mt-v1") ?? "{}"));
    } catch {}
    try {
      setShowMt(localStorage.getItem("icd10-mtview") === "1");
    } catch {}
  }, []);

  // Penghalang salin sederhana: klik kanan, pilih teks, dan Ctrl+C/Ctrl+A
  // dimatikan di area bacaan. Kolom isian tetap normal (pengguna perlu tempel).
  // Ini pengaman visual, bukan proteksi teknis: berkas JSON tetap bisa diunduh.
  useEffect(() => {
    const editable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n || !n.tagName) return false;
      const tag = n.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || n.isContentEditable === true;
    };
    const onCtx = (e: MouseEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onSelect = (e: Event) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onDrag = (e: DragEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || editable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "c" || k === "x" || k === "a") e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("copy", onCopy);
    document.addEventListener("selectstart", onSelect);
    document.addEventListener("dragstart", onDrag);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("selectstart", onSelect);
      document.removeEventListener("dragstart", onDrag);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Indeks Alfabet Vol.3 dimuat malas: hanya saat tab "Indeks A–Z" dibuka.
  useEffect(() => {
    if (mode !== "index" || idx || idxBusy) return;
    setIdxBusy(true);
    setIdxErr(null);
    fetchJson<AlphaIndex>("data/alpha-index.json", (loaded, total) => setProg({ k: "alpha", loaded, total }), sizeOf("alpha-index.json"))
      .then((j) => setIdx(j))
      .catch((e) => setIdxErr(STR[lang].loadFail + e.message))
      .finally(() => {
        setIdxBusy(false);
        setProg(null);
      });
  }, [mode, idx, idxBusy, lang]);

  // Tabel khusus Vol.3 (neoplasma, obat & bahan kimia) juga dimuat malas.
  useEffect(() => {
    if (mode !== "index" || !TBL_SRC.includes(idxSrc as (typeof TBL_SRC)[number])) return;
    if (tbls[idxSrc as "neo" | "drugs"] || tblBusy === idxSrc) return;
    const src = idxSrc as "neo" | "drugs";
    setTblBusy(src);
    setTblErr(null);
    fetchJson<TableIndex>(`data/${src}-index.json`, (loaded, total) => setProg({ k: src, loaded, total }), sizeOf(`${src}-index.json`))
      .then((j) => setTbls((s) => ({ ...s, [src]: j })))
      .catch((e) => setTblErr(STR[lang].loadFail + e.message))
      .finally(() => {
        setTblBusy(null);
        setProg(null);
      });
  }, [mode, idxSrc, tbls, tblBusy, lang]);

  // Seksi II Vol.3 — indeks Penyebab Luar (cedera & keracunan).
  useEffect(() => {
    if (mode !== "index" || idxSrc !== "ext" || ext || extBusy) return;
    setExtBusy(true);
    setExtErr(null);
    fetchJson<AlphaIndex>("data/ext-index.json", (loaded, total) => setProg({ k: "ext", loaded, total }), sizeOf("ext-index.json"))
      .then((j) => setExt(j))
      .catch((e) => setExtErr(STR[lang].loadFail + e.message))
      .finally(() => {
        setExtBusy(false);
        setProg(null);
      });
  }, [mode, idxSrc, ext, extBusy, lang]);

  // Tabel matriks (abortus & kecelakaan lalu lintas darat).
  useEffect(() => {
    if (mode !== "index" || idxSrc !== "tables" || special || specialBusy) return;
    setSpecialBusy(true);
    setSpecialErr(null);
    fetchJson<SpecialFile>("data/special-tables.json", (loaded, total) => setProg({ k: "special", loaded, total }), sizeOf("special-tables.json"))
      .then((j) => setSpecial(j))
      .catch((e) => setSpecialErr(STR[lang].loadFail + e.message))
      .finally(() => {
        setSpecialBusy(false);
        setProg(null);
      });
  }, [mode, idxSrc, special, specialBusy, lang]);

  // Esc menutup tampilan matriks.
  useEffect(() => {
    if (!matrix) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMatrix(null);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [matrix]);

  // Esc menutup panel morfologi.
  useEffect(() => {
    if (!morphOpen) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMorphOpen(false);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [morphOpen]);

  // Ganti huruf/kueri/mode: kembali ke atas daftar dan setel ulang batas tampil.
  // Dilewati sekali bila perubahan huruf berasal dari lompatan rujukan "lihat".
  useEffect(() => {
    if (keepView.current) {
      keepView.current = false;
      return;
    }
    setIdxLimit(400);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [letter, q, mode, idxSrc]);

  // Tulis-balik localStorage hanya dari aksi user (hindari efek persist-on-mount
  // yang menimpa simpanan saat StrictMode dev me-mount ganda).
  useEffect(() => {
    if (!showGuide) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowGuide(false);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [showGuide]);

  const pickLang = (l: Lang) => {
    setLang(l);
    saveLS(LS_LANG, l);
  };
  // Panel detail punya scroll sendiri: setiap pindah kode, kembali ke atas
  // supaya judul & badge kode baru langsung terlihat.
  const paneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [sel]);
  // Kode indeks sering berbentuk "X36.-" (digit ke-4 belum ditentukan) atau
  // berpenanda †/‡/*. Buang dulu, lalu mundur ke kategori 3 karakter bila
  // subkategorinya tidak ada di Tabular.
  const navTarget = (raw: string) => {
    if (!data) return null;
    const base = navCode(raw.replace(/[†‡*]/g, ""));
    if (getNode(data, base)) return base;
    if (getNode(data, base.slice(0, 3))) return base.slice(0, 3);
    return null;
  };
  const go = (raw: string) => {
    const code = navTarget(raw);
    if (!code) return;
    setEditIdx(null);
    setSel(code);
    setHist((h) => [...h.slice(0, hi + 1), code]);
    setHi((i) => i + 1);
  };
  const back = () => {
    if (hi > 0) {
      setSel(hist[hi - 1]);
      setHi(hi - 1);
    }
  };
  const fwd = () => {
    if (hi < hist.length - 1) {
      setSel(hist[hi + 1]);
      setHi(hi + 1);
    }
  };

  // Panel morfologi: dimuat malas sekali, lalu dibuka pada stem/kode tertentu.
  const openMorph = (q = "") => {
    setMorphQ(q);
    setMorphOpen(true);
    if (!morph) {
      fetch("data/morphology.json")
        .then((r) => r.json())
        .then(setMorph)
        .catch(() => {});
    }
  };

  const searching = q.trim().length >= 2;
  const hits = useMemo(() => {
    if (!data) return [];
    const all = search(data, custom, q, 200, scope);
    if (!validOnly) return all;
    return all.filter((h) => data.nodes[h.code]?.meta?.term === 1);
  }, [data, custom, q, validOnly, scope]);
  const markers = useMemo(
    () => (data && searching ? matchAncestors(data, hits) : new Set<string>()),
    [data, hits, q, searching]
  );

  // ===== Indeks A–Z (Vol.3): alfabet penyakit + penyebab luar =====
  // Keduanya memakai bentuk data yang sama (AlphaEntry), jadi satu set memo
  // dipakai untuk dua sumber; hanya berkas yang dimuat berbeda.
  const idxData: AlphaIndex | null = idxSrc === "alpha" ? idx : idxSrc === "ext" ? ext : null;
  const idxNorms = useMemo(() => (idxData ? idxData.entries.map((e) => normTerm(e[0])) : []), [idxData]);
  const idxBrowse = useMemo(() => (idxData ? indexBrowse(idxData.entries) : { rows: {}, counts: {} }), [idxData]);
  const idxSearching = mode === "index" && q.trim().length >= 2;
  // "Lead term" = baris tertebal (level 0 di indeks alfabet, level 1 di tabel
  // neoplasma); "Subterm" = semua baris bertingkat di bawahnya.
  const lvlOk = (lvl: number, lead: number) =>
    idxFilter === "all" || (idxFilter === "lead" ? lvl <= lead : lvl > lead);
  const idxSearch = useMemo(
    () =>
      idxData && idxSearching
        ? searchAlpha(idxNorms, q, idxFilter === "all" ? 240 : 8000)
        : { hits: [], total: 0 },
    [idxData, idxSearching, idxNorms, q, idxFilter]
  );
  const idxRows = useMemo(() => {
    if (!idxData) return [];
    const ent = idxData.entries;
    const keep = (i: number) => lvlOk(ent[i][2], 0);
    let base: number[];
    if (idxSearching) {
      base = idxSearch.hits.filter(keep).slice(0, 240);
    } else {
      const all = (idxBrowse.rows[letter] ?? []).filter(keep);
      let n = Math.min(all.length, idxLimit);
      // Jangan potong tepat di tengah kelompok: lanjutkan sampai lead term
      // berikutnya, tapi maksimal 200 baris tambahan agar tetap ringan.
      let m = n;
      while (m < all.length && ent[all[m]][2] !== 0) m++;
      if (m - n <= 200) n = m;
      base = all.slice(0, n);
    }
    const paths = buildPaths(ent, new Set(base));
    return base.map((i) => ({ i, e: ent[i], path: paths.get(i) }));
  }, [idxData, idxSearching, idxSearch, idxBrowse, letter, idxLimit, idxFilter]);
  const idxTotal = idxSearching
    ? idxFilter === "all"
      ? idxSearch.total
      : idxSearch.hits.filter((i) => idxData && lvlOk(idxData.entries[i][2], 0)).length
    : (idxBrowse.rows[letter] ?? []).filter((i) => idxData && lvlOk(idxData.entries[i][2], 0)).length;

  // ===== Tabel khusus Vol.3 (neoplasma, obat & bahan kimia) =====
  const isList = idxSrc === "alpha" || idxSrc === "ext";
  const isTbl = idxSrc === "neo" || idxSrc === "drugs";
  const tbl = isTbl ? tbls[idxSrc] ?? null : null;
  const tblLead = idxSrc === "neo" ? 1 : 0;
  const tblCols = idxSrc === "neo" ? t.neoCols : t.drugCols;
  // Kolom kode ikut dicari supaya "C80.9" menemukan barisnya.
  const tblNorms = useMemo(
    () =>
      tbl
        ? tbl.entries.map((e) => `${normTerm(e[0])} ${e[3].filter(Boolean).join(" ").toLowerCase()}`.trim())
        : [],
    [tbl]
  );
  const tblBrowse = useMemo(
    () => (tbl ? tableBrowse(tbl.entries, tblLead) : { rows: {} as Record<string, number[]>, counts: {} as Record<string, number> }),
    [tbl, tblLead]
  );
  const tblSearch = useMemo(
    () =>
      tbl && idxSearching
        ? searchAlpha(tblNorms, q, idxFilter === "all" ? 240 : 8000)
        : { hits: [], total: 0 },
    [tbl, idxSearching, tblNorms, q, idxFilter]
  );
  const tblRows = useMemo(() => {
    if (!tbl) return [];
    const keep = (i: number) => lvlOk(tbl.entries[i][1], tblLead);
    const base = idxSearching
      ? tblSearch.hits.filter(keep).slice(0, 240)
      : (tblBrowse.rows[letter] ?? []).filter(keep).slice(0, idxLimit);
    return base.map((i) => ({ i, e: tbl.entries[i] }));
  }, [tbl, idxSearching, tblSearch, tblBrowse, letter, idxLimit, tblLead, idxFilter]);
  const tblTotal = idxSearching
    ? idxFilter === "all"
      ? tblSearch.total
      : tblSearch.hits.filter((i) => tbl && lvlOk(tbl.entries[i][1], tblLead)).length
    : (tblBrowse.rows[letter] ?? []).filter((i) => tbl && lvlOk(tbl.entries[i][1], tblLead)).length;

  // Rujukan "lihat: …" bisa berupa jalur ("Neoplasm, sinus"), sedangkan entri
  // hanya menyimpan istilahnya sendiri. resolveSee mencocokkan lewat rantai induk,
  // lalu daftar digulir ke baris itu (bukan mencari teks jalur yang tak akan ketemu).
  const [jump, setJump] = useState<{ i: number; n: number } | null>(null);
  const [pendingSee, setPendingSee] = useState<{ target: string; src: "neo" | "drugs"; letter?: string } | null>(null);
  const [pendingSpecial, setPendingSpecial] = useState<string | null>(null);
  const notesRef = useRef<HTMLDetailsElement | null>(null);
  const land = (entries: (AlphaEntry | TableEntry)[], table: boolean, leadLevel: number, i: number) => {
    const rows = table
      ? tableBrowse(entries as TableEntry[], leadLevel).rows
      : indexBrowse(entries as AlphaEntry[]).rows;
    const L = Object.keys(rows).find((k) => rows[k].includes(i));
    if (!L) return false;
    keepView.current = true;
    setLetter(L);
    setQ("");
    const pos = rows[L].indexOf(i);
    if (pos >= idxLimit) setIdxLimit(pos + 60);
    setJump({ i, n: Date.now() });
    return true;
  };
  const jumpIn = (entries: (AlphaEntry | TableEntry)[], table: boolean, leadLevel: number, target: string) => {
    const terms = entries.map((e) => e[0]);
    const levels = entries.map((e) => (table ? (e as TableEntry)[1] : (e as AlphaEntry)[2]));
    let i = resolveSee(terms, levels, target);
    // Rujukan kadang menambah keterangan yang tak ada di daftar tujuan
    // ("Neoplasm, connective tissue, malignant" — kolom tabel yang menentukan
    // keganasan). Coba bertahap tanpa bagian terakhir.
    for (let k = 0; i < 0 && k < 2; k++) {
      const parts = splitSeeTarget(target);
      if (parts.length < 2) break;
      parts.pop();
      i = resolveSee(terms, levels, parts.join(", "));
    }
    return i >= 0 && land(entries, table, leadLevel, i);
  };
  // Rujukan ke awalan ("Levo-", "Sulf-", "specific protein") tidak punya entri
  // persis, jadi dicari entri pertama yang berawalan itu — utamakan lead term.
  const jumpPrefix = (entries: (AlphaEntry | TableEntry)[], table: boolean, leadLevel: number, target: string) => {
    const lvl = (k: number) => (table ? (entries[k] as TableEntry)[1] : (entries[k] as AlphaEntry)[2]);
    const lower = entries.map((e) => e[0].toLowerCase());
    // "specific substance" → "substance": kata umumnya dibuang lebih dulu.
    const tries = [target.trim(), target.trim().replace(/^specific\s+/i, "")];
    for (const raw of tries) {
      const p = raw.replace(/[-\s]+$/, "").toLowerCase();
      if (p.length < 3) continue;
      let i = lower.findIndex((t, k) => t.startsWith(p) && lvl(k) === leadLevel);
      if (i < 0) i = lower.findIndex((t, k) => t.includes(p) && lvl(k) === leadLevel);
      if (i < 0) i = lower.findIndex((t) => t.startsWith(p));
      if (i >= 0) return land(entries, table, leadLevel, i);
    }
    return false;
  };
  // Rujukan berupa judul bab ("Conditions originating in the perinatal period,
  // distress, fetal") tak punya entri indeks. Buka tab Pohon di bab itu.
  const gotoChapter = (target: string) => {
    if (!data) return false;
    const nk = (s: string) => s.toLowerCase().replace(/\bthe\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
    const head = nk(splitSeeTarget(target)[0] ?? "").replace(/^complications? originating/, "conditions originating");
    // Judul bab panjang; batas 3 kata menghindari salah cocok ("Neoplasm").
    if (head.split(" ").length < 3) return false;
    const c = data.chapters.find((ch) => {
      const p = data.nodes[ch]?.rubrics?.preferred?.[0];
      return !!p && nk(rubText(p)).includes(head);
    });
    if (!c) return false;
    setMode("tree");
    setQ("");
    go(c);
    requestAnimationFrame(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    return true;
  };
  // Rujukan berkode ("Note at category O80.-", "categories D50–D77",
  // "E10–E14 with fourth character .6") tak punya entri indeks; buka kodenya.
  const gotoCodeRef = (target: string) => {
    if (!data) return false;
    const t = target.trim();
    const range = /^([A-Z]\d{2})\s*[–—-]\s*[A-Z]\d{2}\s+with fourth character\s*\.?\s*(\d)/i.exec(t);
    const note = /^note at\s+(?:category\s+)?([A-Z]\d{2})(?:\.(\d))?/i.exec(t);
    const cats = /^categories?\s+([A-Z]\d{2})/i.exec(t);
    const code = range ? `${range[1]}.${range[2]}` : note ? (note[2] ? `${note[1]}.${note[2]}` : note[1]) : cats ? cats[1] : "";
    if (!code) return false;
    const hit = data.nodes[code] ? code : data.nodes[code.slice(0, 3)] ? code.slice(0, 3) : "";
    if (!hit) return false;
    setMode("tree");
    setQ("");
    // Buka jalur induknya dulu supaya baris kode terlihat di pohon.
    setOpen((prev) => {
      const n = new Set(prev);
      breadcrumb(data, hit).forEach((tr) => n.add(tr.code));
      return n;
    });
    go(hit);
    setTimeout(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" }), 80);
    return true;
  };
  const gotoSee = (target: string) => {
    // Artefak parse: "alsoMelioidosis" -> "Melioidosis"; "also" sendirian tak
    // menuju apa pun (tombolnya sudah tidak dirender, ini jaring pengaman).
    target = target.replace(/^also\s*/i, "").trim();
    if (!target) return;
    // Blok neoplasma ada di tabel terpisah; di indeks alfabet hanya tersisa
    // baris kepalanya, jadi rujukan "Neoplasm, …" selalu diarahkan ke sana.
    if (isList && /^neoplas/i.test(target.trim())) {
      setPendingSee({ target, src: "neo" });
      setIdxSrc("neo");
      return;
    }
    // "Table of drugs and chemicals" merujuk seluruh tabel Obat & Kimia; tak ada
    // entri dengan nama itu, jadi buka tabnya dan berhenti di huruf A.
    if (/^table of drugs/i.test(target.trim())) {
      setPendingSee({ target, src: "drugs", letter: "A" });
      setIdxSrc("drugs");
      return;
    }
    // Tabel neoplasma ada di tab Neoplasma; "Table of land transport" ada di
    // Tabel Khusus (matriks). Keduanya dibuka di baris/daftar yang tepat.
    if (/^table of neoplasms/i.test(target.trim())) {
      setPendingSee({ target, src: "neo", letter: "N" });
      setIdxSrc("neo");
      return;
    }
    if (/^table of land transport/i.test(target.trim())) {
      setIdxSrc("tables");
      setPendingSpecial("land");
      return;
    }
    if (gotoCodeRef(target)) return;
    if (gotoChapter(target)) return;
    const entries = isList ? idxData?.entries : tbl?.entries;
    if (entries && jumpIn(entries, !isList, tblLead, target)) return;
    if (entries && jumpPrefix(entries, !isList, tblLead, target)) return;
    // Rujukan lintas tabel lainnya: pindah tab dulu, lompatan dilakukan
    // setelah tabelnya termuat.
    const tail = splitSeeTarget(target).pop() ?? target;
    setQ(tail.trim().length >= 2 ? tail : target);
  };
  useEffect(() => {
    if (!pendingSee || idxSrc !== pendingSee.src) return;
    const t = tbls[pendingSee.src];
    if (!t) return;
    setPendingSee(null);
    const lead = pendingSee.src === "neo" ? 1 : 0;
    if (pendingSee.letter) {
      const rows = tableBrowse(t.entries, lead).rows;
      const first = rows[pendingSee.letter]?.[0];
      setLetter(pendingSee.letter);
      setQ("");
      if (first !== undefined) {
        keepView.current = true;
        setJump({ i: first, n: Date.now() });
      }
      return;
    }
    jumpIn(t.entries, true, lead, pendingSee.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSee, idxSrc, tbls]);
  // Matriks Tabel Khusus dimuat malas; buka tabelnya begitu datanya siap.
  useEffect(() => {
    if (!pendingSpecial || idxSrc !== "tables" || !special) return;
    setPendingSpecial(null);
    setMatrix(pendingSpecial);
  }, [pendingSpecial, idxSrc, special]);
  useEffect(() => {
    if (!jump) return;
    keepView.current = false;
    listRef.current?.querySelector(`[data-row="${jump.i}"]`)?.scrollIntoView({ block: "center" });
    const tm = setTimeout(() => setJump(null), 3000);
    return () => clearTimeout(tm);
  }, [jump]);
  const openNote = (n: number) => {
    const d = notesRef.current;
    if (!d) return;
    d.open = true;
    d.querySelector(`[data-note="${n}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // Nilai gabungan untuk ketiga jenis tampilan (indeks, tabel, matriks).
  const listLoading = isList ? !idxData : isTbl ? !tbl : !special;
  const listErr = isList ? (idxSrc === "alpha" ? idxErr : extErr) : isTbl ? tblErr : specialErr;
  const listLen = isList ? idxRows.length : isTbl ? tblRows.length : 0;
  const listTotal = isList ? idxTotal : isTbl ? tblTotal : 0;
  const letterCounts = isList ? idxBrowse.counts : isTbl ? tblBrowse.counts : {};

  // Header lengket di atas daftar: saat digulir, tampilkan jalur induk baris
  // teratas (lead term > subterm) supaya pembaca tidak kehilangan konteks —
  // pengganti penanda "continued" di buku cetak.
  const [stickyPath, setStickyPath] = useState<{ i: number; t: string }[]>([]);
  const stickyRaf = useRef(0);
  const stickyOn = mode === "index" && !idxSearching && idxFilter === "all" && (isList || isTbl);
  const syncSticky = () => {
    if (!stickyOn || stickyRaf.current) return;
    stickyRaf.current = requestAnimationFrame(() => {
      stickyRaf.current = 0;
      const box = listRef.current;
      if (!box) return;
      const src: (AlphaEntry | TableEntry)[] = isList ? idxData?.entries ?? [] : tbl?.entries ?? [];
      const lead = isList ? 0 : tblLead;
      const lvl = (i: number) => (isList ? (src[i] as AlphaEntry)[2] : (src[i] as TableEntry)[1]);
      const top = box.getBoundingClientRect().top + 24;
      const els = box.querySelectorAll<HTMLElement>("[data-row]");
      let cur = -1;
      for (const el of els) {
        if (el.getBoundingClientRect().top > top) break;
        cur = Number(el.dataset.row);
      }
      // Belum ada baris yang melewati tepi atas (mis. masih di puncak daftar).
      if (cur < 0 && els.length) cur = Number(els[0].dataset.row);
      const out: { i: number; t: string }[] = [];
      let want = cur >= 0 ? lvl(cur) - 1 : -1;
      for (let k = cur - 1; k >= 0 && want >= lead; k--) {
        if (lvl(k) === want) {
          out.unshift({ i: k, t: src[k][0] });
          want--;
        }
      }
      // Baris teratas adalah lead term: tampilkan dirinya sendiri agar header
      // tidak kosong dan istilah yang terpotong di tepi atas tetap terbaca.
      if (!out.length && cur >= 0) out.push({ i: cur, t: src[cur][0] });
      setStickyPath((prev) => (prev.length === out.length && prev.every((p, n) => p.i === out[n].i) ? prev : out));
    });
  };
  // Hitung ulang saat daftar/huruf berganti (bukan hanya saat digulir).
  useEffect(() => {
    syncSticky();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, idxSrc, mode, idxFilter, idxSearching, listLen]);
  const jumpToRow = (i: number) => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-row="${i}"]`);
    if (!box || !el) return;
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 24;
  };

  const renderIndexRow = (row: { i: number; e: AlphaEntry; path: string | undefined }) => {
    const [term, c, level, page, rawSee, c2] = row.e;
    const see = rawSee && seeUsable(rawSee) ? rawSee : null;
    const path = idxSearching || idxFilter !== "all" ? row.path : undefined;
    const goTerm = c ? () => go(c) : see ? () => gotoSee(see) : null;
    const cOk = c ? !!navTarget(c) : false;
    const c2Ok = c2 ? !!navTarget(c2) : false;
    const lead = level === 0;
    const deep = level >= 2;
    return (
      <div
        key={row.i}
        data-row={row.i}
        className={`flex items-start gap-2 border-b border-slate-100 py-1.5 pr-2 transition hover:bg-teal-50/70 dark:border-white/5 dark:hover:bg-white/5 ${
          jump?.i === row.i ? "bg-amber-50 ring-1 ring-inset ring-amber-300 dark:bg-amber-900/20 dark:ring-amber-700" : ""
        }`}
        style={{ paddingLeft: idxSearching || idxFilter !== "all" ? 8 : 8 + Math.min(level, 6) * 12 }}
      >
        <span className="min-w-0 flex-1">
          {goTerm ? (
            <button
              onClick={goTerm}
              className={`block w-full text-left leading-snug hover:text-teal-700 dark:hover:text-teal-300 ${
                lead
                  ? "text-[13.5px] font-semibold"
                  : deep
                    ? "text-[12.5px] text-slate-600 dark:text-slate-300"
                    : "text-[13.5px]"
              }`}
            >
              {term}
            </button>
          ) : (
            <span
              className={`block leading-snug ${
                lead
                  ? "text-[13.5px] font-semibold"
                  : deep
                    ? "text-[12.5px] text-slate-600 dark:text-slate-300"
                    : "text-[13.5px]"
              }`}
            >
              {term}
            </span>
          )}
          {(path || see) && (
            <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">
              {path}
              {path && see ? " · " : ""}
              {see && (
                <button
                  onClick={() => gotoSee(see)}
                  className="text-left underline decoration-dotted hover:text-teal-700 dark:hover:text-teal-300"
                >
                  {`${t.indexSee}: ${see}`}
                </button>
              )}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          {c ? (
            cOk ? (
              <button
                onClick={() => go(c)}
                title={`${t.detail} — ${c}`}
                className="rounded border border-blue-200 bg-blue-50 px-1.5 py-px font-mono text-[11.5px] font-bold text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:border-sky-500"
              >
                {c}
              </button>
            ) : (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[11.5px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                {c}
              </span>
            )
          ) : (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-200 dark:bg-white/20" />
          )}
          {c2 && c2Ok && (
            <button
              onClick={() => go(c2)}
              title={`${t.detail} — ${c2}`}
              className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px font-mono text-[11.5px] font-bold text-amber-700 transition hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:border-amber-600"
            >
              {c2}
            </button>
          )}
        </span>
        <span className="mt-1 w-11 shrink-0 text-right text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400" title={t.indexPage(page)}>
          {page}
        </span>
      </div>
    );
  };
  const renderTableRow = (row: { i: number; e: TableEntry }) => {
    const [term, level, page, codes, rawSee, mark] = row.e;
    const see = rawSee && seeUsable(rawSee) ? rawSee : null;
    const lead = level <= tblLead;
    const first = codes.find((c) => !!c) ?? null;
    const goFirst = first ? () => go(navCode(first)) : see ? () => gotoSee(see) : null;
    const noteNo = mark === "#" ? 2 : mark === "<>" ? 3 : 0;
    return (
      <div
        key={row.i}
        data-row={row.i}
        className={`border-b border-slate-100 py-1.5 pr-2 transition hover:bg-teal-50/70 dark:border-white/5 dark:hover:bg-white/5 ${
          jump?.i === row.i ? "bg-amber-50 ring-1 ring-inset ring-amber-300 dark:bg-amber-900/20 dark:ring-amber-700" : ""
        }`}
        style={{ paddingLeft: 8 + (idxSearching ? 0 : Math.max(0, level - tblLead) * 14) }}
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            {goFirst ? (
              <span className="flex items-baseline gap-1">
                <button
                  onClick={goFirst}
                  className={`min-w-0 flex-1 text-left text-[13.5px] leading-snug hover:text-teal-700 dark:hover:text-teal-300 ${
                    level < tblLead ? "font-bold" : lead ? "font-semibold" : ""
                  }`}
                >
                  {term}
                </button>
                {noteNo > 0 && <MarkBtn mark={mark!} noteNo={noteNo} onClick={openNote} title={t.tblNoteJump(noteNo)} />}
              </span>
            ) : (
              <span className={`flex items-baseline gap-1 text-[13.5px] leading-snug ${level < tblLead ? "font-bold" : lead ? "font-semibold" : ""}`}>
                <span className="min-w-0 flex-1">{term}</span>
                {noteNo > 0 && <MarkBtn mark={mark!} noteNo={noteNo} onClick={openNote} title={t.tblNoteJump(noteNo)} />}
              </span>
            )}
            {see && (
              <button
                onClick={() => gotoSee(see)}
                className="mt-0.5 block text-left text-[11px] text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
              >
                {t.indexSee}: {see}
              </button>
            )}
          </span>
          <span className="mt-1 w-11 shrink-0 text-right text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400" title={t.indexPage(page)}>
            {page}
          </span>
        </div>
        {codes.some(Boolean) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {codes.map((c, ci) => {
              if (!c) return null;
              const target = navCode(c);
              return data && getNode(data, target) ? (
                <button
                  key={ci}
                  onClick={() => go(target)}
                  title={`${tblCols[ci]} — ${c}`}
                  className={`rounded border px-1.5 py-px font-mono text-[11px] font-bold transition ${TBL_CHIP[ci]}`}
                >
                  {c}
                </button>
              ) : (
                <span
                  key={ci}
                  title={`${tblCols[ci]} — ${c}`}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                >
                  {c}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  const node = data ? getNode(data, sel) : undefined;
  const status = data && node ? codeStatus(data, node) : null;
  const trail = useMemo(() => (data && sel ? breadcrumb(data, sel) : []), [data, sel]);
  const idList = useMemo(
    () => [...(data?.idTerms[sel] ?? []), ...(custom[sel] ?? [])],
    [data, custom, sel]
  );
  const kamusList = data?.idTerms[sel] ?? [];
  const customList = custom[sel] ?? [];
  const note = notes[sel] ?? "";

  const toggle = (code: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else {
        n.add(code);
        go(code);
      }
      return n;
    });

  const renderTree = (codes: string[], depth: number): React.ReactNode =>
    codes.map((c) => {
      const n = data!.nodes[c];
      if (!n) return null;
      const ex = open.has(c);
      const hasKids = n.children.length > 0;
      const isSel = sel === c;
      return (
        <div key={c}>
          <button
            aria-selected={isSel}
            aria-expanded={hasKids ? ex : undefined}
            className={
              "group flex w-full items-center gap-1.5 rounded-lg px-2 py-[5px] text-left text-[13.5px] transition " +
              "hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 " +
              "dark:hover:bg-white/5 " +
              (isSel ? "bg-teal-100 font-semibold dark:bg-teal-900/50" : "")
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (hasKids ? toggle(c) : go(c))}
            title={preferred(n)}
          >
            <span className="flex w-4 flex-none justify-center text-slate-500 dark:text-slate-400">
              {hasKids ? (
                ex ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              ) : (
                <Circle size={6} fill="currentColor" className="opacity-50" />
              )}
            </span>
            <span className="whitespace-nowrap font-mono font-bold text-blue-700 dark:text-sky-300">{n.code}{codeMark(n)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{preferred(n)}</span>
            {markers.has(c) && searching && <span className="dot" title={t.syntaxBody} />}
            {notes[c]?.trim() && <span className="notedot" title={t.notesTitle} />}
          </button>
          {ex && hasKids && renderTree(n.children, depth + 1)}
        </div>
      );
    });

  const doTranslate = async () => {
    if (!node || mtBusy || mt[sel]) return;
    setMtErr(null);
    setMtBusy(true);
    try {
      const keys: string[] = [];
      const texts: string[] = [preferred(node)];
      for (const [k, vals] of Object.entries(node.rubrics)) {
        if (k === "preferred" || k === "preferredLong") continue;
        for (const v of vals.slice(0, 6)) {
          keys.push(k);
          texts.push(rubText(v));
        }
        if (texts.length > 14) break;
      }
      for (const [i, k] of (node.kn ?? []).entries()) {
        keys.push("kn" + i);
        texts.push(`${k.ref}: ${k.text}`);
        if (texts.length > 18) break;
      }
      const out = await translateEnId(texts);
      const rub: Record<string, string[]> = {};
      keys.forEach((k, i) => {
        (rub[k] ??= []).push(out[i + 1]);
      });
      setMt((p) => {
        const next = { ...p, [sel]: { title: out[0], rub } };
        saveLS("icd10-mt-v1", next);
        return next;
      });
      pickMtView(true);
    } catch {
      setMtErr(t.mtFail);
    } finally {
      setMtBusy(false);
    }
  };

  const copyCode = async () => {
    if (!node) return;
    try {
      await navigator.clipboard.writeText(`${node.code} — ${preferred(node)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const saveCustomList = (next: string[]) => {
    setCustom((p) => {
      const obj = { ...p, [sel]: next };
      saveLS(LS_CUSTOM, obj);
      return obj;
    });
  };

  const addTerm = () => {
    if (!newTerm.trim()) return;
    saveCustomList([...(custom[sel] ?? []), newTerm.trim()]);
    setNewTerm("");
  };

  const saveEdit = () => {
    if (editIdx === null || !editVal.trim()) return;
    saveCustomList((custom[sel] ?? []).map((x, j) => (j === editIdx ? editVal.trim() : x)));
    setEditIdx(null);
  };

  const setNote = (code: string, text: string) => {
    setNotes((p) => {
      // Jangan simpan entri kosong: hapus kuncinya agar localStorage & penanda
      // di tree tetap bersih setelah catatan dihapus.
      const next = { ...p };
      if (text) next[code] = text;
      else delete next[code];
      saveLS(LS_NOTES, next);
      return next;
    });
  };

  const goNote = () => {
    const ch = trail[0]?.code;
    if (!ch) return;
    go(ch);
    setTimeout(() => document.getElementById("pengantar")?.scrollIntoView({ behavior: "smooth", block: "start" }), 450);
  };

  const renderLinked = (text: string, key: string | number) => (
    <span key={key}>
      {linkify(text).map((s, i) => {
        if (s.note)
          return (
            <button key={i} className="codelink" onClick={goNote} title={t.noteGo}>
              {s.text}
            </button>
          );
        if (s.morph)
          return (
            <button key={i} className="codelink" onClick={() => openMorph(s.morph!)} title={`${t.morphOpen} — ${s.morph}`}>
              {s.text}
            </button>
          );
        const tgt = s.code && data ? linkTarget(data, s.code) : null;
        if (!tgt) return <span key={i}>{s.text}</span>;
        const n = getNode(data!, tgt);
        const approx = tgt !== s.code;
        return (
          <button
            key={i}
            className="codelink"
            onClick={() => go(tgt)}
            title={`${n ? preferred(n) : tgt}${approx ? ` · ${t.refBase} ${tgt}` : ""}`}
          >
            {s.text}
          </button>
        );
      })}
    </span>
  );

  const collapseAll = () => setOpen(new Set());

  // Persen progres untuk sumber tertentu (null bila tak ada content-length).
  const pctFor = (k: string) => (prog && prog.k === k ? progPct : null);
  const withPct = (s: string, k: string) => {
    const p = pctFor(k);
    return p === null ? s : `${s} ${p}%`;
  };
  const idxSrcKey = idxSrc === "alpha" ? "alpha" : idxSrc;
  const matrixTbl = matrix && special ? special.tables.find((tb) => tb.id === matrix) ?? null : null;

  return (
    <div className="wm-guard flex min-h-dvh flex-col bg-slate-100 text-slate-900 dark:bg-navy-950 dark:text-slate-100 lg:h-dvh">
      {/* ===== Header ===== */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-teal-800 focus:shadow-lg focus:outline focus:outline-2 focus:outline-teal-500 dark:focus:bg-navy-900 dark:focus:text-teal-200"
      >
        {t.skipToContent}
      </a>
      <header className="no-print shrink-0 bg-gradient-to-r from-navy-900 via-navy-800 to-teal-900 text-white shadow-md">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          <div className="flex w-full min-w-0 flex-1 items-center gap-3 sm:w-auto">
            <img src="logo.png" alt="RUANGPMIK" className="h-11 w-auto shrink-0 rounded-md ring-1 ring-white/20" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-tight">
                ICD-10 2010 Browser <span className="text-xs font-normal text-white/70">(EN + Indonesia)</span>
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/70">
                <span className="min-w-0 truncate">
                {data ? t.subtitleStats(data.meta.chapters, data.meta.blocks, data.meta.categories.toLocaleString(lang === "id" ? "id-ID" : "en-US")) : (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" />
                    {withPct(t.loadingData, "icd")}
                  </span>
                )}
                </span>
                <span className="inline-flex shrink-0 items-center rounded-full bg-pmik-orange px-2 py-px text-[11px] font-semibold text-navy-950">
                  Kang Aris | @riz_es
                </span>
              </p>
            </div>
          </div>
          <nav aria-label={t.navSearch} className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-xl bg-white/10 p-1" role="group" aria-label="EN/ID">
              {(["id", "en"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => pickLang(l)}
                  aria-pressed={lang === l}
                  title={l === "id" ? "Bahasa Indonesia" : "English"}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold uppercase transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${lang === l ? "bg-pmik-orange text-navy-950" : "text-white/70 hover:bg-white/20 hover:text-white"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-xl bg-white/10 p-1">
              <HBtn title={t.back} onClick={back} disabled={hi <= 0}><ArrowLeft size={15} /></HBtn>
              <HBtn title={t.fwd} onClick={fwd} disabled={hi >= hist.length - 1}><ArrowRight size={15} /></HBtn>
            </div>
            <div className="flex items-center gap-0.5 rounded-xl bg-white/10 p-1">
              <HBtn title={t.fontDown} onClick={() => setZoom((z) => Math.max(0.85, +(z - 0.1).toFixed(2)))}><ZoomOut size={15} /></HBtn>
              <HBtn title={t.fontUp} onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.1).toFixed(2)))}><ZoomIn size={15} /></HBtn>
              {mounted && (
                <HBtn title={theme === "dark" ? t.toLight : t.toDark} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                </HBtn>
              )}
            </div>
            <div className="flex items-center gap-0.5 rounded-xl bg-white/10 p-1">
              <HBtn title={t.print} onClick={() => window.print()}><Printer size={15} /><span className="max-sm:hidden">{t.print}</span></HBtn>
              <HBtn title={t.guide} onClick={() => setShowGuide(true)}><BookOpen size={15} /><span className="max-sm:hidden">{t.guide}</span></HBtn>
            </div>
          </nav>
        </div>
        {/* Bar progres unduh berkas data (byte nyata) */}
        {prog && (
          <div
            className="h-1 w-full bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progPct ?? undefined}
            aria-label={t.loadingData}
          >
            <div
              className={`h-full bg-gradient-to-r from-teal-300 via-emerald-300 to-pmik-orange ${
                progPct === null ? "w-1/3 animate-pulse" : "transition-[width] duration-150"
              }`}
              style={progPct === null ? undefined : { width: `${progPct}%` }}
            />
          </div>
        )}
      </header>

      {/* ===== Main ===== */}
      <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-[1440px] flex-1 gap-3 p-3 outline-none max-lg:auto-rows-max lg:min-h-0 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* Panel kiri */}
        <section aria-label={t.navSearch} className="no-print flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-navy-900">
          <p aria-live="polite" className="sr-only">
            {mode === "tree" ? (searching ? t.searchAnnounce(hits.length) : "") : idxSearching ? t.searchAnnounce(listLen) : ""}
          </p>
          <div className="shrink-0 space-y-2 border-b border-slate-200 p-3 dark:border-white/10">
            <div role="tablist" aria-label={t.navSearch} onKeyDown={tabKeyNav} className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/5">
              {([
                ["tree", t.modeTree, <ListTree key="t" size={13} />],
                ["index", t.modeIndex, <BookOpen key="i" size={13} />],
              ] as const).map(([m, label, icon]) => (
                <button
                  key={m}
                  id={`tab-${m}`}
                  role="tab"
                  aria-selected={mode === m}
                  aria-controls="left-panel"
                  tabIndex={mode === m ? 0 : -1}
                  onClick={() => setMode(m)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${
                    mode === m
                      ? "bg-white text-teal-700 shadow-sm dark:bg-navy-950 dark:text-teal-300"
                      : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            {mode === "index" && (
              <div role="tablist" aria-label={t.modeIndex} onKeyDown={tabKeyNav} className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/5">
                {([
                  ["alpha", t.idxAlpha, <BookMarked key="a" size={12} />],
                  ["ext", t.idxExt, <Ambulance key="x" size={12} />],
                  ["neo", t.idxNeo, <Dna key="n" size={12} />],
                  ["drugs", t.idxDrugs, <Pill key="d" size={12} />],
                  ["tables", t.idxSpecial, <Table2 key="b" size={12} />],
                ] as const).map(([k, label, icon]) => (
                  <button
                    key={k}
                    id={`tab-${k}`}
                    role="tab"
                    aria-selected={idxSrc === k}
                    aria-controls="left-panel"
                    tabIndex={idxSrc === k ? 0 : -1}
                    onClick={() => setIdxSrc(k)}
                    title={label}
                    className={`flex min-w-0 flex-1 basis-[28%] items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${
                      idxSrc === k
                        ? "bg-white text-teal-700 shadow-sm dark:bg-navy-950 dark:text-teal-300"
                        : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {icon}
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            )}
            {idxSrc !== "tables" && (
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
              <input
                role="searchbox"
                aria-label={t.searchLabel}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100 dark:placeholder:text-slate-400"
                placeholder={mode === "index" ? (idxSrc === "alpha" ? t.indexPh : idxSrc === "ext" ? t.idxExtPh : t.indexTblPh) : t.searchPh}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  aria-label={t.clearSearch}
                  title={t.clearSearch}
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            )}
            {mode === "tree" ? (
              <>
            <details className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200/70 dark:bg-white/5 dark:ring-white/10">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-300">
                <Info size={13} className="shrink-0" />
                {t.syntaxTitle(searching ? hits.length : null)}
              </summary>
              <div className="space-y-1.5 px-2.5 pb-2.5">
                <div className="flex flex-wrap gap-1">
                  {["cholera", "diab* & nephro?", "A00 | A01", "tubercul* (lung | larynx)"].map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setQ(ex)}
                      title={ex}
                      className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-blue-700 ring-1 ring-slate-200 transition hover:ring-teal-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:bg-navy-950 dark:text-sky-300 dark:ring-white/10 dark:hover:ring-teal-500"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <p className="m-0 leading-relaxed text-slate-500 dark:text-slate-400">{t.syntaxBody}</p>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <GBtn onClick={collapseAll} title={t.collapseAll}><ListCollapse size={14} /> {t.collapseAll}</GBtn>
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-slate-600 dark:text-slate-300" title={t.validOnlyTitle}>
                <input type="checkbox" className="accent-teal-600" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} />
                {t.validOnly}
              </label>
            </div>
            <fieldset className="m-0 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200/70 dark:bg-white/5 dark:ring-white/10">
              <legend className="sr-only">{t.scopeLegend}</legend>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t.searchIn}</p>
              <div className="flex flex-wrap gap-1.5">
                {SCOPE_KEYS.map((k) => (
                  <label
                    key={k}
                    title={t.scope[k]}
                    className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition focus-within:outline focus-within:outline-2 focus-within:outline-teal-500 ${
                      scope[k]
                        ? "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900/60 dark:text-teal-200 dark:ring-teal-700"
                        : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300 dark:bg-navy-950 dark:text-slate-400 dark:ring-white/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={scope[k]}
                      onChange={(e) => setScope((s) => ({ ...s, [k]: e.target.checked }))}
                    />
                    {scope[k] && <Check size={12} />}
                    {t.scope[k]}
                  </label>
                ))}
              </div>
            </fieldset>
              </>
            ) : idxSrc === "tables" ? (
              <p className="m-0 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                <Info size={12} className="mt-0.5 shrink-0" />
                {t.specialHint}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1" role="group" aria-label="A–Z">
                  {ALPHA_LETTERS.map((L) => {
                    const n = letterCounts[L] ?? 0;
                    const active = !idxSearching && letter === L;
                    return (
                      <button
                        key={L}
                        onClick={() => {
                          setLetter(L);
                          setQ("");
                        }}
                        disabled={n === 0}
                        aria-pressed={active}
                        title={`${L} — ${n}`}
                        className={`h-6 w-6 rounded-md text-[11.5px] font-semibold transition disabled:opacity-30 ${
                          active
                            ? "bg-teal-700 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-teal-100 hover:text-teal-800 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-teal-900/40"
                        }`}
                      >
                        {L}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t.idxFilterTitle}>
                  {(["all", "lead", "sub"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setIdxFilter(k)}
                      aria-pressed={idxFilter === k}
                      title={t.idxFilterTitle}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${
                        idxFilter === k
                          ? "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900/60 dark:text-teal-200 dark:ring-teal-700"
                          : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300 dark:bg-navy-950 dark:text-slate-400 dark:ring-white/10"
                      }`}
                    >
                      {k === "all" ? t.idxFilterAll : k === "lead" ? t.idxFilterLead : t.idxFilterSub}
                    </button>
                  ))}
                </div>
                <p className="m-0 flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <ListOrdered size={11} className="shrink-0" />
                    {idxData ? t.indexCount(idxData.meta.count) : withPct(t.indexLoading, idxSrcKey)}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate">
                      {idxSrc === "alpha"
                        ? t.indexSource
                        : idxData
                          ? t.idxExtSrc(idxData.meta.pages.replace("-", "–"))
                          : tbl
                            ? t.idxTblSrc(tbl.meta.pages.replace("-", "–"))
                            : ""}
                    </span>
                  </span>
                </p>
              </>
            )}
          </div>
          <div
            ref={listRef}
            id="left-panel"
            role="tabpanel"
            aria-labelledby={mode === "tree" ? "tab-tree" : `tab-${idxSrc}`}
            onScroll={syncSticky}
            className="min-h-[240px] flex-1 overflow-y-auto p-2 max-lg:max-h-[50vh]"
          >
            {mode === "index" ? (
              idxSrc === "tables" ? (
                specialErr ? (
                  <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {specialErr}
                  </p>
                ) : !special ? (
                  <div className="space-y-2 p-1" aria-hidden>
                    {[0, 1].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" />
                    ))}
                    <p className="pt-1 text-center text-[13px] text-slate-500 dark:text-slate-400">{withPct(t.indexLoading, "special")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {special.tables.map((tb) => (
                      <button
                        key={tb.id}
                        onClick={() => setMatrix(tb.id)}
                        className="group flex w-full items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-teal-400 hover:bg-teal-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-white/10 dark:bg-navy-950 dark:hover:border-teal-500 dark:hover:bg-teal-900/20"
                      >
                        <span className="mt-0.5 rounded-md bg-teal-100 p-1.5 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
                          {tb.id === "land" ? <Ambulance size={15} /> : <Table2 size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-snug group-hover:text-teal-700 dark:group-hover:text-teal-300">
                            {tb.title[lang]}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-0.5"><ListOrdered size={10} /> {t.specialRows(tb.rows.length)}</span>
                            <span className="inline-flex items-center gap-0.5"><FileText size={10} /> {t.specialPages(tb.pages.replace("-", "–"))}</span>
                            <span className="inline-flex items-center gap-0.5"><ChevronRight size={10} /> {t.specialOpen}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )
              ) : listErr ? (
                <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {listErr}
                </p>
              ) : listLoading ? (
                <div className="space-y-2 p-1" aria-hidden>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div key={i} className="h-7 animate-pulse rounded-md bg-slate-100 dark:bg-white/5" style={{ marginLeft: (i % 3) * 10 }} />
                  ))}
                  <p className="pt-1 text-center text-[13px] text-slate-500 dark:text-slate-400">{withPct(t.indexLoading, idxSrcKey)}</p>
                </div>
              ) : listLen === 0 ? (
                <div className="px-3 py-10 text-center">
                  <SearchX size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
                  <p className="mt-2 text-sm font-medium">{isTbl ? t.tblEmpty : t.indexEmpty}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.indexHint}</p>
                </div>
              ) : (
                <>
                  {stickyOn && (
                    <div className="sticky -top-2 z-10 -mx-2 -mt-2 mb-1 flex min-h-[24px] items-center border-b border-teal-200 bg-teal-50 px-2 py-1 text-[12.5px] dark:border-teal-900/70 dark:bg-teal-950/70">
                      {stickyPath.length > 0 && (
                        <button
                          onClick={() => jumpToRow(stickyPath[0].i)}
                          className="flex min-w-0 items-center gap-1 text-left font-medium text-teal-800 transition hover:text-teal-900 dark:text-teal-200 dark:hover:text-teal-100"
                        >
                          <ArrowUp size={12} className="shrink-0 opacity-70" aria-hidden />
                          <span className="truncate">{stickyPath.map((p) => p.t).join(" › ")}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {isTbl && (
                    <div className="mb-1 flex flex-wrap gap-x-2.5 gap-y-0.5 rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-500 dark:bg-white/5 dark:text-slate-400">
                      {tblCols.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <i className={`h-2 w-2 shrink-0 rounded-sm ${TBL_DOT[i]}`} aria-hidden />
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {isTbl && tbl?.meta.notes?.length ? (
                    <details
                      ref={notesRef}
                      className="mb-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 dark:border-amber-900/50 dark:bg-amber-950/20"
                    >
                      <summary className="cursor-pointer text-[11.5px] font-medium text-amber-800 dark:text-amber-300">
                        {t.tblNotes(tbl.meta.notes.length)}
                      </summary>
                      <div className="mt-1 space-y-1.5 pb-1">
                        {tbl.meta.notes.map((n) => (
                          <p
                            key={n.n}
                            data-note={n.n}
                            className="text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300"
                          >
                            {lang === "en" ? n.en : n.id ?? n.en}
                          </p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {isList ? idxRows.map(renderIndexRow) : tblRows.map(renderTableRow)}
                  <p className="m-0 px-2 py-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    {t.indexShowing(listLen, listTotal)}
                  </p>
                  {!idxSearching && listTotal > listLen && (
                    <div className="px-2 pb-3 text-center">
                      <button
                        onClick={() => setIdxLimit((n) => n + 400)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-teal-400 hover:text-teal-700 dark:border-white/15 dark:bg-navy-950 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-300"
                      >
                        {t.idxMore}
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  )}
                </>
              )
            ) : (
              <>
            {err && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {err}
              </p>
            )}
            {!data && !err && (
              <div className="space-y-2 p-1" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="h-7 animate-pulse rounded-md bg-slate-100 dark:bg-white/5" style={{ marginLeft: (i % 3) * 14 }} />
                ))}
                <p className="pt-1 text-center text-[13px] text-slate-500 dark:text-slate-400">{withPct(t.loadingJson, "icd")}</p>
              </div>
            )}
            {searching ? (
              hits.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <SearchX size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
                  <p className="mt-2 text-sm font-medium">{t.noResult(q)}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.noResultHint}</p>
                </div>
              ) : (
                hits.map((h) => (
                  <button
                    key={h.code}
                    onClick={() => {
                      go(h.code);
                      setOpen((prev) => {
                        const n = new Set(prev);
                        breadcrumb(data!, h.code).forEach((tr) => n.add(tr.code));
                        return n;
                      });
                    }}
                    className="block w-full rounded-lg border-b border-slate-100 px-2.5 py-2 text-left transition hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-white/5 dark:hover:bg-white/5"
                  >
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="font-mono text-[13px] font-bold text-blue-700 dark:text-sky-300">{h.code}{data ? codeMark(getNode(data, h.code)) : ""}</span>
                      <Badge tone="sky">{t.kind[h.kind] ?? h.kind}</Badge>
                      {data!.nodes[h.code]?.meta?.term === 1 && <Badge tone="emerald"><BadgeCheck size={12} /> {t.valid}</Badge>}
                      {data!.nodes[h.code]?.meta?.aster === 1 && <Badge tone="amber"><Asterisk size={12} /></Badge>}
                      {h.src.map((s) => (
                        <span key={s} className={"src src-" + s} title={t.scope[s] ?? s}>
                          {t.scope[s] ?? s}
                        </span>
                      ))}
                      {notes[h.code] && <Badge tone="amber">{t.noteBadge}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] leading-snug">{h.en}</span>
                    {h.id && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{h.id}</span>}
                  </button>
                ))
              )
            ) : (
              data && renderTree(data.chapters, 0)
            )}
              </>
            )}
          </div>
        </section>

        {/* Panel kanan */}
        <section aria-label={t.detail} className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-navy-900">
          <div ref={paneRef} className="min-h-[300px] flex-1 overflow-y-auto" style={{ fontSize: `${zoom}em` }}>
            <div className="p-4 sm:p-5">
            {!node ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t.selectHint}</p>
            ) : (
              <>
                <div id="detail-head" className="static z-20 -mx-4 border-b border-slate-100 bg-white/95 px-4 pb-2 pt-4 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:-mx-5 sm:px-5 sm:pt-5 lg:sticky lg:top-0 print:static print:m-0 print:border-0 print:bg-transparent print:p-0 print:backdrop-blur-none dark:border-white/10 dark:bg-navy-900/95 dark:supports-[backdrop-filter]:bg-navy-900/85">
                <nav aria-label={t.breadcrumb} className="mb-2 flex flex-wrap items-center gap-0.5 text-[12.5px] text-slate-500 print:hidden dark:text-slate-400">
                  {trail.map((tr, i) => (
                    <span key={tr.code} className="flex items-center gap-0.5">
                      {i > 0 && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />}
                      <button onClick={() => go(tr.code)} title={preferred(tr)} className="rounded px-0.5 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500">
                        {tr.code}
                      </button>
                    </span>
                  ))}
                </nav>
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="m-0 font-mono text-[22px] font-bold leading-tight text-navy-900 dark:text-sky-200">{node.code}{codeMark(node)}</h2>
                  <Badge tone="sky">{t.kind[node.kind] ?? node.kind}</Badge>
                  {status?.t === "valid" && (
                    <Badge tone="emerald" title={t.validTitle(status.len)}>
                      <BadgeCheck size={12} /> {t.validForCoding}
                    </Badge>
                  )}
                  {status?.t === "semi" && (
                    <Badge tone="amber" title={(status.opt ? t.semiValidOptTitle : t.semiValidTitle)(status.pos, status.n, status.eg.slice(0, 4).join(", "))}>
                      {t.semiValid(status.pos)}
                    </Badge>
                  )}
                  {status?.t === "none" && node.meta?.term === 0 && node.kind === "category" && (
                    <Badge tone="amber" title={t.notFinalTitle}>{t.notFinal}</Badge>
                  )}
                  {(node.meta?.aster === 1 || node.usage === "aster") && <Badge tone="amber"><Asterisk size={12} /> {t.asteriskM}</Badge>}
                  {node.usage === "dagger" && <Badge tone="amber"><Sword size={12} /> {t.daggerE}</Badge>}
                  {trail[0]?.code === "II" && node.kind === "category" && (
                    <button
                      onClick={() => openMorph()}
                      title={`${t.morphOpen} — ${t.morphTitle}`}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${TONE.violet}`}
                    >
                      <Dna size={12} /> {t.morphBadge}
                    </button>
                  )}
                  {idList.length > 0 && <Badge tone="emerald"><Languages size={12} /> {t.idTermsN(idList.length)}</Badge>}
                  <span className="no-print ml-auto flex items-center gap-1.5">
                    {mt[sel] ? (
                      <span className="flex items-center rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200 dark:bg-navy-950 dark:ring-white/10" role="group" aria-label={t.mtBtn}>
                        {([false, true] as boolean[]).map((v) => (
                          <button
                            key={String(v)}
                            onClick={() => pickMtView(v)}
                            aria-pressed={showMt === v}
                            className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${
                              showMt === v
                                ? "bg-teal-700 text-white shadow-sm"
                                : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            }`}
                          >
                            {v ? t.mtViewTr : t.mtViewOrig}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <GBtn onClick={doTranslate} title={t.mtBtn}>
                        {mtBusy ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}{" "}
                        {mtBusy ? t.mtLoading : t.mtBtn}
                      </GBtn>
                    )}
                    <GBtn onClick={copyCode} title={t.copyTitle}>
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t.copied : t.copyCode}
                    </GBtn>
                  </span>
                </div>
                {mtBusy && <p className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400"><Loader2 size={13} className="animate-spin" /> {t.mtLoading}</p>}
                {mtErr && <p className="mt-1 text-[13px] text-red-600 dark:text-red-300">{mtErr}</p>}
                {showMt && mt[sel] && <p className="mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400">{t.mtNote}</p>}
                {showMt && mt[sel] ? (
                  <p className="mb-1 mt-1.5 text-[17px] font-medium leading-snug">
                    {mt[sel].title} <Badge tone="sky">MT</Badge>
                  </p>
                ) : (
                  <p className="mb-0 mt-1.5 text-[17px] font-medium leading-snug">{preferred(node)}</p>
                )}
                </div>
                {(node.meta?.disp || node.meta?.morb || (node.meta?.mort ?? []).length > 0) && (
                  <dl className="mb-1 mt-2 flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[13px] ring-1 ring-slate-200/70 dark:bg-white/5 dark:ring-white/10">
                    {node.meta?.disp && (
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t.whoForm.replace(/:$/, "")}</dt>
                        <dd className="m-0 font-mono font-bold text-blue-700 dark:text-sky-300">{node.meta.disp}</dd>
                      </div>
                    )}
                    {node.meta?.morb && (
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t.morb.replace(/:$/, "")}</dt>
                        <dd className="m-0 rounded bg-white px-1.5 py-px font-mono text-[12px] ring-1 ring-slate-200 dark:bg-navy-950 dark:ring-white/10">{node.meta.morb}</dd>
                      </div>
                    )}
                    {(node.meta?.mort ?? []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <dt className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t.mort.replace(/:$/, "")}</dt>
                        {node.meta!.mort.map((m) => (
                          <dd key={m} className="m-0 rounded bg-white px-1.5 py-px font-mono text-[12px] ring-1 ring-slate-200 dark:bg-navy-950 dark:ring-white/10">{m}</dd>
                        ))}
                      </div>
                    )}
                  </dl>
                )}

                {node.qc && (
                  <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <SecTitle icon={<ShieldAlert size={14} />}>{t.qcTitle}</SecTitle>
                    <ul className="m-0 list-none space-y-1 p-0 text-sm leading-relaxed">
                      {node.qc.sex === "M" && <li>{t.qcSexM}</li>}
                      {node.qc.sex === "F" && <li>{t.qcSexF}</li>}
                      {node.qc.ast === 1 && <li>{t.qcAst}</li>}
                      {node.qc.seq === 1 && <li>{t.qcSeq}</li>}
                      {node.qc.pp === 1 && <li>{t.qcPp}</li>}
                    </ul>
                  </div>
                )}

                {data && effectiveMods(data, node).map((m) => {
                  const pos = /_(\d)$/.exec(m.code)?.[1] ?? "?";
                  // subFull() butuh kode induk sesuai posisi digit: 3 karakter untuk
                  // karakter ke-4, 5 karakter untuk karakter ke-5. Saat membuka kode
                  // 4/5 karakter (mis. F10.2, V01.00), tetap pakai induknya agar baris bisa diklik.
                  const base = pos === "5" ? node.code.slice(0, 5) : node.code.slice(0, 3);
                  // Baris aktif: kode node sendiri untuk karakter ke-5, atau leluhur
                  // 5-karakter untuk karakter ke-4 (V01.00 → baris V01.0 ikut aktif).
                  const own = pos === "5" ? node.code : node.code.slice(0, 5);
                  const activeSub = m.subs.find((s) => subFull(base, m.code, s.c) === own);
                  // Karakter ke-5 baru punya kode setelah karakter ke-4 dipilih.
                  const needFourth = pos === "5" && node.code.length < 5;
                  // Hanya lipat bila ada baris aktif dan daftarnya panjang.
                  const collapsible = !!activeSub && m.subs.length > 3;
                  // Modifier yang menghasilkan kode yang sudah ada sebagai node nyata
                  // (mis. place of occurrence pada X34 yang sudah punya .0-.9) tidak
                  // ditampilkan — labelnya akan menimpa makna kode asli.
                  const collides = m.subs.some((s) => {
                    const full = subFull(base, m.code, s.c);
                    return !!full && !!data.nodes[full];
                  });
                  if (collides) return null;
                  // Daftar subdivisi: dipakai baik di dalam <details> (bisa dilipat)
                  // maupun langsung (tanpa pelipatan).
                  const list = (
                        <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                        {m.subs.map((s) => {
                          const full = subFull(base, m.code, s.c);
                          const active = full === own;
                          const row = (
                            <>
                              <span className="shrink-0 rounded-md bg-white px-1.5 py-px font-mono font-bold text-blue-700 ring-1 ring-teal-200 dark:bg-navy-950 dark:text-sky-300 dark:ring-teal-800">
                                {s.c}
                              </span>
                              <span>
                                {s.label}
                                {full && !active && (
                                  <span className="text-slate-500 dark:text-slate-400"> — <span className="font-mono">{full}</span></span>
                                )}
                                {s.usage === "dagger" && <span title={t.daggerE}> †</span>}
                                {s.usage === "aster" && <span title={t.asteriskM}> *</span>}
                              </span>
                            </>
                          );
                          return (
                            <li key={s.c} className="flex items-baseline gap-2 text-sm">
                              {full ? (
                                <button
                                  onClick={() => go(full)}
                                  title={full}
                                  aria-current={active ? "true" : undefined}
                                  className={`flex items-baseline gap-2 rounded-md px-1 py-0.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${
                                    active
                                      ? "bg-white font-medium ring-1 ring-teal-400 dark:bg-white/10 dark:ring-teal-600"
                                      : "hover:bg-white/70 dark:hover:bg-white/10"
                                  }`}
                                >
                                  {row}
                                </button>
                              ) : (
                                <span className="flex items-baseline gap-2 px-1 py-0.5">{row}</span>
                              )}
                            </li>
                          );
                        })}
                        </ul>
                  );
                  return (
                    <div key={m.code} className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800 dark:bg-teal-950/30">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SecTitle icon={<ListOrdered size={14} />}>{t.subdiv(pos)}</SecTitle>
                        {m.optional && <Badge tone="emerald">{t.subdivOpt}</Badge>}
                      </div>
                      {m.intro && <p className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">{m.intro}</p>}
                      {needFourth && <p className="mb-2 text-[13px] font-medium text-teal-800 dark:text-teal-200">{t.subdivNeedFourth}</p>}
                      {/* Saat membuka kode subdivisi (mis. F10.2), tampilkan hanya baris aktif;
                          sisanya dilipat agar konten WHO tidak terdorong jauh ke bawah. */}
                      <div className="flex flex-col">
                      {collapsible ? (
                        <details key={`${m.code}-${node.code}`} className="group order-2">
                          <summary className="flex cursor-pointer select-none items-center gap-1 rounded text-[12px] font-semibold text-teal-700 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300">
                            <ChevronDown size={13} className="transition group-open:rotate-180" />
                            <span className="group-open:hidden">{t.subdivShowAll(m.subs.length)}</span>
                            <span className="hidden group-open:inline">{t.subdivHide}</span>
                          </summary>
                          {list}
                        </details>
                      ) : (
                        <div className="order-2">{list}</div>
                      )}
                      {collapsible && (
                        <p className="subdiv-active order-1 mb-1.5 flex items-baseline gap-2 rounded-md bg-white px-1 py-0.5 text-sm font-medium ring-1 ring-teal-400 dark:bg-white/10 dark:ring-teal-600">
                          <span className="shrink-0 rounded-md bg-white px-1.5 py-px font-mono font-bold text-blue-700 ring-1 ring-teal-200 dark:bg-navy-950 dark:text-sky-300 dark:ring-teal-800">
                            {activeSub!.c}
                          </span>
                          <span>
                            {activeSub!.label}
                            {activeSub!.usage === "dagger" && <span title={t.daggerE}> †</span>}
                            {activeSub!.usage === "aster" && <span title={t.asteriskM}> *</span>}
                          </span>
                        </p>
                      )}
                      </div>
                      <p className="mb-0 mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t.subdivNote}</p>
                    </div>
                  );
                })}

                {(node.kn ?? []).length > 0 && (
                  <div className="mt-4">
                    <SecTitle icon={<BookMarked size={14} />}>{t.knTitle}</SecTitle>
                    <div className="space-y-2">
                      {node.kn!.map((k, i) => (
                        <div key={i} className="rounded-lg border border-sky-200 bg-sky-50/60 p-2.5 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950/30">
                          <Badge tone="sky">{k.ref}</Badge>
                          <p className="mb-0 mt-1">
                            {showMt && mt[sel]?.rub["kn" + i] ? (
                              <>{mt[sel].rub["kn" + i]} <Badge tone="sky">MT</Badge></>
                            ) : (
                              k.text
                            )}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.entries(node.rubrics)
                  .filter(([k]) => k !== "preferred" && k !== "preferredLong")
                  .map(([k, vals]) => {
                    // Kelompokkan: subjudul + paragraf-paragrafnya jadi satu kartu catatan
                    const groups: { h: string | null; items: { v: RubricVal; i: number }[] }[] = [];
                    for (const [i, v] of vals.entries()) {
                      if (typeof v !== "string" && v.h === 1) groups.push({ h: v.t, items: [] });
                      else {
                        if (groups.length === 0) groups.push({ h: null, items: [] });
                        groups[groups.length - 1].items.push({ v, i });
                      }
                    }
                    const flat = groups.every((g) => g.h === null);
                    return (
                      <div className="mt-4 scroll-mt-32" key={k} id={k === "introduction" ? "pengantar" : undefined}>
                        <SecTitle icon={<FileText size={14} />}>{t.rubric[k] ?? k}</SecTitle>
                        {flat ? (
                          <ul className="my-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                            {vals.map((v, i) =>
                              showMt && mt[sel]?.rub[k]?.[i] ? (
                                <li key={i}>
                                  {mt[sel].rub[k][i]} <Badge tone="sky">MT</Badge>
                                </li>
                              ) : (
                                <li key={i}>{renderLinked(rubText(v), i)}</li>
                              )
                            )}
                          </ul>
                        ) : (
                          <div className="space-y-2.5">
                            {groups.map((g, gi) => (
                              <div
                                key={gi}
                                className={
                                  g.h
                                    ? "rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/5"
                                    : "my-1"
                                }
                              >
                                {g.h && (
                                  <p className="mb-1.5 text-sm font-bold text-navy-900 dark:text-sky-200">{g.h}</p>
                                )}
                                {g.items.map(({ v, i }) => (
                                  <p key={i} className="mb-1.5 text-sm leading-relaxed last:mb-0">
                                    {showMt && mt[sel]?.rub[k]?.[i] ? (
                                      <>{mt[sel].rub[k][i]} <Badge tone="sky">MT</Badge></>
                                    ) : (
                                      renderLinked(rubText(v), i)
                                    )}
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                <div className="mt-4">
                  <SecTitle icon={<Languages size={14} />}>{t.idTitle}</SecTitle>
                  {(kamusList.length === 0 && customList.length === 0) ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t.idEmpty}</p>
                  ) : (
                    <ul className="my-1 list-disc space-y-1 pl-5 text-sm">
                      {kamusList.map((term, i) => <li key={"k" + i}>{term}</li>)}
                      {customList.map((term, i) => (
                        <li key={"c" + i}>
                          {editIdx === i ? (
                            <span className="no-print flex flex-wrap items-center gap-1.5">
                              <input
                                autoFocus
                                className="min-w-[140px] flex-1 rounded-md border border-teal-400 bg-white px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:bg-navy-950"
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit();
                                  if (e.key === "Escape") setEditIdx(null);
                                }}
                              />
                              <button onClick={saveEdit} title={t.termSave} aria-label={t.termSave} className="rounded-md p-1 text-teal-600 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-white/10">
                                <Check size={14} />
                              </button>
                              <button onClick={() => setEditIdx(null)} title={t.termCancel} aria-label={t.termCancel} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10">
                                <X size={14} />
                              </button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <span className="flex-1">{term}</span>
                              <span className="no-print inline-flex items-center gap-0.5">
                                <button
                                  onClick={() => { setEditIdx(i); setEditVal(term); }}
                                  title={t.termEdit}
                                  aria-label={`${t.termEdit}: ${term}`}
                                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-teal-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-teal-300"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => saveCustomList(customList.filter((_, j) => j !== i))}
                                  title={t.termDelTitle(term)}
                                  aria-label={t.termDelTitle(term)}
                                  className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-red-400"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="no-print mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[13px] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-white/15 dark:bg-navy-950"
                      aria-label={t.idAddLabel}
                      placeholder={t.idAddPh}
                      value={newTerm}
                      onChange={(e) => setNewTerm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addTerm();
                      }}
                    />
                    <button
                      className="flex items-center gap-1.5 rounded-lg bg-pmik-orange px-4 py-2 text-[13px] font-semibold text-navy-950 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400"
                      onClick={addTerm}
                    >
                      <Plus size={14} /> {t.add}
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SecTitle icon={<StickyNote size={14} />}>{t.notesTitle}</SecTitle>
                    {note && (
                      <button
                        onClick={() => setNote(sel, "")}
                        className="mb-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 print:hidden dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      >
                        <Trash2 size={12} /> {t.notesClear}
                      </button>
                    )}
                  </div>
                  <textarea
                    aria-label={t.notesLabel(sel)}
                    className="w-full resize-y rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 print:hidden dark:border-amber-800 dark:bg-amber-950/30"
                    rows={Math.min(14, Math.max(3, note.split("\n").length + 1))}
                    placeholder={t.notesPh}
                    value={note}
                    onChange={(e) => setNote(sel, e.target.value)}
                  />
                  {note.trim() && (
                    <>
                      <p className="mb-0 mt-1 hidden whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm print:block">{note}</p>
                      <p className="mb-0 mt-1 text-[11.5px] text-slate-500 print:hidden dark:text-slate-400">{t.notesMeta(note.length)}</p>
                    </>
                  )}
                </div>

                {node.children.length > 0 && (
                  <div className="no-print mt-4">
                    <SecTitle icon={<ListTree size={14} />}>{t.subcats(node.children.length)}</SecTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {node.children.map((c) => (
                        <button key={c} onClick={() => go(c)} title={data ? preferred(data.nodes[c]) : c} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12.5px] transition hover:border-teal-400 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-white/15 dark:hover:border-teal-500 dark:hover:text-teal-300">
                          <span className="font-mono font-bold">{c}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </div>
        </section>
      </main>

      <footer className="no-print mx-auto w-full max-w-[1440px] shrink-0 px-4 pb-3 text-xs text-slate-600 dark:text-slate-400">
        {t.footerMid}{" "}
        <a className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-300" href="https://icd.who.int/browse10/2010/en" target="_blank" rel="noreferrer">WHO Browser 2010 <ExternalLink size={11} /></a> •{" "}
        <a className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-300" href="https://icd.who.int/browse10/Content/statichtml/ICD10Volume2_en_2010.pdf" target="_blank" rel="noreferrer">Manual Vol.2 (PDF) <ExternalLink size={11} /></a> •{" "}
        <a className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-300" href="https://icd.who.int/browse10/Help/en" target="_blank" rel="noreferrer">User Guide <ExternalLink size={11} /></a>
      </footer>

      {matrixTbl && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-3 backdrop-blur-[2px]"
          onClick={() => setMatrix(null)}
        >
          <div
            ref={matrixDlg}
            role="dialog"
            aria-modal="true"
            aria-label={matrixTbl.title[lang]}
            className="flex max-h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-navy-900"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-start gap-2.5 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <span className="mt-0.5 rounded-md bg-teal-100 p-1.5 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
                {matrixTbl.id === "land" ? <Ambulance size={16} /> : <Table2 size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-[15px] font-bold leading-tight">{matrixTbl.title[lang]}</h2>
                <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-0.5"><FileText size={10} /> {t.specialPages(matrixTbl.pages.replace("-", "–"))}</span>
                  <span className="inline-flex items-center gap-0.5"><ListOrdered size={10} /> {t.specialRows(matrixTbl.rows.length)}</span>
                  <span className="inline-flex items-center gap-0.5"><Table2 size={10} /> {matrixTbl.cols.length} {t.specialCols.toLowerCase()}</span>
                </p>
              </div>
              <button
                onClick={() => setMatrix(null)}
                aria-label={t.close}
                title={t.close}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </header>

            <div className="shrink-0 space-y-1 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11.5px] leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <p className="m-0">{matrixTbl.note[lang]} <span className="text-slate-500 dark:text-slate-400">{t.specialClick}</span></p>
              {matrixTbl.families && (
                <p className="m-0 flex flex-wrap items-center gap-1">
                  <span className="text-slate-500 dark:text-slate-400">{t.specialFamily}:</span>
                  {matrixTbl.families.map((c) => (
                    <button
                      key={c}
                      onClick={() => { go(c); setMatrix(null); }}
                      className="rounded border border-teal-200 bg-teal-50 px-1.5 py-px font-mono text-[11px] font-bold text-teal-800 transition hover:border-teal-400 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                    >
                      {c}
                    </button>
                  ))}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-slate-100 px-2.5 py-1.5 text-left align-bottom text-[10.5px] font-semibold uppercase tracking-wide text-slate-600 dark:border-white/10 dark:bg-navy-800 dark:text-slate-400"
                    >
                      {matrixTbl.families ? t.specialTermHead : t.specialRowHead}
                    </th>
                    {matrixTbl.cols.map((c, i) => (
                      <th
                        key={i}
                        scope="col"
                        className="min-w-[82px] border-b border-l border-slate-200 bg-slate-100 px-1.5 py-1.5 align-bottom text-left text-[10.5px] font-semibold leading-tight text-slate-600 dark:border-white/10 dark:bg-navy-800 dark:text-slate-300"
                      >
                        <span className="block font-mono text-[10px] font-bold text-teal-700 dark:text-teal-300">{i + 1}</span>
                        {c}
                        {matrixTbl.colSuffix[i] && (
                          <span className="mt-0.5 block font-mono text-[10px] font-normal text-slate-500 dark:text-slate-400">
                            {matrixTbl.colSuffix[i]}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixTbl.rows.map((r, ri) => {
                    const [term, level, , cells] = r;
                    const isGroup = r[5] === "group" || level === 0;
                    const bg = isGroup ? "bg-slate-50 dark:bg-white/5" : "bg-white dark:bg-navy-900";
                    return (
                      <tr key={ri} className={isGroup ? "" : "hover:bg-teal-50/40 dark:hover:bg-white/5"}>
                        <th
                          scope="row"
                          className={`sticky left-0 z-10 border-b border-r border-slate-100 px-2.5 py-1 text-left font-normal dark:border-white/5 ${bg}`}
                        >
                          <span
                            className={`block leading-snug ${isGroup ? "font-semibold" : ""} ${level >= 2 ? "text-[11.5px] text-slate-600 dark:text-slate-300" : "text-[12px]"}`}
                            style={{ paddingLeft: Math.max(0, level) * 12 }}
                          >
                            {term}
                          </span>
                        </th>
                        {matrixTbl.cols.map((_, ci) => {
                          const raw = cells[ci] ?? "";
                          const target = cellTarget(matrixTbl, raw, ci);
                          const live = target && data && getNode(data, target) ? target : null;
                          const expanded =
                            !target && raw.startsWith(".") && matrixTbl.families
                              ? matrixTbl.families
                                  .filter((f) => f !== "O08")
                                  .map((f) => f + raw)
                                  .join(", ")
                              : "";
                          return (
                            <td
                              key={ci}
                              className={`border-b border-l border-slate-100 px-1 py-1 text-center align-middle dark:border-white/5 ${bg}`}
                            >
                              {!raw ? null : /^[–—-]+$/.test(raw) ? (
                                <span aria-hidden className="text-slate-500 dark:text-slate-400">-</span>
                              ) : live ? (
                                <button
                                  onClick={() => { go(live); setMatrix(null); }}
                                  title={`${matrixTbl.cols[ci]} — ${raw}`}
                                  className="rounded border border-teal-200 bg-teal-50 px-1.5 py-px font-mono text-[11px] font-bold text-teal-800 transition hover:border-teal-400 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:border-teal-500"
                                >
                                  {raw}
                                </button>
                              ) : (
                                <span
                                  title={target ? `${raw} — ${t.specialCellNo}` : expanded ? `${expanded} — ${t.specialSuffix}` : t.specialSuffix}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                                >
                                  {raw}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
              <span>{t.idxTblSrc(matrixTbl.pages.replace("-", "–"))}</span>
              <button
                onClick={() => setMatrix(null)}
                className="inline-flex items-center gap-1 rounded-lg bg-pmik-orange px-3 py-1.5 text-[12px] font-semibold text-navy-950 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400"
              >
                <X size={13} /> {t.close}
              </button>
            </footer>
          </div>
        </div>
      )}

      {morphOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-3 backdrop-blur-[2px]"
          onClick={() => setMorphOpen(false)}
        >
          <div
            ref={morphDlg}
            role="dialog"
            aria-modal="true"
            aria-label={t.morphTitle}
            className="flex max-h-[90vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-navy-900"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-start gap-2.5 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <span className="mt-0.5 rounded-md bg-violet-100 p-1.5 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                <Dna size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-[15px] font-bold leading-tight">{t.morphTitle}</h2>
                <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-0.5"><FileText size={10} /> {t.morphSource((morph?.meta.pdfPages ?? "1066–1084").replace("-", "–"))}</span>
                  {morph && <span className="inline-flex items-center gap-0.5"><ListOrdered size={10} /> {t.morphCount(morph.entries.length)}</span>}
                </p>
              </div>
              <button
                onClick={() => setMorphOpen(false)}
                aria-label={t.close}
                title={t.close}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </header>

            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-white/10 dark:bg-white/5">
              <p className="m-0 text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">{t.morphNote}</p>
              {morph && (
                <table className="mt-1.5 w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th scope="col" className="py-0.5 pr-2 font-semibold">{t.morphBehavHead}</th>
                      <th scope="col" className="py-0.5 font-semibold">{t.morphChapter}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {morph.behaviours.map((b) => (
                      <tr key={b.b} className="align-top">
                        <td className="py-0.5 pr-2 text-slate-700 dark:text-slate-200">
                          <span className="font-mono font-bold text-violet-700 dark:text-violet-300">/{b.b}</span>{" "}
                          {lang === "en" ? b.en : b.id}
                        </td>
                        <td className="py-0.5">
                          <span className="flex flex-wrap gap-1">
                            {b.cats.split(",").map((part) => {
                              const raw = part.trim();
                              const first = raw.split(/[–-]/)[0].trim();
                              return navTarget(first) ? (
                                <button
                                  key={raw}
                                  onClick={() => { go(first); setMorphOpen(false); }}
                                  title={`${t.detail} — ${first}`}
                                  className="rounded border border-violet-200 bg-violet-50 px-1.5 py-px font-mono text-[11px] font-bold text-violet-800 transition hover:border-violet-400 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                                >
                                  {raw}
                                </button>
                              ) : (
                                <span key={raw} className="rounded border border-slate-200 bg-white px-1.5 py-px font-mono text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                                  {raw}
                                </span>
                              );
                            })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="shrink-0 border-b border-slate-200 px-4 py-2 dark:border-white/10">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={morphQ}
                  onChange={(e) => setMorphQ(e.target.value)}
                  placeholder={t.morphSearchPh}
                  aria-label={t.morphSearchPh}
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-[13px] outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-white/15 dark:bg-navy-950 dark:focus:ring-violet-900"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
              {!morph ? (
                <p className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">{t.loadingData}</p>
              ) : (
                (() => {
                  const needle = morphQ.trim().toUpperCase();
                  const rows = needle
                    ? morph.entries.filter((e) => e.c.includes(needle) || e.t.toUpperCase().includes(needle))
                    : morph.entries;
                  if (rows.length === 0)
                    return <p className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">{t.morphEmpty}</p>;
                  return rows.map((e, i) => {
                    const g = morphGroupOf(morph.groups, e.c);
                    const prev = i > 0 ? morphGroupOf(morph.groups, rows[i - 1].c) : null;
                    const bh = morph.behaviours.find((b) => b.b === morphBehav(e.c));
                    const sites = morphSites(e.t);
                    return (
                      <div key={e.c}>
                        {g && g !== prev && (
                          <p className="mb-1 mt-3 flex items-baseline gap-1.5 border-b border-slate-100 pb-1 text-[11.5px] font-semibold text-slate-500 dark:border-white/10 dark:text-slate-400">
                            <span className="font-mono text-violet-700 dark:text-violet-300">{g.c}</span>
                            {g.t}
                          </p>
                        )}
                        <div className="flex items-start gap-2 border-b border-slate-100 py-1 last:border-0 dark:border-white/5">
                          <span className="w-[62px] shrink-0 font-mono text-[12px] font-bold text-navy-900 dark:text-sky-200">{e.c}</span>
                          <span
                            title={bh ? `/${bh.b} — ${lang === "en" ? bh.en : bh.id}` : `/${morphBehav(e.c)}`}
                            className="mt-px shrink-0 rounded border border-violet-200 bg-violet-50 px-1 py-px font-mono text-[10.5px] font-bold text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                          >
                            /{morphBehav(e.c)}
                          </span>
                          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-700 dark:text-slate-200">{e.t}</span>
                          {sites.length > 0 && (
                            <span className="flex shrink-0 flex-wrap justify-end gap-1">
                              {sites.map((s) =>
                                navTarget(s) ? (
                                  <button
                                    key={s}
                                    onClick={() => { go(s); setMorphOpen(false); }}
                                    title={`${t.morphSite} — ${s}`}
                                    className="rounded border border-teal-200 bg-teal-50 px-1.5 py-px font-mono text-[10.5px] font-bold text-teal-800 transition hover:border-teal-400 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                                  >
                                    {s}
                                  </button>
                                ) : (
                                  <span key={s} className="font-mono text-[10.5px] text-slate-400">{s}</span>
                                )
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
              <span>{t.morphNote}</span>
              <button
                onClick={() => setMorphOpen(false)}
                className="inline-flex items-center gap-1 rounded-lg bg-pmik-orange px-3 py-1.5 text-[12px] font-semibold text-navy-950 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400"
              >
                <X size={13} /> {t.close}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showGuide && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-4 backdrop-blur-[2px]" onClick={() => setShowGuide(false)}>
          <div ref={guideDlg} role="dialog" aria-modal="true" aria-label={t.guideTitle} className="max-h-[85vh] w-full max-w-[620px] overflow-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-navy-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mt-0 flex items-center gap-2 text-lg font-bold"><BookOpen size={18} className="text-teal-600 dark:text-teal-400" /> {t.guideTitle} <span className="text-[13px] font-normal text-slate-500 dark:text-slate-400">{t.guideFrom}</span></h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
              {t.guideSteps.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
            <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">{t.guideNote}</p>
            <button className="mt-2 flex items-center gap-1.5 rounded-lg bg-pmik-orange px-4 py-2 text-[13px] font-semibold text-navy-950 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400" onClick={() => setShowGuide(false)}><X size={14} /> {t.close}</button>
          </div>
        </div>
      )}
    </div>
  );
}
