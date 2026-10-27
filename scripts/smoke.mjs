// Regresi UI: halaman jalan, data lengkap, pencarian, kamus ID, tanpa error konsol.
// Usage: node scripts/smoke.mjs [url]  (default http://localhost:3001)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const URL = process.argv[2] ?? "http://localhost:3001";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(ROOT, "package.json"));
const puppeteer = req("C:\\laragon\\www\\klaimintel\\node_modules\\puppeteer");

const errors = [];
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

let fail = 0;
const t = (name, ok, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 120000 });

  // Tunggu data icd10.json selesai termuat (pohon terisi).
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => /^A00/.test(b.textContent ?? "")),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 500));

  // 1. 22 bab di pohon.
  const chapters = await page.$$eval("button", (bs) =>
    bs.filter((b) => /^(I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII)(?=[A-Z])/.test(b.textContent ?? "")).length
  );
  t("pohon bab (22)", chapters >= 22, `terdeteksi ${chapters}`);

  // 2. Pencarian "abortus" memfilter hasil.
  await page.type('input[placeholder="Cari kode / diagnosis…"]', "abortus", { delay: 30 });
  await new Promise((r) => setTimeout(r, 1500));
  const hits = await page.$$eval("button", (bs) =>
    bs.filter((b) => /abortus/i.test(b.textContent ?? "")).length
  );
  t("pencarian 'abortus'", hits > 0, `${hits} baris`);

  // 3. Klik baris hasil dengan padanan ID (O08.1) → panel detail + istilah ID.
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /^O0[0-9]/.test(x.textContent ?? "") && /abortus|haemorrhage/i.test(x.textContent ?? "")
    );
    b?.click();
    return b?.textContent?.slice(0, 40);
  });
  await new Promise((r) => setTimeout(r, 1000));
  const body1 = await page.evaluate(() => document.body.innerText);
  t(
    "panel detail + kamus ID",
    clicked !== undefined && body1.includes("ISTILAH INDONESIA") && !/Belum ada padanan/.test(body1),
    `klik: ${clicked ?? "gagal"}`
  );

  // 4. Tab Indeks A–Z: buka dan cari istilah.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Indeks A–Z")?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const idxPh = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map((i) => i.placeholder).find((p) => /Indeks/i.test(p)) ?? ""
  );
  t("tab Indeks A–Z", idxPh.length > 0, idxPh);
  if (idxPh) {
    await page.type(`input[placeholder="${idxPh}"]`, "neoplasm", { delay: 20 });
    await new Promise((r) => setTimeout(r, 1500));
    const idxHits = await page.evaluate(() => /Neoplasm/i.test(document.body.innerText));
    t("indeks 'neoplasm'", idxHits);
  }

  // 5. Data dari halaman: idTerms tidak kosong.
  const idCount = await page.evaluate(async () => {
    const j = await (await fetch("data/icd10.json")).json();
    return Object.keys(j.idTerms ?? {}).length;
  });
  t("idTerms >= 437", idCount >= 437, `${idCount}`);

  console.log(errors.length ? `KONSOL ERROR (${errors.length}):` : "KONSOL BERSIH (0 error)");
  errors.slice(0, 10).forEach((e) => console.log("  -", e.slice(0, 160)));
  process.exitCode = fail || errors.length ? 1 : 0;
} finally {
  await browser.close();
}
