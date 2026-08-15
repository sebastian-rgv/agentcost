import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/sdk.ts"],
  outDir: "dist",
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  banner: {
    js: "#!/usr/bin/env node",
  },
});