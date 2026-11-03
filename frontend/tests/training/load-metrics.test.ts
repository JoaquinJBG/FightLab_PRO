import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMetrics, RATIO_MIN_DAYS } from "@/lib/load";

// Paridad con `backend/activities/selectors.py` (E.5): sin ratio antes de 28 días, la semana
// frente a la media de 4 semanas en % y el aviso de semanas sin carga.

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 2, 18, 0, 0).getTime();

function sessions(list: [daysAgo: number, load: number][]) {
  const items = list.map(([daysAgo, load]) => ({ ts: NOW - daysAgo * DAY, load, minutes: 0 }));
  localStorage.setItem("flp_mma", JSON.stringify(items));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("loadMetrics (local)", () => {
  it("con menos de 28 días no hay ratio y dice cuántos faltan", () => {
    sessions([[11, 300], [1, 420]]);
    const m = loadMetrics();
    expect(m.historyDays).toBe(12);
    expect(m.acwr).toBeNull();
    expect(m.weekVsAvgPct).toBeNull();
    expect(m.ratioDaysLeft).toBe(RATIO_MIN_DAYS - 12);
  });

  it("con 28 días: ratio y % frente a la media semanal de 4 semanas", () => {
    sessions([[27, 300], [20, 300], [13, 300], [1, 600]]);
    const m = loadMetrics();
    expect(m.historyDays).toBe(28);
    expect(m.acwr).toBeCloseTo(1.6, 3);
    expect(m.weekVsAvgPct).toBe(60);
    expect(m.ratioDaysLeft).toBe(0);
    expect(m.gaps).toBe(false);
  });

  it("una semana vacía en el historial activa el aviso", () => {
    sessions([[27, 300], [13, 300], [1, 300]]);
    expect(loadMetrics().gaps).toBe(true);
  });
});
