import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Deliberately doesn't apply babel-plugin-react-compiler (see next.config.ts) -
// the Compiler is a build-time optimization, not something unit/component
// tests need to exercise to verify logic correctness.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      // Mirrors tsconfig.json's "@/*" -> "./*" path mapping.
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
