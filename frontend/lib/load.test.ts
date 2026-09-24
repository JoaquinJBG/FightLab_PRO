import { describe, test, expect, beforeEach } from "vitest";
import {
  dailyAU,
  loadMetrics,
  LOAD_BAND_META,
  LOAD_BAND_MIN_DAYS,
  LOAD_BAND_FULL_DAYS,
  ACWR_MIN_HISTORY_DAYS,
  type LoadPoint,
  type LoadBandStatus,
} from "./load";

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

describe("loadMetrics().band", () => {
  beforeEach(() => localStorage.clear());

  test("historial < 14 días => band null", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 12 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    expect(loadMetrics().band).toBeNull();
  });

  test("28 días de carga estable, semana en rango => sostenible y no provisional", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 28 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const b = loadMetrics().band!;
    expect(b.status).toBe("sostenible");
    expect(b.provisional).toBe(false);
  });

  test("baseline estable con suelo de anchura: sigma=0 => banda ±10% de mu (630..770)", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 28 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const b = loadMetrics().band!;
    // mu=700 (7×100), sigma=0 => sigmaEff=70 => low=630, high=770
    expect(b.low).toBe(630);
    expect(b.high).toBe(770);
    expect(b.overreach).toBe(840);
  });

  test("pico fuerte esta semana sobre baseline estable => alta", () => {
    const now = Date.now();
    // días 7..27 atrás a 100 (baseline); últimos 7 días (0..6) a 300 (pico)
    const sessions = Array.from({ length: 28 }, (_, i) => ({ ts: now - i * DAY, load: i <= 6 ? 300 : 100 }));
    seedActivities(sessions);
    expect(loadMetrics().band!.status).toBe("alta");
  });

  test("semana muy suave sobre baseline estable => descarga", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 28 }, (_, i) => ({ ts: now - i * DAY, load: i <= 6 ? 20 : 100 }));
    seedActivities(sessions);
    expect(loadMetrics().band!.status).toBe("descarga");
  });

  test("semana por encima del rango pero sin llegar a pico => elevada", () => {
    const now = Date.now();
    // baseline 100/día => mu=700, high=770, overreach=840; semana a 115/día => 805 AU, en (770, 840]
    const sessions = Array.from({ length: 28 }, (_, i) => ({ ts: now - i * DAY, load: i <= 6 ? 115 : 100 }));
    seedActivities(sessions);
    expect(loadMetrics().band!.status).toBe("elevada");
  });

  test("20 días de historial => banda provisional", () => {
    const now = Date.now();
    const sessions = Array.from({ length: 20 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    expect(loadMetrics().band!.provisional).toBe(true);
  });
});

// P0.1b: el semáforo pasa de la zona fija de ACWR (0.8–1.3) a la banda
// personal. Estos tests fijan el contrato que consumen las 3 vistas (mini-
// resumen de Entreno, Home y "Carga vs tu rango"): mismo lenguaje (label/
// color) y mismos umbrales de historial para el mensaje de "faltan X días".
describe("LOAD_BAND_META", () => {
  test("define label, color y hint para cada estado de la banda", () => {
    const statuses: LoadBandStatus[] = ["descarga", "sostenible", "elevada", "alta"];
    for (const s of statuses) {
      expect(LOAD_BAND_META[s].label.length).toBeGreaterThan(0);
      expect(LOAD_BAND_META[s].color.length).toBeGreaterThan(0);
      expect(LOAD_BAND_META[s].hint.length).toBeGreaterThan(0);
    }
  });
});

describe("umbrales de historial (contrato compartido por las 3 vistas)", () => {
  beforeEach(() => localStorage.clear());

  test(`ACWR sigue null con ${ACWR_MIN_HISTORY_DAYS - 1} días (uno por debajo del umbral)`, () => {
    const now = Date.now();
    const sessions = Array.from({ length: ACWR_MIN_HISTORY_DAYS - 1 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    expect(loadMetrics().acwr).toBeNull();
  });

  test(`banda null con ${LOAD_BAND_MIN_DAYS - 1} días (uno por debajo del umbral)`, () => {
    const now = Date.now();
    const sessions = Array.from({ length: LOAD_BAND_MIN_DAYS - 1 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(sessions);
    const m = loadMetrics();
    expect(m.band).toBeNull();
    expect(m.historyDays).toBe(LOAD_BAND_MIN_DAYS - 1);
  });

  test(`banda deja de ser provisional exactamente al llegar a ${LOAD_BAND_FULL_DAYS} días`, () => {
    const now = Date.now();
    const under = Array.from({ length: LOAD_BAND_FULL_DAYS - 1 }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(under);
    expect(loadMetrics().band!.provisional).toBe(true);

    localStorage.clear();
    const full = Array.from({ length: LOAD_BAND_FULL_DAYS }, (_, i) => ({ ts: now - i * DAY, load: 100 }));
    seedActivities(full);
    expect(loadMetrics().band!.provisional).toBe(false);
  });
});
