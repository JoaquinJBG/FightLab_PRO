"use client";

// Estado de seguridad de hoy (R4-10, R4-13): una sola fuente de verdad para todas las pantallas.
//
// Lo calcula el servidor (`coaching/safety_state.py`, en `GET /coach/safety` → `state`): golpe en
// la cabeza, lesión o dolor nuevo, «para y consulta» y los límites del cribado, con su motivo, su
// vigencia y su regla, y si hoy se puede hacer algo vigoroso (la misma regla que el plan y Mi
// rutina). Hoy, Inicio, Coach, Carga y Deportes leen solo esto: ninguna pantalla decide por su
// cuenta si se está «listo para entrenar» o si se ofrece «Intenso».

import { useSafety } from "./hooks";
import type { Safety, SafetyStateItem } from "./schemas";

export type SafetyLevel = "ok" | "caution" | "stop";

export type TodaySafety = {
  level: SafetyLevel;
  noContact: boolean;
  noTraining: boolean;
  /** ¿Se puede ofrecer trabajo vigoroso («Intenso», HIIT, sparring duro…)? */
  vigorousAllowed: boolean;
  vigorousBlockedBy: string[];
  active: SafetyStateItem[];
  /** Zonas de las lesiones activas (para el Coach). */
  injuries: string[];
};

/** El estado de hoy de `/coach/safety`. Un servidor sin `state` (anterior a R4-13) solo da los
 * flags: se leen igual, del lado prudente. `null` mientras carga. */
export function todaySafety(safety: Safety | undefined | null): TodaySafety | null {
  if (!safety) return null;
  const s = safety.state;
  if (s) {
    return {
      level: s.level,
      noContact: s.no_contact,
      noTraining: s.no_training,
      vigorousAllowed: s.vigorous.allowed,
      vigorousBlockedBy: s.vigorous.blocked_by,
      active: s.active,
      injuries: s.active
        .filter((a) => a.kind === "injury")
        .map((a) => a.params.area)
        .filter((a): a is string => typeof a === "string" && a.trim() !== ""),
    };
  }
  const f = safety.flags ?? {};
  const blocked: string[] = ["no_training", "review_before_vigorous", "cap_moderate"].filter((k) => f[k]);
  if (f.no_contact) blocked.push("head_blow_return");
  const injuries = (safety.reasons ?? [])
    .filter((r) => r.code === "injury_unassessed" || r.code === "injury_managed")
    .map((r) => r.params.area)
    .filter((a): a is string => typeof a === "string" && a.trim() !== "");
  return {
    level: f.no_training ? "stop" : blocked.length || f.no_contact || injuries.length ? "caution" : "ok",
    noContact: !!f.no_contact,
    noTraining: !!f.no_training,
    vigorousAllowed: blocked.length === 0,
    vigorousBlockedBy: blocked,
    active: [],
    injuries,
  };
}

export function useTodaySafety(): TodaySafety | null {
  const { data } = useSafety();
  return todaySafety(data);
}

/** ¿Se puede decir hoy «Listo para entrenar» (buen día para trabajo exigente)? Solo sin nada
 * activo y con lo vigoroso permitido. Mientras carga, no. */
export function canSayReady(s: TodaySafety | null): boolean {
  return !!s && s.level === "ok" && s.vigorousAllowed;
}
