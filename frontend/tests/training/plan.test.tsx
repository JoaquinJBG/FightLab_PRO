import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import { makePlan, makeState } from "./plan-fixture";
import WeeklyPlanPage from "@/app/(shell)/training/plan/page";
import type { PlanState } from "@/lib/plan";

// Fase 6.5: pantalla "Plan de la semana". El plan lo genera el servidor; aquí se pinta con la
// regla de cada línea y "Aplicar" lo pasa a Mi rutina.

const state = vi.hoisted(() => ({
  plan: undefined as unknown,
  generate: vi.fn(),
  apply: vi.fn(),
  genError: null as unknown,
}));

vi.mock("@/lib/plan", async (orig) => ({
  ...(await orig<typeof import("@/lib/plan")>()),
  useWeeklyPlan: () => ({ data: state.plan as PlanState, isLoading: false, isError: false }),
  useGeneratePlan: () => ({ mutate: state.generate, isPending: false, error: state.genError }),
  useApplyPlan: () => ({ mutate: state.apply, isPending: false, isSuccess: false, error: null }),
  useStrengthSets: () => ({
    data: {
      week: { start: "2026-10-20", end: "2026-10-26" }, sets: { chest: 6, quads: 3 }, unmapped: ["Fondos"],
      reference_sets_per_week: 10, rules: [{ key: "strength-hypertrophy/weekly-sets-per-muscle-dose-response", grade: "strong", title: "Weekly sets" }],
    },
  }),
}));

beforeEach(() => { state.generate.mockClear(); state.apply.mockClear(); state.genError = null; });
afterEach(cleanup);

describe("Plan de la semana (en)", () => {
  it("pinta el borrador con la regla de cada línea", () => {
    state.plan = makeState({ draft: makePlan() });
    const { container } = renderEn(<WeeklyPlanPage />);
    expect(screen.getByText("Weekly plan")).toBeTruthy();
    expect(screen.getByTestId("plan-status").textContent).toBe("Draft");
    // La semana: gimnasio A el lunes, MMA el martes con lo que se puede hacer y lo que no.
    const tue = screen.getAllByTestId("plan-day").find((d) => d.dataset.day === "tue")!;
    expect(within(tue).getByText("Technique and drilling")).toBeTruthy();
    expect(within(tue).getByText("Hard sparring")).toBeTruthy();
    expect(within(tue).getByText("until a professional reviews vigorous work")).toBeTruthy();
    expect(within(tue).getByText("at 19:00")).toBeTruthy();
    // Cada ejercicio lleva su chip; la carga sale del motor o no se inventa.
    const items = screen.getAllByTestId("plan-item");
    expect(items).toHaveLength(6);
    for (const item of items) expect(within(item).getAllByTestId("evidence-chip").length).toBeGreaterThan(0);
    const bench = items.find((i) => i.dataset.exercise === "Press banca")!;
    expect(within(bench).getByText(/62\.5 kg/)).toBeTruthy();
    expect(within(bench).getByText("Same load, more reps")).toBeTruthy();
    const rdl = items.find((i) => i.dataset.exercise === "Peso muerto rumano")!;
    expect(within(rdl).getByText(/one you could lift 2-3 more times/)).toBeTruthy();
    expect(within(rdl).getByText("Instead of Squat (paused)")).toBeTruthy();
    const press = items.find((i) => i.dataset.exercise === "Prensa")!;
    expect(within(press).getByText(/At most 100 kg/)).toBeTruthy();
    // Convenciones etiquetadas: rotación (del coach) y minutos de MMA como cardio (de FightLab).
    expect(screen.getAllByTestId("convention-coach").length).toBeGreaterThan(0);
    const cardio = screen.getByTestId("plan-cardio");
    expect(within(cardio).getByText("120 min to go: 40 min × 3 days")).toBeTruthy();
    expect(within(cardio).getAllByText("FightLab convention, not reviewed").length).toBeGreaterThan(0);
    expect(within(cardio).getByText("SIT and REHIT need every PAR-Q+ answer to be NO")).toBeTruthy();
    // Intensidad con la escala Light / Moderate / Vigorous.
    expect(within(cardio).getAllByText("Vigorous").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("plan-nutrition")).getByText("2,450 kcal a day")).toBeTruthy();
    expect(within(screen.getByTestId("strength-sets")).getByText(/Not mapped \(they don't count\): Dips/)).toBeTruthy();
    expectClean(container);
  });

  it("F26: el plan activo dice que se ha ajustado a la seguridad de hoy, con la vuelta por fases", () => {
    const rule = "combat-sports/return-to-contact-follows-a-graded-clinician-supervised-plan";
    const plan = makePlan({
      status: "active",
      live: { changed: true, no_contact: true, no_training: false, return_rule_key: rule },
      rules: [...makePlan().rules, { key: rule, grade: "strong", title: "Return to contact" }],
    });
    state.plan = makeState({ active: plan });
    renderEn(<WeeklyPlanPage />);
    const live = screen.getByTestId("plan-live");
    expect(live.textContent).toContain("Adjusted to your safety today");
    const noContact = within(live).getByTestId("plan-live-no-contact");
    expect(noContact.textContent).toContain("No contact until a clinician clears you");
    expect(within(noContact).getByTestId("evidence-chip").getAttribute("data-grade")).toBe("strong");
  });

  it("F9: el cardio dice la duración mínima de cada sesión, como convención de FightLab", () => {
    const base = makePlan();
    state.plan = makeState({
      draft: makePlan({ cardio: { ...base.cardio, minutes_needed: 10, days: ["wed"], minutes_per_day: 20, min_session: 20, min_session_convention: "fightlab" } }),
    });
    renderEn(<WeeklyPlanPage />);
    expect(screen.getByText(/10 min to go: 20 min × 1 day/)).toBeTruthy();
    const line = screen.getByTestId("cardio-min-session");
    expect(line.textContent).toContain("Each session lasts at least 20 min");
    expect(within(line).getByTestId("evidence-chip").dataset.variant).toBe("convention");
  });

  it("sin cambios de seguridad no hay aviso de ajuste", () => {
    state.plan = makeState({ active: makePlan({ status: "active", live: { changed: false, no_contact: false, no_training: false, return_rule_key: null } }) });
    renderEn(<WeeklyPlanPage />);
    expect(screen.queryByTestId("plan-live")).toBeNull();
  });

  it("aplicar llama a la API con el id del borrador", () => {
    state.plan = makeState({ draft: makePlan() });
    renderEn(<WeeklyPlanPage />);
    fireEvent.click(screen.getByText("Apply to My routine"));
    expect(state.apply).toHaveBeenCalledWith(7);
  });

  it("prepara el plan con los días elegidos", () => {
    state.plan = makeState();
    renderEn(<WeeklyPlanPage />);
    const gym = screen.getByTestId("gym-days");
    fireEvent.click(within(gym).getByLabelText("Saturday"));
    fireEvent.click(screen.getByText("Build plan"));
    expect(state.generate).toHaveBeenCalledWith({ gym_days: ["mon", "thu", "sat"], mma_days: ["tue"] });
  });

  it("con menos de 2 días de gimnasio no deja preparar", () => {
    state.plan = makeState();
    renderEn(<WeeklyPlanPage />);
    fireEvent.click(within(screen.getByTestId("gym-days")).getByLabelText("Monday"));
    expect((screen.getByText("Build plan") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enseña el error de la API traducido", () => {
    state.plan = makeState();
    state.genError = { code: "too_few_gym_days" };
    const { container } = renderEn(<WeeklyPlanPage />);
    expect(screen.getByRole("alert").textContent).toBe("Choose at least 2 gym days.");
    expectClean(container);
  });

  it("con no_training no hay plan ni formulario", () => {
    state.plan = makeState({
      defaults: null,
      blocked: {
        code: "no_training",
        reasons: [{ code: "bp_no_training", rule_key: "recovery-habits/bp", grade: "moderate", params: {}, text: "185/80, no training until reviewed by a GP", professional: "GP", severity: "stop" }],
      },
    });
    const { container } = renderEn(<WeeklyPlanPage />);
    expect(screen.getByTestId("plan-blocked")).toBeTruthy();
    expect(screen.queryByTestId("plan-form")).toBeNull();
    expect(screen.getByText("No plan until a doctor reviews it")).toBeTruthy();
    expectClean(container);
  });

  it("el plan aplicado lleva a Mi rutina", () => {
    state.plan = makeState({ active: makePlan({ status: "active", applied_at: "2026-10-29T11:00:00Z" }) });
    renderEn(<WeeklyPlanPage />);
    expect(screen.getByTestId("plan-status").textContent).toBe("In My routine");
    expect(screen.getByText("See My routine").getAttribute("href")).toBe("/training/my-routine");
  });
});
