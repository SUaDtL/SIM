import { fileURLToPath, pathToFileURL } from "node:url";

// Browser navigation and every evidence digest must refer to the same offline file.
export const candidatePath =
  process.env["SIM_TEST_HTML"] ?? fileURLToPath(new URL("../../dist/sim.html", import.meta.url));
export const candidateUrl = pathToFileURL(candidatePath).href;
