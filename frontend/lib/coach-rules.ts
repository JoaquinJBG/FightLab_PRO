import { LOAD_BAND_META, type LoadMetrics } from "@/lib/load";
import type { Recovery } from "@/lib/recovery";

/* ------------------- contexto real del atleta (local) -------------------- */

export type Ctx = {
  metrics: LoadMetrics | null;
  recovery: Recovery | null;
  weight: number | null;
  lastWeightDays: number | null;
  weighTarget: number | null;
  weighDays: number | null;
};

export function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/* --------------------- briefing y recomendaciones por reglas -------------- */

export function buildBriefing(ctx: Ctx): string {
  const bits: string[] = [];
  if (ctx.recovery?.state === "cuidado") {
    bits.push("Tus señales de recuperación están bajas: hoy manda la técnica suave o el descanso activo.");
  } else if (ctx.metrics?.band && (ctx.metrics.band.status === "elevada" || ctx.metrics.band.status === "alta")) {
    bits.push(`Tu carga de la semana está ${LOAD_BAND_META[ctx.metrics.band.status].label.toLowerCase()}: ${LOAD_BAND_META[ctx.metrics.band.status].hint} Baja el volumen unos días.`);
  } else if (ctx.recovery?.state === "listo") {
    bits.push("Recuperación por encima de tu media: buen día para una sesión exigente.");
  } else if (ctx.metrics && ctx.metrics.weekAU > 0) {
    bits.push(`Semana en marcha: ${ctx.metrics.weekAU} AU acumuladas. Mantén el ritmo y registra cada sesión.`);
  } else {
    bits.push("Aún no te conozco del todo: registra tus entrenos (con RPE) y tus mediciones, y este briefing se volverá tuyo de verdad.");
  }
  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null) {
    const over = ctx.weight - ctx.weighTarget;
    if (over > 0.3 && ctx.weighDays <= 10) {
      bits.push(`Pesaje en ${ctx.weighDays} días y vas ${over.toFixed(1)} kg por encima: déficit suave, sin recortes agresivos todavía.`);
    }
  }
  return bits.join(" ");
}

export type Rec = {
  id: string;
  icon: "load" | "weigh" | "rest" | "log";
  tone: "warn" | "info" | "good";
  title: string;
  why: string;
  action?: { label: string; href: string };
};

export function buildRecs(ctx: Ctx): Rec[] {
  const recs: Rec[] = [];
  const m = ctx.metrics;

  const band = m?.band ?? null;
  if (band && (band.status === "elevada" || band.status === "alta")) {
    recs.push({
      id: "carga-alta",
      icon: "load",
      tone: "warn",
      title: `Carga ${LOAD_BAND_META[band.status].label.toLowerCase()} esta semana`,
      why: `${LOAD_BAND_META[band.status].hint} Mete un día de técnica o descanso para volver a tu rango habitual.`,
      action: { label: "Ver carga", href: "/training/load" },
    });
  } else if (band && band.status === "descarga" && m && m.weekAU > 0 && ctx.recovery?.state !== "cuidado") {
    recs.push({
      id: "carga-baja",
      icon: "load",
      tone: "info",
      title: "Semana por debajo de tu rango",
      why: `${LOAD_BAND_META[band.status].hint} Si te encuentras bien, tienes margen para sumar una sesión.`,
      action: { label: "Ir a entrenar", href: "/training" },
    });
  }

  if (ctx.recovery?.state === "cuidado") {
    recs.push({
      id: "recuperacion",
      icon: "rest",
      tone: "warn",
      title: "Señales de recuperación bajas",
      why: `${ctx.recovery.chips.join(" · ")}. Prioriza dormir 8 h; si mañana sigue igual, recorta el volumen.`,
    });
  }

  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null && ctx.weight - ctx.weighTarget > 0.3) {
    recs.push({
      id: "pesaje",
      icon: "weigh",
      tone: ctx.weighDays <= 5 ? "warn" : "info",
      title: `${(ctx.weight - ctx.weighTarget).toFixed(1)} kg sobre el objetivo · pesaje en ${ctx.weighDays} d`,
      why: ctx.weighDays > 5
        ? "Margen razonable: mantén un déficit moderado. No recortes agua ni sodio por tu cuenta."
        : "Queda poco: revisa el plan con tu entrenador o un médico antes de cualquier corte agresivo.",
      action: { label: "Plan de pesaje", href: "/nutrition/weigh-in" },
    });
  }

  if (ctx.lastWeightDays != null && ctx.lastWeightDays >= 14) {
    recs.push({
      id: "peso-viejo",
      icon: "weigh",
      tone: "info",
      title: `Sin pesarte desde hace ${ctx.lastWeightDays} días`,
      why: "Con un pesaje cada 1-2 semanas tu tendencia y tus macros se mantienen fiables.",
      action: { label: "Apuntar peso", href: "/biometrics/new" },
    });
  }

  if ((m == null || m.weekAU === 0) && recs.length === 0) {
    recs.push({
      id: "empieza",
      icon: "log",
      tone: "info",
      title: "Registra tu primera sesión de la semana",
      why: "Con tus entrenos (duración + RPE) calculo tu carga frente a tu rango y te aviso antes de que te pases o te quedes corto.",
      action: { label: "Ir a entrenar", href: "/training" },
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "ok",
      icon: "load",
      tone: "good",
      title: "Sin avisos: todo en orden 👊",
      // Solo afirma carga sostenible y recuperación si de verdad hay datos de ambas
      why: band?.status === "sostenible" && ctx.recovery
        ? "Carga sostenible y recuperación correcta. Sigue tu plan y nos vemos mañana."
        : "Sin avisos por ahora. Cuantos más entrenos y mediciones registres, más fino seré.",
    });
  }
  return recs;
}

export function coachReply(text: string, ctx: Ctx): string {
  const low = text.toLowerCase();
  const m = ctx.metrics;
  const band = m?.band ?? null;
  const bandTxt = band
    ? `carga ${LOAD_BAND_META[band.status].label.toLowerCase()}${band.provisional ? " (provisional)" : ""}`
    : "carga aún sin rango (necesito ~14 días de sesiones)";
  if (/peso|pesaje|corte/.test(low)) {
    if (ctx.weight == null) return "Aún no tengo tu peso. Regístralo en Biometría y te sigo la tendencia.";
    if (ctx.weighTarget != null && ctx.weighDays != null) {
      const over = ctx.weight - ctx.weighTarget;
      return over > 0
        ? `Estás a ${over.toFixed(1)} kg del objetivo con ${ctx.weighDays} días de margen. Ritmo razonable: déficit moderado, sin recortar agua ni sodio por tu cuenta. Si hace falta un corte, que lo supervise tu entrenador o un médico.`
        : `Ya estás en el peso objetivo (${ctx.weighTarget} kg) con ${ctx.weighDays} días de margen. Mantén y llega fresco.`;
    }
    return `Tu último peso es ${ctx.weight.toFixed(1)} kg. Si tienes combate, configura el pesaje en Nutrición y te llevo el plan.`;
  }
  if (/fuerte|intens|sparring|entren|hoy/.test(low)) {
    if (ctx.recovery?.state === "cuidado") return `Hoy no es el día de matarte: ${ctx.recovery.chips.join(" y ")}. Técnica de calidad (RPE 5-6) y a dormir.`;
    if (band && (band.status === "elevada" || band.status === "alta")) return `Tu ${bandTxt} dice que llevas una subida fuerte. Mi llamada: sesión técnica hoy y la dura dentro de 2 días.`;
    if (ctx.recovery?.state === "listo") return `Recuperación por encima de tu media y ${bandTxt}: dale duro hoy, tienes margen. Calienta bien.`;
    return `Con lo que veo (${bandTxt}), un día normal de plan. Registra la sesión al acabar y ajusto el consejo.`;
  }
  if (/fatiga|cansad|dolor|recuper/.test(low)) {
    return ctx.recovery
      ? `Tus señales: ${ctx.recovery.chips.join(" · ")}. ${ctx.recovery.phrase}`
      : "No tengo tus señales de recuperación aún: registra FC en reposo y HRV unos días y te las leo cada mañana.";
  }
  if (/carga|acwr|riesgo/.test(low)) {
    return m && m.weekAU > 0
      ? `Semana: ${m.weekAU} AU, ${bandTxt}. ${band ? `${LOAD_BAND_META[band.status].hint} ` : ""}Míralo frente a tu rango habitual, no como un umbral fijo, y evita dos picos seguidos.`
      : "Aún no hay sesiones esta semana. Registra tus entrenos con RPE y te calculo carga y avisos.";
  }
  if (/cómo voy|como voy|resumen/.test(low)) {
    const parts: string[] = [];
    if (m && m.weekAU > 0) parts.push(`semana ${m.weekAU} AU, ${bandTxt}`);
    if (ctx.recovery) parts.push(`recuperación: ${ctx.recovery.label.toLowerCase()}`);
    if (ctx.weight != null) parts.push(`peso ${ctx.weight.toFixed(1)} kg${ctx.weighTarget != null ? ` (objetivo ${ctx.weighTarget})` : ""}`);
    return parts.length > 0 ? `Tu foto de hoy: ${parts.join(" · ")}. ¿Quieres el plan del día?` : "Aún no tengo datos tuyos. Empieza registrando un entreno o tu peso y hablamos.";
  }
  if (/gracias|ok|vale|genial/.test(low)) return "A trabajar. Registra la sesión cuando acabes y la cuento en tu carga. 🥊";
  return `Te leo. Pregúntame por el entreno de hoy, tu carga, tu peso o tu recuperación — te contesto con tus números reales.`;
}

