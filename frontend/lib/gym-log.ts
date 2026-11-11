// Registro del gimnasio (F17, rama H): lo que se valida al escribir una serie, la calculadora
// de discos, los récords durante el entreno y las superseries. Funciones puras, sin React.

import type { ExerciseEntry, SetEntry, SetType } from "./gym";

/* ------------------------------ números (F2) ------------------------------ */

// Límites del servidor (activities/serializers.py): por encima, la serie no se puede guardar.
export const KG_MAX = 1000;
export const REPS_MAX = 1000;
// Por encima de esto es raro (prensa o arrastre, como mucho): se avisa, pero se deja guardar.
export const KG_HIGH = 500;
export const REPS_HIGH = 100;

/** Lo que admite el campo de peso: cifras y UN separador decimal (coma o punto), como mucho
    4 cifras enteras y 2 decimales. «9295,.» se queda en «9295,» (fallo F2). */
export function sanitizeDecimal(raw: string): string {
  let out = "";
  let sep = false;
  let ints = 0;
  let decs = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (sep ? decs >= 2 : ints >= 4) continue;
      out += ch;
      if (sep) decs++;
      else ints++;
    } else if ((ch === "," || ch === ".") && !sep) {
      sep = true;
      out += ch;
    }
  }
  return out;
}

/** Repeticiones: solo cifras, como mucho 4. */
export const sanitizeInt = (raw: string) => raw.replace(/\D/g, "").slice(0, 4);

/** El número de un campo con coma o punto (NaN si no se puede leer, null si está vacío). */
export function parseNum(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export type SetIssue = { level: "error" | "warn"; code: "kgMax" | "kgBad" | "repsMax" | "rpeRange" | "rirRange" | "kgHigh" | "repsHigh" };

/** Qué le pasa a una serie: `error` no se puede guardar (el ✓ se bloquea y no cuenta);
    `warn` es un valor poco habitual que se deja guardar con aviso. */
export function setIssue(s: Pick<SetEntry, "kg" | "reps" | "rpe" | "rir">): SetIssue | null {
  const kg = parseNum(s.kg);
  const reps = parseNum(s.reps);
  const rpe = parseNum(s.rpe);
  const rir = parseNum(s.rir);
  if (kg !== null && Number.isNaN(kg)) return { level: "error", code: "kgBad" };
  if (kg !== null && kg > KG_MAX) return { level: "error", code: "kgMax" };
  if (reps !== null && (Number.isNaN(reps) || reps > REPS_MAX)) return { level: "error", code: "repsMax" };
  if (rpe !== null && (Number.isNaN(rpe) || rpe < 1 || rpe > 10)) return { level: "error", code: "rpeRange" };
  if (rir !== null && (Number.isNaN(rir) || rir < 0 || rir > 10)) return { level: "error", code: "rirRange" };
  if (kg !== null && kg > KG_HIGH) return { level: "warn", code: "kgHigh" };
  if (reps !== null && reps > REPS_HIGH) return { level: "warn", code: "repsHigh" };
  return null;
}

/* ---------------------------- tipos de serie ----------------------------- */

export const SET_TYPES: SetType[] = ["normal", "warmup", "drop", "failure"];

/** Al tocar el número de la serie: normal → calentamiento → drop → al fallo → normal. */
export function nextSetType(t: SetType | undefined): SetType {
  const i = SET_TYPES.indexOf(t ?? "normal");
  return SET_TYPES[(i + 1) % SET_TYPES.length];
}

/** La etiqueta de la serie, como Hevy: su número entre las series normales o, si no es
    normal, su tipo (la pantalla lo traduce a una letra). */
export function setLabels(sets: Pick<SetEntry, "type">[]): string[] {
  let n = 0;
  return sets.map((s) => {
    const t = s.type ?? "normal";
    return t === "normal" ? String(++n) : t;
  });
}

/* ------------------------- calculadora de discos ------------------------- */

export const DEFAULT_BAR_KG = 20;
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const PLATES_KEY = "flp_gym_plates";

export type PlateSettings = { bar: number; plates: number[] };

/** Los discos de cada lado para cargar `target` en una barra de `bar` kg con los discos que
    hay (se pueden repetir). Lo que no cuadra queda en `remainder` (por lado). null si el peso
    está por debajo de la barra. */
export function platesFor(target: number, bar: number, available: number[]): { perSide: number[]; remainder: number } | null {
  if (!Number.isFinite(target) || target < bar) return null;
  let left = Math.round(((target - bar) / 2) * 1000) / 1000;
  const perSide: number[] = [];
  for (const p of [...available].filter((x) => x > 0).sort((a, b) => b - a)) {
    while (left + 1e-9 >= p && perSide.length < 40) {
      perSide.push(p);
      left = Math.round((left - p) * 1000) / 1000;
    }
  }
  return { perSide, remainder: left };
}

export function loadPlateSettings(): PlateSettings {
  try {
    const v = JSON.parse(localStorage.getItem(PLATES_KEY) ?? "null") as PlateSettings | null;
    if (v && typeof v.bar === "number" && Array.isArray(v.plates)) return v;
  } catch { /* noop */ }
  return { bar: DEFAULT_BAR_KG, plates: DEFAULT_PLATES };
}

export function savePlateSettings(s: PlateSettings) {
  try { localStorage.setItem(PLATES_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

/* ------------------------- récords en el entreno ------------------------- */

/** Los récords de un ejercicio antes de este entreno (`GET gym/records`). */
export type PriorRecords = {
  max_weight_kg: number | null;
  best_e1rm_kg: number | null;
  best_set_volume_kg: number | null;
  reps_by_weight: { weight_kg: number | null; reps: number }[];
  sessions: number;
};

export type RecordKind = "weight" | "e1rm" | "volume" | "reps";
export type DoneSet = { kg: number; reps: number; type?: SetType; rir?: number | null; rpe?: number | null };

/** e1RM de la serie: Epley con las repeticiones en reserva (convención del coach, la misma del
    servidor). null sin carga o sin repeticiones. */
export function e1rm(s: DoneSet): number | null {
  if (!(s.kg > 0) || !(s.reps >= 1)) return null;
  const rir = s.rir ?? (s.rpe != null ? 10 - s.rpe : 0);
  const total = s.reps + Math.max(0, rir);
  return total === 1 ? s.kg : s.kg * (1 + total / 30);
}

/** Qué récords bate una serie recién hecha, frente a lo de antes y a lo ya hecho hoy. Como
    Hevy, los calentamientos no cuentan y la primera vez que se hace un ejercicio no es récord. */
export function detectRecords(set: DoneSet, prior: PriorRecords | null, today: DoneSet[]): RecordKind[] {
  if (!prior || prior.sessions < 1 || (set.type ?? "normal") === "warmup" || !(set.kg > 0) || !(set.reps > 0)) return [];
  const work = today.filter((s) => (s.type ?? "normal") !== "warmup" && s.kg > 0 && s.reps > 0);
  const best = (v: number | null | undefined, xs: number[]) => Math.max(v ?? 0, ...xs);
  const out: RecordKind[] = [];
  if (set.kg > best(prior.max_weight_kg, work.map((s) => s.kg))) out.push("weight");
  const e = e1rm(set) ?? 0;
  if (e > best(prior.best_e1rm_kg, work.map((s) => e1rm(s) ?? 0)) + 1e-9) out.push("e1rm");
  if (set.kg * set.reps > best(prior.best_set_volume_kg, work.map((s) => s.kg * s.reps))) out.push("volume");
  const atWeight = prior.reps_by_weight.find((r) => r.weight_kg === set.kg);
  if (atWeight && set.reps > best(atWeight.reps, work.filter((s) => s.kg === set.kg).map((s) => s.reps))) out.push("reps");
  return out;
}

/* ------------------------------ superseries ------------------------------ */

/** Letra de cada superserie (A, B…) por orden de aparición. */
export function supersetGroups(xs: Pick<ExerciseEntry, "superset">[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const x of xs) {
    if (x.superset == null || out[x.superset] !== undefined) continue;
    out[x.superset] = String.fromCharCode(65 + Object.keys(out).length);
  }
  return out;
}

/** A qué ejercicio se pasa tras una serie de una superserie: el siguiente del grupo o, desde el
    último, vuelta al primero (`last`: ahí toca el descanso). null fuera de una superserie. */
export function nextInSuperset(xs: Pick<ExerciseEntry, "superset">[], index: number): { index: number; last: boolean } | null {
  const group = xs[index]?.superset;
  if (group == null) return null;
  const members = xs.map((x, i) => (x.superset === group ? i : -1)).filter((i) => i >= 0);
  if (members.length < 2) return null;
  const pos = members.indexOf(index);
  return pos === members.length - 1 ? { index: members[0], last: true } : { index: members[pos + 1], last: false };
}

/** Un número de superserie libre. */
export function freeSuperset(xs: Pick<ExerciseEntry, "superset">[]): number {
  const used = new Set(xs.map((x) => x.superset).filter((v): v is number => v != null));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
