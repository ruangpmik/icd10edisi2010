// Utilitas fetch JSON dengan progres byte.
//
// Dipakai untuk berkas data besar (icd10.json ± 4,4 MB, alpha-index.json ± 2,6 MB)
// supaya pengguna melihat progres nyata, bukan spinner tanpa akhir. Next.js
// menyajikan berkas publik sebagai gzip + chunked tanpa content-length, jadi
// pemanggil dapat memberi ukuran acuan (`expected`, dari data/sizes.json).
// Bila keduanya kosong, UI menampilkan bar indeterminate.

export type ProgressFn = (loaded: number, total: number) => void;

export async function fetchJson<T>(url: string, onProgress?: ProgressFn, expected = 0): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = Number(res.headers.get("content-length") ?? 0) || expected || 0;

  if (!res.body || !onProgress) return (await res.json()) as T;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  }

  const buf = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  // Muat dekompresi bisa melebihi content-length (gzip): persen dijepit di UI.
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}
