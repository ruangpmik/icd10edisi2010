"use client";
// Gerbang lisensi desktop. DI WEB PUBLIK window.icd10License tidak ada →
// komponen ini merender null dan aplikasi berperilaku persis seperti sebelumnya.
//
// CATATAN KEAMANAN (F3.7): overlay ini bukan batas keamanan — ia hanya UI.
// Batas sebenarnya: verifikasi lease Ed25519 + validasi server (main process).
// Aplikasi tidak pernah menghapus data pengguna saat lisensi bermasalah;
// konten (DOM) tetap terpasang, overlay hanya menutupi secara visual.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TriangleAlert, X } from "lucide-react";

type LicState = {
  state: string;
  canUseApp: boolean;
  features: string[];
  expiresAt: number | null;
  graceUntil: number | null;
  message: string | null;
  installationId?: string;
  licenseId?: string | null;
  owner?: string | null;
  licenseExp?: number | null;
};
type LicResult = {
  ok: boolean;
  error?: string;
  message?: string;
  status?: LicState;
};
type LicApi = {
  status(): Promise<LicState>;
  activate(key: string): Promise<LicResult>;
  renew(): Promise<LicResult>;
  deactivate(): Promise<LicResult>;
  onUpdate(cb: (s: LicState) => void): () => void;
};

declare global {
  interface Window {
    icd10License?: LicApi;
  }
}

const BLOCKING = new Set([
  "unactivated",
  "invalid",
  "expired",
  "revoked",
  "license_expired",
  "license_disabled",
]);

function fmtLeft(sec: number): string {
  if (sec <= 0) return "0 jam";
  const d = Math.floor(sec / 86400);
  const h = Math.ceil((sec % 86400) / 3600);
  return d > 0 ? `${d} hari ${h} jam` : `${h} jam`;
}

export function LicenseGate() {
  const [api, setApi] = useState<LicApi | null>(null);
  const [st, setSt] = useState<LicState | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const a = window.icd10License;
    if (!a) return;
    setApi(a);
    a.status().then(setSt).catch(() => {});
    const off = a.onUpdate((s) => setSt(s));
    return off;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  const doActivate = useCallback(async () => {
    if (!api || !keyInput.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.activate(keyInput.trim());
      if (r.status) setSt(r.status);
      if (r.ok) setKeyInput("");
      else setErr(r.message ?? r.error ?? "Aktivasi gagal.");
    } catch {
      setErr("Terjadi kesalahan tak terduga.");
    }
    setBusy(false);
  }, [api, keyInput, busy]);

  const doRenew = useCallback(async () => {
    if (!api || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.renew();
      if (r.status) setSt(r.status);
      if (!r.ok) setErr(r.message ?? "Validasi ulang gagal — coba lagi saat online.");
    } catch {
      setErr("Validasi ulang gagal.");
    }
    setBusy(false);
  }, [api, busy]);

  if (!api || !st) return null; // web publik & sebelum status pertama tiba
  if (st.state === "active") return null;

  if (st.state === "grace") {
    if (dismissed) return null;
    const left = st.graceUntil ? st.graceUntil - now : 0;
    return (
      <div
        role="status"
        className="fixed bottom-3 right-3 z-50 w-[min(92vw,23rem)] overflow-hidden rounded-xl border border-amber-300 bg-white shadow-xl ring-1 ring-amber-200/70 dark:border-amber-800/70 dark:bg-navy-900 dark:ring-amber-900/40"
      >
        <div className="flex items-start gap-2.5 p-3.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
            <TriangleAlert size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12.5px] font-semibold leading-snug text-amber-900 dark:text-amber-100">
                Masa tenggang offline · sisa {fmtLeft(left)}
              </p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Tutup pemberitahuan"
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-amber-700/70 transition hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300/70 dark:hover:bg-amber-950/60 dark:hover:text-amber-100"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800/90 dark:text-amber-200/80">
              Hubungkan internet untuk validasi ulang.
            </p>
            {err ? (
              <p className="mt-1 text-[11.5px] font-medium text-red-600 dark:text-red-400">{err}</p>
            ) : null}
            <button
              type="button"
              onClick={doRenew}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-500"
            >
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
              {busy ? "Memvalidasi…" : "Validasi ulang"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!BLOCKING.has(st.state)) return null;

  const judul: Record<string, string> = {
    unactivated: "Aktivasi ICD-10 Codex 2010",
    invalid: "Perlu validasi ulang",
    expired: "Masa tenggang habis",
    revoked: "Lisensi dicabut",
    license_expired: "Masa berlaku lisensi habis",
    license_disabled: "Lisensi dinonaktifkan",
  };
  const teks: Record<string, string> = {
    unactivated:
      "Masukkan license key Anda untuk mengaktifkan aplikasi pada perangkat ini.",
    invalid:
      "Lease lokal tidak dapat diverifikasi. Aktifkan ulang dengan license key Anda — butuh koneksi internet.",
    expired:
      "Perlu koneksi internet untuk validasi ulang. Aktifkan kembali dengan license key Anda.",
    revoked:
      "Lisensi ini telah dicabut oleh penerbit. Hubungi dukungan RUANGPMIK dengan menyertakan ID instalasi di bawah.",
    license_expired:
      "Perpanjangan lisensi diperlukan. Hubungi penjual Anda.",
    license_disabled:
      "Lisensi dinonaktifkan sementara. Hubungi dukungan RUANGPMIK.",
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {judul[st.state] ?? "Aktivasi"}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {teks[st.state] ?? st.message}
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Data Anda (catatan, preferensi) aman dan tidak dihapus.
        </p>

        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && doActivate()}
            placeholder="ICD10-XXXXX-XXXXX-XXXXX-XXXXX"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-sky-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            disabled={busy || st.state === "revoked"}
          />
          <button
            type="button"
            onClick={doActivate}
            disabled={busy || !keyInput.trim() || st.state === "revoked"}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? "…" : "Aktivasi"}
          </button>
        </div>
        {err ? (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p>
        ) : null}
        {st.installationId ? (
          <p className="mt-4 break-all text-[11px] text-neutral-400 dark:text-neutral-500">
            ID instalasi (untuk dukungan): {st.installationId}
          </p>
        ) : null}
      </div>
    </div>
  );
}
