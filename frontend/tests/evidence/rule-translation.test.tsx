import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { ruleDetail } from "@/lib/schemas";
// Respuesta real de `GET /knowledge/rules/<clave>` en español, con las traducciones de
// `backend/knowledge_translations/`. El backend comprueba que sigue siendo la que sirve
// (test_load_translations.py::test_api_serves_the_spanish_translation_the_frontend_test_uses).
import fixtures from "./fixtures/rules-es.json";

const RULES = Object.values(fixtures).map((r) => ruleDetail.parse(r));

function openSheet(locale: "es" | "en", rule: (typeof RULES)[number]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rule }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en}>
        <EvidenceChip ruleKey={rule.key} grade={rule.grade} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId("evidence-chip"));
}

afterEach(() => vi.unstubAllGlobals());

describe("Reglas traducidas desde los archivos del repo", () => {
  it.each(RULES.map((r) => [r.key, r] as const))(
    "%s: en español la hoja muestra la traducción con la etiqueta 'sin revisar'",
    async (_key, rule) => {
      const tr = rule.translation!;
      openSheet("es", rule);
      expect(await screen.findByText(tr.heading)).toBeTruthy();
      const sheet = screen.getByTestId("evidence-sheet");
      expect(sheet.textContent).toContain(tr.rule_text);
      expect(sheet.textContent).toContain(tr.applies_to);
      expect(sheet.textContent).toContain(tr.conflicts);
      expect(sheet.textContent).not.toContain(rule.rule_text); // nada del original en inglés
      expect(screen.getByTestId("translation-label").textContent).toBe("Traducción automática, sin revisar");
      // Las fuentes no se traducen: siguen sus identificadores.
      for (const s of rule.sources) expect(sheet.textContent).toContain(s.sid);
    },
  );

  it("el chip del coach abre la regla de Mifflin-St Jeor en español", async () => {
    const rule = RULES.find((r) => r.key === "nutrition/default-rmr-equation-mifflin-st-jeor")!;
    openSheet("es", rule);
    expect(screen.getByTestId("evidence-chip").textContent).toBe("Evidencia moderada");
    expect(await screen.findByText("Ecuación de RMR por defecto: Mifflin-St Jeor")).toBeTruthy();
    expect(screen.getByText("A quién se aplica")).toBeTruthy();
  });

  it("en inglés la misma respuesta muestra el original, sin etiqueta", async () => {
    const rule = RULES[0];
    openSheet("en", rule);
    expect(await screen.findByText(rule.heading)).toBeTruthy();
    expect(screen.getByTestId("evidence-sheet").textContent).toContain(rule.rule_text);
    expect(screen.queryByTestId("translation-label")).toBeNull();
  });
});
