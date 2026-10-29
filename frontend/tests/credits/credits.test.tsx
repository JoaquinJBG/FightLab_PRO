import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import CreditsPage from "@/app/(shell)/profile/credits/page";
import { ENGINE_SHA, EVIDENCE_DATE } from "@/lib/credits";

function renderIn(locale: string, messages: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CreditsPage />
    </NextIntlClientProvider>,
  );
}

describe.each([
  ["es", es],
  ["en", en],
])("pantalla de Créditos (%s)", (locale, messages) => {
  it("muestra al autor del coach y las licencias del coach", () => {
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain("matgarfer499");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("MIT");
  });

  it("enlaza al repositorio del coach", () => {
    const { container } = renderIn(locale, messages);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/matgarfer499/ai-personal-coach");
  });

  it("muestra el SHA del motor y la fecha de la evidencia", () => {
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain(ENGINE_SHA);
    expect(text).toContain(EVIDENCE_DATE);
  });

  it("cita USDA, Open Food Facts y PAR-Q+", () => {
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain("USDA FoodData Central");
    expect(text).toContain("Open Food Facts");
    expect(text).toContain("PAR-Q+ Collaboration");
  });

  it("termina con la licencia de FightLab y enlaza a los dos archivos", () => {
    const { container } = renderIn(locale, messages);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.endsWith("/LICENSE"))).toBe(true);
    expect(hrefs.some((h) => h.endsWith("/LICENSE-CONTENT.md"))).toBe(true);
    expect(container.textContent).toContain("Joaquín J Beltrán García");
  });
});
