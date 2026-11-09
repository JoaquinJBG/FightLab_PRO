import type { SyncSet } from "./activities";
import { setIssue } from "./gym-log";

// Tipos, biblioteca de ejercicios y persistencia local del gimnasio.
// (localStorage por ahora; pasa al backend con Exercise/WorkoutSession en fase 3)

import type { ServerActivity, SyncItem } from "./activities";

/** Tipos de serie del contrato de F17. */
export type SetType = "warmup" | "normal" | "drop" | "failure";

/** Una serie mientras se registra (texto tal cual se escribe). `type`, `rpe` y `rir` son de F17:
    las sesiones guardadas antes no los tienen. */
export type SetEntry = {
  kg: string;
  reps: string;
  done: boolean;
  type?: SetType;
  rpe?: string;
  rir?: string;
  pr?: ("weight" | "e1rm" | "volume" | "reps")[]; // récords batidos con esta serie
};
/** Un ejercicio del entreno. `key` es la clave del contrato (`cat:…` o `custom:…`); `restS`, el
    descanso tras sus series; `superset`, el grupo de superserie (null: suelto). */
export type ExerciseEntry = {
  name: string;
  sets: SetEntry[];
  key?: string | null;
  notes?: string;
  restS?: number | null;
  superset?: number | null;
};

/** Una serie guardada. */
export type SavedSet = { kg: number; reps: number; type?: SetType; rpe?: number | null; rir?: number | null };
export type SavedExercise = {
  name: string;
  sets: SavedSet[];
  key?: string | null;
  notes?: string;
  restS?: number | null;
  superset?: number | null;
};

export type GymSession = {
  id: string;
  client_id?: string; // misma identidad en el dispositivo y en el servidor
  ts: number;
  focus: string | null;
  durationSec: number;
  rpe: number | null;
  load: number | null; // sRPE: min × RPE (AU)
  volume: number; // kg totales levantados (Σ kg × reps)
  exercises: SavedExercise[];
  /** Id de la sesión en el servidor (para abrir su detalle). */
  serverId?: number;
};

export type LiveGym = {
  startedAt: number;
  focus: string | null;
  exercises: ExerciseEntry[];
  savedAt: number;
  plan?: string | null; // sesión del plan de la semana ("A", "B")
  routine?: { id: number; title: string } | null; // rutina de la que salió (F17)
  restUntil?: number | null; // fin del descanso en marcha (sigue en segundo plano)
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

/* Claves i18n de los textos de dominio. Los ids guardados (localStorage/servidor)
   siguen siendo los nombres en español: aquí solo se mapean a claves de catálogo. */
export const EXERCISE_KEYS: Record<string, string> = {
  "Press banca": "benchPress",
  "Press inclinado": "inclinePress",
  "Press con mancuernas": "dumbbellPress",
  Aperturas: "flyes",
  Fondos: "dips",
  Dominadas: "pullUps",
  "Jalón al pecho": "latPulldown",
  "Remo con barra": "barbellRow",
  "Remo en máquina": "machineRow",
  "Peso muerto": "deadlift",
  "Face pull": "facePull",
  Sentadilla: "squat",
  Prensa: "legPress",
  "Peso muerto rumano": "romanianDeadlift",
  Zancadas: "lunges",
  "Extensión de cuádriceps": "legExtension",
  "Curl femoral": "legCurl",
  Gemelos: "calfRaises",
  "Press militar": "overheadPress",
  "Elevaciones laterales": "lateralRaises",
  Pájaros: "rearDeltFlyes",
  "Press Arnold": "arnoldPress",
  "Curl bíceps": "bicepsCurl",
  "Curl martillo": "hammerCurl",
  "Extensión de tríceps": "tricepsExtension",
  "Press francés": "skullCrushers",
  Plancha: "plank",
  "Crunch en polea": "cableCrunch",
  "Rueda abdominal": "abWheel",
  "Elevaciones de piernas": "legRaises",
  Remo: "row",
  "Extensión tríceps": "tricepsExtensionShort",
};

export const FOCUS_KEYS: Record<string, string> = {
  Descanso: "rest",
  "Full body": "fullBody",
  Empuje: "push",
  Tirón: "pull",
  Pierna: "legs",
  Torso: "upper",
  Pecho: "chest",
  Espalda: "back",
  Hombro: "shoulders",
  Brazo: "arms",
  Cardio: "cardio",
  Core: "core",
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

/** Lee el desglose en formato completo (`exercises`) o compacto (`ex`). */
function exercisesFromDetail(detail: Record<string, unknown> | null | undefined): GymSession["exercises"] {
  if (Array.isArray(detail?.exercises)) return detail.exercises as GymSession["exercises"];
  if (!Array.isArray(detail?.ex)) return [];
  return (detail.ex as { n?: unknown; s?: unknown }[])
    .filter((e) => typeof e?.n === "string" && Array.isArray(e.s))
    .map((e) => ({
      name: e.n as string,
      sets: (e.s as unknown[]).flatMap((p) =>
        Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" ? [{ kg: p[0], reps: p[1] }] : [],
      ),
    }));
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
  const exercises = exercisesFromDetail(detail);
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

/** Serie previa (misma posición) de un ejercicio, para logging estilo Hevy:
    la sesión completada más reciente que incluya ese ejercicio, tomando la
    serie del mismo índice (o la última registrada si esa sesión tuvo menos
    series). Sirve para pintar "anterior: 80 kg × 8" y rellenar con un toque. */
export function previousSet(
  name: string,
  setIndex: number,
  sessions: GymSession[] = loadGymSessions(),
): { kg: number; reps: number } | null {
  for (const s of sessions) {
    const ex = s.exercises.find((e) => e.name === name);
    if (!ex || ex.sets.length === 0) continue;
    const set = ex.sets[setIndex] ?? ex.sets[ex.sets.length - 1];
    return { kg: set.kg, reps: set.reps };
  }
  return null;
}

/** Texto corto para el chip "anterior": "80 kg × 8" o, en ejercicios a peso
    corporal (0 kg), solo "8 reps". null si no hay serie previa. */
export function formatSetPreview(set: { kg: number; reps: number } | null): string | null {
  if (!set) return null;
  return set.kg > 0 ? `${set.kg} kg × ${set.reps}` : `${set.reps} reps`;
}

/* ------------------------- Qué se guarda al terminar ------------------------ */

export const MAX_DETAIL_CHARS = 8000; // margen bajo el tope del backend (8192, activities/serializers.py)
export const DEFAULT_RPE = 7;

const num = (v: string) => parseFloat(v.replace(",", "."));
const optNum = (v: string | undefined) => (v !== undefined && v.trim() !== "" && Number.isFinite(num(v)) ? num(v) : null);

/** Lo que se guarda (y lo que enseña el resumen, que sale de aquí mismo): las series marcadas ✓
    con reps > 0 y sin valores imposibles (`setIssue`, fallo F2). kg en blanco = peso corporal (0). */
export function savedExercises(exercises: ExerciseEntry[]): SavedExercise[] {
  return exercises
    .map((x) => {
      const out: SavedExercise = {
        name: x.name,
        sets: x.sets
          .filter((s) => s.done && Number.isFinite(parseInt(s.reps, 10)) && parseInt(s.reps, 10) > 0 && setIssue(s)?.level !== "error")
          .map((s) => {
            const set: SavedSet = { kg: Number.isFinite(num(s.kg)) ? num(s.kg) : 0, reps: parseInt(s.reps, 10) };
            if (s.type && s.type !== "normal") set.type = s.type;
            const rpe = optNum(s.rpe);
            const rir = optNum(s.rir);
            if (rpe !== null) set.rpe = rpe;
            if (rir !== null) set.rir = rir;
            return set;
          }),
      };
      if (x.key) out.key = x.key;
      if (x.notes?.trim()) out.notes = x.notes.trim();
      if (x.restS != null) out.restS = x.restS;
      if (x.superset != null) out.superset = x.superset;
      return out;
    })
    .filter((x) => x.sets.length > 0);
}

export function sessionTotals(saved: GymSession["exercises"]): { totalSets: number; volume: number } {
  const totalSets = saved.reduce((a, x) => a + x.sets.length, 0);
  const volume = Math.round(saved.reduce((a, x) => a + x.sets.reduce((b, s) => b + s.kg * s.reps, 0), 0));
  return { totalSets, volume };
}

const isBlankSet = (s: SetEntry) => s.kg.trim() === "" && s.reps.trim() === "" && !s.done;

/** Deshace un "quitar ejercicio". Si el ejercicio se volvió a añadir mientras
    tanto, las series recuperadas se unen a las nuevas (sin las vacías). */
export function restoreExercise(xs: ExerciseEntry[], ex: ExerciseEntry, index: number): ExerciseEntry[] {
  const at = xs.findIndex((x) => x.name === ex.name);
  if (at === -1) return [...xs.slice(0, index), ex, ...xs.slice(index)];
  const merged = [...ex.sets, ...xs[at].sets.filter((s) => !isBlankSet(s))];
  return xs.map((x, i) => (i === at ? { ...x, sets: merged } : x));
}

/** Series que el usuario podría creer guardadas y no lo serán. `impossible`: marcadas ✓ con un
    valor que el servidor no admite (fallo F2): se avisa, no se pierden en silencio. */
export function incompleteSets(exercises: ExerciseEntry[]): { tickedEmpty: number; unticked: number; impossible: number } {
  let tickedEmpty = 0;
  let unticked = 0;
  let impossible = 0;
  for (const x of exercises) {
    for (const s of x.sets) {
      const reps = parseInt(s.reps, 10);
      const hasReps = Number.isFinite(reps) && reps > 0;
      if (s.done && !hasReps) tickedEmpty++;
      else if (s.done && setIssue(s)?.level === "error") impossible++;
      else if (!s.done && (s.kg.trim() !== "" || s.reps.trim() !== "")) unticked++;
    }
  }
  return { tickedEmpty, unticked, impossible };
}

/** `detail` para el backend. Si el desglose completo no cabe se compacta
    (claves cortas, números); si aun así no cabe, `breakdown` es false y el
    llamante debe avisar al usuario: nunca se descarta en silencio. */
export function buildActivityDetail(
  focus: string | null,
  volume: number,
  saved: GymSession["exercises"],
  max = MAX_DETAIL_CHARS,
): { detail: Record<string, unknown>; breakdown: boolean } {
  const fits = (d: Record<string, unknown>) => JSON.stringify(d).length <= max;
  const full = { focus, volume_kg: volume, exercises: saved };
  if (fits(full)) return { detail: full, breakdown: true };
  const compact = { focus, volume_kg: volume, ex: saved.map((x) => ({ n: x.name, s: x.sets.map((s) => [s.kg, s.reps]) })) };
  if (fits(compact)) return { detail: compact, breakdown: true };
  return { detail: { focus, volume_kg: volume }, breakdown: false };
}

const MAX_SYNC_SETS = 300;

/** Series de una sesión para `SetLog` (Task 6.1). 0 kg es una serie con el peso corporal
 * (`weight_kg: null`, como en el coach); las series sin repeticiones o con carga ilegible se
 * descartan, no se adivinan. */
export function gymSets(exercises: unknown[]): SyncSet[] {
  const out: SyncSet[] = [];
  exercises.forEach((raw, ei) => {
    const ex = raw as { name?: unknown; sets?: unknown } | null;
    const name = ex?.name;
    const sets = ex?.sets;
    if (typeof name !== "string" || !name.trim() || !Array.isArray(sets)) return;
    const meta = raw as { key?: unknown; notes?: unknown; restS?: unknown; superset?: unknown };
    sets.forEach((rawSet, si) => {
      const s = rawSet as { kg?: unknown; reps?: unknown; type?: unknown; rpe?: unknown; rir?: unknown };
      const kg = typeof s?.kg === "number" ? s.kg : Number.NaN;
      const reps = typeof s?.reps === "number" ? s.reps : Number.NaN;
      if (!Number.isInteger(reps) || reps <= 0 || reps > 1000) return;
      if (!Number.isFinite(kg) || kg < 0 || kg > 1000) return;
      const row: SyncSet = { exercise: name.trim().slice(0, 120), exercise_index: ei, set_index: si, weight_kg: kg > 0 ? kg : null, reps };
      if (typeof meta.key === "string" && meta.key) row.exercise_key = meta.key;
      if (typeof s.type === "string" && s.type !== "normal") row.set_type = s.type as SetType;
      if (typeof s.rpe === "number") row.rpe = s.rpe;
      if (typeof s.rir === "number") row.rir = s.rir;
      if (typeof meta.superset === "number") row.superset = meta.superset;
      if (typeof meta.notes === "string" && meta.notes) row.notes = meta.notes.slice(0, 1000);
      if (typeof meta.restS === "number") row.rest_s = meta.restS;
      out.push(row);
    });
  });
  return out.slice(0, MAX_SYNC_SETS);
}
