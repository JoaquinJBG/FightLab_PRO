import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import NutritionPage from "@/app/(shell)/nutrition/page";
import { PROFILE, SAFETY, TARGETS, WEIGH_IN, CATALOGS, mockApi, renderApp, type Routes } from "../support/app";

const base = (extra: Routes = {}): Routes => ({
  "/api/proxy/me/profile": { body: PROFILE },
  "/api/proxy/coach/safety": { body: SAFETY },
  "/api/proxy/coach/targets": { body: TARGETS },
  "/api/proxy/coach/weigh-in": { body: WEIGH_IN },
  ...extra,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["es", CATALOGS.es.nutrition],
  ["en", CATALOGS.en.nutrition],
] as const)("Nutrición con los objetivos del servidor (%s)", (locale, cat) => {
  it("muestra las kcal y los macros que da la API, sin calcular nada en el cliente", async () => {
    mockApi(base());
    renderApp(<NutritionPage />, locale);
    expect(await screen.findByText(/\/ 2600 kcal/)).toBeTruthy();
    const macros = screen.getByTestId("macros");
    expect(macros.textContent).toContain("0/112 g"); // proteína, redondeada de 112
    expect(macros.textContent).toContain("0/373 g"); // carbos de 372,5
    expect(macros.textContent).toContain("0/72 g");
    expect(screen.getByText(cat.fibreLine.replace("{grams}", "25"))).toBeTruthy();
  });

  it("lleva un chip de evidencia junto a las kcal, la proteína, la grasa y la fibra", async () => {
    mockApi(base());
    renderApp(<NutritionPage />, locale);
    await screen.findByText(/\/ 2600 kcal/);
    expect(within(screen.getByTestId("kcal-rule")).getByTestId("evidence-chip").getAttribute("data-grade")).toBe("moderate");
    expect(within(screen.getByTestId("macros")).getAllByTestId("evidence-chip")).toHaveLength(2); // proteína y grasa
    expect(screen.getAllByTestId("evidence-chip").some((c) => c.getAttribute("data-grade") === "strong")).toBe(true); // fibra
  });

  it("dice qué ecuación se ha usado y por qué, con la regla", async () => {
    mockApi(base());
    renderApp(<NutritionPage />, locale);
    const details = await screen.findByTestId("targets-details");
    expect(within(details).getByTestId("targets-equation").getAttribute("data-equation")).toBe("ten_haaf");
    expect(details.textContent).toContain(cat.details.equations.ten_haaf);
    const reason = within(details).getByTestId("targets-reason");
    expect(reason.getAttribute("data-code")).toBe("rmr_ten_haaf");
    expect(within(reason).getByTestId("evidence-chip").getAttribute("data-variant")).toBe("evidence");
  });
});

describe("bloqueos del servidor en Nutrición (spec §8.3)", () => {
  it("con no_deficit, Perder queda bloqueado y se explica el motivo con la línea de derivación", async () => {
    const reasons = [
      {
        code: "eating_disorder_screen", rule_key: "recovery-habits/x", grade: "moderate", params: {},
        text: "cribado positivo", professional: "médico de cabecera", severity: "refer" as const,
      },
    ];
    mockApi(
      base({
        "/api/proxy/coach/safety": {
          body: { ...SAFETY, refer_gp: true, deferral_line: "LÍNEA DE DERIVACIÓN", flags: { no_deficit: true, no_weight_targets: true } },
        },
        "/api/proxy/coach/targets": { body: { ...TARGETS, goal: "fat_loss", deficit_blocked: true, reasons } },
        "/api/proxy/coach/weigh-in": { body: { ...WEIGH_IN, blocked: true, deficit_blocked: true } },
        "/api/proxy/me/profile": { body: { ...PROFILE, goal: "fat_loss" } },
      }),
    );
    renderApp(<NutritionPage />);
    const blocked = await screen.findByTestId("deficit-blocked");
    expect(within(blocked).getByTestId("safety-reason").getAttribute("data-code")).toBe("eating_disorder_screen");
    expect(within(blocked).getByTestId("safety-footer").textContent).toBe("LÍNEA DE DERIVACIÓN");
    expect((screen.getByTestId("goal-perder") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("goal-ganar") as HTMLButtonElement).disabled).toBe(true); // no_weight_targets
    expect((screen.getByTestId("goal-mantener") as HTMLButtonElement).disabled).toBe(false);
  });

  it("con no_weight_targets no se ve nada de pesaje (ni la tarjeta ni el aviso de peso antiguo)", async () => {
    mockApi(
      base({
        "/api/proxy/coach/targets": { body: { ...TARGETS, weight: { kg: 70, date: "2026-08-01", stale_days: 90 } } },
        "/api/proxy/coach/weigh-in": { body: { ...WEIGH_IN, blocked: true } },
      }),
    );
    renderApp(<NutritionPage />);
    await screen.findByText(/\/ 2600 kcal/);
    expect(screen.queryByTestId("weigh-card")).toBeNull();
    expect(screen.queryByTestId("stale-weight")).toBeNull();
  });

  it("con el pesaje disponible muestra la tarjeta con el objetivo y los kg actuales", async () => {
    mockApi(
      base({
        "/api/proxy/coach/weigh-in": { body: { ...WEIGH_IN, goal_weight_kg: 68.5, days_left: 14, current_kg: 70 } },
      }),
    );
    renderApp(<NutritionPage />);
    const card = await screen.findByTestId("weigh-card");
    await waitFor(() => expect(card.textContent).toContain("Objetivo 68,5 kg · 70 kg ahora"));
  });

  it("con el déficit bloqueado la tarjeta de pesaje no da la distancia: solo la cuenta atrás", async () => {
    mockApi(
      base({
        "/api/proxy/coach/weigh-in": { body: { ...WEIGH_IN, deficit_blocked: true, goal_weight_kg: 72, days_left: 3 } },
      }),
    );
    renderApp(<NutritionPage />);
    const card = await screen.findByTestId("weigh-card");
    await waitFor(() => expect(card.textContent).toContain("Pesaje en 3 días"));
    expect(card.textContent).not.toContain("ahora");
  });

  it("un peso de hace 14 días o más avisa de que se actualice", async () => {
    mockApi(base({ "/api/proxy/coach/targets": { body: { ...TARGETS, weight: { kg: 70, date: "2026-10-01", stale_days: 20 } } } }));
    renderApp(<NutritionPage />);
    expect((await screen.findByTestId("stale-weight")).textContent).toContain("20 días");
  });
});

describe("datos que faltan (409 del motor)", () => {
  it("sin equation_sex no hay objetivos de calorías: se explica y se puede elegir", async () => {
    const calls = mockApi(
      base({
        "/api/proxy/coach/targets": { status: 409, body: { code: "profile_incomplete", field: "equation_sex" } },
        "/api/proxy/me/profile": (init) => ({ body: init?.method === "PATCH" ? { ...PROFILE, equation_sex: "female" } : PROFILE }),
      }),
    );
    renderApp(<NutritionPage />);
    const prompt = await screen.findByTestId("equation-sex-prompt");
    expect(prompt.textContent).toContain(CATALOGS.es.nutrition.noSex.title);
    // la pantalla sigue siendo usable: el diario no tiene objetivo, solo kcal
    expect(screen.getByTestId("kcal-today").textContent).toContain("kcal");
    expect(screen.getByTestId("kcal-today").textContent).not.toContain("/");
    fireEvent.click(screen.getByTestId("equation-sex-female"));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("/api/proxy/me/profile", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ equation_sex: "female" }) })),
    );
  });

  it("sin peso lleva a registrarlo", async () => {
    mockApi(base({ "/api/proxy/coach/targets": { status: 409, body: { code: "profile_incomplete", field: "weight_kg" } } }));
    renderApp(<NutritionPage />);
    const missing = await screen.findByTestId("targets-missing");
    expect(missing.getAttribute("data-field")).toBe("weight_kg");
    expect(missing.querySelector("a")?.getAttribute("href")).toBe("/biometrics/new");
  });

  it("sin otro dato del perfil lleva al onboarding", async () => {
    mockApi(base({ "/api/proxy/coach/targets": { status: 409, body: { code: "profile_incomplete", field: "screening.scoff_yes_count" } } }));
    renderApp(<NutritionPage />);
    expect((await screen.findByTestId("targets-missing")).querySelector("a")?.getAttribute("href")).toBe("/onboarding");
  });

  it("un menor de 18 ve el motivo y ningún objetivo ni selector de objetivo", async () => {
    const under18 = {
      code: "under_18", rule_key: "recovery-habits/x", grade: null, params: {},
      text: "menor de 18 años, fuera del alcance del coach", professional: "pediatra", severity: "refer" as const,
    };
    mockApi(
      base({
        "/api/proxy/coach/targets": {
          body: {
            ...TARGETS, blocked: { code: "no_calorie_targets", reason_code: "under_18" }, kcal: null, macros: null,
            equation: null, rules: {}, reasons: [under18], deficit_blocked: true,
          },
        },
        "/api/proxy/coach/safety": { body: { ...SAFETY, refer_gp: true, deferral_line: "DERIVACIÓN" } },
        "/api/proxy/coach/weigh-in": { body: { ...WEIGH_IN, blocked: true } },
      }),
    );
    renderApp(<NutritionPage />);
    expect((await screen.findByTestId("deficit-blocked")).textContent).toContain("menor de 18");
    expect(screen.queryByTestId("goal-perder")).toBeNull();
    expect(screen.queryByTestId("targets-details")).toBeNull();
    expect(screen.queryByTestId("weigh-card")).toBeNull();
  });
});

describe("suelo calórico", () => {
  it("se explica con su regla y su chip", async () => {
    const floor = {
      code: "floor_raised", rule_key: "nutrition/low-and-very-low-calorie-diets-need-clinical-supervision", grade: "strong",
      params: { floor_kcal: 1200 }, text: "subido al suelo de 1200 kcal; bajar más exige supervisión clínica",
      professional: null, severity: "limit" as const,
    };
    mockApi(base({ "/api/proxy/coach/targets": { body: { ...TARGETS, kcal: 1200, clamped: true, reasons: [floor, ...TARGETS.reasons] } } }));
    renderApp(<NutritionPage />);
    const limits = await screen.findByTestId("targets-limits");
    const reason = within(limits).getByTestId("safety-reason");
    expect(reason.getAttribute("data-code")).toBe("floor_raised");
    expect(reason.textContent).toContain("1200 kcal");
    expect(within(reason).getByTestId("evidence-chip").getAttribute("data-grade")).toBe("strong");
  });
});
