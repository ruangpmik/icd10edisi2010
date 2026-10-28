// Preload sandboxed — API lisensi SEMPIT untuk renderer.
// Tidak ada require lain selain "electron" (kewajiban sandbox).
// Key/token tidak pernah lewat sini; hanya status terhitung + perintah terbatas.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("icd10License", {
  status: () => ipcRenderer.invoke("license:status"),
  activate: (key) => ipcRenderer.invoke("license:activate", typeof key === "string" ? key : ""),
  renew: () => ipcRenderer.invoke("license:renew"),
  deactivate: () => ipcRenderer.invoke("license:deactivate"),
  onUpdate: (cb) => {
    if (typeof cb !== "function") return () => {};
    const h = (_e, st) => cb(st);
    ipcRenderer.on("license-status", h);
    return () => ipcRenderer.removeListener("license-status", h);
  },
});
