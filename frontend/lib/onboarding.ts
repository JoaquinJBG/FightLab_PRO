// Lógica del onboarding con cribado (Task 3.6), según `setup/SKILL.md` del coach.
// Aquí solo se recogen respuestas y se convierten en los resultados que guarda el coach.
// Los flags y el punto de corte del SCOFF los aplica el motor en el servidor.

export type Step =
  | "welcome"
  | "language"
  | "scoff"
  | "basics"
  | "parq"
  | "cardiac"
  | "medical"
  | "bp"
  | "cycle"
  | "goals"
  | "done";

/** Pasos que aplican: el ciclo solo para mujeres; la tensión con hipertensión o si se sabe. */
export function steps(opts: { female: boolean; hypertension: boolean }): Step[] {
  const out: Step[] = ["welcome", "language", "scoff", "basics", "parq", "cardiac", "medical"];
  if (opts.hypertension) out.push("bp");
  if (opts.female) out.push("cycle");
  out.push("goals", "done");
  return out;
}

/* ---------------------------------- SCOFF ---------------------------------- */

// Las cinco preguntas del coach, en este orden (setup/SKILL.md, paso 2).
export const SCOFF_ITEMS = ["sick", "control", "fat", "dominate", "weightLoss"] as const;
export type ScoffItem = (typeof SCOFF_ITEMS)[number];

/** `partial` ("algo", "a veces") lleva una pregunta de seguimiento antes de contar. */
export type ScoffAnswer = { answer: "yes" | "no" | "partial"; followUp?: boolean };

/** El índice de la pérdida de control, cuya pregunta de seguimiento es el atracón. */
export const SCOFF_CONTROL = SCOFF_ITEMS.indexOf("control");

/** ¿Hace falta la pregunta de seguimiento? Para una respuesta parcial, y en la pérdida de
 * control también con un sí (el atracón con pérdida de control es una señal de alarma). */
export function needsFollowUp(index: number, a: ScoffAnswer | undefined): boolean {
  if (!a) return false;
  if (a.answer === "partial") return true;
  return index === SCOFF_CONTROL && a.answer === "yes";
}

function isYes(a: ScoffAnswer): boolean {
  return a.answer === "yes" || (a.answer === "partial" && a.followUp === true);
}

/** `scoff_yes_count` (síes claros) y `scoff_positive` (señal de alarma: un sí a provocarse
 * el vómito, una pérdida de peso reciente que preocupó o atracones con pérdida de control). */
export function scoffOutcome(answers: ScoffAnswer[]): { scoff_yes_count: number; scoff_positive: boolean } {
  const count = answers.filter(isYes).length;
  const sick = answers[SCOFF_ITEMS.indexOf("sick")];
  const loss = answers[SCOFF_ITEMS.indexOf("weightLoss")];
  const control = answers[SCOFF_CONTROL];
  const binge = !!control && control.answer !== "no" && control.followUp === true;
  const positive = (!!sick && isYes(sick)) || (!!loss && isYes(loss)) || binge;
  return { scoff_yes_count: count, scoff_positive: positive };
}

/* --------------------------------- PAR-Q+ ---------------------------------- */

export type Tri = "yes" | "no" | "unsure";

/** "No lo sé o no lo he rellenado" deja el campo nulo: el motor lo trata como no contestado. */
export function triToBool(v: Tri): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

// recovery-habits.md: "PAR-Q+ specific thresholds" (coach.safety.VIGOROUS_REVIEW_AGE)
export const VIGOROUS_REVIEW_AGE = 45;

export function askVigorousReview(anyYes: boolean | null, followupYes: boolean | null, age: number | null) {
  return anyYes === true || followupYes === true || (age !== null && age >= VIGOROUS_REVIEW_AGE);
}

export function ageOn(dob: string | null | undefined, today: Date): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return null;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

/* -------------------------------- reanudar --------------------------------- */

type ProfileLike = {
  date_of_birth: string | null;
  height_cm: number | null;
  region: string | null;
  emergency_number: string | null;
};
type ScreeningLike = { scoff_yes_count: number | null; cardiac_symptoms: boolean | null };

/** El primer paso obligatorio sin contestar. El PAR-Q+ no es obligatorio: "no lo sé" deja
 * solo trabajo ligero o moderado y la Home recuerda completarlo. */
export function firstMissingStep(p: ProfileLike, s: ScreeningLike): Step | null {
  if (!p.region && !p.emergency_number) return "language";
  if (s.scoff_yes_count == null) return "scoff";
  if (!p.date_of_birth || p.height_cm == null) return "basics";
  if (s.cardiac_symptoms == null) return "cardiac";
  return null;
}

export function isOnboardingComplete(p: ProfileLike, s: ScreeningLike): boolean {
  return firstMissingStep(p, s) === null;
}

/* ------------------------- medicación y condiciones ------------------------ */

// Los tokens de docs/safety.md (coach.profile.MEDICATION_TOKENS / CONDITION_TOKENS).
export const MEDICATION_TOKENS = ["beta_blocker", "glp1"] as const;
export const CONDITION_TOKENS = ["hypertension", "heart_disease", "weight_related_condition"] as const;
export const PREGNANCY_TOKENS = ["pregnant", "planning_pregnancy"] as const;
export const MENSTRUAL_STATES = ["normal", "irregular_new", "absent", "not_applicable"] as const;

/** "ibuprofeno, asma" → ["ibuprofeno", "asma"] (lo que el coach no puede clasificar). */
export function splitFreeText(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}
