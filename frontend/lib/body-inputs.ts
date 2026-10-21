// Datos corporales del atleta sin valores inventados: si falta alguno, se
// devuelve null y la pantalla lo pide en vez de calcular con un supuesto.

export type BodyLog = { weight_kg: string | null };

export function latestWeightKg(logs: BodyLog[]): number | null {
  for (const l of logs) {
    const w = l.weight_kg ? parseFloat(l.weight_kg) : NaN;
    if (Number.isFinite(w) && w > 0) return w;
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
