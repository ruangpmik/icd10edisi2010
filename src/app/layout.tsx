import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { LicenseGate } from "./LicenseGate";
import { Welcome } from "./Welcome";

export const metadata: Metadata = {
  title: "ICD-10 Codex 2010",
  description: "ICD-10 Codex 2010 — penampil rujukan ICD-10 2010 WHO (ClaML), English + padanan Indonesia.",
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.ico`,
    apple: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/apple-touch-icon.png`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        {/* Gerbang lisensi — aktif hanya di desktop (window.icd10License). */}
        <LicenseGate />
        {/* Splash selamat datang — desktop only, memudar singkat. */}
        <Welcome />
        {/* Watermark atribusi; tidak menangkap klik (pointer-events: none). */}
        <div className="wm" aria-hidden="true" />
      </body>
    </html>
  );
}
