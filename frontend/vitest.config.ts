import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom da window/localStorage a las funciones del motor que persisten en el
    // dispositivo (load.ts, gym.ts, nutrition.ts). La lógica pura no lo necesita.
    environment: "jsdom",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    // Mismo alias "@/*" que tsconfig.json, para poder importar las rutas del
    // BFF (app/api/**/route.ts) tal cual, sin reescribir sus imports.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
