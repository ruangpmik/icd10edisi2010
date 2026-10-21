// Kamus UI EN/ID untuk ICD-10 Browser.
export type Lang = "id" | "en";

export interface UiStrings {
  subtitleStats: (c: number, b: number, k: string) => string;
  loadingData: string;
  back: string;
  fwd: string;
  fontDown: string;
  fontUp: string;
  print: string;
  guide: string;
  toLight: string;
  toDark: string;
  searchPh: string;
  syntaxTitle: (n: number | null) => string;
  syntaxBody: string;
  collapseAll: string;
  clear: string;
  validOnly: string;
  validOnlyTitle: string;
  searchIn: string;
  scope: Record<string, string>;
  loadingJson: string;
  loadFail: string;
  noResult: (qt: string) => string;
  noResultHint: string;
  kind: Record<string, string>;
  valid: string;
  validForCoding: string;
  notFinal: string;
  notFinalTitle: string;
  semiValid: (pos: number) => string;
  semiValidTitle: (pos: number, n: number, eg: string) => string;
  semiValidOptTitle: (pos: number, n: number, eg: string) => string;
  validTitle: (len: number) => string;
  morphBadge: string;
  morphTitle: string;
  morphNote: string;
  morphSearchPh: string;
  morphEmpty: string;
  morphSource: (pages: string) => string;
  morphOpen: string;
  morphCount: (n: number) => string;
  morphBehavHead: string;
  morphChapter: string;
  morphSite: string;
  asteriskM: string;
  daggerE: string;
  idTermsN: (n: number) => string;
  copyCode: string;
  copied: string;
  copyTitle: string;
  whoForm: string;
  morb: string;
  mort: string;
  idTitle: string;
  idEmpty: string;
  idAddPh: string;
  idAddLabel: string;
  add: string;
  rubric: Record<string, string>;
  notesTitle: string;
  notesPh: string;
  notesMeta: (n: number) => string;
  notesClear: string;
  subcats: (n: number) => string;
  subdiv: (pos: string) => string;
  subdivOpt: string;
  subdivNote: string;
  subdivShowAll: (n: number) => string;
  subdivHide: string;
  subdivNeedFourth: string;
  mtBtn: string;
  mtLoading: string;
  mtNote: string;
  mtFail: string;
  mtViewOrig: string;
  mtViewTr: string;
  noteGo: string;
  refBase: string;
  termEdit: string;
  termDel: string;
  termDelTitle: (t: string) => string;
  termSave: string;
  termCancel: string;
  qcTitle: string;
  qcSexM: string;
  qcSexF: string;
  qcAst: string;
  qcSeq: string;
  qcPp: string;
  knTitle: string;
  noteBadge: string;
  breadcrumb: string;
  detail: string;
  navSearch: string;
  skipToContent: string;
  searchAnnounce: (n: number) => string;
  searchLabel: string;
  clearSearch: string;
  scopeLegend: string;
  notesLabel: (code: string) => string;
  footerMid: string;
  footerRefs: string;
  guideTitle: string;
  guideFrom: string;
  guideSteps: string[];
  guideNote: string;
  close: string;
  selectHint: string;
  modeTree: string;
  modeIndex: string;
  indexPh: string;
  indexTblPh: string;
  indexLoading: string;
  indexCount: (n: number) => string;
  indexEmpty: string;
  tblEmpty: string;
  indexHint: string;
  indexSee: string;
  tblNotes: (n: number) => string;
  tblNoteJump: (n: number) => string;
  indexPage: (p: number) => string;
  indexShowing: (shown: number, total: number) => string;
  indexAll: string;
  indexSource: string;
  idxAlpha: string;
  idxNeo: string;
  idxDrugs: string;
  idxMore: string;
  idxFilterAll: string;
  idxFilterLead: string;
  idxFilterSub: string;
  idxFilterTitle: string;
  idxTblSrc: (pages: string) => string;
  idxExt: string;
  idxExtPh: string;
  idxExtSrc: (pages: string) => string;
  idxSpecial: string;
  specialHint: string;
  specialOpen: string;
  specialRows: (n: number) => string;
  specialPages: (p: string) => string;
  specialFamily: string;
  specialSuffix: string;
  specialCellNo: string;
  specialCols: string;
  specialRowHead: string;
  specialTermHead: string;
  specialClick: string;
  neoCols: [string, string, string, string, string];
  drugCols: [string, string, string, string, string];
}

const ID: UiStrings = {
  subtitleStats: (c, b, k) => `${c} chapter • ${b} block • ${k} kategori`,
  loadingData: "Memuat data…",
  back: "Kembali",
  fwd: "Maju",
  fontDown: "Perkecil huruf",
  fontUp: "Perbesar huruf",
  print: "Cetak",
  guide: "Panduan",
  toLight: "Mode terang",
  toDark: "Mode gelap",
  searchPh: "Cari kode / diagnosis…",
  syntaxTitle: (n) => `Sintaks pencarian${n === null ? "" : ` — ${n} hasil`}`,
  syntaxBody: "Titik hijau di tree = cabang yang cocok.",
  collapseAll: "Tutup semua",
  clear: "Bersihkan",
  validOnly: "Hanya kode valid",
  validOnlyTitle: "T = terminal node, valid untuk koding (dari WHO codes.txt)",
  searchIn: "Cari di:",
  scope: { kode: "Kode", judul: "Judul", inklusi: "Inklusi", eksklusi: "Eksklusi", lainnya: "Catatan lain", indeks: "Indeks ID" },
  loadingJson: "Memuat icd10.json ±4,1 MB…",
  loadFail: "Gagal memuat data: ",
  noResult: (qt) => `Tidak ada hasil untuk “${qt}”`,
  noResultHint: "Coba wildcard (*) atau perluas ruang lingkup di atas.",
  kind: { chapter: "chapter", block: "block", category: "category", virtual: "subdivisi" },
  valid: "valid",
  validForCoding: "valid untuk koding",
  notFinal: "bukan kode final - dalami sub-kategori",
  notFinalTitle: "Kode ini punya sub-kategori yang lebih spesifik",
  semiValid: (pos) => `semi-valid — tersedia karakter ke-${pos}`,
  semiValidTitle: (pos, n, eg) => `Belum final: ada ${n} pilihan karakter ke-${pos} (mis. ${eg})`,
  semiValidOptTitle: (pos, n, eg) => `Kode ini sudah bisa dipakai, tetapi masih punya ${n} karakter ke-${pos} opsional (mis. ${eg})`,
  validTitle: (len) => `Kode final ${len} karakter — siap dipakai untuk koding`,
  morphBadge: "tabel morfologi",
  morphTitle: "Morfologi neoplasma (ICD-O)",
  morphNote: "Akurasi koding neoplasma mengacu pada digit perilaku (behaviour code): perilaku menentukan kategori Bab II yang dipakai.",
  morphSearchPh: "Cari morfologi / kode M…",
  morphEmpty: "Tidak ada morfologi yang cocok.",
  morphSource: (pages) => `WHO ICD-10 Vol.1 (2010), hlm. ${pages}`,
  morphOpen: "Buka daftar morfologi",
  morphCount: (n) => `${n} morfologi`,
  morphBehavHead: "Digit perilaku",
  morphChapter: "Bab II",
  morphSite: "Situs disarankan",
  asteriskM: "asterisk (manifestasi)",
  daggerE: "dagger (etiologi)",
  idTermsN: (n) => `${n} padanan ID`,
  copyCode: "Salin kode",
  copied: "Tersalin",
  copyTitle: "Salin kode + judul ke clipboard",
  whoForm: "Bentuk WHO:",
  morb: "Morbiditas:",
  mort: "Mortalitas:",
  idTitle: "Istilah Indonesia (Indeks lokal)",
  idEmpty: "Belum ada padanan Indonesia untuk kode ini.",
  idAddPh: "Tambah istilah Indonesia sendiri… (Enter)",
  idAddLabel: "Istilah Indonesia baru untuk kode ini",
  add: "Tambah",
  rubric: {
    preferredLong: "Judul panjang", definition: "Definisi", inclusion: "Inklusi",
    exclusion: "Eksklusi", note: "Catatan", "coding-hint": "Petunjuk koding",
    text: "Teks", introduction: "Pengantar", footnote: "Catatan kaki",
    modifierlink: "Modifier", preferred: "Judul",
  },
  notesTitle: "Catatan pribadi",
  notesPh: "Tempel catatan untuk kode ini… (tersimpan lokal di browser)",
  notesMeta: (n) => `${n.toLocaleString("id-ID")} karakter · tersimpan otomatis di browser ini`,
  notesClear: "Hapus catatan",
  subcats: (n) => `Sub-kategori (${n})`,
  subdiv: (pos) => `Subdivisi karakter ke-${pos}`,
  subdivOpt: "opsional",
  subdivNote: "Label subdivisi mengikuti teks WHO (Inggris).",
  subdivShowAll: (n) => `Tampilkan semua ${n} subdivisi`,
  subdivHide: "Sembunyikan daftar",
  subdivNeedFourth: "Kode karakter ke-5 muncul setelah subdivisi karakter ke-4 dipilih — klik salah satu kode di atas.",
  mtBtn: "Terjemahkan ke Indonesia",
  mtLoading: "Menerjemahkan…",
  mtNote: "Terjemahan mesin — verifikasi sebelum dipakai koding.",
  mtFail: "Terjemahan gagal, coba lagi.",
  mtViewOrig: "Original",
  mtViewTr: "Terjemahan",
  noteGo: "Lompat ke catatan bab",
  refBase: "kategori",
  termEdit: "Ubah",
  termDel: "Hapus",
  termDelTitle: (t) => `Hapus “${t}”`,
  termSave: "Simpan",
  termCancel: "Batal",
  qcTitle: "Quality control (Vol.2 §3.1.5)",
  qcSexM: "♂ Khusus laki-laki — kategori ini hanya untuk pasien laki-laki. Bila tidak sesuai, verifikasi; untuk mortalitas kode ke R99 (§4.2.5).",
  qcSexF: "♀ Khusus perempuan — kategori ini hanya untuk pasien perempuan. Bila tidak sesuai, verifikasi; untuk mortalitas kode ke R99 (§4.2.5).",
  qcAst: "Kategori asterisk — tidak boleh dipakai sendiri; selalu bersama kode dagger (§3.1.5).",
  qcSeq: "Kategori sekuele — untuk kondisi yang sudah tidak aktif; kode utama = sifat sekuele-nya (§3.1.5; §4.2.4/§4.4.2).",
  qcPp: "Postprocedural — bukan untuk underlying-cause mortality (§3.1.5).",
  knTitle: "Key Knowledge (Vol.2)",
  noteBadge: "catatan",
  breadcrumb: "Breadcrumb",
  detail: "Detail kode",
  navSearch: "Navigasi dan pencarian",
  skipToContent: "Lompat ke konten utama",
  searchAnnounce: (n) => (n === 0 ? "Tidak ada hasil pencarian" : `${n} hasil pencarian`),
  searchLabel: "Pencarian ICD-10",
  clearSearch: "Bersihkan pencarian",
  scopeLegend: "Ruang lingkup pencarian",
  notesLabel: (code) => `Catatan pribadi untuk kode ${code}`,
  footerMid: "Data: WHO ICD-10 2010 (ClaML) + meta codes/blocks/chapters + Kamus ICD lokal • Kang Aris | @riz_es. Referensi:",
  footerRefs: "resmi",
  guideTitle: "Panduan koding dasar",
  guideFrom: "(dari Help ICD-10 2nd Ed.)",
  guideSteps: [
    "Kenali jenis pernyataan yang akan dikode dan cari di Indeks Alfabet (kolom Istilah Indonesia / pencarian). Kode ICD-10 kami memakai Kamus ICD lokal sebagai indeks.",
    "Temukan lead term (istilah utama) — biasanya kata benda kondisi patologis. Eponim dicari langsung sebagai lead term, bukan di bawah Disease/Syndrome.",
    "Baca catatan di bawah lead term, lalu baca modifier dalam kurung (non-esensial, tidak mengubah kode) dan indentasi (esensial, dapat mengubah kode) sampai semua kata terakomodasi.",
    "Ikuti rujukan silang ('see' / 'see also') — di aplikasi ini kode biru bisa diklik untuk melompat.",
    "Verifikasi ke Tabular List: pastikan kode 3-karakter dengan tanda hubung punya subdivisi karakter ke-4 di Tabular. Di sini buka sub-kategorinya.",
    "Patuhi inclusion / exclusion di bawah kode, block, atau chapter yang dipilih.",
    "Tetapkan kode. Tanda † (dagger) = etiologi, * (asterisk) = manifestasi; kode keduanya bila diminta.",
  ],
  guideNote: "Seluruh Volume 3 tersedia lewat tab “Indeks A–Z” di panel kiri: Indeks Alfabet (hlm. 11–688), Penyebab Luar/Seksi II (hlm. 691–740), Tabel Neoplasma (hlm. 456–491), Tabel Obat & Bahan Kimia (hlm. 742–881), serta Tabel Khusus berisi matriks Abortus (hlm. 18–19) dan Kecelakaan Lalu Lintas Darat (hlm. 692). Kolom “Istilah Indonesia” dari Kamus ICD lokal tetap berperan sebagai kamus. Selalu verifikasi kode terpilih di Tabular (panel detail).",
  close: "Tutup",
  selectHint: "Pilih kode di kiri atau dari hasil pencarian.",
  modeTree: "Pohon",
  modeIndex: "Indeks A–Z",
  indexPh: "Cari istilah di Indeks Alfabet (Inggris)…",
  indexTblPh: "Cari istilah atau kode tabel (Inggris)…",
  indexLoading: "Memuat indeks alfabet…",
  indexCount: (n) => `${n.toLocaleString("id-ID")} istilah`,
  indexEmpty: "Istilah tidak ditemukan di Indeks Alfabet.",
  tblEmpty: "Istilah atau kode tidak ditemukan di tabel ini.",
  indexHint: "Ketik istilah bahasa Inggris, mis. “diabetes”, “fracture femur”, “dengue”.",
  indexSee: "lihat",
  tblNotes: (n) => `Catatan tabel (${n})`,
  tblNoteJump: (n) => `Lihat catatan ${n}`,
  indexPage: (p) => `hlm. ${p}`,
  indexShowing: (shown, total) => `Menampilkan ${shown.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} istilah`,
  indexAll: "Semua",
  indexSource: "Sumber: ICD-10 Vol.3, Indeks Alfabet hlm. 11–688",
  idxAlpha: "Penyakit",
  idxNeo: "Neoplasma",
  idxDrugs: "Obat & Kimia",
  idxMore: "Muat lagi",
  idxFilterAll: "Semua",
  idxFilterLead: "Lead term",
  idxFilterSub: "Subterm",
  idxFilterTitle: "Lead term = istilah bercetak tebal; subterm = baris bertingkat di bawahnya",
  idxTblSrc: (pages) => `Sumber: ICD-10 Vol.3 hlm. ${pages}`,
  idxExt: "Penyebab Luar",
  idxExtPh: "Cari istilah penyebab luar (Inggris)…",
  idxExtSrc: (pages) => `Sumber: ICD-10 Vol.3, Seksi II hlm. ${pages}`,
  idxSpecial: "Tabel Khusus",
  specialHint: "Tabel matriks Volume 3 — pilih tabel untuk membuka tampilan penuh, lalu klik kode untuk melihat rinciannya.",
  specialOpen: "Buka tabel",
  specialRows: (n) => `${n} baris`,
  specialPages: (p) => `hlm. ${p}`,
  specialFamily: "Kode induk",
  specialSuffix: "Karakter ke-4 untuk O03–O06 (pilih kategori induknya).",
  specialCellNo: "Sel ini tidak mewakili satu kode tunggal.",
  specialCols: "Kolom",
  specialRowHead: "Istilah / korban",
  specialTermHead: "Istilah",
  specialClick: "Klik kode untuk membuka rinciannya.",
  neoCols: ["Maligna primer", "Maligna sekunder", "In situ", "Jinak", "Tidak pasti"],
  drugCols: ["Keracunan", "Kecelakaan", "Self-harm", "Tak jelas", "Efek samping"],
};

const EN: UiStrings = {
  subtitleStats: (c, b, k) => `${c} chapters • ${b} blocks • ${k} categories`,
  loadingData: "Loading data…",
  back: "Back",
  fwd: "Forward",
  fontDown: "Decrease font",
  fontUp: "Increase font",
  print: "Print",
  guide: "Guide",
  toLight: "Light mode",
  toDark: "Dark mode",
  searchPh: "Search code / diagnosis…",
  syntaxTitle: (n) => `Search syntax${n === null ? "" : ` — ${n} results`}`,
  syntaxBody: "Green dot on the tree = matching branch.",
  collapseAll: "Collapse all",
  clear: "Clear",
  validOnly: "Valid codes only",
  validOnlyTitle: "T = terminal node, valid for coding (from WHO codes.txt)",
  searchIn: "Search in:",
  scope: { kode: "Code", judul: "Title", inklusi: "Inclusion", eksklusi: "Exclusion", lainnya: "Other notes", indeks: "ID index" },
  loadingJson: "Loading icd10.json ±4.1 MB…",
  loadFail: "Failed to load data: ",
  noResult: (qt) => `No results for “${qt}”`,
  noResultHint: "Try a wildcard (*) or widen the scope above.",
  kind: { chapter: "chapter", block: "block", category: "category", virtual: "subdivision" },
  valid: "valid",
  validForCoding: "valid for coding",
  notFinal: "not a final code - open sub-categories",
  notFinalTitle: "This code has more specific sub-categories",
  semiValid: (pos) => `semi-valid — character ${pos} available`,
  semiValidTitle: (pos, n, eg) => `Not final: ${n} choices for character ${pos} (e.g. ${eg})`,
  semiValidOptTitle: (pos, n, eg) => `Codable as is, but ${n} optional character-${pos} choices exist (e.g. ${eg})`,
  validTitle: (len) => `Final ${len}-character code — ready for coding`,
  morphBadge: "morphology table",
  morphTitle: "Morphology of neoplasms (ICD-O)",
  morphNote: "Neoplasm coding accuracy follows the behaviour code: behaviour decides which Chapter II category applies.",
  morphSearchPh: "Search morphology / M code…",
  morphEmpty: "No matching morphology.",
  morphSource: (pages) => `WHO ICD-10 Vol.1 (2010), pp. ${pages}`,
  morphOpen: "Open morphology list",
  morphCount: (n) => `${n} morphologies`,
  morphBehavHead: "Behaviour code",
  morphChapter: "Chapter II",
  morphSite: "Suggested site",
  asteriskM: "asterisk (manifestation)",
  daggerE: "dagger (aetiology)",
  idTermsN: (n) => `${n} ID terms`,
  copyCode: "Copy code",
  copied: "Copied",
  copyTitle: "Copy code + title to clipboard",
  whoForm: "WHO form:",
  morb: "Morbidity:",
  mort: "Mortality:",
  idTitle: "Indonesian terms (local index)",
  idEmpty: "No Indonesian equivalent for this code yet.",
  idAddPh: "Add your own Indonesian term… (Enter)",
  idAddLabel: "New Indonesian term for this code",
  add: "Add",
  rubric: {
    preferredLong: "Long title", definition: "Definition", inclusion: "Inclusion",
    exclusion: "Exclusion", note: "Note", "coding-hint": "Coding hint",
    text: "Text", introduction: "Introduction", footnote: "Footnote",
    modifierlink: "Modifier", preferred: "Title",
  },
  notesTitle: "Personal notes",
  notesPh: "Attach a note to this code… (stored locally in browser)",
  notesMeta: (n) => `${n.toLocaleString("en-US")} characters · saved automatically in this browser`,
  notesClear: "Clear note",
  subcats: (n) => `Sub-categories (${n})`,
  subdiv: (pos) => `Character-${pos} subdivisions`,
  subdivOpt: "optional",
  subdivNote: "Subdivision labels follow WHO text (English).",
  subdivShowAll: (n) => `Show all ${n} subdivisions`,
  subdivHide: "Hide list",
  subdivNeedFourth: "Fifth-character codes appear after a fourth-character subdivision is chosen — click one of the codes above.",
  mtBtn: "Translate to Indonesian",
  mtLoading: "Translating…",
  mtNote: "Machine translation — verify before coding use.",
  mtFail: "Translation failed, retry.",
  mtViewOrig: "Original",
  mtViewTr: "Translated",
  noteGo: "Jump to chapter note",
  refBase: "category",
  termEdit: "Edit",
  termDel: "Delete",
  termDelTitle: (t) => `Delete “${t}”`,
  termSave: "Save",
  termCancel: "Cancel",
  qcTitle: "Quality control (Vol.2 §3.1.5)",
  qcSexM: "♂ Male-only — this category applies to male patients only. If inconsistent, verify; for mortality code R99 (§4.2.5).",
  qcSexF: "♀ Female-only — this category applies to female patients only. If inconsistent, verify; for mortality code R99 (§4.2.5).",
  qcAst: "Asterisk category — never used alone; always with a dagger code (§3.1.5).",
  qcSeq: "Sequelae category — for conditions no longer active; main code = the sequela itself (§3.1.5; §4.2.4/§4.4.2).",
  qcPp: "Postprocedural — not for underlying-cause mortality (§3.1.5).",
  knTitle: "Key Knowledge (Vol.2)",
  noteBadge: "note",
  breadcrumb: "Breadcrumb",
  detail: "Code detail",
  navSearch: "Navigation and search",
  skipToContent: "Skip to main content",
  searchAnnounce: (n) => (n === 0 ? "No search results" : `${n} search results`),
  searchLabel: "ICD-10 search",
  clearSearch: "Clear search",
  scopeLegend: "Search scope",
  notesLabel: (code) => `Personal note for code ${code}`,
  footerMid: "Data: WHO ICD-10 2010 (ClaML) + codes/blocks/chapters meta + local ICD dictionary • Kang Aris | @riz_es. Official refs:",
  footerRefs: "official",
  guideTitle: "Basic coding guide",
  guideFrom: "(from ICD-10 2nd Ed. Help)",
  guideSteps: [
    "Identify the statement to be coded and search the Alphabetical Index (Indonesian terms / search box). This app uses the local ICD dictionary as its index.",
    "Find the lead term — usually a noun for the pathological condition. Look up eponyms directly as lead terms, not under Disease/Syndrome.",
    "Read the note under the lead term, then modifiers in parentheses (non-essential, don't change the code) and indented terms (essential, may change the code) until all words are accounted for.",
    "Follow cross-references ('see' / 'see also') — blue codes here are clickable.",
    "Verify in the Tabular List: a 3-character code with a dash has a 4th-character subdivision in the Tabular. Open its sub-categories here.",
    "Observe inclusion / exclusion notes under the selected code, block or chapter.",
    "Assign the code. † (dagger) = aetiology, * (asterisk) = manifestation; code both when required.",
  ],
  guideNote: "All of Volume 3 is available in the “A–Z Index” tab on the left: the Alphabetical Index (pp. 11–688), External Causes/Section II (pp. 691–740), the Neoplasm table (pp. 456–491), the Table of Drugs and Chemicals (pp. 742–881), plus Special Tables with the Abortion (pp. 18–19) and Land Transport (p. 692) matrices. The local ICD dictionary's “Indonesian terms” column remains as a dictionary. Always verify the selected code in the Tabular (detail panel).",
  close: "Close",
  selectHint: "Pick a code on the left or from the search results.",
  modeTree: "Tree",
  modeIndex: "A–Z Index",
  indexPh: "Search the Alphabetical Index…",
  indexLoading: "Loading alphabetical index…",
  indexCount: (n) => `${n.toLocaleString("en-US")} terms`,
  indexEmpty: "No matching term in the Alphabetical Index.",
  tblEmpty: "No matching term or code in this table.",
  indexHint: "Type an English term, e.g. “diabetes”, “fracture femur”, “dengue”.",
  indexSee: "see",
  tblNotes: (n) => `Table notes (${n})`,
  tblNoteJump: (n) => `See note ${n}`,
  indexPage: (p) => `p. ${p}`,
  indexShowing: (shown, total) => `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} terms`,
  indexAll: "All",
  indexSource: "Source: ICD-10 Vol.3 Alphabetical Index, pp. 11-688",
  idxAlpha: "Diseases",
  idxNeo: "Neoplasm",
  idxDrugs: "Drugs & Chem.",
  idxMore: "Load more",
  idxFilterAll: "All",
  idxFilterLead: "Lead term",
  idxFilterSub: "Subterm",
  idxFilterTitle: "Lead term = the bold entry; subterm = the indented rows beneath it",
  idxTblSrc: (pages) => `Source: ICD-10 Vol.3, pp. ${pages}`,
  indexTblPh: "Search table term or code (English)…",
  idxExt: "External Causes",
  idxExtPh: "Search external-cause terms (English)…",
  idxExtSrc: (pages) => `Source: ICD-10 Vol.3, Section II, pp. ${pages}`,
  idxSpecial: "Special Tables",
  specialHint: "Volume 3 matrix tables — pick a table for the full view, then click a code to see its details.",
  specialOpen: "Open table",
  specialRows: (n) => `${n} rows`,
  specialPages: (p) => `p. ${p}`,
  specialFamily: "Parent codes",
  specialSuffix: "Fourth character for O03–O06 (choose the parent category).",
  specialCellNo: "This cell does not represent a single code.",
  specialCols: "Columns",
  specialRowHead: "Term / victim",
  specialTermHead: "Term",
  specialClick: "Click a code to open its details.",
  neoCols: ["Malignant primary", "Malignant secondary", "In situ", "Benign", "Uncertain"],
  drugCols: ["Poisoning", "Accidental", "Self-harm", "Undetermined", "Adverse effect"],
};

export const STR: Record<Lang, UiStrings> = { id: ID, en: EN };

export function loadLang(): Lang {
  try {
    return localStorage.getItem("icd10-lang") === "en" ? "en" : "id";
  } catch {
    return "id";
  }
}
