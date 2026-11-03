// Objetivo del perfil (`profile.goal`, valores del coach) frente al antiguo
// `flp_nutri_goal` de localStorage (perder/mantener/ganar). Spec §6.2.
import type { Goal as LegacyGoal } from "./nutrition";

export const COACH_GOALS = ["fat_loss", "maintenance", "muscle_gain", "recomposition"] as const;
export type CoachGoal = (typeof COACH_GOALS)[number];

export const LEGACY_GOAL_KEY = "flp_nutri_goal";

const FROM_LEGACY: Record<LegacyGoal, CoachGoal> = {
  perder: "fat_loss",
  mantener: "maintenance",
  ganar: "muscle_gain",
};

export function legacyToCoachGoal(value: string | null | undefined): CoachGoal | null {
  return value && value in FROM_LEGACY ? FROM_LEGACY[value as LegacyGoal] : null;
}

/** Para la pantalla de Nutrición, que aún calcula con perder/mantener/ganar hasta la fase 4. */
export function coachToLegacyGoal(goal: string | null | undefined): LegacyGoal {
  if (goal === "fat_loss") return "perder";
  if (goal === "muscle_gain") return "ganar";
  return "mantener"; // maintenance, recomposition (comer en mantenimiento) o sin objetivo
}

/** El objetivo que hay que guardar en el perfil en la primera carga, o null si no hay
 * nada que migrar (el perfil ya tiene objetivo o no hay valor antiguo). */
export function goalToMigrate(
  profileGoal: string | null | undefined,
  legacy: string | null | undefined,
): CoachGoal | null {
  if (profileGoal) return null;
  return legacyToCoachGoal(legacy);
}
