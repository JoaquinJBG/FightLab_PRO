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
import { detectSafetyTopic, type SafetyTopic } from "@/lib/chat-safety";
import { SAFETY_RULES } from "@/lib/safety-rules";

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
  // F26: golpe en la cabeza con síntomas sin el alta de un clínico (`no_contact` de /coach/safety)
  noContact?: boolean;
  // F26: lesiones activas (las del perfil, de /coach/safety, y la de «Contarle a mi coach»)
  injuries?: string[];
};

// Reglas del bloqueo por un golpe en la cabeza: el bloqueo y la vuelta al contacto por fases (la
// misma que enseña la tarjeta del golpe, que es por donde se quita con el alta de un clínico).
export const HEAD_BLOW_RULES: RuleRef[] = [COMBAT_RULES.noContact, COMBAT_RULES.returnSteps];

/** Las zonas lesionadas, sin repetir (el perfil y la memoria del coach pueden decir lo mismo). */
export function injuryAreas(reasons: { code: string; params: Record<string, unknown> }[], memoryLesion?: string | null): string[] {
  const areas = reasons
    .filter((r) => r.code === "injury_unassessed" || r.code === "injury_managed")
    .map((r) => r.params.area)
    .filter((a): a is string => typeof a === "string" && a.trim() !== "");
  if (memoryLesion && memoryLesion.trim()) areas.push(memoryLesion.trim());
  const seen = new Set<string>();
  return areas.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

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

export function buildBriefing(ctx: Ctx, { t, tl, tc }: CoachTr, listFmt?: Intl.ListFormat): { text: string; rules: RuleRef[]; blocked: boolean } {
  const bits: string[] = [];
  const rules: RuleRef[] = [];
  const injuries = ctx.injuries ?? [];
  // F26: un golpe en la cabeza activo manda sobre la carga y la recuperación.
  if (ctx.noContact) {
    bits.push(t("briefing.headBlow"));
    rules.push(...HEAD_BLOW_RULES);
    if (injuries.length) {
      bits.push(t("briefing.injury", { areas: joinAreas(injuries, listFmt) }));
      rules.push(SAFETY_RULES.newPain);
    }
    return { text: bits.join(" "), rules, blocked: true };
  }
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
  if (injuries.length) {
    bits.push(t("briefing.injury", { areas: joinAreas(injuries, listFmt) }));
    rules.push(SAFETY_RULES.newPain);
  }
  return { text: bits.join(" "), rules, blocked: false };
}

const joinAreas = (areas: string[], listFmt?: Intl.ListFormat) => (listFmt ? listFmt.format(areas) : areas.join(", "));

export type Rec = {
  id: string;
  icon: "load" | "weigh" | "rest" | "log";
  tone: "warn" | "info" | "good";
  title: string;
  why: string;
  action?: { label: string; href: string };
  rule?: RuleRef | null; // la regla del número o del consejo; null = convención de FightLab
};

export function buildRecs(ctx: Ctx, { t, tl, tc }: CoachTr, listFmt?: Intl.ListFormat): Rec[] {
  const recs: Rec[] = [];
  const m = ctx.metrics;

  // F26: el golpe en la cabeza y las lesiones van antes que la carga.
  if (ctx.noContact) {
    recs.push({
      id: "golpe",
      icon: "rest",
      tone: "warn",
      title: t("recs.headBlow.title"),
      why: t("recs.headBlow.why"),
      action: { label: t("recs.headBlow.action"), href: "/training/mma" },
      rule: COMBAT_RULES.returnSteps,
    });
  }
  if (ctx.injuries?.length) {
    recs.push({
      id: "lesion",
      icon: "rest",
      tone: "warn", // las lesiones se ven aunque el atleta pida pocos avisos
      title: t("recs.injury.title", { areas: joinAreas(ctx.injuries, listFmt) }),
      why: t("recs.injury.why"),
      action: { label: t("recs.injury.action"), href: "/checkin" },
      rule: SAFETY_RULES.newPain,
    });
  }

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

// Las reglas de cada tema de seguridad: las del check-in (señales de alarma) y las del anexo de
// combate para el golpe en la cabeza (parar y, con señales de alarma, urgencias).
const SAFETY_REPLY_RULES: Record<SafetyTopic, RuleRef[]> = {
  headBlow: [COMBAT_RULES.stopAfterHeadBlow, COMBAT_RULES.redFlags],
  cardiac: [SAFETY_RULES.cardiac],
  illness: [SAFETY_RULES.illness],
  pain: [SAFETY_RULES.newPain],
};

/** Respuesta de seguridad (F3): va antes que cualquier consejo de carga o de intensidad. */
export function safetyReply(topic: SafetyTopic, t: Tr): string {
  return t(`reply.safety.${topic}`) + SAFETY_REPLY_RULES[topic].map(cite).join("");
}

export function coachReply(text: string, ctx: Ctx, { t, tl, tc }: CoachTr, listFmt: Intl.ListFormat): string {
  // Seguridad primero: con dolor, una lesión, un golpe en la cabeza, mareo o fiebre no hay
  // consejo de carga, sino la misma regla que el check-in y el cribado.
  const topic = detectSafetyTopic(text);
  const injuries = ctx.injuries ?? [];
  const areas = listFmt.format(injuries);
  // F26: con un golpe en la cabeza activo, el golpe va primero en cualquier respuesta (solo el
  // pecho, el mareo o la fiebre van antes, porque piden parar o ir al médico ya).
  if (ctx.noContact) {
    const head = t("reply.headBlowActive") + HEAD_BLOW_RULES.map(cite).join("");
    return topic === "cardiac" || topic === "illness" ? `${safetyReply(topic, t)} ${head}` : head;
  }
  if (topic === "pain" && injuries.length) {
    // F3: el dolor y la lesión que ya tiene guardada, los dos con nombre
    return `${t("reply.injuryKnown", { areas })} ${safetyReply(topic, t)}`;
  }
  if (topic) return safetyReply(topic, t);
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
    // F26: con una lesión guardada, el consejo de carga lleva su límite (solo lo que afecta a la zona)
    const limit = injuries.length ? ` ${t("reply.injuryLimit", { areas })}${cite(SAFETY_RULES.newPain)}` : "";
    if (rec && ctx.recovery?.state === "cuidado") return t("reply.hardCare", { chips: listFmt.format(rec.chips) }) + limit;
    if (isBigJump(m)) return tl("coach.replyHigh", { comparison: acwrTxt }) + limit;
    if (injuries.length) return t("reply.hardNormal", { acwr: acwrTxt }) + limit;
    if (ctx.recovery?.state === "listo") return t("reply.hardReady", { acwr: acwrTxt });
    return t("reply.hardNormal", { acwr: acwrTxt });
  }
  if (/fatiga|cansad|agujetas|recuper|fatigue|tired|sore|recover/.test(low)) {
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
