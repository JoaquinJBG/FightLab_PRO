import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import LoadPage from "@/app/(shell)/training/load/page";

const state = vi.hoisted(() => ({ logs: [] as unknown[], metrics: null as unknown }));
vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: state.logs }) }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: vi.fn(async () => null) }));
vi.mock("@/lib/load", () => ({
  loadMetrics: () => state.metrics,
}));

const m = (over: object) => ({
  weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, weekVsAvgPct: null, ratioDaysLeft: 28, gaps: false,
  monotonia: null, tension: null, sinVariacion: false, historyDays: 0, ...over,
});
const bio = (rhr: number, hrv: number) => ({ resting_heart_rate: rhr, hrv_ms: hrv });

beforeEach(() => { state.logs = []; state.metrics = m({}); });

describe("Carga y estado (en)", () => {
  it("vacío: sin biometría ni sesiones", () => {
    const { container } = renderEn(<LoadPage />);
    expect(screen.getByText("Load and status")).toBeTruthy();
    expect(screen.getByText(/Log resting HR and HRV/)).toBeTruthy();
    expect(screen.getByText(/Log your workouts with RPE/)).toBeTruthy();
    expect(screen.getByText(/No sessions this week/)).toBeTruthy();
    expectClean(container);
  });

  it("estado de recuperación con chips y tooltips", () => {
    state.logs = [bio(60, 40), bio(52, 60), bio(52, 60), bio(52, 60), bio(52, 60)];
    const { container } = renderEn(<LoadPage />);
    expect(screen.getByText("Take it easy")).toBeTruthy();
    expect(screen.getByText("Resting HR +8 vs your average")).toBeTruthy();
    expect(screen.getByText("HRV -33% vs your average")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("More info")[0]);
    expect(screen.getByText(/Your readiness to train today/)).toBeTruthy();
    expectClean(container);
  });

  it("con 28 días: la semana frente a la media, el ratio sin bandas y cada número con su regla", async () => {
    state.metrics = m({ weekAU: 500, daily7: [100, 0, 50, 200, 0, 100, 50], acwr: 1.45, weekVsAvgPct: 45, ratioDaysLeft: 0, monotonia: 1.3, tension: 650, historyDays: 28 });
    const { container } = renderEn(<LoadPage />);
    await waitFor(() => expect(screen.getByTestId("load-week-vs-avg").textContent).toBe("45% above your 4-week average"));
    expect(screen.getByText(/Week\/average ratio: 1\.45/)).toBeTruthy();
    expect(screen.getByText(/Big jump: 30% or more/)).toBeTruthy();
    expect(screen.getByText(/barely been studied in combat sports/)).toBeTruthy();
    expect(screen.getByText("500 AU")).toBeTruthy();
    expect(container.textContent).not.toMatch(/safe zone|optimal zone|injury risk|Provisional/i);
    expect(container.querySelector(".text-good, .text-warn")).toBeNull();
    // Reglas: comparación, ratio, combate, AU (2), monotonía y tensión; el 30 % es convención
    expect(container.querySelectorAll('[data-variant="evidence"]').length).toBe(7);
    expect(container.querySelectorAll('[data-variant="convention"]').length).toBe(1);
    expect(screen.queryByTestId("load-gaps")).toBeNull();
    expectClean(container);
    for (const b of screen.getAllByLabelText("More info")) fireEvent.click(b);
    expect(screen.getByText(/the 28 days are a FightLab convention/)).toBeTruthy();
    expectClean(container);
  });

  it("con huecos en el historial avisa de que el número puede engañar", () => {
    state.metrics = m({ weekAU: 300, daily7: [0, 0, 0, 300, 0, 0, 0], acwr: 1.2, weekVsAvgPct: 20, ratioDaysLeft: 0, gaps: true, historyDays: 28 });
    renderEn(<LoadPage />);
    expect(screen.getByTestId("load-gaps").textContent).toMatch(/may mislead/);
  });

  it("sin ratio antes de 28 días, con plural, en pausa y sin variación", () => {
    state.metrics = m({ historyDays: 1, ratioDaysLeft: 27 });
    const first = renderEn(<LoadPage />);
    expect(screen.getByTestId("load-days-left").textContent).toMatch(/27 more days of history .* you have 1\./);
    expectClean(first.container);
    first.unmount();

    state.metrics = m({ historyDays: 27, ratioDaysLeft: 1, weekAU: 200 });
    const one = renderEn(<LoadPage />);
    expect(screen.getByTestId("load-days-left").textContent).toMatch(/^1 more day of history/);
    expect(one.container.textContent).not.toMatch(/ratio:/);
    one.unmount();

    state.metrics = m({ historyDays: 28, ratioDaysLeft: 0, weekAU: 0 });
    const second = renderEn(<LoadPage />);
    expect(screen.getByText(/No sessions in the last 7 days/)).toBeTruthy();
    expectClean(second.container);
    second.unmount();

    state.metrics = m({ weekAU: 700, daily7: [100, 100, 100, 100, 100, 100, 100], sinVariacion: true, historyDays: 8, ratioDaysLeft: 20 });
    const third = renderEn(<LoadPage />);
    expect(screen.getByText("max")).toBeTruthy();
    expect(screen.getByText(/All 7 daily loads are the same/)).toBeTruthy();
    expectClean(third.container);
  });
});
