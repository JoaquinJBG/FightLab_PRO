import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Mismo alias "@/*" que tsconfig.json, para poder importar las rutas del
  // BFF (app/api/**/route.ts) tal cual, sin reescribir sus imports.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    // jsdom da window/localStorage a las funciones del motor que persisten en el
    // dispositivo (load.ts, gym.ts, nutrition.ts) y el DOM a las pruebas de pantallas.
    environment: "jsdom",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
