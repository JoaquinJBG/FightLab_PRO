// Datos corporales del atleta sin valores inventados: si falta alguno, se
// devuelve null y la pantalla lo pide en vez de calcular con un supuesto.

export type BodyLog = { weight_kg: string | null; timestamp?: string };

const weightOf = (l: BodyLog) => {
  const w = l.weight_kg ? parseFloat(l.weight_kg) : NaN;
  return Number.isFinite(w) && w > 0 ? w : null;
};

/** El día local (AAAA-MM-DD) de una medida. */
export function localDay(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DayWeight = { day: string; kg: number; count: number; t: number };

/** F28: el peso de cada día es la media de los pesajes de ese día, con cuántos hubo; es el mismo
 * criterio que el servidor (`daily_weights`) y que la tendencia del motor (medias diarias). Más
 * antiguo primero; `t` es la hora del último pesaje del día. */
export function dailyWeights(logs: (BodyLog & { timestamp: string })[]): DayWeight[] {
  const byDay = new Map<string, { sum: number; count: number; t: number }>();
  for (const l of logs) {
    const w = weightOf(l);
    const t = new Date(l.timestamp).getTime();
    if (w === null || !Number.isFinite(t)) continue;
    const day = localDay(l.timestamp);
    const acc = byDay.get(day) ?? { sum: 0, count: 0, t };
    byDay.set(day, { sum: acc.sum + w, count: acc.count + 1, t: Math.max(acc.t, t) });
  }
  return [...byDay.entries()]
    .map(([day, a]) => ({ day, kg: Math.round((a.sum / a.count) * 100) / 100, count: a.count, t: a.t }))
    .sort((a, b) => a.t - b.t);
}

/** El peso del último día con pesaje (la media de ese día). Sin fechas, el primer peso de la lista. */
export function latestWeightKg(logs: BodyLog[]): number | null {
  if (logs.length > 0 && logs.every((l) => typeof l.timestamp === "string")) {
    const days = dailyWeights(logs as (BodyLog & { timestamp: string })[]);
    return days.length ? days[days.length - 1].kg : null;
  }
  for (const l of logs) {
    const w = weightOf(l);
    if (w !== null) return w;
  }
  return null;
}

export function ageFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a > 0 && a < 120 ? a : null;
}

export type NutritionInputs = { weight: number; height: number; age: number };

export function nutritionInputs(
  logs: BodyLog[],
  profile: { height_cm?: number | null; date_of_birth?: string | null } | null | undefined,
  now: Date = new Date(),
): { inputs: NutritionInputs | null; missing: ("peso" | "altura" | "edad")[] } {
  const weight = latestWeightKg(logs);
  const height = profile?.height_cm && profile.height_cm > 0 ? profile.height_cm : null;
  const age = ageFromDob(profile?.date_of_birth, now);
  const missing: ("peso" | "altura" | "edad")[] = [];
  if (weight == null) missing.push("peso");
  if (height == null) missing.push("altura");
  if (age == null) missing.push("edad");
  if (weight == null || height == null || age == null) return { inputs: null, missing };
  return { inputs: { weight, height, age }, missing };
}

// Objetivo del onboarding → objetivo de nutrición.
export function nutriGoalFromOnboarding(goal: string): "perder" | "mantener" | "ganar" | null {
  if (goal === "lose") return "perder";
  if (goal === "muscle") return "ganar";
  if (goal === "fit" || goal === "perform") return "mantener";
  return null;
}
