import { defineConfig } from "@playwright/test";

// Uses the installed Edge and Chrome (no browser download), matching what SIM's users run.
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  forbidOnly: true,
  // Cap local browser concurrency; CI uses two workers on its smaller Windows runner.
  workers: process.env["CI"] ? 2 : 4,
  projects: [
    { name: "msedge", use: { channel: "msedge" } },
    { name: "chrome", use: { channel: "chrome" } },
  ],
});
