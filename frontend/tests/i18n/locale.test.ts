import { describe, expect, it } from "vitest";
import { resolveLocale } from "@/lib/locale";

describe("resolveLocale", () => {
  it("la cookie manda sobre Accept-Language", () => {
    expect(resolveLocale("en", "es-ES,es;q=0.9")).toBe("en");
  });
  it("sin cookie usa el idioma del navegador", () => {
    expect(resolveLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, "fr-FR,es;q=0.8")).toBe("es");
  });
  it("sin nada, o con un idioma no soportado, es español", () => {
    expect(resolveLocale(undefined, null)).toBe("es");
    expect(resolveLocale("fr", "de")).toBe("es");
  });
});
