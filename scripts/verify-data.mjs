// F2-D: verifikasi data kamus identik dengan HEAD, kecuali meta.builtAt.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(ROOT, "public", "data", "icd10.json");

const head = execSync("git show HEAD:public/data/icd10.json", {
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
});
const work = fs.readFileSync(F);

const strip = (buf) => {
  const j = JSON.parse(buf.toString("utf8"));
  delete j.meta?.builtAt;
  return JSON.stringify(j);
};

const h = (s) => createHash("sha256").update(s).digest("hex");
const a = strip(head);
const b = strip(work);

const jh = JSON.parse(head.toString("utf8"));
const jw = JSON.parse(work.toString("utf8"));
const count = (j) => ({
  nodes: Object.keys(j.nodes ?? {}).length,
  chapters: j.chapters?.length ?? 0,
  idTerms: Object.keys(j.idTerms ?? {}).length,
  modifiers: Object.keys(j.modifiers ?? {}).length,
  builtAt_head: jh.meta?.builtAt,
  builtAt_work: jw.meta?.builtAt,
});

console.log("SHA256 (tanpa builtAt) HEAD :", h(a));
console.log("SHA256 (tanpa builtAt) WORK :", h(b));
console.log("IDENTIK:", a === b);
console.log("HEAD :", JSON.stringify(count(jh)));
console.log("WORK :", JSON.stringify(count(jw)));
process.exit(a === b ? 0 : 1);
