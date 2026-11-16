import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { runtimeNoticesPlugin } from "./scripts/runtime-notices";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const modified =
  execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "src",
      "scripts",
      "sim.html",
      "vite.config.ts",
      "package.json",
      "package-lock.json",
    ],
    { encoding: "utf8" },
  ).trim() !== "";

// Everything (JS, CSS, sql.js WASM) is inlined into one file that runs from file://.
export default defineConfig({
  define: {
    __SIM_BUILD__: JSON.stringify({ version: manifest.version, commit, builtAt: new Date().toISOString(), modified }),
  },
  plugins: [viteSingleFile(), runtimeNoticesPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: "sim.html" },
  },
});
