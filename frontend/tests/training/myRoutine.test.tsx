import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import { makePlan, makeState } from "./plan-fixture";
import MyRoutinePage from "@/app/(shell)/training/my-routine/page";

const state = vi.hoisted(() => ({ plan: undefined as unknown, generated: undefined as unknown }));
vi.mock("@/lib/plan", async (orig) => ({
  ...(await orig<typeof import("@/lib/plan")>()),
  useWeeklyPlan: () => ({ data: state.plan }),
}));
// Las rutinas generadas por el plan (F17) tienen su propio test (routines.test.tsx).
vi.mock("@/lib/routines", async (orig) => ({
  ...(await orig<typeof import("@/lib/routines")>()),
  usePlanRoutines: () => ({ data: state.generated }),
}));
vi.mock("@/components/routines/PlanRoutines", () => ({ PlanRoutines: () => null }));

describe("Mi rutina (en)", () => {
  it("ya no pinta la rutina de ejemplo ni el entrenador inventado", () => {
    state.plan = makeState();
    const { container } = renderEn(<MyRoutinePage />);
    expect(screen.getByText("My routine")).toBeTruthy();
    expect(screen.queryByText(/Your trainer/)).toBeNull();
    expect(screen.queryByText("Bench press 4×8")).toBeNull();
    expect(screen.queryByLabelText("Mark as done")).toBeNull();
    expectClean(container, ["Carlos Méndez"]);
  });

  it("sin plan aplicado ofrece preparar el del coach", () => {
    state.plan = makeState();
    renderEn(<MyRoutinePage />);
    expect(screen.getByTestId("routine-plan-cta").getAttribute("href")).toBe("/training/plan");
    expect(screen.getByText("Build your weekly plan with the coach")).toBeTruthy();
  });

  it("con un plan aplicado lo pinta con sus sesiones para empezar", () => {
    state.plan = makeState({ active: makePlan({ status: "active", applied_at: "2026-10-29T11:00:00Z" }) });
    const { container } = renderEn(<MyRoutinePage />);
    expect(screen.getByTestId("routine-active-plan")).toBeTruthy();
    expect(screen.getByText("Coach's plan · week of 26 October")).toBeTruthy();
    expect(screen.getByText("Start session A").getAttribute("href")).toBe("/training/gym/session?plan=A");
    expect(screen.queryByText(/Your trainer/)).toBeNull();
    expectClean(container);
  });

  it("con las rutinas del plan al día, «Start session A» empieza su rutina", () => {
    state.plan = makeState({ active: makePlan({ id: 3, status: "active", applied_at: "2026-10-29T11:00:00Z" }) });
    state.generated = {
      plan_id: 3, week_start: "2026-10-26", folder: null, in_sync: true, edited: [],
      routines: [{ id: 41, source: "plan", source_ref: "plan:3:A" }, { id: 42, source: "plan", source_ref: "plan:3:B" }],
    };
    renderEn(<MyRoutinePage />);
    expect(screen.getByText("Start session A").getAttribute("href")).toBe("/training/gym/session?routine=41");
    state.generated = undefined;
  });
});
