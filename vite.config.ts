import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { runtimeNoticesPlugin } from "./scripts/runtime-notices";

// Everything (JS, CSS, sql.js WASM) is inlined into one file that runs from file://.
export default defineConfig({
  plugins: [viteSingleFile(), runtimeNoticesPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: "sim.html" },
  },
});
