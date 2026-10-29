import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import type { Profile, Safety, Screening } from "@/lib/schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { LanguageStep } from "@/components/onboarding/LanguageStep";
import { ScoffStep } from "@/components/onboarding/ScoffStep";
import { BasicsStep } from "@/components/onboarding/BasicsStep";
import { ParqStep } from "@/components/onboarding/ParqStep";
import { CardiacStep } from "@/components/onboarding/CardiacStep";
import { MedicalStep } from "@/components/onboarding/MedicalStep";
import { BpStep, CycleStep } from "@/components/onboarding/BpCycleSteps";
import { GoalsStep } from "@/components/onboarding/GoalsStep";
import { SafetyPanel } from "@/components/safety/SafetyBanner";

const ROOT = join(__dirname, "..", "..");
const SAFETY_DOC = join(ROOT, "..", "backend", "vendor", "ai-personal-coach", "docs", "safety.md");
const CATALOGS = { es, en } as const;

const PROFILE: Profile = {
  date_of_birth: "1990-05-01",
  gender: "FEMALE",
  height_cm: 170,
  dominant_stance: null,
  preferred_units: "METRIC",
  timezone: "UTC",
  equation_sex: null,
  goal: null,
  experience: null,
  activity_level: null,
  language: "es",
  region: "es",
  emergency_number: null,
  medications: [],
  medications_other: [],
  conditions: [],
  conditions_other: [],
  disciplines: [],
  training_frequency: null,
  goal_weight_kg: null,
  goal_date: null,
  weight_class: null,
  weigh_in_at: null,
};

const SCREENING: Screening = {
  values: {
    scoff_yes_count: null,
    scoff_positive: null,
    parq_any_yes: null,
    parq_followup_yes: null,
    vigorous_reviewed: null,
    cardiac_symptoms: null,
    menstrual: null,
    bp_systolic: null,
    bp_diastolic: null,
  },
  parq_url: "https://eparmedx.com/official.pdf",
  parq_native_form: false,
};

const SAFETY: Safety = {
  screened: true,
  flags: { no_deficit: true, no_weight_targets: true, refer_gp: true },
  reasons: [
    {
      code: "eating_disorder_screen",
      rule_key: "nutrition/eating-disorder-screening-brief-questions-as-a-prompt",
      grade: "moderate",
      params: {},
      text: "cribado positivo (2 o más respuestas afirmativas)…",
      professional: "médico de cabecera",
      severity: "refer",
    },
  ],
  paused_exercises: {},
  refer_gp: true,
  deferral_line: "LÍNEA DE DERIVACIÓN",
  disclaimer: "AVISO",
  emergency_number: "112",
  parq_pending: false,
  weight: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = url.includes("coach/safety") ? SAFETY : url.includes("coach/screening") ? SCREENING : url.includes("injuries") ? [] : {};
    void init;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const missing: string[] = [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]} onError={(e) => missing.push(e.message)}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, missing };
}

const noop = () => {};
const STEPS: [string, () => React.ReactNode][] = [
  ["language", () => <LanguageStep profile={PROFILE} onNext={noop} selectorEnabled />],
  ["region", () => <LanguageStep profile={PROFILE} onNext={noop} />],
  ["scoff", () => <ScoffStep onNext={noop} />],
  ["basics", () => <BasicsStep profile={{ ...PROFILE, gender: "OTHER" }} onNext={noop} />],
  ["parq", () => <ParqStep screening={SCREENING} age={50} onNext={noop} />],
  ["cardiac", () => <CardiacStep onNext={noop} onExit={noop} />],
  ["medical", () => <MedicalStep profile={PROFILE} female knowBp={false} onKnowBp={noop} onNext={noop} />],
  ["bp", () => <BpStep screening={SCREENING} onNext={noop} />],
  ["cycle", () => <CycleStep screening={SCREENING} onNext={noop} />],
  ["goals", () => <GoalsStep profile={PROFILE} onNext={noop} />],
];

describe("onboarding en los dos idiomas", () => {
  for (const locale of ["es", "en"] as const) {
    for (const [name, ui] of STEPS) {
      it(`${name} en ${locale} no tiene claves sin traducir`, () => {
        const { missing } = wrap(ui(), locale);
        expect(missing).toEqual([]);
      });
    }
  }

  it("sin el flag de la fase I no hay selector de idioma ni se envía language", async () => {
    wrap(<LanguageStep profile={PROFILE} onNext={noop} />);
    expect(screen.queryByTestId("language-selector")).toBeNull();
    expect(screen.getByText("Tu", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByTestId("region-es"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("me/profile"))!;
    expect(JSON.parse(init.body)).toEqual({ region: "es", emergency_number: null });
  });

  it("con el flag, el selector aparece", () => {
    wrap(<LanguageStep profile={PROFILE} onNext={noop} selectorEnabled />);
    expect(screen.getByTestId("language-selector")).toBeTruthy();
  });

  it("las preguntas del SCOFF cambian de idioma", () => {
    wrap(<ScoffStep onNext={noop} />, "en");
    expect(screen.getByText("Making yourself sick when uncomfortably full")).toBeTruthy();
  });
});

describe("textos de seguridad copiados de docs/safety.md", () => {
  const doc = readFileSync(SAFETY_DOC, "utf8");

  it("la línea de derivación es literal en es y en", () => {
    expect(doc).toContain(`- **es:** \`${es.safety.deferralLine}\``);
    expect(doc).toContain(`- **en:** \`${en.safety.deferralLine}\``);
  });

  it("el aviso es la primera frase de esa línea", () => {
    expect(es.safety.deferralLine.startsWith(es.safety.disclaimer)).toBe(true);
    expect(en.safety.deferralLine.startsWith(en.safety.disclaimer)).toBe(true);
  });

  it("los pasos de cribado llevan el aviso", () => {
    for (const ui of [<ScoffStep key="s" onNext={noop} />, <ParqStep key="p" screening={SCREENING} age={30} onNext={noop} />, <CardiacStep key="c" onNext={noop} onExit={noop} />]) {
      const { unmount } = wrap(ui);
      expect(screen.getByTestId("safety-disclaimer").textContent).toBe(es.safety.disclaimer);
      unmount();
    }
  });
});

describe("PAR-Q+ (spec §8.1): nunca copiado ni incrustado", () => {
  it("abre el formulario oficial en una pestaña nueva", () => {
    wrap(<ParqStep screening={SCREENING} age={30} onNext={noop} />);
    const link = screen.getByTestId("parq-official-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(SCREENING.parq_url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(document.querySelector("iframe, embed, object")).toBeNull();
  });

  it("solo hace las preguntas del coach: 7 generales, seguimiento y revisión", () => {
    wrap(<ParqStep screening={SCREENING} age={30} onNext={noop} />);
    expect(screen.getByText(es.onboarding.parq.anyYes)).toBeTruthy();
    expect(screen.queryByText(es.onboarding.parq.followupYes)).toBeNull();
    fireEvent.click(screen.getByTestId("parq-any-yes").querySelector('[data-testid="yes"]')!);
    expect(screen.getByText(es.onboarding.parq.followupYes)).toBeTruthy();
  });

  it("'no lo sé' guarda el campo nulo", async () => {
    wrap(<ParqStep screening={SCREENING} age={30} onNext={noop} />);
    fireEvent.click(screen.getByTestId("parq-any-yes").querySelector('[data-testid="unsure"]')!);
    fireEvent.click(screen.getByTestId("onboarding-next"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("coach/screening"))!;
    expect(JSON.parse(init.body).values).toEqual({ parq_any_yes: null, parq_followup_yes: null, vigorous_reviewed: null });
  });

  it("con 45 años o más pregunta por la revisión del trabajo vigoroso", () => {
    wrap(<ParqStep screening={SCREENING} age={45} onNext={noop} />);
    fireEvent.click(screen.getByTestId("parq-any-yes").querySelector('[data-testid="no"]')!);
    expect(screen.getByTestId("parq-vigorous")).toBeTruthy();
  });

  it("ningún archivo de la app incrusta eparmedx ni tiene un formulario nativo", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|json)$/.test(f)) files.push(p);
      }
    };
    for (const d of ["app", "components", "lib", "messages"]) walk(join(ROOT, d));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/<iframe|<embed|<object/i);
      expect(text, f).not.toMatch(/eparmedx\.com\/wp-content/); // la URL vive en la configuración del backend
    }
  });
});

describe("panel de seguridad", () => {
  it("con refer_gp termina con la línea de derivación; sin él, con el aviso", () => {
    const { unmount } = wrap(<SafetyPanel data={SAFETY} />);
    expect(screen.getByTestId("safety-footer").textContent).toBe("LÍNEA DE DERIVACIÓN");
    expect(screen.getAllByTestId("safety-reason")).toHaveLength(1);
    expect(screen.getByTestId("evidence-chip").getAttribute("data-grade")).toBe("moderate");
    unmount();
    wrap(<SafetyPanel data={{ ...SAFETY, refer_gp: false }} />);
    expect(screen.getByTestId("safety-footer").textContent).toBe("AVISO");
  });

  it("recuerda el PAR-Q+ pendiente", () => {
    wrap(<SafetyPanel data={{ ...SAFETY, reasons: [], parq_pending: true }} />);
    expect(screen.getByText(es.safety.parqPending, { exact: false })).toBeTruthy();
  });
});
