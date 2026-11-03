import { describe, expect, it } from "vitest";
import { intlLocale, resolveLocale } from "@/lib/locale";
import { foodName } from "@/lib/nutrition";

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

describe("selector de idioma", () => {
  it("está encendido por defecto", async () => {
    const { LANGUAGE_SELECTOR_ENABLED } = await import("@/lib/locale");
    expect(LANGUAGE_SELECTOR_ENABLED).toBe(true);
  });
  it("apagado, la app va en español aunque el navegador o la cookie digan inglés", async () => {
    const { appLocale } = await import("@/lib/locale");
    expect(appLocale("en", "en-GB,en;q=0.9", false)).toBe("es");
    expect(appLocale(undefined, "en-GB,en;q=0.9", false)).toBe("es");
    expect(appLocale("en", "es-ES", true)).toBe("en");
  });
});

describe("formato y nombres en inglés", () => {
  it("las fechas y números en inglés son británicos", () => {
    expect(intlLocale("en")).toBe("en-GB");
    expect(intlLocale("es")).toBe("es");
    expect(new Date(2026, 10, 2).toLocaleDateString(intlLocale("en"), { day: "2-digit", month: "short" })).toBe("02 Nov");
  });
  it("los alimentos de ejemplo tienen nombre en inglés y en español se quedan igual", () => {
    expect(foodName("Pechuga de pollo", "en")).toBe("Chicken breast");
    expect(foodName("Pechuga de pollo", "es")).toBe("Pechuga de pollo");
    expect(foodName("Algo nuevo", "en")).toBe("Algo nuevo");
  });
});
