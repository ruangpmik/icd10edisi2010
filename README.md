# icd10edisi2010

Browser ICD-10 edisi 2010 (Volume 1, 2, dan 3) dengan penelusuran pohon, indeks, tabel khusus, penautan morfologi ICD-O, serta catatan koding.

Situs: https://ruangpmik.github.io/icd10edisi2010/

## Menjalankan lokal

```
npm install
npm run dev
```

Buka http://localhost:3001.

## Membangun

```
npm run build
```

Menghasilkan ekspor statis di `out/`. Untuk build di bawah sub-path (mis. GitHub Pages), set `NEXT_PUBLIC_BASE_PATH=/icd10edisi2010` sebelum build.

Build juga menjalankan `scripts/obfuscate.mjs`, yang mengaburkan chunk aplikasi di `out/_next/static/chunks/app/`. Ini hanya menaikkan biaya penyalinan, bukan perlindungan: kode yang dijalankan browser selalu bisa dibaca lewat DevTools.

## Data

Berkas JSON di `public/data/` dibangun oleh skrip di `scripts/` dari PDF sumber di `data/raw/`.

## Kredit

Kang Aris | @riz_es — RUANGPMIK

## Lisensi

Hak cipta dilindungi. Lihat [LICENSE](LICENSE). Tidak ada izin untuk menyalin, mendistribusikan, atau membuat karya turunan tanpa izin tertulis.
