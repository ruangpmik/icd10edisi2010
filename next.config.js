/** @type {import('next').NextConfig} */
// Ekspor statis untuk GitHub Pages. Semua data dibaca relatif dari public/data,
// jadi tidak butuh server. basePath hanya dipakai saat build Pages.
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: base || undefined,
  assetPrefix: base || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;
