// Terjemahan mesin EN->ID via endpoint publik Google Translate (tanpa kunci).
// Hasil di-cache di localStorage oleh pemanggil.

export async function translateEnId(texts: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of texts) {
    if (!t.trim()) {
      out.push("");
      continue;
    }
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=" +
      encodeURIComponent(t.slice(0, 1500));
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const s = Array.isArray(j?.[0]) ? j[0].map((x: unknown[]) => x?.[0] ?? "").join("") : "";
    out.push(s || t);
    await new Promise((res) => setTimeout(res, 150));
  }
  return out;
}
