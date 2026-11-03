import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // Static export: `npm run build` writes a plain site to `out/` that any
  // static host (GitHub Pages, Netlify, nginx, ...) can serve.
  output: "export",
  // Static hosts have no image optimisation server; serve images as-is.
  images: { unoptimized: true },
};

export default nextConfig;
