import { defineConfig } from "@playwright/test";

// `E2E_PORT` para correr dos copias a la vez (por ejemplo, dos worktrees) sin chocar.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const isCI = !!process.env.CI;

// Un proyecto por ancho de móvil. El backend no hace falta: los specs mockean
// /api/proxy/* (ver e2e/mock/fixtures.ts). Las pruebas contra Django de verdad
// van aparte: playwright.real.config.ts (`pnpm e2e`, ver e2e/README.md).
const widths = [320, 360, 390] as const;

export default defineConfig({
  testDir: "./e2e/mock",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    hasTouch: true,
    isMobile: true,
    // Los textos que buscan los specs están en español; con el selector de idioma
    // encendido, el idioma sale del navegador (Accept-Language).
    locale: "es-ES",
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
