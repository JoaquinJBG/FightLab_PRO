import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import CreditsPage from "@/app/(shell)/profile/credits/page";
import { ENGINE_SHA, EVIDENCE_DATE } from "@/lib/credits";

function renderIn(locale: string, messages: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <CreditsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["es", es],
  ["en", en],
])("pantalla de Créditos (%s)", (locale, messages) => {
  it("muestra al autor del coach y las licencias del coach", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain("matgarfer499");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("MIT");
  });

  it("enlaza al repositorio del coach", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderIn(locale, messages);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/matgarfer499/ai-personal-coach");
  });

  it("muestra el SHA y la fecha de la API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sha: "abc1234",
        sha_full: "abc1234" + "0".repeat(33),
        knowledge_checked_on: "2026-11-02",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderIn(locale, messages);
    expect(await screen.findByText(/abc1234/)).toBeTruthy();
    expect(screen.getByText(/2026-11-02/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/coach/engine", expect.anything());
  });

  it("mientras carga o si la API falla, muestra los valores por defecto", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain(ENGINE_SHA);
    expect(text).toContain(EVIDENCE_DATE);
  });

  it("cita USDA, Open Food Facts y PAR-Q+", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const text = renderIn(locale, messages).container.textContent ?? "";
    expect(text).toContain("USDA FoodData Central");
    expect(text).toContain("Open Food Facts");
    expect(text).toContain("PAR-Q+ Collaboration");
  });

  it("termina con la licencia de FightLab y enlaza a los dos archivos", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderIn(locale, messages);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.endsWith("/LICENSE"))).toBe(true);
    expect(hrefs.some((h) => h.endsWith("/LICENSE-CONTENT.md"))).toBe(true);
    expect(container.textContent).toContain("Joaquín J Beltrán García");
  });
});
