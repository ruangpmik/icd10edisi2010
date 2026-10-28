// Build icon.ico (multi-size PNG) untuk Electron/NSIS dari public/logo.png.
// Usage: node scripts/make-desktop-icon.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const req = createRequire(path.join(ROOT, "package.json"));
const sharp = req("C:\\laragon\\www\\klaimintel\\node_modules\\sharp");

const logo = path.join(ROOT, "public", "logo.png");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function tile(size) {
  const img = await sharp(logo).resize(size, size, { fit: "cover" }).png().toBuffer();
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`
  );
  return sharp(img).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

const parts = [];
for (const s of SIZES) parts.push(await tile(s));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

let off = 6 + SIZES.length * 16;
const entries = [];
SIZES.forEach((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0); // width (0 = 256)
  e.writeUInt8(s >= 256 ? 0 : s, 1); // height (0 = 256)
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(parts[i].length, 8);
  e.writeUInt32LE(off, 12);
  entries.push(e);
  off += parts[i].length;
});

const ico = Buffer.concat([header, ...entries, ...parts]);
const out = path.join(ROOT, "build", "icon.ico");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ico);
console.log("build/icon.ico:", ico.length, "bytes, sizes:", SIZES.join(","));
