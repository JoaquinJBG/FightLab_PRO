import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import LoadPage from "@/app/(shell)/training/load/page";

const state = vi.hoisted(() => ({ logs: [] as unknown[], metrics: null as unknown }));
vi.mock("@/lib/hooks", () => ({ useBiometrics: () => ({ data: state.logs }), useSafety: () => ({ data: undefined }) }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: vi.fn(async () => null) }));
// El resto de `@/lib/load` es real: la banda usa LOAD_BAND_META (su color neutro)
vi.mock("@/lib/load", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load")>()),
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

  it("el gráfico de carga semanal dibuja las barras con alto en píxeles, proporcional al día", () => {
    // Fallo C: el alto era un % de una columna sin alto fijo, que el navegador resuelve a 0: sin barras.
    state.metrics = m({ weekAU: 500, daily7: [100, 0, 50, 200, 0, 100, 50], historyDays: 28, ratioDaysLeft: 0 });
    renderEn(<LoadPage />);
    const bars = screen.getAllByTestId("load-bar");
    expect(bars).toHaveLength(7);
    const heights = bars.map((b) => b.style.height);
    expect(heights.every((h) => /^\d+px$/.test(h))).toBe(true);
    const px = heights.map((h) => parseInt(h, 10));
    expect(px[3]).toBeGreaterThanOrEqual(60); // el día más cargado llena el gráfico
    expect(px[0]).toBe(Math.round(px[3] / 2)); // 100 es la mitad de 200
    expect(px[1]).toBeGreaterThan(0); // un día sin carga deja una marca, no desaparece
    expect(px[1]).toBeLessThan(px[2]);
  });

  it("con huecos en el historial avisa de que el número puede engañar", () => {
    state.metrics = m({ weekAU: 300, daily7: [0, 0, 0, 300, 0, 0, 0], acwr: 1.2, weekVsAvgPct: 20, ratioDaysLeft: 0, gaps: true, historyDays: 28 });
    renderEn(<LoadPage />);
    expect(screen.getByTestId("load-gaps").textContent).toMatch(/may mislead/);
  });

  it("banda personal: dónde cae tu semana frente a tu rango, sin semáforo ni consejos", () => {
    const band = { weekAU: 900, low: 400, high: 600, overreach: 800, status: "alta", provisional: true };
    state.metrics = m({ weekAU: 900, daily7: [100, 200, 0, 300, 0, 200, 100], historyDays: 20, ratioDaysLeft: 8, band });
    const { container } = renderEn(<LoadPage />);
    expect(screen.getByText("Your week against your usual range")).toBeTruthy();
    expect(screen.getByTestId("load-band-status").textContent).toBe("Well above your range");
    expect(screen.getByText(/Range still calibrating: 20\/28/)).toBeTruthy();
    // La banda no tiene regla: lleva el chip de convención de FightLab
    expect(screen.getByTestId("load-band").querySelector('[data-variant="convention"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId("load-band").querySelector("button")!); // la explicación de la banda
    expect(screen.getByTestId("load-band").textContent).toMatch(/does not predict injury/);
    expect(screen.getByTestId("load-band").textContent).not.toMatch(/recover|reduce|volume|watch|safe zone/i);
    expect(container.querySelector('[data-testid="load-band"] [style*="--color-bad"], [data-testid="load-band"] [style*="--color-warn"], [data-testid="load-band"] [style*="--color-good"]')).toBeNull();
    expectClean(container);
  });

  it("sin banda (menos de 14 días) o sin sesiones esta semana no se dibuja", () => {
    state.metrics = m({ weekAU: 300, historyDays: 10, ratioDaysLeft: 18, band: null });
    const first = renderEn(<LoadPage />);
    expect(screen.queryByTestId("load-band")).toBeNull();
    first.unmount();
    const band = { weekAU: 0, low: 400, high: 600, overreach: 800, status: "descarga", provisional: false };
    state.metrics = m({ weekAU: 0, historyDays: 28, ratioDaysLeft: 0, band });
    renderEn(<LoadPage />);
    expect(screen.queryByTestId("load-band")).toBeNull();
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
