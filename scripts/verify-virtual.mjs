// Verifikasi batch kode subdivisi virtual.
import fs from "node:fs";
import { resolveVirtual, search } from "../src/lib/icd.ts";
const data = JSON.parse(fs.readFileSync("./public/data/icd10.json", "utf8"));
const cases = ["V01.1", "V20.4", "M54.55", "S02.01", "S72.01", "W01.4", "E10.2", "F10.2", "K25.0", "N00.0", "O03.0", "R83.0", "Y70.0", "M23.01", "V01.4", "A00.0", "I70.0", "Z00.0"];
for (const c of cases) {
  const v = resolveVirtual(data, c);
  const hit = search(data, {}, c, 3)[0];
  console.log(
    c.padEnd(8),
    v ? `OK ${v.full} | ${v.title.slice(0, 72)}` : "null",
    "| hit1:",
    hit ? `${hit.code}[${hit.kind}]` : "-"
  );
}
