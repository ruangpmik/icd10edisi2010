"use client";

// Splash selamat datang (desktop only). Tampil singkat setiap kali aplikasi
// desktop dibuka, lalu memudar ke UI utama. Di web publik window.icd10License
// tidak ada → komponen tidak merender apa pun (web tidak terganggu).
import { useEffect, useState } from "react";

type Phase = "boot" | "show" | "fade" | "done";

export function Welcome() {
  const [phase, setPhase] = useState<Phase>("boot");

  useEffect(() => {
    if (typeof window === "undefined" || !window.icd10License) {
      setPhase("done");
      return;
    }
    const t1 = setTimeout(() => setPhase("show"), 30);
    const t2 = setTimeout(() => setPhase("fade"), 1600);
    const t3 = setTimeout(() => setPhase("done"), 2250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  if (phase === "boot" || phase === "done") return null;

  return (
    <div
      aria-hidden="true"
      className={`splash no-print ${phase === "fade" ? "splash--fade" : ""}`}
    >
      <div className="splash-inner">
        <img src="logo.png" alt="" className="splash-logo" />
        <h1 className="splash-title">ICD-10 Codex 2010</h1>
        <p className="splash-by">oleh RUANGPMIK</p>
        <p className="splash-tag">EN + Indonesia · ICD-10 2010</p>
        <div className="splash-bar" aria-hidden="true">
          <span className="splash-bar-fill" />
        </div>
      </div>
    </div>
  );
}