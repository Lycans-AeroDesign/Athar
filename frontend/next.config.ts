import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  experimental: {
    // Turbopack (the default bundler since Next 16) saves/restores compiler
    // artifacts to .next/cache across builds - stable for `next dev`, but
    // opt-in for `next build` ("experimental" per Next's own docs). Without
    // this, .next/cache has nothing meaningful in it for a production build
    // to reuse, even if the directory itself is cached (see Dockerfile/CI).
    turbopackFileSystemCacheForBuild: true,
  },
};

export default withNextIntl(nextConfig);
