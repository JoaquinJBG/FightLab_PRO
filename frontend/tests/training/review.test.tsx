import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import { makePlan } from "./plan-fixture";
import WeeklyReviewPage from "@/app/(shell)/training/review/page";
import { PlanView } from "@/components/plan/PlanView";
import { reviewState, weeklyReview, type ReviewState, type WeeklyReview } from "@/lib/review";

// Fase 7: revisión semanal. Los números los calcula el servidor con el motor; aquí se pinta cada
// número y cada propuesta con su regla, se mandan las 6 señales y se aceptan las propuestas.

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  run: vi.fn(),
  accept: vi.fn(),
}));

vi.mock("@/lib/review", async (orig) => ({
  ...(await orig<typeof import("@/lib/review")>()),
  useWeeklyReview: () => ({ data: state.data as ReviewState, isLoading: false, isError: false }),
  useRunReview: () => ({ mutate: state.run, isPending: false, error: null }),
  useAcceptReview: () => ({ mutate: state.accept, reset: vi.fn(), isPending: false, error: null }),
}));

const reason = (code: string, text: string, rule_key: string | null) => ({
  code, rule_key, grade: rule_key ? "moderate" : null, params: {}, text, professional: null, severity: "info",
});

const RECAL = "nutrition/recalibrate-tdee-from-the-weight-trend";
const DELOADS = "strength-hypertrophy/deloads";

function makeReview(over: Record<string, unknown> = {}): WeeklyReview {
  return weeklyReview.parse({
    id: 3,
    week_end: "2026-10-29",
    status: "pending",
    goal: "fat_loss",
    adherence: {
      start: "2026-10-23", end: "2026-10-29", plan_id: 7, plan_week_start: "2026-10-26", planned_total: 2, done_planned: 1,
      sessions: { gym: { planned: 2, done: 1 }, mma: { planned: 0, done: 1 }, cardio: { planned: 0, done: 0 } },
      entries: [
        { day: "mon", date: "2026-10-26", kind: "gym", session: "A", done: true },
        { day: "thu", date: "2026-10-29", kind: "gym", session: "B", done: false },
      ],
      nutrition: { blocked: false, days_logged: 7, mean_kcal: 2000, target_kcal: 2237, diff_kcal: -237 },
    },
    trend: {
      status: "ok", blocked: false, rate_kg_week: -0.14, rate_pct_week: -0.2, weight_kg: 71.5, points: 28, days: 28,
      min_points: 7, min_days: 14, rule_key: "nutrition/read-the-scale-with-weekly-averages", reasons: [],
    },
    calories: {
      status: "out_of_range", goal: "fat_loss", rate_rule_key: "nutrition/rate-of-loss-for-lean-trained-clients",
      range_pct: [-1, -0.5], in_range: false, tdee_status: "ok", tdee_kcal: 2154, intake_days: 28, intake_mean_kcal: 2000,
      recalibrate_rule_key: RECAL, current_kcal: 2237, proposal: true, reasons: [],
    },
    training: {
      week: { start: "2026-10-23", end: "2026-10-29" }, sets: { chest: 3 }, unmapped: [], reference_sets_per_week: 10,
      sets_rule_key: "strength-hypertrophy/weekly-sets-per-muscle-dose-response",
      lifts: [{
        exercise: "Press banca", action: "stalled", load_kg: 60, rep_range: [8, 12], rule_key: "strength-hypertrophy/when-progress-stalls",
        reasons: [reason("strength_stalled", "no gain in load or reps for 3 sessions", "strength-hypertrophy/when-progress-stalls")],
      }],
      stalled: ["Press banca"],
    },
    signs: ["performance_stall", "joint_aches"],
    deload: { status: "indicated", rule_key: DELOADS, signs_given: ["joint_aches"], signs_derived: ["performance_stall"] },
    proposals: [
      {
        kind: "calories", kcal: 2037, current_kcal: 2237, change_kcal: -200, tdee_kcal: 2154, deficit_kcal: 117, in_deficit: true,
        stepped: true, rule_key: RECAL,
        reasons: [reason("recalibrate_step", "one step of 200 kcal down from the current 2,237 kcal", RECAL)],
      },
      {
        kind: "deload", volume_cut: [0.3, 0.5], stop_rir: 3, extra_rest_days: [0, 0], rule_key: DELOADS,
        reasons: [reason("strength_deload", "2 signs together; one lighter week, keep the loads", DELOADS)],
      },
    ],
    accepted: [],
    accepted_at: null,
    target_kcal: null,
    plan_id: null,
    plan_week_start: null,
    safety_reasons: [],
    rules: [{ key: RECAL, grade: "moderate", title: "Recalibrate TDEE from the weight trend" }],
    engine_sha: "abc1234",
    narrative: "",
    created_at: "2026-10-29T10:00:00Z",
    ...over,
  });
}

function makeState(over: Record<string, unknown> = {}): ReviewState {
  return reviewState.parse({
    today: "2026-10-29", week_end: "2026-10-29", max_past_days: 56,
    signs: ["performance_stall", "joint_aches", "poor_sleep", "low_motivation", "drop_despite_rest", "low_mood"],
    latest: null,
    ...over,
  });
}

beforeEach(() => { state.run.mockClear(); state.accept.mockClear(); });
afterEach(cleanup);

describe("Revisión semanal (en)", () => {
  it("manda la revisión con las señales marcadas", () => {
    state.data = makeState();
    const { container } = renderEn(<WeeklyReviewPage />);
    expect(screen.getByText("Weekly review")).toBeTruthy();
    const signs = screen.getAllByTestId("review-sign");
    expect(signs).toHaveLength(6);
    fireEvent.click(signs.find((s) => s.dataset.sign === "poor_sleep")!);
    fireEvent.click(signs.find((s) => s.dataset.sign === "joint_aches")!);
    fireEvent.click(screen.getByText("Run the review"));
    expect(state.run).toHaveBeenCalledWith({ week_end: "2026-10-29", signs: ["joint_aches", "poor_sleep"] });
    expect(screen.queryByTestId("review-stale")).toBeNull();
    expectClean(container);
  });

  it("pinta cada número y cada propuesta con su regla, y acepta lo marcado", () => {
    state.data = makeState({ latest: makeReview() });
    const { container } = renderEn(<WeeklyReviewPage />);
    expect(screen.getByTestId("review-status").textContent).toBe("Waiting for you to accept");
    const adherence = screen.getByTestId("review-adherence");
    expect(within(adherence).getByText(/1 of 2 planned sessions/)).toBeTruthy();
    expect(within(adherence).getByText(/2,000 kcal on average over 7 logged days; your target is 2,237 kcal \(-237 kcal\)/)).toBeTruthy();
    expect(within(screen.getByTestId("review-trend")).getByText(/71\.5 kg average.*-0\.14 kg a week \(-0\.2 % a week\)/)).toBeTruthy();
    const calories = screen.getByTestId("review-calories");
    expect(within(calories).getByText(/0\.5 to 1 % of body weight a week/)).toBeTruthy();
    expect(within(calories).getByText(/2,154 kcal a day/)).toBeTruthy();
    // Cada número de peso, calorías y entrenamiento lleva su chip.
    for (const id of ["review-weight", "review-calories", "review-training", "review-recovery"]) {
      expect(within(screen.getByTestId(id)).getAllByTestId("evidence-chip").length).toBeGreaterThan(0);
    }
    const proposals = screen.getAllByTestId("review-proposal");
    expect(proposals.map((p) => p.dataset.kind)).toEqual(["calories", "deload"]);
    for (const p of proposals) expect(within(p).getAllByTestId("evidence-chip").length).toBeGreaterThan(0);
    expect(within(proposals[0]).getByText(/from 2,237 to 2,037 kcal a day \(-200 kcal\)/)).toBeTruthy();
    expect(within(proposals[1]).getByText(/cut your sets by 30-50 %.*at least 3 reps short of failure/)).toBeTruthy();
    expect(screen.getByText("Counted by the coach: My performance has stalled.")).toBeTruthy();
    // Se desmarca la de calorías y se acepta solo la descarga.
    fireEvent.click(within(proposals[0]).getByTestId("proposal-check"));
    fireEvent.click(screen.getByTestId("review-accept"));
    expect(state.accept).toHaveBeenCalledWith({ id: 3, accept: ["deload"] });
    expectClean(container, ["Press banca"]);
  });

  it("aceptada: lleva al plan nuevo", () => {
    state.data = makeState({ latest: makeReview({ status: "accepted", accepted: ["deload"], plan_id: 9, plan_week_start: "2026-11-02" }) });
    const { container } = renderEn(<WeeklyReviewPage />);
    expect(screen.getByTestId("review-status").textContent).toBe("Accepted");
    expect(screen.queryByTestId("review-accept")).toBeNull();
    expect(screen.getByTestId("review-plan-link").getAttribute("href")).toBe("/training/plan");
    const [cal, deload] = screen.getAllByTestId("review-proposal");
    expect(within(cal).getByText("Not accepted")).toBeTruthy();
    expect(within(deload).getByText("Accepted")).toBeTruthy();
    expectClean(container, ["Press banca"]);
  });

  it("con no_weight_targets no sale nada de peso ni de kcal", () => {
    state.data = makeState({
      latest: makeReview({
        trend: { status: "disabled", blocked: true, reasons: [] },
        calories: { status: "blocked" },
        adherence: {
          ...makeReview().adherence,
          nutrition: { blocked: true, days_logged: 0, mean_kcal: null, target_kcal: null, diff_kcal: null },
        },
        proposals: [],
      }),
    });
    const { container } = renderEn(<WeeklyReviewPage />);
    expect(screen.queryByTestId("review-calories")).toBeNull();
    expect(screen.getByText("No weight data, for safety.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/kcal|kg a week/);
    expectClean(container, ["Press banca", "60 kg"]);
  });

  it("el admin ve la evidencia antigua", () => {
    state.data = makeState({ stale: { months: 6, files: [{ file: "nutrition.md", checked: "2026-01-10", origin: "upstream" }] } });
    const { container } = renderEn(<WeeklyReviewPage />);
    const stale = screen.getByTestId("review-stale");
    expect(within(stale).getByText(/nutrition\.md · coach · checked on 10 January 2026/)).toBeTruthy();
    expectClean(container, ["nutrition.md"]);
  });
});

describe("Plan de la semana: semana de descarga (en)", () => {
  it("pinta el aviso de descarga y el esfuerzo de la descarga", () => {
    const plan = makePlan({
      deload: { review_id: 3, volume_cut: [0.3, 0.5], stop_rir: 3, extra_rest_days: [1, 3], rule_key: DELOADS, sets_convention: "fightlab" },
    });
    const { container } = renderEn(<PlanView plan={plan} />);
    const banner = screen.getByTestId("plan-deload");
    expect(within(banner).getByText(/sets cut by 30-50 %/)).toBeTruthy();
    expect(within(banner).getByText("Add 1-3 rest days this week.")).toBeTruthy();
    expect(screen.getAllByText("Stop every set 3 or more reps short of failure").length).toBe(plan.sessions.length);
    expectClean(container, ["Press banca", "Peso muerto rumano", "Prensa"]);
  });
});
