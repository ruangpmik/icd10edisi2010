// Generate keypair Ed25519 untuk signing lease.
// Pemakaian:  node scripts/generate-keys.mjs <kid>   (mis. test-2026-10)
// Hasil:      keys/<kid>.private.pem  (TIDANG boleh di-commit / di-copy ke client)
//             keys/<kid>.public.pem   (aman — ini yang dipasang di aplikasi desktop)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kid = process.argv[2];
if (!kid || !/^[A-Za-z0-9._-]{1,64}$/.test(kid)) {
  console.error("Pakai: node scripts/generate-keys.mjs <kid>");
  process.exit(1);
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "keys");
fs.mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });
fs.writeFileSync(path.join(dir, `${kid}.private.pem`), privPem, { mode: 0o600 });
fs.writeFileSync(path.join(dir, `${kid}.public.pem`), pubPem, { mode: 0o644 });
console.log(`Kunci ${kid} dibuat di keys/`);
console.log("private: " + path.join(dir, `${kid}.private.pem`));
console.log("public : " + path.join(dir, `${kid}.public.pem`));
console.log("\nPasang public key ke aplikasi desktop: electron/public-keys.json");
console.log("JANGAN commit / copy file .private.pem ke repository client.");
