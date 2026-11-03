// Textos de la carga de entreno según el anexo de combate (E.5): la semana frente a la media de
// 4 semanas en palabras neutras, sin hablar de zonas seguras ni de riesgo de lesión, y sin ratio hasta
// tener 28 días de historial. Los usan la página de Carga, la Home, Entreno y el Coach.

import type { useTranslations } from "next-intl";
import type { LoadMetrics } from "./load";
import { COMBAT_RULES, type RuleRef } from "./combat-rules";

type Tr = ReturnType<typeof useTranslations>;

/** Convención de FightLab (sin revisar): desde qué % sobre la media se habla de "salto grande". */
export const BIG_JUMP_PCT = 30;

export type LoadState =
  | { kind: "empty" }
  | { kind: "building"; daysLeft: number; have: number }
  | { kind: "paused" }
  | { kind: "ratio"; pct: number; ratio: number; gaps: boolean };

export function loadState(m: LoadMetrics | null): LoadState {
  if (m && m.acwr != null && m.weekVsAvgPct != null) {
    return { kind: "ratio", pct: m.weekVsAvgPct, ratio: m.acwr, gaps: m.gaps };
  }
  if (!m || m.historyDays === 0) return { kind: "empty" };
  if (m.ratioDaysLeft > 0) return { kind: "building", daysLeft: m.ratioDaysLeft, have: m.historyDays };
  return { kind: "paused" };
}

export const isBigJump = (m: LoadMetrics | null) => m?.weekVsAvgPct != null && m.weekVsAvgPct >= BIG_JUMP_PCT;

/** "12 % por encima de tu media de 4 semanas" (página de Carga). `tl` = `useTranslations("load")`. */
export function comparisonLong(pct: number, tl: Tr): string {
  if (pct > 0) return tl("up", { pct });
  if (pct < 0) return tl("down", { pct: -pct });
  return tl("equal");
}

/** "+12 % vs tu media" o "faltan 5 d" (tarjetas pequeñas). */
export function comparisonShort(m: LoadMetrics | null, tl: Tr): string | null {
  const s = loadState(m);
  if (s.kind === "ratio") {
    if (s.pct > 0) return tl("short.up", { pct: s.pct });
    if (s.pct < 0) return tl("short.down", { pct: -s.pct });
    return tl("short.equal");
  }
  if (s.kind === "building") return tl("short.daysLeft", { days: s.daysLeft });
  return null;
}

/** La regla que respalda el número que se ve en cada estado. */
export function comparisonRule(m: LoadMetrics | null): RuleRef | null {
  const s = loadState(m);
  if (s.kind === "ratio") return COMBAT_RULES.comparison;
  if (s.kind === "building") return COMBAT_RULES.ratio28;
  return null;
}

/** Trozo de frase para el chat y el resumen del Coach ("+12 % sobre tu media de 4 semanas"). */
export function comparisonPhrase(m: LoadMetrics | null, tl: Tr): string {
  const s = loadState(m);
  switch (s.kind) {
    case "ratio":
      if (s.pct > 0) return tl("coach.comparisonUp", { pct: s.pct });
      if (s.pct < 0) return tl("coach.comparisonDown", { pct: -s.pct });
      return tl("coach.comparisonEqual");
    case "building":
      return tl("coach.daysLeft", { days: s.daysLeft });
    case "paused":
      return tl("coach.paused");
    default:
      return tl("coach.pending");
  }
}

/** Insignia del Coach: "+12 % vs tu media", "Carga: faltan 5 d" o "Carga —". */
export function loadBadge(m: LoadMetrics | null, tl: Tr): string {
  const s = loadState(m);
  if (s.kind === "building") return tl("coach.badgeDays", { days: s.daysLeft });
  return comparisonShort(m, tl) ?? tl("coach.badgeNone");
}

/** Cita `[[regla:clave]]` para las respuestas por reglas del chat. */
export const cite = (r: RuleRef) => ` [[regla:${r.key}]]`;

/** Las citas de un texto con `[[regla:…]]` de las reglas de combate, con su grado. */
export function combatCitations(text: string): { key: string; grade: string; title: string }[] {
  const all = Object.values(COMBAT_RULES) as RuleRef[];
  return all.filter((r) => text.includes(`[[regla:${r.key}]]`)).map((r) => ({ key: r.key, grade: r.grade, title: "" }));
}
