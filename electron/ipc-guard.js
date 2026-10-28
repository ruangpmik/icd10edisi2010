// Penjaga IPC lisensi: hanya frame top-level dari app://local/ yang boleh
// memanggil kanal lisensi. Dipisah dari main.js agar bisa diuji unit.
"use strict";

function allowLicenseIpc(e) {
  const f = e && e.senderFrame;
  return !!f && typeof f.url === "string" && f.url.startsWith("app://local/") && f.parent === null;
}

module.exports = { allowLicenseIpc };