// Hitung SHA-256 seluruh inline script di out/**/*.html untuk CSP berbasis hash.
// Hasil: electron/csp-hashes.json (array base64). Dijalankan setelah obfuscate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const DEST = path.join(ROOT, "electron", "csp-hashes.json");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });
}

const hashes = new Set();
for (const f of walk(OUT)) {
  const html = fs.readFileSync(f, "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    if (!body.trim()) continue;
    const h = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.add(h);
    console.log(`${path.relative(OUT, f)}: sha256-${h.slice(0, 12)}… (${body.length} B)`);
  }
}

fs.writeFileSync(DEST, JSON.stringify([...hashes], null, 2) + "\n");
console.log(`csp-hashes: ${hashes.size} hash unik -> electron/csp-hashes.json`);
