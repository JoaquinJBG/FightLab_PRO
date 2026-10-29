import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { pickRuleText, splitCitations } from "@/lib/evidence";
import type { RuleDetail } from "@/lib/schemas";

const KEY = "nutrition/default-rmr-equation-mifflin-st-jeor";

const RULE: RuleDetail = {
  key: KEY,
  heading: "Default RMR equation: Mifflin-St Jeor",
  section: "Estimating energy needs",
  grade: "moderate",
  rule_text: "Use Mifflin-St Jeor as the default starting RMR.",
  applies_to: "Healthy ambulatory adults.",
  conflicts: "Individual error is large.",
  translation: null,
  sources: [
    {
      sid: "S819",
      citation: "Mifflin MD et al. 1990. A new predictive equation.",
      type: "Other",
      doi: "10.1093/ajcn/51.2.241",
      url: "https://pubmed.ncbi.nlm.nih.gov/2305711/",
    },
    { sid: "S161", citation: "Frankenfield 2005.", type: "RCT", doi: "", url: "https://example.org/s161" },
  ],
};

const TRANSLATION = {
  lang: "es",
  status: "machine" as const,
  heading: "Ecuación de RMR por defecto: Mifflin-St Jeor",
  rule_text: "Usa Mifflin-St Jeor como RMR inicial.",
  evidence: "",
  applies_to: "Adultos sanos y ambulatorios.",
  conflicts: "",
};

function renderChip(locale: "es" | "en", props: { ruleKey?: string | null; grade?: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en}>
        <EvidenceChip {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function mockRule(rule: RuleDetail) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rule });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("EvidenceChip: los tres grados", () => {
  it.each([
    ["strong", "Evidencia fuerte", "var(--color-good)"],
    ["moderate", "Evidencia moderada", "var(--color-warn)"],
    ["emerging", "Evidencia emergente", "var(--color-neon)"],
  ])("grado %s: texto y color fijo", (grade, label, color) => {
    renderChip("es", { ruleKey: KEY, grade });
    const chip = screen.getByTestId("evidence-chip");
    expect(chip.textContent).toBe(label);
    expect(chip.getAttribute("data-grade")).toBe(grade);
    expect(chip.getAttribute("data-variant")).toBe("evidence");
    expect(chip.style.color).toBe(color);
  });

  it("en inglés usa las etiquetas del catálogo en", () => {
    renderChip("en", { ruleKey: KEY, grade: "strong" });
    expect(screen.getByTestId("evidence-chip").textContent).toBe("Strong evidence");
  });
});

describe("EvidenceChip: variante de convención", () => {
  it.each([
    ["es", "Convención de FightLab, sin revisar"],
    ["en", "FightLab convention, not reviewed"],
  ] as const)("sin regla se etiqueta como convención (%s)", (locale, label) => {
    renderChip(locale, { ruleKey: null });
    const chip = screen.getByTestId("evidence-chip");
    expect(chip.textContent).toBe(label);
    expect(chip.getAttribute("data-variant")).toBe("convention");
    expect(chip.tagName).toBe("SPAN"); // no se puede pulsar: no abre ninguna regla
    expect(chip.getAttribute("data-grade")).toBeNull();
  });
});

describe("EvidenceSheet", () => {
  it("el chip abre la regla con sus fuentes y enlaces al DOI", async () => {
    const fetchMock = mockRule(RULE);
    renderChip("en", { ruleKey: KEY, grade: "moderate" });
    expect(screen.queryByTestId("evidence-sheet")).toBeNull();
    fireEvent.click(screen.getByTestId("evidence-chip"));
    expect(await screen.findByText("Default RMR equation: Mifflin-St Jeor")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy/knowledge/rules/${KEY}`, expect.anything());
    const sheet = screen.getByTestId("evidence-sheet");
    expect(sheet.textContent).toContain("Use Mifflin-St Jeor as the default starting RMR.");
    expect(sheet.textContent).toContain("Who it applies to");
    expect(sheet.textContent).toContain("Where it is unclear");
    expect(sheet.textContent).toContain("S819");
    const hrefs = [...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://doi.org/10.1093/ajcn/51.2.241");
    expect(hrefs).toContain("https://example.org/s161"); // sin DOI: enlace a la URL
    expect(screen.queryByTestId("translation-label")).toBeNull(); // en: es el original
  });

  it("en español, sin traducción muestra el original con la etiqueta 'sin traducir'", async () => {
    mockRule(RULE);
    renderChip("es", { ruleKey: KEY, grade: "moderate" });
    fireEvent.click(screen.getByTestId("evidence-chip"));
    expect(await screen.findByText("Default RMR equation: Mifflin-St Jeor")).toBeTruthy();
    expect(screen.getByTestId("translation-label").textContent).toContain("Sin traducir");
    expect(screen.getByText("A quién se aplica")).toBeTruthy();
  });

  it("en español, la traducción automática lleva la etiqueta 'sin revisar'", async () => {
    mockRule({ ...RULE, translation: TRANSLATION });
    renderChip("es", { ruleKey: KEY, grade: "moderate" });
    fireEvent.click(screen.getByTestId("evidence-chip"));
    expect(await screen.findByText("Usa Mifflin-St Jeor como RMR inicial.")).toBeTruthy();
    expect(screen.getByTestId("translation-label").textContent).toContain("Traducción automática");
  });

  it("una traducción revisada se muestra sin etiqueta", async () => {
    mockRule({ ...RULE, translation: { ...TRANSLATION, status: "reviewed" } });
    renderChip("es", { ruleKey: KEY, grade: "moderate" });
    fireEvent.click(screen.getByTestId("evidence-chip"));
    expect(await screen.findByText("Usa Mifflin-St Jeor como RMR inicial.")).toBeTruthy();
    expect(screen.queryByTestId("translation-label")).toBeNull();
  });

  it("se cierra con el botón", async () => {
    mockRule(RULE);
    renderChip("en", { ruleKey: KEY, grade: "moderate" });
    fireEvent.click(screen.getByTestId("evidence-chip"));
    await screen.findByTestId("evidence-sheet");
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("evidence-sheet")).toBeNull();
  });

  it("si la regla no carga, lo dice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    renderChip("en", { ruleKey: KEY, grade: "moderate" });
    fireEvent.click(screen.getByTestId("evidence-chip"));
    expect(await screen.findByText("The rule could not be loaded.")).toBeTruthy();
  });
});

describe("pickRuleText", () => {
  it("en: siempre el original, aunque haya traducción", () => {
    const r = pickRuleText({ ...RULE, translation: TRANSLATION }, "en");
    expect(r.heading).toBe(RULE.heading);
    expect(r.label).toBeNull();
  });

  it("es con traducción obsoleta: original y 'sin traducir'", () => {
    const r = pickRuleText({ ...RULE, translation: { ...TRANSLATION, status: "stale" } }, "es");
    expect(r.rule_text).toBe(RULE.rule_text);
    expect(r.label).toBe("untranslated");
  });

  it("es: los campos traducidos vacíos caen al original", () => {
    const r = pickRuleText({ ...RULE, translation: TRANSLATION }, "es");
    expect(r.conflicts).toBe(RULE.conflicts);
    expect(r.label).toBe("machine");
  });
});

describe("splitCitations", () => {
  it("separa el texto y las citas [[regla:clave]]", () => {
    expect(splitCitations(`Usa 1,6 g/kg [[regla:${KEY}]] y listo.`)).toEqual([
      { text: "Usa 1,6 g/kg " },
      { key: KEY },
      { text: " y listo." },
    ]);
  });

  it("sin citas devuelve el texto tal cual", () => {
    expect(splitCitations("hola")).toEqual([{ text: "hola" }]);
  });
});
