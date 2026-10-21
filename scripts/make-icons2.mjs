// Rebuild favicon + apple-touch-icon dari logo berlatar hitam.
// Usage: node scripts/make-icons2.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const req = createRequire(path.join(ROOT, "package.json"));
const sharp = req("C:\\laragon\\www\\klaimintel\\node_modules\\sharp");

const logo = path.join(ROOT, "public", "logo.png");

const apple = await sharp(logo).resize(180, 180, { fit: "cover" }).png().toBuffer();
fs.writeFileSync(path.join(ROOT, "public", "apple-touch-icon.png"), apple);
console.log("apple-touch-icon.png:", apple.length);

async function tile(size) {
  const img = await sharp(logo).resize(size, size, { fit: "cover" }).png().toBuffer();
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`
  );
  return sharp(img).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

const p16 = await tile(16);
const p32 = await tile(32);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(2, 4);
const entries = [];
let off = 6 + 32;
for (const [w, b] of [[16, p16], [32, p32]]) {
  const e = Buffer.alloc(16);
  e.writeUInt8(w, 0);
  e.writeUInt8(w, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(b.length, 8);
  e.writeUInt32LE(off, 12);
  entries.push(e);
  off += b.length;
}
const ico = Buffer.concat([header, ...entries, p16, p32]);
fs.writeFileSync(path.join(ROOT, "public", "favicon.ico"), ico);
console.log("favicon.ico:", ico.length);
