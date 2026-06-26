import { defineConfig, devices } from "@playwright/test";

/** Webview (diagram) end-to-end tests: drive the built React bundle in a real
 *  browser with adversarial mouse interactions. */
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./dist/e2e-output",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 1100, height: 800 },
  },
});
