// Obfuscate app chunks after `next build`.
//
// Only the app's own route chunks are touched. Framework chunks (react,
// next runtime, polyfills) are stock code and carry no value to a copier,
// so leaving them readable keeps debugging and hydration predictable.
//
// This is a speed bump, not protection: the browser must execute the code,
// so anyone with DevTools can still read and reuse it.
import fs from "node:fs";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const OUT = path.join(process.cwd(), "out");
const TARGET = path.join(OUT, "_next", "static", "chunks", "app");

if (!fs.existsSync(TARGET)) {
  console.error(`obfuscate: ${TARGET} not found, run next build first`);
  process.exit(1);
}

const options = {
  compact: true,
  target: "browser",
  // Keep top-level webpack identifiers intact; the runtime looks them up by name.
  renameGlobals: false,
  identifierNamesGenerator: "hexadecimal",
  // String array keeps literals out of plain sight but decodes them at runtime,
  // so aria-labels, class names and test selectors still behave.
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ["base64"],
  stringArrayWrappersCount: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  // These two cost a lot of runtime and can break React internals.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  simplify: true,
  splitStrings: false,
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

let before = 0;
let after = 0;

for (const file of walk(TARGET).filter((f) => f.endsWith(".js"))) {
  const code = fs.readFileSync(file, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
  // Fail loudly instead of shipping a chunk the browser cannot parse.
  new Function(result);
  fs.writeFileSync(file, result);
  before += code.length;
  after += result.length;
  console.log(
    `obfuscate: ${path.basename(file)} ${(code.length / 1024).toFixed(0)}KB -> ${(
      result.length / 1024
    ).toFixed(0)}KB`
  );
}

console.log(
  `obfuscate: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`
);
