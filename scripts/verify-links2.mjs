// Verifikasi: linkify unit (kode+rentang+note) + kui C02.8 & see-note di browser.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const req = createRequire(path.join(ROOT, "package.json"));
const puppeteer = req("C:\\laragon\\www\\klaimintel\\node_modules\\puppeteer");
const OUT = "C:\\Users\\IT PROGRAMMER\\AppData\\Local\\Temp\\opencode\\shots";

// 1) unit linkify via strip-types
const { linkify } = await import("../src/lib/icd.ts");
for (const s of [
  "coded to C74 with additional code E27.5",
  "indexed to C16.0 (cardia), while carcinoma of the tip should be assigned to C02.8",
  "bladder C67.- and the coder may need",
  "[See note 5 at the beginning of this chapter]",
  "categories C76-C80 include",
]) {
  console.log(JSON.stringify(s.slice(0, 40)), "=>", JSON.stringify(linkify(s)));
}

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));
  // ke C02.8 via search
  await page.click("input[role=searchbox]");
  await page.keyboard.type("C02.8", { delay: 50 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => {
    [...document.querySelectorAll("main button")].find((x) => x.querySelector(".font-mono")).click();
  });
  await new Promise((r) => setTimeout(r, 600));
  console.log("detail:", await page.evaluate(() => document.querySelector("section h2").textContent));
  // klik "see note 5" pertama di detail
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("section button.codelink")].find((x) => /see note/i.test(x.textContent));
    if (!b) return null;
    b.click();
    return b.textContent;
  });
  console.log("note clicked:", clicked);
  await new Promise((r) => setTimeout(r, 1200));
  console.log(
    "after note:",
    await page.evaluate(() => document.querySelector("section h2").textContent),
    "| pengantar visible:",
    await page.evaluate(() => {
      const el = document.getElementById("pengantar");
      if (!el) return "NO-ID";
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < 900 ? "yes" : "no-" + Math.round(r.top);
    })
  );
  await page.screenshot({ path: path.join(OUT, "notejump.png") });
} finally {
  await browser.close();
}
