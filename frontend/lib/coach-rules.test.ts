import { describe, test, expect } from "vitest";
import { buildBriefing, buildRecs, coachReply, type Ctx } from "./coach-rules";
import type { LoadBandStatus, LoadMetrics } from "./load";

function metrics(acwr: number | null, status: LoadBandStatus | null, weekAU = 400): LoadMetrics {
  return {
    weekAU,
    daily7: [0, 0, 0, 0, 0, 0, 0],
    acwr,
    provisional: false,
    monotonia: 1.2,
    tension: 100,
    sinVariacion: false,
    band: status ? { weekAU, low: 300, high: 500, overreach: 700, status, provisional: false } : null,
    historyDays: 28,
  };
}
const ctx = (m: LoadMetrics | null): Ctx => ({
  metrics: m, recovery: null, weight: null, lastWeightDays: null, weighTarget: null, weighDays: null,
});

describe("coach usa la banda personal, no umbrales fijos de ACWR", () => {
  test("ACWR 1.5 con banda sostenible: el coach dice sostenible, no alerta", () => {
    const c = ctx(metrics(1.5, "sostenible"));
    expect(buildRecs(c).some((r) => r.tone === "warn")).toBe(false);
    expect(buildBriefing(c)).not.toMatch(/demasiado rápido|ACWR/);
    expect(coachReply("¿cómo va mi carga?", c)).toMatch(/sostenible/);
    expect(coachReply("¿entreno fuerte hoy?", c)).not.toMatch(/subida fuerte/);
  });

  test("ACWR 0.5 con banda alta: el coach avisa", () => {
    const c = ctx(metrics(0.5, "alta"));
    expect(buildRecs(c)[0].tone).toBe("warn");
    expect(buildBriefing(c)).toMatch(/alta/);
    expect(coachReply("¿entreno fuerte hoy?", c)).toMatch(/subida fuerte/);
  });

  test("sin banda no se afirma nada sobre la carga", () => {
    const c = ctx(metrics(1.0, null));
    expect(coachReply("¿cómo va mi carga?", c)).toMatch(/sin rango/);
    expect(buildRecs(c).some((r) => /zona segura|sostenible/i.test(r.why))).toBe(false);
  });

  test("ningún texto menciona las frases retiradas ni el ACWR como cifra", () => {
    for (const status of ["descarga", "sostenible", "elevada", "alta"] as const) {
      const c = ctx(metrics(1.5, status));
      const text = [buildBriefing(c), ...buildRecs(c).flatMap((r) => [r.title, r.why]),
        coachReply("carga", c), coachReply("cómo voy", c), coachReply("hoy", c)].join(" ");
      expect(text).not.toMatch(/sin riesgo añadido|zona segura|ACWR/);
    }
  });
});
