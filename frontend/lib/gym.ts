// Tipos, biblioteca de ejercicios y persistencia local del gimnasio.
// (localStorage por ahora; pasa al backend con Exercise/WorkoutSession en fase 3)

import type { ServerActivity, SyncItem } from "./activities";

export type SetEntry = { kg: string; reps: string; done: boolean };
export type ExerciseEntry = { name: string; sets: SetEntry[] };

export type GymSession = {
  id: string;
  client_id?: string; // misma identidad en el dispositivo y en el servidor
  ts: number;
  focus: string | null;
  durationSec: number;
  rpe: number | null;
  load: number | null; // sRPE: min × RPE (AU)
  volume: number; // kg totales levantados (Σ kg × reps)
  exercises: { name: string; sets: { kg: number; reps: number }[] }[];
};

export type LiveGym = {
  startedAt: number;
  focus: string | null;
  exercises: ExerciseEntry[];
  savedAt: number;
};

export const GYM_SESS_KEY = "flp_gym_sessions";
export const GYM_LIVE_KEY = "flp_gym_live";
export const GYM_REST_KEY = "flp_gym_rest";

export const LIBRARY: { group: string; items: string[] }[] = [
  { group: "Pecho", items: ["Press banca", "Press inclinado", "Press con mancuernas", "Aperturas", "Fondos"] },
  { group: "Espalda", items: ["Dominadas", "Jalón al pecho", "Remo con barra", "Remo en máquina", "Peso muerto", "Face pull"] },
  { group: "Pierna", items: ["Sentadilla", "Prensa", "Peso muerto rumano", "Zancadas", "Extensión de cuádriceps", "Curl femoral", "Gemelos"] },
  { group: "Hombro", items: ["Press militar", "Elevaciones laterales", "Pájaros", "Press Arnold"] },
  { group: "Brazo", items: ["Curl bíceps", "Curl martillo", "Extensión de tríceps", "Press francés"] },
  { group: "Core", items: ["Plancha", "Crunch en polea", "Rueda abdominal", "Elevaciones de piernas"] },
];

// Ejercicios de arranque según el foco del calendario
export const FOCUS_EXERCISES: Record<string, string[]> = {
  "Full body": ["Sentadilla", "Press banca", "Remo con barra", "Press militar"],
  Empuje: ["Press banca", "Press militar", "Fondos", "Extensión de tríceps"],
  Tirón: ["Dominadas", "Remo con barra", "Curl bíceps", "Face pull"],
  Pierna: ["Sentadilla", "Peso muerto rumano", "Prensa", "Gemelos"],
  Torso: ["Press banca", "Remo con barra", "Press militar", "Dominadas"],
  Pecho: ["Press banca", "Press inclinado", "Aperturas", "Fondos"],
  Espalda: ["Dominadas", "Remo con barra", "Jalón al pecho", "Peso muerto"],
  Hombro: ["Press militar", "Elevaciones laterales", "Pájaros", "Face pull"],
  Brazo: ["Curl bíceps", "Extensión de tríceps", "Curl martillo", "Fondos"],
};

export function loadGymSessions(): GymSession[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(GYM_SESS_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function pushGymSession(s: GymSession) {
  const all = [s, ...loadGymSessions()].slice(0, 200);
  localStorage.setItem(GYM_SESS_KEY, JSON.stringify(all));
}

/** Reconstruye una GymSession a partir de la actividad guardada en el
    servidor o de un item aún en la cola pendiente (misma forma que guarda
    `save()` en gym/session). Si el detail se recortó por tamaño (>8 KB) solo
    trae focus/volumen, sin desglose de ejercicios (sin PR de esa sesión). */
function gymSessionFromDetail(
  clientId: string | null | undefined,
  ts: number,
  durationSec: number,
  rpe: number | null,
  detail: Record<string, unknown> | null | undefined,
): GymSession {
  const focus = typeof detail?.focus === "string" ? detail.focus : null;
  const volume = typeof detail?.volume_kg === "number" ? detail.volume_kg : 0;
  const exercises = Array.isArray(detail?.exercises) ? (detail.exercises as GymSession["exercises"]) : [];
  return {
    id: clientId ?? `srv-${ts}`,
    client_id: clientId ?? undefined,
    ts,
    focus,
    durationSec,
    rpe,
    load: rpe ? Math.round((durationSec / 60) * rpe) : null,
    volume,
    exercises,
  };
}

/** Fin de sesión (ts) a partir del inicio + duración del servidor. */
const endTs = (startedAt: string, durationSec: number) => new Date(startedAt).getTime() + durationSec * 1000;

export function gymSessionFromServer(a: ServerActivity): GymSession {
  return gymSessionFromDetail(a.client_id, endTs(a.started_at, a.duration_sec), a.duration_sec, a.rpe, a.detail);
}

export function gymSessionFromPending(item: SyncItem): GymSession {
  return gymSessionFromDetail(
    item.client_id,
    endTs(item.started_at, item.duration_sec),
    item.duration_sec,
    item.rpe ?? null,
    item.detail,
  );
}

/** "Última vez" y PR (kg máximo histórico) de un ejercicio, sobre el
    historial dado (por defecto, solo el local de este dispositivo). Pásale el
    historial fusionado con el servidor para que funcione en otro dispositivo. */
export function exerciseStats(
  name: string,
  sessions: GymSession[] = loadGymSessions(),
): { last: string | null; prKg: number | null } {
  let prKg: number | null = null;
  let last: string | null = null;
  for (const s of sessions) {
    const ex = s.exercises.find((e) => e.name === name);
    if (!ex || ex.sets.length === 0) continue;
    for (const set of ex.sets) {
      if (set.kg > 0 && (prKg === null || set.kg > prKg)) prKg = set.kg; // bodyweight (0 kg) no es PR
    }
    if (last === null) {
      const top = ex.sets.reduce((a, b) => (b.kg > a.kg ? b : a), ex.sets[0]);
      last = `${ex.sets.length}×${top.reps}${top.kg > 0 ? ` · ${top.kg} kg` : ""}`;
    }
  }
  return { last, prKg };
}
