import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
]);
