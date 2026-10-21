import { defineConfig } from "@playwright/test";

const PORT = 3100;
const isCI = !!process.env.CI;

// Un proyecto por ancho de móvil. El backend no hace falta: los specs mockean
// /api/proxy/* (ver e2e/fixtures.ts).
const widths = [320, 360, 390] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    hasTouch: true,
    isMobile: true,
  },
  projects: widths.map((width) => ({
    name: `mobile-${width}`,
    use: { viewport: { width, height: 740 } },
  })),
  webServer: {
    // En CI el build ya se hizo en el paso anterior; en local se usa el dev server.
    command: isCI ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
