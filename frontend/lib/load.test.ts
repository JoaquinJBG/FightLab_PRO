import { describe, test, expect, beforeEach } from "vitest";
import { dailyAU, loadMetrics, type LoadPoint } from "./load";

const DAY = 86_400_000;

describe("dailyAU", () => {
  test("reparte la carga por día, con hoy en el último índice", () => {
    const now = Date.now();
    const loads: LoadPoint[] = [
      { ts: now, load: 100 }, // hoy
      { ts: now - DAY, load: 50 }, // ayer
    ];
    const arr = dailyAU(7, loads);
    expect(arr).toHaveLength(7);
    expect(arr[6]).toBe(100); // hoy = último
    expect(arr[5]).toBe(50); // ayer
    expect(arr[0]).toBe(0); // hace 6 días, sin carga
  });

  test("suma varias sesiones del mismo día", () => {
    const now = Date.now();
    const arr = dailyAU(7, [
      { ts: now, load: 100 },
      { ts: now, load: 40 },
    ]);
    expect(arr[6]).toBe(140);
  });
});

// loadMetrics lee las sesiones del dispositivo desde localStorage.
function seedActivities(sessions: { ts: number; load: number }[]) {
  localStorage.setItem(
    "flp_activities",
    JSON.stringify(sessions.map((s) => ({ ...s, durationSec: 0 }))),
  );
}

describe("loadMetrics", () => {
  beforeEach(() => localStorage.clear());

  test("sin sesiones: métricas vacías", () => {
    const m = loadMetrics();
    expect(m.weekAU).toBe(0);
    expect(m.acwr).toBeNull();
    expect(m.monotonia).toBeNull();
    expect(m.historyDays).toBe(0);
  });

  test("ACWR sigue null por debajo de 10 días de historial (umbral)", () => {
    const now = Date.now();
    // 7 días de sesiones: hay carga pero historial < 10
    const sessions = Array.from({ length: 7 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const m = loadMetrics();
    expect(m.weekAU).toBe(700);
    expect(m.acwr).toBeNull();
    expect(m.historyDays).toBe(7);
  });

  test("7 días con carga idéntica => monotonía máxima (sinVariacion)", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 7 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const m = loadMetrics();
    expect(m.sinVariacion).toBe(true);
  });

  test("con 14 días de carga estable, ACWR ~1.0 y provisional", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 14 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const m = loadMetrics();
    expect(m.historyDays).toBe(14);
    expect(m.acwr).toBeCloseTo(1.0, 1);
    expect(m.provisional).toBe(true);
  });
});
