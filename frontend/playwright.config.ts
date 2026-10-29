import { defineConfig } from "@playwright/test";

// E2E contra la app real: Django (DJANGO_API_URL) y Next (E2E_BASE_URL) arrancados aparte.
// Cómo prepararlo: e2e/README.md. Usa el Chrome instalado (no descarga navegadores).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
});
