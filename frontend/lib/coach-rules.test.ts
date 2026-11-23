import { describe, test, expect } from "vitest";
import { createTranslator } from "next-intl";
import es from "@/messages/es.json";
import { buildBriefing, buildRecs, coachReply, type CoachTr, type Ctx, type Tr } from "./coach-rules";
import type { LoadBandStatus, LoadMetrics } from "./load";
import { COMBAT_RULES } from "./combat-rules";

// Las reglas reciben los traductores de la página; aquí, los del catálogo en español.
const tr = (ns: "coach" | "load" | "combat") => createTranslator({ locale: "es", messages: es, namespace: ns }) as unknown as Tr;
const TR: CoachTr = { t: tr("coach"), tl: tr("load"), tc: tr("combat") };
const listFmt = new Intl.ListFormat("es", { type: "conjunction" });

// Forma E.5 de LoadMetrics: ratio y % frente a la media solo con 28 días; la banda es aparte.
function metrics(over: Partial<LoadMetrics> = {}, status: LoadBandStatus | null = null): LoadMetrics {
  const weekAU = over.weekAU ?? 400;
  return {
    weekAU,
    daily7: [0, 0, 0, 0, 0, 0, 0],
    acwr: null,
    weekVsAvgPct: null,
    ratioDaysLeft: 0,
    gaps: false,
    monotonia: 1.2,
    tension: 100,
    sinVariacion: false,
    band: status ? { weekAU, low: 300, high: 500, overreach: 700, status, provisional: false } : null,
    historyDays: 28,
    ...over,
  };
}
const ctx = (m: LoadMetrics | null, over: Partial<Ctx> = {}): Ctx => ({
  metrics: m, recovery: null, weight: null, lastWeightDays: null, weighTarget: null, weighDays: null,
  cutAllowed: true, minor: false, ...over,
});
const allText = (c: Ctx) => {
  const b = buildBriefing(c, TR);
  return [b.text, ...buildRecs(c, TR).flatMap((r) => [r.title, r.why]),
    coachReply("¿cómo va mi carga?", c, TR, listFmt), coachReply("cómo voy", c, TR, listFmt),
    coachReply("¿entreno fuerte hoy?", c, TR, listFmt)].join(" ");
};

describe("la banda personal no genera avisos ni consejos de volumen (anexo de combate)", () => {
  test("banda alta o elevada sin salto frente a la media: ningún aviso de carga", () => {
    for (const status of ["elevada", "alta"] as const) {
      const c = ctx(metrics({ acwr: 1.1, weekVsAvgPct: 10 }, status));
      const recs = buildRecs(c, TR);
      expect(recs.some((r) => r.icon === "load" && r.tone === "warn")).toBe(false);
      expect(recs.map((r) => r.id)).not.toContain("carga-alta");
      expect(buildBriefing(c, TR).text).not.toMatch(/baja el volumen/i);
    }
  });

  test("banda de descarga: no invita a sumar sesiones", () => {
    const c = ctx(metrics({ acwr: 0.6, weekVsAvgPct: -40 }, "descarga"));
    expect(buildRecs(c, TR).map((r) => r.id)).not.toContain("carga-baja");
  });

  test("ningún texto usa el semáforo ni las frases retiradas", () => {
    for (const status of ["descarga", "sostenible", "elevada", "alta"] as const) {
      const text = allText(ctx(metrics({ acwr: 1.5, weekVsAvgPct: 50 }, status)));
      expect(text).not.toMatch(/sin riesgo añadido|zona segura|ACWR|baja el volumen|vigila la recuperación|prioriza recuperar/i);
    }
  });
});

describe("la carga se cuenta como la semana frente a tu media de 4 semanas", () => {
  test("salto grande (≥ 30 %): recomendación informativa con su regla", () => {
    const c = ctx(metrics({ acwr: 1.45, weekVsAvgPct: 45 }));
    const rec = buildRecs(c, TR).find((r) => r.id === "carga-salto")!;
    expect(rec.tone).toBe("info");
    expect(rec.title).toContain("45 %");
    expect(rec.rule).toEqual(COMBAT_RULES.comparison);
    expect(buildBriefing(c, TR).rules).toContain(COMBAT_RULES.comparison);
  });

  test("antes de 28 días no hay ratio: dice cuántos días faltan y lo cita", () => {
    const c = ctx(metrics({ historyDays: 12, ratioDaysLeft: 16 }));
    const reply = coachReply("¿cómo va mi carga?", c, TR, listFmt);
    expect(reply).toMatch(/faltan 16 días de historial/);
    expect(reply).toContain(`[[regla:${COMBAT_RULES.ratio28.key}]]`);
  });
});

describe("pesaje y corte", () => {
  const withWeigh = (over: Partial<Ctx> = {}) => ctx(null, { weight: 75, weighTarget: 70, weighDays: 4, ...over });

  test("sin protocolos de agua ni sodio, y remite a un profesional", () => {
    const text = allText(withWeigh()) + coachReply("¿cómo va mi peso?", withWeigh(), TR, listFmt);
    expect(text).not.toMatch(/48-72|agua|sodio/i);
    expect(text).toMatch(/dietista-nutricionista/);
  });

  test("con el corte bloqueado no hay aviso de pesaje ni distancia al objetivo", () => {
    const c = withWeigh({ cutAllowed: false });
    expect(buildRecs(c, TR).map((r) => r.id)).not.toContain("pesaje");
    expect(coachReply("¿cómo va mi peso?", c, TR, listFmt)).not.toMatch(/del objetivo/);
  });

  test("menores: sin contenido de corte", () => {
    const reply = coachReply("¿cómo va mi peso?", withWeigh({ minor: true, cutAllowed: false }), TR, listFmt);
    expect(reply).toContain(`[[regla:${COMBAT_RULES.minorsCut.key}]]`);
  });
});
