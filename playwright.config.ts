import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "https://molkky-web.pages.dev",
    headless: true
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
