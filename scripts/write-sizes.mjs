// Menulis public/data/sizes.json berisi ukuran byte tiap berkas data.
//
// Next.js menyajikan berkas publik dengan gzip + chunked sehingga header
// content-length tidak ada; UI butuh ukuran acuan agar bar progres bisa
// menampilkan persen nyata. Jalankan setelah membangun ulang berkas data:
//   node scripts/write-sizes.mjs
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "public", "data");
const sizes = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".json") || f === "sizes.json") continue;
  sizes[f] = fs.statSync(path.join(dir, f)).size;
}
const out = path.join(dir, "sizes.json");
fs.writeFileSync(out, JSON.stringify(sizes));
console.log(`sizes.json: ${Object.keys(sizes).length} berkas`);
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k} = ${v} (${(v / 1024).toFixed(0)} KB)`);
