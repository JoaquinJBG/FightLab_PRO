import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderEn, expectClean } from "./i18nB-helpers";
import TrainingHubPage from "@/app/(shell)/training/page";

const metrics = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/activities", () => ({ fetchServerMetrics: vi.fn(async () => metrics.value) }));

const base = {
  weekAU: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, weekVsAvgPct: null, ratioDaysLeft: 28, gaps: false,
  monotonia: null, tension: null, sinVariacion: false, historyDays: 0,
};

describe("hub de Entreno (en)", () => {
  it("sin datos: resumen vacío y las 5 tarjetas", () => {
    metrics.value = null;
    const { container } = renderEn(<TrainingHubPage />);
    expect(screen.getByText("Training load")).toBeTruthy();
    expect(screen.getByText("Stopwatch and round timer")).toBeTruthy();
    expect(screen.getByText("My routine")).toBeTruthy();
    expectClean(container);
  });

  it("con menos de 28 días: la carga sin ratio y cuántos días faltan", async () => {
    metrics.value = { ...base, weekAU: 420, historyDays: 12, ratioDaysLeft: 16 };
    const { container } = renderEn(<TrainingHubPage />);
    await waitFor(() => expect(screen.getByText("Week")).toBeTruthy());
    expect(screen.getByTestId("load-comparison").textContent).toBe("16 d to go");
    expect(container.textContent).not.toMatch(/ACWR|provisional|1\.\d\d/);
    // El AU y los días que faltan llevan su regla del anexo
    expect(container.querySelectorAll('[data-variant="evidence"]').length).toBe(2);
    expectClean(container);
  });

  it("con 28 días: la semana frente a la media, sin semáforo", async () => {
    metrics.value = { ...base, weekAU: 420, acwr: 1.1, weekVsAvgPct: 10, ratioDaysLeft: 0, historyDays: 28 };
    const { container } = renderEn(<TrainingHubPage />);
    await waitFor(() => expect(screen.getByTestId("load-comparison").textContent).toBe("+10% vs your average"));
    expect(container.querySelector(".text-good, .text-warn")).toBeNull();
    expectClean(container);
  });
});
