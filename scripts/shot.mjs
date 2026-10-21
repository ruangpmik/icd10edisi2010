// Screenshot http://localhost:3001 untuk review UI.
// Usage: node scripts/shot.mjs [outdir]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = process.argv[2] ?? "C:\\Users\\IT PROGRAMMER\\AppData\\Local\\Temp\\opencode\\shots";
const req = createRequire(path.join(ROOT, "package.json"));
const puppeteer = req("C:\\laragon\\www\\klaimintel\\node_modules\\puppeteer");

const shots = [
  { name: "desktop-top.png", w: 1440, h: 900, dark: false },
  { name: "desktop-en.png", w: 1440, h: 900, dark: false, lang: "en" },
  { name: "desktop-dark.png", w: 1440, h: 900, dark: true },
  { name: "mobile.png", w: 390, h: 844, dark: false },
];

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h });
    if (s.dark) {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    }
    await page.goto("http://localhost:3001/", { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    if (s.lang) {
      await page.evaluate((l) => localStorage.setItem("icd10-lang", l), s.lang);
      await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (s.dark) {
      // paksa dark via toggle bila perlu: set class manual
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await new Promise((r) => setTimeout(r, 800));
    }
    const fs = await import("node:fs");
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, s.name) });
    console.log("OK", s.name);
    await page.close();
  }
} finally {
  await browser.close();
}
