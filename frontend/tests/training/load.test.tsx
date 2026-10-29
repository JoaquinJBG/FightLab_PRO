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

const m = (over: object) => ({ weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, provisional: true, monotonia: null, tension: null, sinVariacion: false, historyDays: 0, ...over });
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

  it("ACWR, carga semanal y monotonía con datos", async () => {
    state.metrics = m({ weekAU: 500, daily7: [100, 0, 50, 200, 0, 100, 50], acwr: 1.45, provisional: true, monotonia: 1.3, tension: 650, historyDays: 14 });
    const { container } = renderEn(<LoadPage />);
    await waitFor(() => expect(screen.getByText("1.45")).toBeTruthy());
    expect(screen.getByText(/Provisional: it calibrates until you have 4 weeks of history \(14\/28 days\)/)).toBeTruthy();
    expect(screen.getByText("500 AU")).toBeTruthy();
    expect(screen.getByText("optimal zone")).toBeTruthy();
    expectClean(container);
    for (const b of screen.getAllByLabelText("More info")) fireEvent.click(b);
    expectClean(container);
  });

  it("mensajes del ACWR sin calcular, con plural y sin variación", () => {
    state.metrics = m({ historyDays: 1 });
    const first = renderEn(<LoadPage />);
    expect(screen.getByText(/you have 1 day\)/)).toBeTruthy();
    expectClean(first.container);
    first.unmount();

    state.metrics = m({ historyDays: 12, weekAU: 0 });
    const second = renderEn(<LoadPage />);
    expect(screen.getByText(/No sessions in the last 7 days/)).toBeTruthy();
    expectClean(second.container);
    second.unmount();

    state.metrics = m({ weekAU: 700, daily7: [100, 100, 100, 100, 100, 100, 100], sinVariacion: true, historyDays: 8 });
    const third = renderEn(<LoadPage />);
    expect(screen.getByText("max")).toBeTruthy();
    expect(screen.getByText(/No variation between days/)).toBeTruthy();
    expectClean(third.container);
  });
});
