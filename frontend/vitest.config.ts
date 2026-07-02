import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom da window/localStorage a las funciones del motor que persisten en el
    // dispositivo (load.ts, gym.ts, nutrition.ts). La lógica pura no lo necesita.
    environment: "jsdom",
    include: ["lib/**/*.test.ts"],
  },
});
