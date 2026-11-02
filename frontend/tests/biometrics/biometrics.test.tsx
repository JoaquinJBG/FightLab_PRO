import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

const state = vi.hoisted(() => ({
  logs: [] as unknown[],
  photos: [] as unknown[],
  loading: false,
  createError: null as Error | null,
  uploadError: null as Error | null,
  weighIn: undefined as unknown,
  trend: undefined as unknown,
  created: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/hooks", () => {
  const mut = (error: Error | null = null) => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockImplementation(async (payload: unknown) => {
      state.created.push(payload);
      return {};
    }),
    isPending: false,
    isError: !!error,
    error,
  });
  return {
    useBiometrics: () => ({ data: state.logs, isLoading: state.loading }),
    useProfile: () => ({ data: { height_cm: 180 } }),
    useWeighIn: () => ({ data: state.weighIn }),
    useTrend: () => ({ data: state.trend }),
    usePhotos: () => ({ data: state.photos }),
    useDeleteBiometrics: () => mut(),
    useUploadPhoto: () => mut(state.uploadError),
    useDeletePhoto: () => mut(),
    useCreateBiometrics: () => mut(state.createError),
  };
});

import BiometricsPage from "@/app/(shell)/biometrics/page";
import NewBiometricsPage from "@/app/(shell)/biometrics/new/page";

const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: null, goal_date: null, weigh_in_at: null,
  weight_class: null, days_left: null, current_kg: 80, to_go_kg: null,
};
const TREND_OK = {
  status: "ok", blocked: false, rate_kg_week: -0.35, rate_pct_week: -0.44, weight_kg: 79.6, points: 9, days: 20,
  start: "2026-10-12", end: "2026-10-31", can_recalibrate: false, min_points: 7, min_days: 14,
  rule_key: "nutrition/read-the-scale-with-weekly-averages", grade: "moderate", reasons: [],
};
const TREND_FEW = { ...TREND_OK, status: "insufficient_data", rate_kg_week: null, rate_pct_week: null, weight_kg: null, points: 4, days: 6 };

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const row = (id: number, daysAgo: number, extra: Record<string, unknown> = {}) => ({
  id,
  weight_kg: "80.0",
  body_fat_pct: null,
  resting_heart_rate: null,
  sleep_quality_score: null,
  hrv_ms: null,
  waist_cm: null,
  hip_cm: null,
  chest_cm: null,
  arm_cm: null,
  thigh_cm: null,
  neck_cm: null,
  timestamp: iso(daysAgo),
  source: "MANUAL",
  ...extra,
});

const SPANISH = /[áéíóúñ¿¡]|\b(Inicio|Peso|Borrar|Guardar|Historial|Medición|Cintura|Foto|Tendencia|Registra|objetivo|semana)\b/;

function renderIn(locale: string, messages: Record<string, unknown>, ui: React.ReactElement) {
  const errors: string[] = [];
  const utils = render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={(e) => errors.push(e.message)}
      getMessageFallback={({ namespace, key }) => `MISSING:${namespace}.${key}`}
    >
      {ui}
    </NextIntlClientProvider>,
  );
  return { ...utils, errors };
}

function expectClean(container: HTMLElement, errors: string[], locale: string) {
  expect(errors).toEqual([]);
  const text = container.textContent ?? "";
  expect(text).not.toContain("MISSING:");
  const attrs = [...container.querySelectorAll("[aria-label],[alt],[placeholder]")].map(
    (e) => e.getAttribute("aria-label") ?? e.getAttribute("alt") ?? e.getAttribute("placeholder") ?? "",
  );
  for (const s of [...text.split(/\s{2,}/), ...attrs]) {
    expect(s.trim()).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
    if (locale === "en") expect(s).not.toMatch(SPANISH);
  }
}

beforeEach(() => {
  state.logs = [];
  state.photos = [];
  state.loading = false;
  state.createError = null;
  state.uploadError = null;
  state.weighIn = WEIGH_IN;
  state.trend = TREND_OK;
  state.created = [];
  localStorage.clear();
});

describe.each([
  ["en", en],
  ["es", es],
])("Biometría (%s)", (locale, messages) => {
  it("lista con datos, objetivo, IMC, historial y fotos", () => {
    state.weighIn = { ...WEIGH_IN, goal_weight_kg: 75 };
    state.logs = [
      row(1, 1, { resting_heart_rate: 52, hrv_ms: 60, body_fat_pct: "15.0", waist_cm: "80" }),
      row(2, 5),
      row(3, 9, { weight_kg: "81.0" }),
      row(4, 12, { weight_kg: null, hrv_ms: 55 }),
    ];
    state.photos = [{ id: 1, image: "/media/a.jpg", taken_at: "2026-10-01" }];
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /.+/ })[0]);
    expectClean(container, errors, locale);
    expect(container.textContent).toContain("80.0");
    expect(container.textContent).toContain("bpm");
    if (locale === "en") {
      expect(container.textContent).toContain("Weight trend");
      expect(container.textContent).toContain("per week");
      expect(container.textContent).toContain("79.6");
      expect(container.textContent).toContain("BMI");
      expect(container.textContent).toContain("fat");
    }
  });

  it("textos de información, confirmación de borrado y fotos", () => {
    state.logs = [row(1, 1), row(2, 4), row(3, 8)];
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    for (const b of screen.getAllByRole("button")) {
      if (b.getAttribute("aria-label")) fireEvent.click(b);
    }
    expectClean(container, errors, locale);
  });

  it("estado vacío, carga y error de subida", () => {
    state.uploadError = new Error("boom");
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    expectClean(container, errors, locale);
    if (locale === "en") expect(container.textContent).toContain("No weight data");
  });

  it("rango sin datos pero con historial", () => {
    state.logs = [row(1, 400)];
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    expectClean(container, errors, locale);
  });

  it("el ritmo y el peso de tendencia salen del servidor, no de la EWMA de la gráfica", () => {
    state.logs = [row(1, 1, { weight_kg: "90.0" }), row(2, 5, { weight_kg: "70.0" }), row(3, 9, { weight_kg: "90.0" })];
    const { container } = renderIn(locale, messages, <BiometricsPage />);
    expect(container.querySelector("[data-testid=trend-ok]")).toBeTruthy();
    expect(container.textContent).toContain("79.6");
    expect(container.textContent).toMatch(/0[.,]35/);
  });

  it("con menos de 7 pesajes en 14 días dice que no hay tendencia y cuántos faltan", () => {
    state.trend = TREND_FEW;
    state.logs = [row(1, 1), row(2, 3), row(3, 5), row(4, 6)];
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    expectClean(container, errors, locale);
    const box = container.querySelector("[data-testid=trend-insufficient]")!;
    expect(box.textContent).toMatch(/\b7\b/);
    expect(box.textContent).toMatch(/\b3\b/); // faltan 3
    expect(container.querySelector("[data-testid=trend-ok]")).toBeNull();
  });

  it("con no_weight_targets no hay peso, tendencia, gráfica ni IMC, pero sí el historial de FC", () => {
    state.weighIn = { ...WEIGH_IN, blocked: true };
    state.trend = undefined;
    state.logs = [row(1, 1, { weight_kg: null, resting_heart_rate: 52 })];
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    expectClean(container, errors, locale);
    expect(container.querySelector("[data-testid=weight-blocked]")).toBeTruthy();
    expect(container.querySelector("svg[role=img]")).toBeNull();
    expect(container.textContent).not.toMatch(/BMI|IMC/);
    expect(container.textContent).toContain("bpm");
  });

  it("cargando", () => {
    state.loading = true;
    const { container, errors } = renderIn(locale, messages, <BiometricsPage />);
    expectClean(container, errors, locale);
  });
});

describe.each([
  ["en", en],
  ["es", es],
])("Nueva medición (%s)", (locale, messages) => {
  it("formulario desplegado, información y error de validación", () => {
    const { container, errors } = renderIn(locale, messages, <NewBiometricsPage />);
    fireEvent.click(container.querySelectorAll("button[type=button]")[0]);
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.getAttribute("type") === "button")[1]);
    for (const b of container.querySelectorAll("button[aria-label]")) fireEvent.click(b);
    const toggles = [...container.querySelectorAll("button[type=button]")].filter((b) => !b.getAttribute("aria-label"));
    for (const b of toggles) if (!container.textContent?.includes("cm")) fireEvent.click(b);
    fireEvent.submit(container.querySelector("form")!);
    expectClean(container, errors, locale);
    if (locale === "en") {
      expect(container.textContent).toContain("Enter at least one measurement.");
      expect(container.textContent).toContain("Waist");
    }
  });

  it("pide cómo se midió la grasa corporal y lo manda con el valor (U04)", async () => {
    const { container, errors } = renderIn(locale, messages, <NewBiometricsPage />);
    fireEvent.click(container.querySelectorAll("button[type=button]")[0]); // medidas avanzadas
    expect(container.querySelector("[data-testid=body-fat-method]")).toBeNull();
    const fat = container.querySelectorAll("input[type=number]")[1] as HTMLInputElement; // peso, % grasa, ...
    fireEvent.change(fat, { target: { value: "15" } });
    const select = container.querySelector("[data-testid=body-fat-method-select]") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect([...select.options].map((o) => o.value)).toEqual(["", "dxa", "bodpod", "bia_lab", "skinfolds", "smart_scale", "other"]);
    fireEvent.change(select, { target: { value: "dxa" } });
    expectClean(container, errors, locale);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.created[0]).toMatchObject({ body_fat_pct: "15", body_fat_method: "dxa" });
  });

  it("con no_weight_targets no pide peso, grasa ni perímetros", () => {
    state.weighIn = { ...WEIGH_IN, blocked: true };
    const { container, errors } = renderIn(locale, messages, <NewBiometricsPage />);
    expectClean(container, errors, locale);
    expect(container.querySelector("[data-testid=body-blocked]")).toBeTruthy();
    fireEvent.click(container.querySelectorAll("button[type=button]")[0]);
    const inputs = [...container.querySelectorAll("input[type=number]")];
    expect(inputs.length).toBe(2); // solo FC en reposo y HRV
  });

  it("error del servidor", () => {
    state.createError = new Error("server says no");
    const { container, errors } = renderIn(locale, messages, <NewBiometricsPage />);
    expectClean(container, errors, locale);
    expect(container.textContent).toContain("server says no");
  });
});
