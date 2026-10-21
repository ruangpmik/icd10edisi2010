# Project Continuation State — ICD-10 2010 Browser

## Project

- Nama: icd10-browser (`C:\laragon\www\icd10-browser`)
- Tujuan: Browser ICD-10 2010 WHO (EN + Indonesia) + alat bantu clinical coder (aturan Vol.1/Vol.2, QC §3.1.5)
- Stack: Next.js 14.2.18, React 18, TypeScript, Tailwind 3.4, next-themes, lucide-react
- Dev: `npm run dev` → http://localhost:3001 (KLAIMINTEL di :3000, jangan bentrok)
- Data build: `node scripts/build-data.mjs` (baca `data/raw/`, tulis `public/data/icd10.json` ±4,4 MB). Semua sumber sudah terpusat di `data/raw/` (XML, codes/blocks/chapters.txt, 2 PDF, kamus xlsx) — tak ada lagi dependensi ke Temp/D:\. Screenshot verifikasi di `docs/shots/`.

## Current Status

- Selesai & terverifikasi (screenshot + uji Puppeteer): tree 22 chapter, search boolean (`& | () * ?`) + scope + badge sumber, valid/asterisk/dagger (†/* menempel di kode), subdivisi modifier (V01, M40) + KODE VIRTUAL ter-resolve (V01.1, M54.55, S02.01, W01.4, E10.2…; judul gabungan di detail), Key Knowledge Vol.2 (421 node), QC sex/asterisk/sequelae/postprocedural (1431 node, daftar persis §3.1.5), MT EN→ID + saklar Original|Terjemahan, saklar ID|EN, dark mode, logo+favicon RUANGPMIK, istilah kustom tambah/ubah/hapus, panduan koding, cetak, zoom, riwayat, catatan lokal. `npm run build` lolos.
- **Volume 3 lengkap**: 5 sumber di tab kiri – Penyakit/Indeks Alfabet (55.106 istilah), Penyebab Luar/Seksi II (2.966), Neoplasma (1.649), Obat & Kimia (5.363), Tabel Khusus (matriks Abortus + Kecelakaan Lalu Lintas Darat). Progress bar byte nyata + ikon di semua tab.
- Sedang dikerjakan: —
- Belum: —(isi Vol.3 sudah tuntas; lihat "Cakupan Volume 3" di bawah)
## Cakupan Volume 3 (peta halaman PDF → halaman cetak = PDF − 1118)

- Seksi I — Alphabetical index to diseases and nature of injury: PDF 1129–1806 (hlm. 11–688).
- Seksi II — External causes of injury: judul PDF 1807, halaman kosong 1808, indeks 1809–1858 (hlm. 691–740); matriks kendaraan darat di PDF 1810 (hlm. 692).
- Seksi III — Table of drugs and chemicals: judul PDF 1859, isi 1860–1999 (hlm. 742–881).
- Tabel sisipan Seksi I: abortus 4-karakter PDF 1136–1137 (hlm. 18–19); neoplasma PDF 1574–1609 (hlm. 456–491).
- Tidak ada seksi morfologi/ICD-O terpisah di Vol.3 (TOC PDF 1121 hanya 3 seksi).

## Last Changes

- **Rujukan berkode & artefak parse "lihat"** (batch ini): sisa rujukan yang tak bertujuan kini dituntaskan.
  - `gotoCodeRef` baru di `gotoSee` (dijalankan sebelum `gotoChapter`): `Note at category O80.-` / `Note at category O80.9` → kode **O80**/**O80.9**; `categories D50–D77` → **D50**; `E10–E14 with fourth character .6` / `F11–F19 with fourth character .3` → `.6`/`.3` pada kategori pertama, mundur ke kategori 3 karakter bila subkode tak ada (2010 tak punya `E10.6`, jadi mendarat di **E10**/**F11**). Pohon dibuka lewat `breadcrumb` lalu baris kode digulir ke tengah.
  - `normTerm` kini menyeragamkan apostrof melengkung (`’`→`'`) dan tanda hubung di dalam kata (`Glomerulo-nephritis`→`glomerulonephritis`), jadi `Glomerulo-nephritis`→baris **Glomerulonephritis** dan `Korsakov’s …`→baris **Korsakov's …**.
  - `gotoSee` membuang awalan `also` yang menempel (`alsoMelioidosis`→**Melioidosis**).
  - Sisa 5 rujukan tanpa tujuan sama sekali (`also` ×2, `Leuk(o`, `note at` ×2) tak lagi dirender sebagai tombol: `seeUsable()` menyaringnya di kedua renderer (indeks & tabel).
  - `scripts/see.mjs`: `cleanSee` membuang awalan `also` tanpa spasi dan mengembalikan `null` untuk target `also` / `note at` / potongan kurung `Leuk(o`, supaya build berikutnya tak lagi memunculkan artefak ini.
  - Terverifikasi Puppeteer 7/7 tujuan + 5/5 tombol sampah hilang, 0 error konsol; regresi see/sticky/chapter/code-click tetap hijau; `tsc --noEmit` bersih; `npm run build` EXIT=0.

- **Dua rujukan "Table of …" terakhir** (batch ini): `Table of neoplasms, secondary` (Penyakit) kini membuka tab **Neoplasma** huruf **N** dan menyorot lead `Neoplasm, neoplastic`; `Table of land transport` (Penyebab Luar) membuka tab **Tabel Khusus** dan langsung menampilkan matriks **Kecelakaan lalu lintas (V01–V99)** lewat `pendingSpecial` (matriks dimuat malas, jadi baru dibuka setelah `special-tables.json` siap).
  - Terverifikasi Puppeteer: keduanya mendarat tepat, 0 error konsol.

- **Rujukan judul bab → tab Pohon** (batch sebelumnya): 80 baris rujukan seperti `Conditions originating in the perinatal period, distress, fetal` (48 target unik) sebelumnya jatuh ke pencarian kata terakhir ("injury") dan mendarat di hasil yang salah. Kini `gotoChapter` mencocokkan bagian pertama rujukan dengan judul 22 bab (kata `the` dibuang, `Complications originating…` disamakan dengan `Conditions originating…`), lalu membuka tab **Pohon** dan memilih babnya (mis. **XVI Certain conditions originating in the perinatal period**).
  - Syarat: minimal 3 kata agar tidak salah cocok dengan istilah pendek seperti "Neoplasm".
  - Terverifikasi Puppeteer 3/3 (`distress, fetal`, `labor, false`, `perinatal period, hemorrhage`) → tab Pohon, bab XVI terpilih; 0 error konsol.
  - Sisa 26 target rujukan (26 baris) masih tak bertujuan: rujukan bab yang judulnya tak ada di pohon (`Nature and site of injury`, `Neoplasm uncertain or unknown behavior`, `specific eponymous syndromes`, `condition by chromosome involved`, `external cause by type…`), rujukan kode (`E10-E14 with fourth character .6`, `categories D50–D77`), catatan Volume 1 (`note 6, …`, `Note at category O80.-`), dan sisa parsing rusak (`also`, `alsoMelioidosis`, `Leuk(o`, `Glomerulo-nephritis`, `Korsakov’s …`). Rujukan kode & parsing sudah dibereskan di batch berikutnya; sisa ~26 baris hanya rujukan bab yang judulnya tak ada di pohon.

- **Rujukan "lihat" lintas tabel & berawalan** (batch sebelumnya):
  - `lihat: Table of drugs and chemicals` (52 di Penyakit, 34 di Penyebab Luar) sebelumnya jatuh ke pencarian kosong karena tak ada entri dengan nama itu. Kini membuka tab **Obat & Kimia** pada huruf **A** dan menyorot baris pertama (`Abrine`).
  - Rujukan berawalan (`Levo-`, `Sulf-`, `specific protein`, `specific substance`) dilayani `jumpPrefix`: cari lead term berawalan itu, lalu subterm berawalan, lalu lead term yang memuatnya. Kata `specific` dibuang lebih dulu. Hasil: `Levo-`→Levobunolol (L), `Sulf-`→Sulfacetamide (S), `specific protein`→Protein hydrolysate (P), `specific substance`→Biological substance NEC (B).
  - `gotoSee` dirapikan: `land()` (pindah huruf + sorot) dipisah dari pencocokan, dan `pendingSee` kini membawa tujuan tab (`neo`/`drugs`) plus huruf opsional.
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol), termasuk lompatan dari Penyebab Luar `Anaphylactic shock` → tab Obat huruf A.
  - Catatan: blok neoplasma warisan cetak di tab Penyakit (lead `Neoplasm, neoplastic .`, 1.624 anak, hlm. 458–491, 1.115 istilah masih bertitik penanda kolom) **sengaja dibiarkan** atas keputusan user — tab Neoplasma tetap sumber utamanya.

- **Header lengket: warna & ukuran** (batch ini): latar `bg-teal-50` (`dark:bg-teal-950/70`), garis bawah teal, teks `12.5px` medium `teal-800`, ikon 12 px, tinggi 28 px, dan `-top-2` agar menempel rapat di tepi panel (tak ada baris menyembul di atasnya). Terverifikasi 320 px: lebar 294 px, tinggi 28 px, tanpa luber horizontal.

- **Indeks A–Z: rujukan "see / see also" yang tercetak menyatu kini jadi tautan** (batch sebelumnya):
  - Masalah: di PDF rujukan sering menempel pada istilah — `animal-rider NEC (see also Accident, transport)`, `column, spinal - see Neoplasm, spine`, `Undernutrition see also Malnutrition`, dan baris yang isinya hanya `— see Tetrachloroethylene`. Parser lama hanya mengenali `— see X` sebagai butir teks terpisah, sehingga 2.683 rujukan di indeks alfabet (365 di Penyebab Luar, 11 di tabel) tampil sebagai teks biasa dan tak bisa diklik.
  - Perbaikan: modul baru `scripts/see.mjs` (`extractSee`, `cleanSee`, `cleanTerm`) dipakai `build-index.mjs`, `build-ext-index.mjs`, dan `build-tables.mjs`. Empat bentuk dikenali: kurung di ujung `(see also X)` (termasuk rujukan yang memuat kurung sendiri, mis. `… virus (HIV) disease`), strip hubung `- see X` / `– see also X`, tanpa tanda `… see also X`, dan baris rujukan murni yang ditempelkan ke entri di atasnya. Rujukan yang terpotong antar kolom (`… (see also Endocarditis, aortic`) tetap dikenali; kurung penutup atau awalan `also` yang tersisa dibersihkan.
  - Hasil: rujukan inline yang tersisa **0** di keempat sumber; `see` terisi 5.918 (alfabet), 427 (Penyebab Luar), 74 (Neoplasma), 50 (Obat). Contoh: `animal-rider NEC | lihat: Accident, transport | V80.9` → lompat ke **A**, `transport (involving injury to)`; `Undernutrition` → `Malnutrition`; `Tetrachlorethylene` → `Tetrachloroethylene`.
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol): klik rujukan `animal-rider NEC` mendarat di baris idx 59 `transport (involving injury to)` (hlm. 693).

- **Indeks A–Z: header lengket lead term / subterm saat digulir** (batch ini):
  - Tambahan bilah `sticky top-0` di dalam panel kiri yang menampilkan jalur induk baris teratas (mis. `Accident (to) › caused by, due to`), pengganti penanda "continued" di buku cetak. Berlaku di keempat sumber indeks (Penyakit, Penyebab Luar, Neoplasma, Obat & Kimia); aktif saat menjelajah (tidak saat mencari atau saat saringan aktif, karena jalur induk sudah tercetak di tiap baris).
  - Klik bilah = kembali ke lead term-nya (`jumpToRow`). Dihitung ulang lewat `requestAnimationFrame` saat gulir dan saat huruf/sumber/saringan berganti. Bila baris teratas sudah lead term, header menampilkan istilah itu sendiri, jadi tak pernah kosong.
  - Terverifikasi Puppeteer: alfabet `Abortion` → `Abortion (complete) (incomplete)`; Penyebab Luar `caused by, due to` → `Accident (to)`, `cold (excessive)` → `Accident (to) › caused by, due to`; Neoplasma → `abdomen, abdominal`; Obat → `Acepifylline`; klik header menggulir ke lead (`scrollTop` 900 → 317). Lebar 320 px: header 294 px, tanpa luber horizontal.

- **Kode indeks yang tak ada di Tabular tak lagi jadi tombol mati** (batch ini):
  - `go()` kini memakai `navTarget()`: membuang penanda †/‡/* dan akhiran `.-`, lalu mundur ke kategori 3 karakter bila subkategorinya tak ada. Chip yang tetap tak ketemu (mis. `B12` pada `vitamin`, `)` pada Neoplasma) dirender sebagai label abu-abu, bukan tombol.
  - Terverifikasi Puppeteer: `X39.-` → X39, `X36.-` → X36, `X34.-` → X34, `W55.-` → W55 (semua membuka Tabular); chip `B12` tampil sebagai `<span>`, bukan `<button>`.

- **Indeks A–Z: saringan Lead term / Subterm**:
  - Tambahan kontrol 3 tombol di bawah baris huruf A–Z: **Semua** / **Lead term** / **Subterm** (`idxFilter` di `page.tsx`), berlaku untuk jelajah maupun pencarian, di keempat sumber (Penyakit, Penyebab Luar, Neoplasma, Obat & Kimia).
  - Lead term = baris tertebal (`level 0`; di tabel Neoplasma `level 1`, sehingga baris kepala tabel `Neoplasm, neoplastic` tetap ikut). Subterm = semua baris bertingkat di bawahnya.
  - Saat saringan aktif, baris ditampilkan rata 8 px dan jalur induk dicetak di bawah istilah (mis. `disease | Naegeli's`), karena hierarki tanpa induk tidak terbaca. Hitungan `Menampilkan X dari Y istilah` ikut menyesuaikan hasil saringan; pencarian memakai batas 8.000 hasil sebelum disaring agar totalnya benar.
  - Kotak cari sudah punya tombol bersihkan (ikon ✕ di kanan, `aria-label`/`title` "Bersihkan pencarian" / "Clear search") — mengosongkan kueri dan kembali ke daftar huruf; saringan dikembalikan lewat tombol "Semua".
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol): huruf N → Semua 2.582 istilah / Lead term 184 (semua rata kiri) / Subterm 2.398 (jalur induk tampil); cari `nausea` → 1 hasil di Semua & Lead term, 0 di Subterm; Neoplasma huruf N → Semua 146 / Lead 14 (baris kepala ikut) / Sub 132; label EN `All / Lead term / Subterm` + tooltip EN; tombol ✕ mengosongkan kueri. `tsc --noEmit` exit 0.

- **Indeks A–Z: baris "…… continued" / "…… cont." dihapus, subterm digabung ke lead asalnya** (batch ini):
  - Masalah: kepala lanjutan halaman (`Neoplasm, neoplastic – continued`, 36 baris) tercatat sebagai lead term level 0 tanpa kode dan tanpa rujukan, jadi diklik tak membuka apa pun dan memecah satu blok istilah jadi puluhan potongan.
  - Perbaikan di `scripts/build-index.mjs`: `parseCont()` mengenali akhiran `continued` / `cont.` (termasuk bentuk gabung `Damage ------ continued - eye, birth injury`), lalu entri dikelompokkan ulang per lead: baris lanjutan dibuang, subterm di bawahnya disisipkan ke segmen lead asal (cocok persis, atau salah satu kunci jadi awalan yang lain — `Contraction, contracture` → `Contraction, contracture, contracted`). Bila lead asal tak ada, barisnya dipertahankan dengan nama bersih.
  - Dua kasus khusus: `(continued)` dalam kurung (`Febricula (continued) (simple)`, R50.9) tetap istilah asli; baris `continued` yang berdiri sendiri akibat baris terpotong ke kolom berikutnya tidak lagi ditempel ke istilah sebelumnya (`prostate continued` → `prostate`).
  - Hasil: 55.141 entri → **55.105**, lead term 7.228 → **7.190**; `Neoplasm, neoplastic` kembali satu blok (1.624 subterm), `Damage` 27 anak (`eye, birth injury` P15.3), `Tumor (M8000/1)` 307 anak (`malignant (M8936/3)`), `Nausea` tetap 3 anak. Sisa teks "continued" hanya 3 baris yang memang istilah resmi.
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol): huruf N 2.582 baris tanpa satu pun baris `continued`; satu baris lead `Neoplasm, neoplastic . | C80.9 | 456`; `eye, birth injury` (idx 38) dan `malignant (M8936/3)` (idx 2.148) muncul setelah lead-nya.
  - `write-sizes.mjs` dijalankan ulang (alpha 2.611 KB); `npm run build` produksi **EXIT=0**.

- **Tabel Neoplasma: rujukan "lihat", catatan tabel, dan baris kepala** (batch ini):
  - Masalah 1: klik `lihat: Neoplasm, sinus` hanya mengisi kotak cari dengan teks jalur; pencarian token-AND tak pernah menemukan "Neoplasm, sinus" (istilah entri hanya `sinus (accessory)`), jadi muncul "tidak ditemukan".
  - Masalah 2: tanda `#` dan `<>` di tabel tidak terhubung ke catatan kaki, dan ketiga catatan tabel tidak ditampilkan sama sekali.
  - Masalah 3: baris kepala `Neoplasm, neoplastic` (C80.9 C79.9 D09.9 D36.9 D48.9) tidak muncul di jelajah (level 0 dibuang oleh `tableBrowse(..., 1)`) dan kode tak bisa dicari.
  - Perbaikan rujukan: `resolveSee(terms, levels, target)` di `src/lib/alpha.ts` mencocokkan jalur rujukan lewat rantai induk (skor: istilah sama > rantai sama > awalan berurutan > token AND), `splitSeeTarget` memecah koma di luar kurung. `gotoSee` (`page.tsx`) menggulir daftar ke baris tujuan (set huruf, kosongkan `q`, naikkan `idxLimit`, sorot kuning 3 detik) — bukan mencari teks. Bila rujukan menunjuk tabel lain (`lihat: Neoplasm, …` dari indeks alfabet) tab Neoplasma dibuka lalu lompat; bila tetap gagal, bagian terakhir jalur dicari sebagai teks.
  - Audit seluruh sumber: rujukan yang tak terselesaikan turun dari **901/3.234 → 289** (indeks alfabet), **14 → 8** (penyebab luar), **1** (neoplasma, sisa `also Neoplasm, nerve, peripheral)` yang memang bukan jalur), **6** (obat). Sisa 289 di indeks alfabet sebagian besar menunjuk ke tabel neoplasma/obat — kini ditangani lompatan lintas tab.
  - Perbaikan catatan: `scripts/build-tables.mjs` kini menangkap blok `Note:` sebelum tabel mulai, memecahnya jadi butir bernomor, dan menyimpan `meta.notes = [{ n, en, id }]` (3 catatan; terjemahan Indonesia disiapkan di `NOTE_ID`, teks resmi tetap di `en`). Baris judul kolom (`____Malignant___`, `In situ Benign…`) disaring lewat `NOTE_HEAD_WORDS`. Penanda `#` / `<>` / `[<>]` di ujung istilah dipindah ke elemen tuple ke-6 (`mark`) — 103 entri bertanda, 0 simbol tersisa di teks istilah.
  - Perbaikan UI: chip penanda `<MarkBtn>` (sup, amber) di samping istilah membuka blok "Catatan tabel (3)" dan menggulir ke catatan yang dituju; blok catatan memakai `<details>` sehingga tidak memakan ruang. Catatan tampil dalam bahasa aktif (ID terjemahan, EN teks resmi).
  - Perbaikan jelajah: `tableBrowse` memakai `level <= leadLevel`, jadi baris kepala level 0 ikut terdaftar (huruf N) dan dicetak tebal (`level < tblLead` → `font-bold`). Pencarian tabel memakai haystack `istilah + kode` sehingga `C80.9` menemukan baris kepala; placeholder jadi "Cari istilah atau kode tabel (Inggris)…".
  - Pesan kosong tabel dipisah (`tblEmpty`: "Istilah atau kode tidak ditemukan di tabel ini.") agar tidak lagi menyebut "Indeks Alfabet".
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol): baris kepala `Neoplasm, neoplastic | 456 | C80.9 C79.9 D09.9 D36.9 D48.9` muncul di huruf N; cari `C80.9` → 5 hasil termasuk baris kepala; `lihat: Neoplasm, sinus` → huruf **S**, baris `sinus (accessory)` tersorot (scrollTop 1450); chip `#`/`<>` membuka catatan (judul "Catatan tabel (3)"); lompatan lintas tab `lihat: Neoplasm, connective tissue, malignant` → tab Neoplasma aktif + baris `connective tissue NEC` tersorot; regresi indeks alfabet `lihat: Malposition, congenital` → `congenital` (hlm. 429) tersorot; switch EN → "Table notes (3)". Tangkapan layar: `shots/90-neo-see-jump.png`, `91-neo-notes.png`, `92-cross-see-neo.png`, `93-neo-notes-dark.png`.
  - `tsc --noEmit` exit 0; `write-sizes.mjs` dijalankan ulang (neo 113 KB); `npm run build` produksi **EXIT=0** — `/` 30,7 kB, First Load JS **118 kB**.

- **Indeks A–Z: indentasi bertingkat + subterm dalam tampil** (batch ini):
  - Masalah: `indexBrowse` (`src/lib/alpha.ts`) hanya memasukkan lead term (level 0) dan subterm tingkat 1, sehingga ribuan sub-subterm (`- - chemical (weapons)`, `- - - from nuclear explosion`) hilang dari jelajah A–Z — hanya muncul lewat pencarian. Indentasi juga dipatok `Math.min(level, 4) * 16` sehingga level 5–6 tidak menjorok lebih jauh, dan pencarian meratakan semua baris ke 0 px (jalur induk jadi satu-satunya petunjuk).
  - Perbaikan: `indexBrowse` kini menyertakan **semua** level (`level > 0`), bukan hanya `level === 1`. `renderIndexRow` (`src/app/page.tsx`) memakai `paddingLeft = 8 + Math.min(level, 6) * 12` saat menjelajah (0–6 dash → 8–80 px; pencarian tetap datar 8 px karena jalur induk sudah ditampilkan). Subterm level ≥ 2 diberi `text-[12.5px] text-slate-600 dark:text-slate-300` agar hierarki terbaca tanpa kehilangan kontras (≥ 4,5:1 di kedua tema).
  - "Muat lagi" tidak lagi memotong di tengah kelompok: `idxRows` memanjangkan potongan sampai lead term berikutnya, dengan batas tambahan 200 baris (kalau lebih, potong di `idxLimit` seperti sebelumnya) supaya satu lead term raksasa (`specified organism`, 1.781 baris) tidak memaksa render sekaligus.
  - Terverifikasi Puppeteer: Penyebab Luar huruf W → `War operations (during hostilities)` 8 px, `asphyxia from` 20 px, `chemical (weapons)` 32 px, `fire, conflagration…` 32 px, `from nuclear explosion` 44 px (Y36.5) — persis pola PDF. Indeks Penyakit huruf C → `Cleft (congenital)` 8 px, `lip (unilateral)` 20 px, `median` 32 px, `with cleft palate` 32 px, `hard` 44 px, `and soft` 56 px, `bilateral` 32 px, `with cleft palate` 44 px, `hard` 56 px, `and soft` 68 px, `bilateral` 80 px (kedalaman 6, Q37.4). Pencarian `chemical weapons` → 5 hasil, semua 8 px, dengan jalur induk `War operations (during hostilities) (injury) (by) (in) › asphyxia from`. 0 error konsol; `tsc --noEmit` exit 0.
  - Produksi: `npm run build` EXIT=0 — `/` 29,3 kB, First Load JS **116 kB**.

- Audit aksesibilitas lapis ketiga (batch ini) — 4 celah nyata, semuanya diperbaiki:
  - **Skip link** (`Lompat ke konten utama`, string baru `skipToContent` ID+EN): elemen `<a href="#main-content">` pertama di halaman, `sr-only` lalu tampil saat fokus (kartu putih/teal-800, `focus:fixed left-3 top-3`). `<main>` diberi `id="main-content"` + `tabIndex={-1}` sehingga Enter memindahkan fokus ke konten (bukan hanya scroll). Kontras terukur **7,58:1** terang / **11,54:1** gelap.
  - **Live region hasil pencarian**: `<p aria-live="polite" class="sr-only">` di panel kiri → "7 hasil pencarian" / "Tidak ada hasil pencarian" (string `searchAnnounce`), menyebut jumlah hasil untuk mode pohon maupun indeks; kosong saat tidak mencari (tidak berisik).
  - **Chip contoh sintaks tanpa indikator fokus**: 4 chip (`cholera`, `diab* & nephro?`, `A00 | A01`, `tubercul* (lung | larynx)`) tidak punya `focus-visible` → ditambah `focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500`. Terverifikasi `outline: solid 2px rgb(20,184,166)` saat difokus dengan Tab.
  - **Kredit terpotong di layar sempit**: subjudul header memakai `truncate` sehingga badge "Kang Aris | @riz_es" terpotong di 320 px (badge `right=403` pada viewport 320). Subjudul diubah jadi `flex flex-wrap` dengan statistik di `<span class="min-w-0 truncate">` dan badge `shrink-0` → badge turun ke baris kedua dan utuh (`right=182 ≤ 320`).
- **Mode cetak diperbaiki** (`src/app/globals.css`, `@media print`): sebelumnya hanya `.no-print` yang disembunyikan, sehingga panel detail yang `overflow-y-auto` terpotong pada tinggi layar. Sekarang: `html/body` tanpa tinggi tetap & tanpa overflow, `#main-content` jadi `block` (panel kiri `.no-print` hilang, hanya detail yang dicetak), semua `overflow-y-auto`/`flex-1` jadi `overflow: visible; max-height: none`, `#detail-head` statis, dan tema gelap dipaksa putih (`background #fff`, `color #111`) agar tidak mencetak teks terang di atas kertas putih.
- Audit aksesibilitas menyeluruh (batch sebelumnya) — hasil pengukuran Puppeteer, lalu diperbaiki:
  - **Kontras teks redup**: pola `text-slate-400 dark:text-slate-500` (2,56:1 di putih / 3,06:1 di navy) diganti `text-slate-500 dark:text-slate-400` (4,76:1 / 5,68:1). Berlaku untuk label "Cari di:", label `dt` "Bentuk WHO/Morbiditas/Mortalitas", jumlah istilah, nomor halaman, footer, breadcrumb, catatan, meta catatan, dan teks bantuan.
  - **Tombol oranye**: putih di atas `#f97316` hanya **2,80:1** (gagal, bahkan untuk teks besar). Warna brand dipertahankan; teks diubah ke `text-navy-950` → **6,22:1**. Berlaku untuk tombol Tambah, Tutup (modal & panduan), badge "Kang Aris | @riz_es", dan tombol bahasa aktif ID/EN.
  - **Chip huruf A–Z aktif** dan **toggle "Teks terjemahan/orisinal"**: `bg-teal-600` + putih (3,74:1) → `bg-teal-700` (5,47:1).
  - **Placeholder**: `placeholder:text-slate-400` (2,56:1) → `placeholder:text-slate-500` terang / `dark:placeholder:text-slate-400`.
  - **Tanda "tidak ada kode" `-` di matriks**: `text-slate-300` (1,48:1) → `text-slate-500 dark:text-slate-400`; tetap `aria-hidden`.
  - **Field tanpa nama aksesibel**: input "Tambah istilah Indonesia sendiri…" hanya punya placeholder → ditambah `aria-label={t.idAddLabel}` (string baru `idAddLabel` di `src/lib/i18n.ts`, ID + EN).
  - Footer dinaikkan ke `text-slate-600` (4,34 → 6,92:1 di slate-100) dan header kolom matriks juga `text-slate-600`.
- Aksesibilitas tab & modal (batch sebelumnya):
  - `src/app/page.tsx`: tablist mode (2 tab) dan tablist sumber (5 tab) kini mengikuti pola ARIA APG — `id` per tab, `aria-controls="left-panel"`, roving `tabIndex` (hanya tab aktif `0`, sisanya `-1`), dan handler `tabKeyNav` untuk panah kiri/kanan/atas/bawah, Home, End (memindah fokus + langsung mengaktifkan tab, dengan pembungkusan).
  - Panel daftar kiri diberi `role="tabpanel"` + `id="left-panel"` + `aria-labelledby` yang mengikuti tab aktif (mode pohon → `tab-tree`, mode indeks → `tab-<sumber>`).
  - Hook `useDialogFocus(open)` dipakai modal matriks dan modal Panduan: fokus awal ke elemen fokusable pertama, Tab/Shift+Tab dikurung di dalam dialog, fokus dikembalikan ke pemicu saat modal ditutup (termasuk saat ditutup lewat Esc atau klik latar).
- Vol.3 Seksi II + tabel khusus + progress bar (batch terakhir):
  - `scripts/build-ext-index.mjs` → `public/data/ext-index.json`: **2.965 entri (2.636 ber-kode)**, hlm. 691–740, bentuk sama dengan `AlphaIndex` (`[term, code, level, page, see, code2]`). Sumber `data/raw/vol3-ext-pages.json` (50 halaman, hasil ekstraksi pdfjs, 2 kolom dipisah di `x >= 214`).
    - Perbaikan builder: INDENT dilebarkan `[3,45]`; baris `....continued` dilewati; lanjutan ditandai kurung tak seimbang; kode yang menempel di teks diambil lewat `findEmbeddedCode` (hanya depth-0); bila kurung belum seimbang, kode di ujung baris dikembalikan ke istilah (memperbaiki rentang `W00–X59` yang terpecah).
  - `scripts/build-special.mjs` → `public/data/special-tables.json` (2 tabel, 76 baris):
    - Abortus: 66 baris (60 ber-kode), level 0–3, hlm. 18–19, `colBase ["","","O08"]`, `families O03–O06,O08`. Sumbu kolom terverifikasi: kolom 1 = kolom 2 + 5 (incomplete `.0–.4`, complete/unspecified `.5–.9`).
    - Kecelakaan lalu lintas darat: 10 baris (9 ber-kode), hlm. 692, baris grup "Occupant of" + 9 anak (awalan "- " dibuang, hierarki lewat indentasi level).
  - `src/lib/special.ts`: `SpecialRow`, `SpecialTable`, `SpecialFile`, `cellTarget()` — `navCode` membuang akhiran `.`/`-`/`–`; sel `(W51.-)`/`(W22.5)` resolve ke W51/W22.5; kolom 3 abortus → `O08.x` nyata; kolom 1–2 hanya chip suffix (O03–O06 tak punya node 4-karakter) dengan tooltip `O03.8, O04.8, O05.8, O06.8`.
  - `src/lib/fetchJson.ts`: fetch streaming + progress byte; karena Next dev menyajikan JSON publik gzip+chunked tanpa `content-length`, `scripts/write-sizes.mjs` → `public/data/sizes.json` (7 berkas) dipakai sebagai penyebut.
  - UI: tab sumber jadi 5 (Penyakit, Penyebab Luar, Neoplasma, Obat & Kimia, Tabel Khusus) dengan ikon `BookMarked`/`Ambulance`/`Dna`/`Pill`/`Table2`; progress bar gradien di header (`role="progressbar"` + `aria-valuenow`, fallback `w-1/3 animate-pulse`), spinner + persen di subjudul, persen di skeleton; ikon `ListOrdered`/`FileText` di baris meta; `ChevronDown` pada "Muat lagi"; placeholder khusus per tabel (`indexTblPh`, `idxExtPh`).
  - Matriks tampil di modal lebar penuh (bukan panel 400 px): header + kolom pertama sticky, chip kode bisa diklik → `go(code)` + modal tertutup, Esc menutup.
  - i18n ID/EN: `idxExt`, `idxExtPh`, `idxExtSrc`, `idxSpecial`, `specialHint/Open/Rows/Pages/Family/Suffix/CellNo/Cols/RowHead/TermHead/Click` (+ `indexTblPh` yang tadinya hilang di EN); `guideNote` diperbarui menyebut seluruh Vol.3.
- `src/app/page.tsx` (rapikan UI halaman detail/catatan):
  - Urutan panel detail: header → meta → QC → subdivisi → Key Knowledge → rubrik WHO (Inklusi/Eksklusi/Notes) → Istilah Indonesia → Catatan pribadi → sub-kategori. Rubrik WHO kini di atas istilah ID/catatan (sebelumnya terbalik).
  - Header detail sticky di desktop (`lg:sticky lg:top-0`, statis di mobile & print) berisi breadcrumb + kode + badge + tombol MT/salin, dengan latar `backdrop-blur`. Container detail dipindah: scroll di luar, padding di wrapper dalam, agar sticky menempel tepat di tepi atas (tanpa celah 16 px).
  - `paneRef` + efek `[sel]`: panel detail kembali ke atas setiap pindah kode (sebelumnya ikut posisi scroll kode sebelumnya).
  - Subdivisi: kode penuh dihitung dari induk sesuai posisi digit (`pos === "5" ? slice(0,5) : slice(0,3)`) → baris tetap bisa diklik dari halaman 4/5 karakter (F10.2, S02.01). Baris aktif diberi `aria-current="true"` + ring teal. Bila kode yang dibuka adalah subdivisi dan jumlah >3, daftar dilipat (`<details>`): ringkasan baris aktif tetap tampil, "Tampilkan semua N subdivisi" untuk membuka. CSS `details[open] + .subdiv-active { display:none }` mencegah baris tampil ganda.
  - Meta bar: morbiditas jadi chip sejajar mortalitas.
  - Catatan pribadi: textarea auto-grow (3–14 baris), tombol "Hapus catatan", penghitung karakter + "tersimpan otomatis", dan fallback cetak (`textarea`/tombol `print:hidden`, isi catatan dicetak sebagai teks). `scroll-mt-32` pada #pengantar agar lompatan "see note N" tidak tertutup header sticky.
  - `setNote`: entri kosong dihapus dari `localStorage` (tidak menyisakan `"C50": ""`); penanda titik di tree memakai `notes[c]?.trim()` sehingga catatan berisi spasi saja tidak menandai kode; tombol "Hapus catatan" tampil selama ada isi (termasuk spasi) agar bisa dibersihkan.
  - i18n: `notesMeta`, `notesClear`, `subdivShowAll`, `subdivHide` (ID + EN).
- `src/app/globals.css`: aturan `details[open] + .subdiv-active`.
- `src/lib/icd.ts`: `getNode()` klon rubrics + `preferred: [judul gabungan]` agar detail virtual tampil "Low back pain - Thoracolumbar region" (sebelumnya hanya judul dasar).
- `src/lib/icd.ts`: `resolveVirtual`, `effectiveMods` (warisan modifier + filter scope), `subFull`, `getNode`, `codeMark` null-safe.
- `src/lib/icd.ts`: `linkify()` tangani rentang (A15-A16, C76–C80 → kedua ujung ter-link bila node ada) + rujukan "see note N" → segmen khusus.
- `src/lib/icd.ts`: `linkTarget()` + `renderLinked` kini lewat `getNode` → kode yang butuh karakter ke-4/ke-5 (F10.6, N00.9, V01.0, F17.2 sebagai kode VIRTUAL) ikut ter-link; bila tetap tak ada node, jatuh ke kategori terdekat (mis. I72.6 → I72, tooltip menandai "kategori").
- `scripts/build-data.mjs`: `tidyProse` gabung "E 27.5"→"E27.5"; fiks aturan spasi "Notes1." min 2 huruf (sebelumnya ikut membelah kode "T82.0").

## Verification

- Perbaikan rujukan "lihat"/"see also" (batch ini):
  - `resolveSee` di `src/lib/alpha.ts` kini **menelusuri jalur**: bagian pertama dicocokkan ke lead term terdangkal (level 0 untuk indeks alfabet, level 1 untuk tabel), bagian berikutnya ditelusuri sebagai subterm di dalam blok induk. Bagian yang tak ada di daftar (`by site`, `NEC`, `malignant`) menghentikan penelusuran di induk terakhir — jadi `lihat: Abscess, by site` mendarat di `Abscess`, bukan kotak cari.
  - `termKey()` membandingkan istilah tanpa keterangan kurung, sehingga `Aneurysm (anastomotic) (artery) …` cocok dengan rujukan `Aneurysm`.
  - `lihat: Disease` dulu mendarat di huruf A (subterm `disease` di bawah `Anemia`); sekarang di huruf D, lead term `Disease, diseased`.
  - `gotoSee` (`page.tsx`): rujukan `Neoplasm, …` dari indeks alfabet selalu pindah ke tab Neoplasma lebih dulu (blok neoplasma tidak lagi ada di indeks alfabet).
  - `scripts/build-index.mjs`: halaman matriks aborsi (PDF 1136–1137) tidak lagi dilewati seluruhnya — hanya sel matriks (x ≥ 150) yang dibuang, sehingga lead term `Abortion` (hlm. 16, 89 subterm) dan blok `Abscess` (hlm. 19) yang tertanam di halaman itu kini masuk. Label baris tabel tanpa kode tidak lagi dipakai sebagai induk lanjutan.
  - Audit rujukan (sampel 125/3235 alpha, semua ext/neo/drugs): sisa kegagalan hanya rujukan non-jalur (`Table of drugs and chemicals, Lead`, `note 6, Volume 1 …`, `Levo-`, `Sulf-`, `Fluoride(s)`, `also Neoplasm, nerve, peripheral)`).
  - Terverifikasi Puppeteer (dev :3001, 0 error konsol): `lihat: Disease` → huruf D, baris `Disease, diseased` tersorot; `lihat: Aneurysm, brain` → huruf A, baris `brain | I67.1`; `lihat: Abscess, by site` → huruf A, baris `Abscess (embolic) … | L02.9`; `lihat: Neoplasm, sinus` → tab Neoplasma, huruf S, `sinus (accessory)`.
- Perbaikan tabel Neoplasma (batch sebelumnya), diuji Puppeteer pada dev :3001 setelah build produksi:
  - Baris kepala `Neoplasm, neoplastic | 456 | C80.9 C79.9 D09.9 D36.9 D48.9` tampil di huruf N (level 0, tebal).
  - Pencarian `C80.9` mengembalikan 5 baris dengan baris kepala **di urutan pertama** (haystack = istilah + kode; kueri berangka diurutkan menurut urutan tabel, bukan panjang teks). `D09.9` juga menaruh baris kepala di posisi 1; kueri biasa ("diabetes") tetap diurutkan awalan + panjang seperti sebelumnya.
  - `lihat: Neoplasm, sinus` → pindah ke huruf **S**, baris `sinus (accessory)` tersorot kuning (scrollTop 1450), bukan kotak cari.
  - Chip `#` (judul "Lihat catatan 2") dan `<>` ("Lihat catatan 3") membuka `<details>` "Catatan tabel (3)" dan menggulir ke catatan yang dituju; isi catatan 3 utuh sampai `coded to C79.5`.
  - Lintas tab: `lihat: Neoplasm, connective tissue, malignant` dari indeks alfabet → tab Neoplasma aktif, baris `connective tissue NEC` tersorot.
  - Regresi indeks alfabet: `lihat: Malposition, congenital` → baris `congenital` (hlm. 429) tersorot.
  - EN: judul catatan jadi "Table notes (3)". 0 error konsol di semua langkah. Tangkapan: `shots/90`–`94`.
- Audit lapis ketiga (`verify-a11y4.mjs`, `verify-print2.mjs`, `verify-skip.mjs` di temp, 1440×900 / 320×800 / 794×1123 + media print):
  - Skip link: Tab pertama → `<a href="#main-content">` "Lompat ke konten utama" tampil (rect 183×36, outline 2px solid); Enter → `document.activeElement = <main id="main-content">`.
  - Kredit 320 px: badge "Kang Aris | @riz_es" `left=72 right=182`, `fullyVisible=true`, `clipped=false` (sebelumnya `right=403`).
  - Sapuan fokus 91 elemen fokusabel: 4 laporan awal ternyata **false positive** (chip contoh sintaks berada di dalam `<details>` tertutup sehingga `focus()` gagal → `activeElement` tak berubah). Setelah `<details>` dibuka, chip menerima fokus dan `outline: solid 2px rgb(20,184,166)`. Tidak ada kontrol nyata tanpa indikator fokus.
  - Live region: kosong → "7 hasil pencarian" (cholera) → "Tidak ada hasil pencarian" (zzzznotfound) → kosong.
  - Header 1440 px: tinggi 64 px, badge `[292,34,110]` di dalam header, tidak menimpa `nav`.
  - Cetak (794 px, `emulateMediaType("print")`) untuk E11: panel kiri `display:none`, `docOverflowX=false`, `scrollers=0`, `clipped=0`, tinggi detail 1244 px = seluruh konten; PDF A4 (`page.pdf`) = **2 halaman**, 102.940 byte, semua bagian (subdivisi, Key Knowledge, inklusi, eksklusi, istilah ID, catatan) tercetak utuh.
  - Cetak tema gelap: `sectionBg rgb(255,255,255)`, `h2Color rgb(17,17,17)`, `bodyBg` putih → tidak ada teks terang di kertas putih.
  - 0 error konsol di semua langkah.
- Audit aksesibilitas menyeluruh (`audit-a11y.mjs` di temp, 1440×900, 11 keadaan: Pohon / Penyakit / Penyebab Luar / Obat & Kimia / Tabel Khusus / modal matriks × tema terang & gelap):
  - Sebelum perbaikan terdeteksi: 1 field tanpa nama (placeholder-only), 5–9 kombinasi warna di bawah ambang (terendah 1,48:1), semuanya nyata.
  - Sesudah perbaikan: **0 field tanpa nama, 0 kombinasi kontras di bawah ambang (WCAG AA: 4,5:1 teks normal / 3:1 teks besar), 0 id ganda, 0 `img` tanpa `alt`, 0 heading kosong** di kesebelas keadaan.
  - Urutan fokus panel detail: 11 elemen, urutan visual naik (`y` tidak menurun) di semua keadaan.
  - Alat ukur diuji kontrol (`control-contrast.mjs`): teks `#e5e7eb` di putih terbaca **1,24**, teks `#475569` di putih **7,58** — membuktikan audit tidak buta.
- Uji Puppeteer aksesibilitas tab/modal (`verify-a11y.mjs`, `verify-a11y2.mjs`, 1440×900):
  - Roving tabindex: tiap tablist tepat 1 tab `tabIndex=0`; semua `aria-controls` menunjuk `#left-panel` yang ada; panel `role="tabpanel"` dengan `aria-labelledby` sinkron (`tab-tree` → `tab-alpha`/`tab-ext`/`tab-tables`).
  - Keyboard: fokus di `Pohon` + `ArrowRight` → `Indeks A–Z` aktif (`aria-selected=true`); `End` di tablist sumber → `Tabel Khusus` aktif (2 kartu muncul); `ArrowRight` dari tab terakhir membungkus ke `Penyakit`.
  - Modal matriks: fokus awal masuk dialog; `Shift+Tab` 4× tetap di dalam dialog (`inDialog=true` tiap langkah); `Esc` menutup dan fokus kembali ke kartu "Kecelakaan lalu lintas". Modal Panduan: fokus awal `Tutup`, `Esc` mengembalikan fokus ke tombol "Panduan".
  - 0 error konsol; 0 tab tanpa nama; 0 tab dengan `aria-controls` menggantung.
- Uji Puppeteer sumber Vol.3 (1440×900, 390×800, tema terang + gelap, `verify-vol3.mjs` / `verify-switch.mjs` / `verify-en2.mjs`):
  - Tab: 7 tombol `role="tab"` (2 mode + 5 sumber), semuanya ber-ikon.
  - Penyebab Luar: "2.965 istilah | Sumber: ICD-10 Vol.3, Seksi II hlm. 691–740", strip A–Z, placeholder `Cari istilah penyebab luar (Inggris)…`; pencarian "accident" memuat istilah + kode (X59.-, Y06.9…) beserta breadcrumb induk.
  - Tabel Khusus: 2 kartu (Abortus 66 baris hlm. 18–19; Kecelakaan lalu lintas 10 baris hlm. 692), kotak pencarian & strip A–Z disembunyikan; balik ke Penyakit → 55.200 istilah, pencarian + A–Z muncul lagi.
  - Matriks lalu lintas: 10 baris × 11 kolom (+ kolom label), 98 chip bisa diklik; sel `(W51.-)` dan `(W22.5)` resolve; klik `V03.-` menutup modal dan membuka detail V03; Esc menutup modal.
  - Matriks abortus: 66 baris × 3 kolom, 60 chip O08.x; sel `.8`/`.3` non-klik dengan tooltip `O03.8, O04.8, O05.8, O06.8 — …`; klik chip keluarga `O08` membuka detail O08.
  - EN: label tab & kartu & header matriks ikut berganti ("External Causes", "Special Tables", "Transport accidents (V01–V99)", "TERM / VICTIM"), 0 error konsol.
  - Progress bar: terlihat saat `icd10.json` (maks 99%) dan `alpha-index.json` (maks 98%) dimuat; skeleton menampilkan "Memuat data… 31%".
- `tsc --noEmit` (via `node node_modules/typescript/bin/tsc`): bersih setelah semua perubahan di atas.
- Batch 14/14 virtual resolve benar; V01.4 invalid ditolak; node asli (A00.0) tak tertimpa.
- Uji Puppeteer halaman detail (1440×900, 390×844):
  - Sticky header: `position: sticky`, `delta = 0` terhadap tepi atas panel saat scroll 700 px; di mobile `position: static`; mode print `static` + breadcrumb/textarea/tombol tersembunyi, isi catatan tercetak.
  - Scroll reset: scroll 800 px di bab II → pindah ke C50 → `scrollTop = 0`.
  - "see note 5" → lompat ke #pengantar; `pengTop 205 > headBottom 195` (tidak tertutup header).
  - Subdivisi: F10.2 (10 baris) terlipat dengan baris `.2` aktif; buka daftar → baris aktif di daftar ter-highlight; klik `.5` → pindah ke F10.5. S02.01 (2 subdivisi) tetap terbuka. EN: "Show all 10 subdivisions"/"Hide list".
  - Catatan: isi teks → tersimpan di `localStorage` (`icd10-notes-v1`), penghitung karakter muncul, tombol "Hapus catatan" mengosongkan textarea + localStorage (kunci dihapus, bukan disisakan sebagai string kosong). Catatan berisi spasi saja bisa dihapus kembali.
  - Mobile 390 px: tanpa overflow horizontal (`overflowX = 0`), textarea 332 px di dalam panel 366 px.
  - Konsol: 0 error.
- Batch 14/14 virtual resolve benar; V01.4 invalid ditolak; node asli (A00.0) tak tertimpa.
- Bug nyata ditemukan & diperbaiki: `codeMark(undefined)` crash saat hasil virtual muncul (karena `nodes[code]` undefined).
- Kode 4/5-karakter di catatan terverifikasi: F04 → "F10.6" ter-link & membuka F10.6 (virtual); I72.5 → "I72.6" ter-link & jatuh ke kategori I72. Semua kode di catatan bab XIII/XIX/XX ter-link.
- `npm run build` produksi (20 Okt 2026, dev server dihentikan dulu): **EXIT=0**, `Compiled successfully`, lint + type check lolos, 4/4 halaman statis. First Load JS `/` = **116 kB** (dari 108 kB sebelum Vol.3; +1 kB dari hook fokus modal + navigasi tablist; perbaikan kontras/label tidak menambah byte). `build-data.mjs` tetap menghasilkan `icd10.json` 4,41 MB & `search-index.json` 996 KB, 11373 entri, 421 KN, 1431 QC. `write-sizes.mjs` dijalankan ulang sesudah build (7 berkas). Dev server dinyalakan ulang (pid 6944, `GET /` 200) dan audit a11y + uji Puppeteer Vol.3 diulang: semua pemeriksaan di atas tetap lolos, 0 error konsol.
- `tsc --noEmit` bersih (exit 0) setelah seluruh perubahan kontras dan `idAddLabel`.
- `npm run build` produksi ulang (20 Okt 2026, dev server dihentikan dulu): **EXIT=0**, `Compiled successfully`, 4/4 halaman statis, First Load JS `/` tetap **116 kB**. `build-data.mjs` meregenerasi `icd10.json` 4.612.160 byte & `search-index.json` 1.019.735 byte — `sizes.json` dicek dan **ketujuh ukuran tetap cocok** (tidak perlu `write-sizes.mjs`). `tsc --noEmit` exit 0 sebelum build.
- `tsc --noEmit` exit 0 juga setelah skip link + live region + perbaikan header/cetak.

## Known Issues

- Dev server mati tiap sesi/server restart atau bila `npm run build` dijalankan saat dev jalan (aset 404) → restart `npm run dev`, JANGAN pipe ke `Select-Object -First`.
- Skrip uji Puppeteer via `node -e` rawan quoting PowerShell → selalu tulis file `.mjs`.

## Next Action

1. Vol.3 sudah lengkap — tidak ada impor tersisa. Bukti: pemindaian 678 halaman rentang indeks (`vol3-pages.json`) hanya menemukan 2 halaman sparse (judul Seksi I + 1 halaman kosong), jadi tidak ada tabel sisipan lain yang terlewat.
2. Aksesibilitas dasar sudah bersih (nama aksesibel, kontras AA, urutan fokus, fokus modal, skip link, live region, indikator fokus). Kandidat lanjutan bila diminta: uji dengan pembaca layar sungguhan (NVDA) untuk alur pohon → detail.
3. Jalankan `scripts/write-sizes.mjs` setiap kali berkas di `public/data/` berubah, agar persentase progress bar tetap akurat.
4. Opsional: jalankan ulang `npm run build` hanya bila ada perubahan kode berikutnya (dev server harus dihentikan dulu, lalu `npm run dev` lagi).

## Resume Instructions

- Jangan sentuh `data/raw/` (sumber) dan port 3001. Kamus xlsx sudah di `data/raw/` (build cek lokal dulu).
- Kredit "Kang Aris | @riz_es" + logo RUANGPMIK wajib dipertahankan di header/footer.
- Bukan repo git → tak ada commit; pengaman file via salinan data di `data/raw/`.
- `npm run build` gagal lewat PowerShell (`npm.ps1` diblokir ExecutionPolicy) → pakai `cmd /c "npm run build > %TEMP%\icd-build.log 2>&1"`.
- Skrip ekstraksi PDF memakai `pdfjs-dist` milik KLAIMINTEL lewat `createRequire` (tanpa menambah dependensi ICD).
