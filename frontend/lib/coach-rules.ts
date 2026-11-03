// Reglas del coach (briefing, recomendaciones y respuestas del chat sin IA), fuera de la página
// para poder probarlas solas. Todos los textos salen del catálogo (`coach.*`, `load.*` y
// `combat.*`): las funciones reciben los traductores de la página.
//
// La carga sigue el anexo de combate (E.5): la semana frente a la media de 4 semanas en palabras
// neutras, con su regla. La banda personal (P0.1) solo se dibuja en la vista de Carga: aquí no
// genera avisos ni consejos de volumen.

import type { useTranslations } from "next-intl";
import type { LoadMetrics } from "@/lib/load";
import type { Recovery } from "@/lib/recovery";
import { COMBAT_RULES, type RuleRef } from "@/lib/combat-rules";
import { cite, comparisonPhrase, comparisonRule, isBigJump } from "@/lib/load-texts";

export type Tr = ReturnType<typeof useTranslations>;

/** Traductores que usan las reglas: `coach`, `load` y `combat`. */
export type CoachTr = { t: Tr; tl: Tr; tc: Tr };

/* ------------------- contexto real del atleta (local) -------------------- */

export type Ctx = {
  metrics: LoadMetrics | null;
  recovery: Recovery | null;
  weight: number | null;
  lastWeightDays: number | null;
  weighTarget: number | null;
  weighDays: number | null;
  // Contenido de corte (anexo de combate): nunca para menores ni con los bloqueos de la fase 4
  cutAllowed: boolean;
  minor: boolean;
};

export function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/* --------------------- traducción de datos de recuperación ---------------- */

/** Etiqueta, frase y chips de recuperación en el idioma activo (computeRecovery los da en español). */
export function recoveryText(r: Recovery, t: Tr) {
  const chips: string[] = [];
  if (r.rhrDelta !== undefined) chips.push(t("recovery.chipRhr", { delta: (r.rhrDelta > 0 ? "+" : "") + r.rhrDelta }));
  if (r.hrvPct !== undefined) chips.push(t("recovery.chipHrv", { delta: (r.hrvPct > 0 ? "+" : "") + r.hrvPct }));
  return { label: t(`recovery.${r.state}.label`), phrase: t(`recovery.${r.state}.phrase`), chips };
}

/* --------------------- briefing y recomendaciones por reglas -------------- */

export function buildBriefing(ctx: Ctx, { t, tl, tc }: CoachTr): { text: string; rules: RuleRef[] } {
  const bits: string[] = [];
  const rules: RuleRef[] = [];
  if (ctx.recovery?.state === "cuidado") {
    bits.push(t("briefing.care"));
  } else if (isBigJump(ctx.metrics)) {
    bits.push(tl("coach.briefingUp", { pct: ctx.metrics!.weekVsAvgPct! }));
    rules.push(COMBAT_RULES.comparison);
  } else if (ctx.recovery?.state === "listo") {
    bits.push(t("briefing.ready"));
  } else if (ctx.metrics && ctx.metrics.weekAU > 0) {
    bits.push(t("briefing.week", { au: ctx.metrics.weekAU }));
  } else {
    bits.push(t("briefing.unknown"));
  }
  if (ctx.cutAllowed && ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null) {
    const over = ctx.weight - ctx.weighTarget;
    if (over > 0.3 && ctx.weighDays <= 10) {
      bits.push(tc("cut.briefing", { days: ctx.weighDays, over: over.toFixed(1) }));
      rules.push(COMBAT_RULES.plannedWeight);
    }
  }
  return { text: bits.join(" "), rules };
}

export type Rec = {
  id: string;
  icon: "load" | "weigh" | "rest" | "log";
  tone: "warn" | "info" | "good";
  title: string;
  why: string;
  action?: { label: string; href: string };
  rule?: RuleRef | null; // la regla del número o del consejo; null = convención de FightLab
};

export function buildRecs(ctx: Ctx, { t, tl, tc }: CoachTr): Rec[] {
  const recs: Rec[] = [];
  const m = ctx.metrics;

  // Anexo de combate: la semana frente a la media, en palabras neutras. El "salto grande"
  // (30 %) es una convención de FightLab; no hay aviso por quedarse por debajo.
  if (isBigJump(m)) {
    recs.push({
      id: "carga-salto",
      icon: "load",
      tone: "info",
      title: tl("coach.recUp.title", { pct: m!.weekVsAvgPct! }),
      why: tl("coach.recUp.why"),
      action: { label: tl("coach.recUp.action"), href: "/training/load" },
      rule: COMBAT_RULES.comparison,
    });
  }

  if (ctx.recovery?.state === "cuidado") {
    recs.push({
      id: "recuperacion",
      icon: "rest",
      tone: "warn",
      title: t("recs.recovery.title"),
      why: t("recs.recovery.why", { chips: recoveryText(ctx.recovery, t).chips.join(" · ") }),
    });
  }

  if (ctx.cutAllowed && ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null && ctx.weight - ctx.weighTarget > 0.3) {
    recs.push({
      id: "pesaje",
      icon: "weigh",
      tone: ctx.weighDays <= 5 ? "warn" : "info",
      title: tc("cut.recTitle", { over: (ctx.weight - ctx.weighTarget).toFixed(1), days: ctx.weighDays }),
      why: tc("cut.recWhy"),
      action: { label: tc("cut.recAction"), href: "/nutrition/weigh-in" },
      rule: COMBAT_RULES.plannedWeight,
    });
  }

  if (ctx.lastWeightDays != null && ctx.lastWeightDays >= 14) {
    recs.push({
      id: "peso-viejo",
      icon: "weigh",
      tone: "info",
      title: t("recs.oldWeight.title", { days: ctx.lastWeightDays }),
      why: t("recs.oldWeight.why"),
      action: { label: t("recs.oldWeight.action"), href: "/biometrics/new" },
    });
  }

  if ((m == null || m.weekAU === 0) && recs.length === 0) {
    recs.push({
      id: "empieza",
      icon: "log",
      tone: "info",
      title: t("recs.start.title"),
      why: tl("coach.start"),
      action: { label: t("recs.start.action"), href: "/training" },
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "ok",
      icon: "load",
      tone: "good",
      title: t("recs.ok.title"),
      // Solo dice "cerca de tu media y recuperación sin avisos" si de verdad hay datos de ambas
      why: m?.acwr != null && ctx.recovery ? tl("coach.okWhy") : t("recs.ok.whyNoData"),
      rule: m?.acwr != null && ctx.recovery ? COMBAT_RULES.comparison : undefined,
    });
  }
  return recs;
}

/* ------------------------- chat sin IA (por reglas) ------------------------ */

export function coachReply(text: string, ctx: Ctx, { t, tl, tc }: CoachTr, listFmt: Intl.ListFormat): string {
  const low = text.toLowerCase();
  const m = ctx.metrics;
  // La semana frente a la media (o cuántos días faltan), con su regla del anexo de combate
  const rule = comparisonRule(m);
  const acwrTxt = comparisonPhrase(m, tl) + (rule ? cite(rule) : "");
  const rec = ctx.recovery ? recoveryText(ctx.recovery, t) : null;
  // Las palabras clave cubren es y en: el texto del usuario puede estar en cualquiera.
  if (/peso|pesaje|corte|weight|weigh|cut/.test(low)) {
    if (ctx.minor) return tc("cut.minor") + cite(COMBAT_RULES.minorsCut);
    if (ctx.weight == null) return t("reply.weightNone");
    if (ctx.cutAllowed && ctx.weighTarget != null && ctx.weighDays != null) {
      const over = ctx.weight - ctx.weighTarget;
      return over > 0
        ? tc("cut.replyOver", { over: over.toFixed(1), days: ctx.weighDays }) + cite(COMBAT_RULES.plannedWeight)
        : t("reply.weightAt", { target: ctx.weighTarget, days: ctx.weighDays });
    }
    return t("reply.weightLast", { weight: ctx.weight.toFixed(1) });
  }
  if (/fuerte|intens|sparring|entren|hoy|hard|train|today/.test(low)) {
    if (rec && ctx.recovery?.state === "cuidado") return t("reply.hardCare", { chips: listFmt.format(rec.chips) });
    if (isBigJump(m)) return tl("coach.replyHigh", { comparison: acwrTxt });
    if (ctx.recovery?.state === "listo") return t("reply.hardReady", { acwr: acwrTxt });
    return t("reply.hardNormal", { acwr: acwrTxt });
  }
  if (/fatiga|cansad|dolor|recuper|fatigue|tired|sore|pain|recover/.test(low)) {
    return rec ? t("reply.fatigue", { chips: rec.chips.join(" · "), phrase: rec.phrase }) : t("reply.fatigueNone");
  }
  if (/carga|acwr|riesgo|load|risk/.test(low)) {
    return m && m.weekAU > 0
      ? tl("coach.replyLoad", { au: m.weekAU, comparison: acwrTxt, mono: m.monotonia != null ? m.monotonia.toFixed(1) : "—" })
      : tl("coach.replyNone");
  }
  if (/cómo voy|como voy|resumen|how am i|summary/.test(low)) {
    const parts: string[] = [];
    if (m && m.weekAU > 0) parts.push(t("reply.summaryWeek", { au: m.weekAU, acwr: acwrTxt }));
    if (rec) parts.push(t("reply.summaryRecovery", { label: rec.label.toLowerCase() }));
    if (ctx.weight != null) {
      parts.push(ctx.weighTarget != null
        ? t("reply.summaryWeightTarget", { weight: ctx.weight.toFixed(1), target: ctx.weighTarget })
        : t("reply.summaryWeight", { weight: ctx.weight.toFixed(1) }));
    }
    return parts.length > 0 ? t("reply.summary", { parts: parts.join(" · ") }) : t("reply.summaryNone");
  }
  if (/gracias|ok|vale|genial|thanks|great/.test(low)) return t("reply.thanks");
  return t("reply.default");
}
