// Verifikasi: link kode + rentang di intro Bab II.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const req = createRequire(path.join(ROOT, "package.json"));
const puppeteer = req("C:\\laragon\\www\\klaimintel\\node_modules\\puppeteer");
const OUT = "C:\\Users\\IT PROGRAMMER\\AppData\\Local\\Temp\\opencode\\shots";

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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("main button")].find(
      (x) => x.querySelector(".font-mono")?.textContent === "II"
    );
    b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("section button.codelink")].map((x) => x.textContent).slice(0, 12)
  );
  console.log("codelinks:", JSON.stringify(links));
  // klik E27.5 -> harus pindah ke detail E27.5
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("section button.codelink")].find((x) => x.textContent === "E27.5");
    if (!b) throw new Error("E27.5 tidak ter-link");
    b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  console.log("detail setelah klik:", await page.evaluate(() => document.querySelector("section h2").textContent));
  await page.screenshot({ path: path.join(OUT, "links.png") });
} finally {
  await browser.close();
}
