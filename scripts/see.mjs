// Ekstrak rujukan "see" / "see also" yang tercetak menyatu dengan istilah.
// Di PDF ada empat bentuk:
//   "animal-rider NEC (see also Accident, transport)"   -> kurung di ujung
//   "column, spinal - see Neoplasm, spine"              -> strip hubung
//   "Undernutrition see also Malnutrition"              -> tanpa tanda
//   "— see Tetrachloroethylene"                         -> hanya rujukan
// Bentuk "— see X" yang berdiri sendiri dikembalikan dengan t = "" supaya
// pemanggil menempelkannya ke entri sebelumnya.

const clean = (s) => s.replace(/\s+/g, " ").trim();

export function extractSee(text) {
  const raw = text.trim();
  const ref = (s) => clean(s.replace(/[\s()]+$/, ""));

  // 1. "(see also X)" / "(see X)" di ujung — kurung penutup wajib ada supaya
  //    baris yang terpotong antar kolom tidak salah pecah. Rujukan boleh
  //    memuat kurung sendiri ("… virus (HIV) disease").
  let m = raw.match(/^(.*?)\s*\(\s*see(?:\s+also)?\s+(.+)\)\s*$/i);
  if (m) return { t: clean(m[1]).replace(/[\s(]+$/, ""), see: ref(m[2]) };

  // 2. "… - see X" / "… – see also X"
  m = raw.match(/^(.*?)\s*[-–—]{1,2}\s*see(?:\s+also)?\s+(.+)$/i);
  if (m) return { t: clean(m[1]).replace(/[\s(]+$/, ""), see: ref(m[2]) };

  // 3. "… see also X" tanpa tanda hubung.
  m = raw.match(/^(.*?)\s+see(?:\s+also)?\s+(.+)$/i);
  if (m) return { t: clean(m[1]).replace(/[\s(]+$/, ""), see: ref(m[2]) };

  // 4. Baris yang isinya hanya rujukan.
  m = raw.match(/^[-–—\s]*see(?:\s+also)?\s+(.+)$/i);
  if (m) return { t: "", see: ref(m[1]) };

  // 5. Rujukan yang kurung penutupnya terpotong antar kolom
  //    ("… (see also Endocarditis, aortic").
  m = raw.match(/^(.*?)\s*\(\s*see(?:\s+also)?\s+(.+)$/i);
  if (m && clean(m[1])) return { t: clean(m[1]).replace(/[\s(]+$/, ""), see: ref(m[2]) };

  return { t: raw, see: null };
}

// Nilai rujukan hasil penggabungan antar kolom masih bisa menyisakan "also "
// atau kurung penutup yang terpotong ("Accident, transport)").
export function cleanSee(s) {
  if (!s) return s;
  let v = s.replace(/\s+/g, " ").trim();
  // "alsoMelioidosis" — kata "also" menempel tanpa spasi.
  v = v.replace(/^also(?=[A-Z])/, "");
  for (;;) {
    const m = v.match(/^(?:also|see)\s+/i);
    if (!m) break;
    v = v.slice(m[0].length);
  }
  const open = (v.match(/\(/g) || []).length;
  const close = (v.match(/\)/g) || []).length;
  if (close > open) v = v.replace(/\)+\s*$/, "").trim();
  // Rujukan tanpa tujuan sama sekali: "also", "note at", potongan kurung "Leuk(o".
  if (/^(?:also|note at)$/i.test(v) || /[a-z]\([a-z]$/i.test(v)) return null;
  return v;
}

// Istilah yang terpotong tepat setelah kurung buka ("fascia (").
export function cleanTerm(t) {
  const open = (t.match(/\(/g) || []).length;
  const close = (t.match(/\)/g) || []).length;
  return open > close ? t.replace(/[\s(]+$/, "") : t;
}
