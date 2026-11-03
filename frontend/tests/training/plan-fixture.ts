import { planState, weeklyPlan, type PlanState, type WeeklyPlan } from "@/lib/plan";

// Un plan como lo devuelve `/coach/plan` (fase 6), con textos en inglés: lo valida el esquema.
const reason = (code: string, text: string, rule_key: string | null, severity = "info") => ({
  code, rule_key, grade: rule_key ? "moderate" : null, params: {}, text, professional: null, severity,
});

const modality = (key: string, intensity: string, rule_key: string | null, convention: string | null, blocked_by: string[] = []) => ({
  key, intensity, rule_key, convention, blocked_by,
});

const item = (exercise: string, pattern: string, extra: Record<string, unknown> = {}) => ({
  exercise, pattern, sets: 3, sets_basis: "coach_convention", sets_rule_key: null, rep_range: [8, 12],
  load_kg: null, action: "no_data", rule_key: "strength-hypertrophy/target-reps-in-reserve", reasons: [],
  swapped_from: null, ...extra,
});

const effort = { rir: [1, 3], rule_key: "strength-hypertrophy/target-reps-in-reserve" };

export function makePlan(over: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return weeklyPlan.parse({
    id: 7,
    week_start: "2026-10-26",
    status: "draft",
    target_kcal: 2450,
    in_deficit: false,
    training_schedule: [
      { day: "mon", time: null, kind: "gym", session: "A", rule_key: "cardio-health/weekly-baseline-dose", rotation_convention: "coach" },
      {
        day: "tue", time: "19:00", kind: "mma",
        allowed: [modality("technical_drilling", "moderate", "combat-sports/technical-drilling-runs-below-sparring", null)],
        excluded: [modality("sparring_hard", "vigorous", "combat-sports/hard-striking-sparring-is-vigorous-in-small-samples", null, ["review_before_vigorous"])],
      },
      { day: "wed", time: null, kind: "cardio", minutes: 40, rule_key: "cardio-health/weekly-baseline-dose" },
      { day: "thu", time: null, kind: "gym", session: "B", rule_key: "cardio-health/weekly-baseline-dose", rotation_convention: "coach" },
    ],
    sessions: [
      {
        key: "A", kind: "gym", rule_key: "strength-hypertrophy/full-body-versus-split", effort,
        items: [
          item("Peso muerto rumano", "legs", {
            swapped_from: "Sentadilla", action: "no_data",
            reasons: [reason("injury_unassessed", "knee injury not yet assessed: a GP or physiotherapist assesses it before it is loaded", "recovery-habits/some-pain", "refer")],
          }),
          item("Press banca", "push", {
            sets_basis: "log", load_kg: 62.5, action: "add_reps", rule_key: "strength-hypertrophy/double-progression",
            reasons: [reason("strength_add_reps", "same load, add reps until every set beats 12", "strength-hypertrophy/double-progression")],
          }),
          item("Remo con barra", "pull"),
        ],
      },
      {
        key: "B", kind: "gym", rule_key: "strength-hypertrophy/full-body-versus-split", effort,
        items: [
          item("Prensa", "legs", { action: "paused", load_kg: 100, rule_key: "recovery-habits/some-pain", sets_basis: "log" }),
          item("Press militar", "push"),
          item("Jalón al pecho", "pull"),
        ],
      },
    ],
    cardio: {
      minutes_week: 150, mma_minutes: 30, minutes_needed: 120, days: ["wed", "fri", "sat"], minutes_per_day: 40,
      intensity: "moderate", zone: { rpe: [12, 13], bpm: null }, rule_key: "cardio-health/weekly-baseline-dose",
      mma_convention: "fightlab",
      options: [modality("walking_brisk", "moderate", "cardio-health/weekly-baseline-dose", null)],
      excluded: [
        modality("hiit", "vigorous", "recovery-habits/par-q-specific-thresholds", null, ["review_before_vigorous"]),
        modality("sit", "maximal", "cardio-health/minimum-effective-dose-rehit-and-3-x-20-s", null, ["no_all_out_sprints"]),
      ],
    },
    nutrition: {
      blocked: null, kcal: 2450, in_deficit: false,
      macros: { protein_g: 128, fat_g: 70, fat_min_g: 55, carbs_g: 320.4, fibre_g: 34, protein_g_per_kg: 1.6 },
      rules: { kcal: ["nutrition/default-pal"], protein_g: ["nutrition/protein"], fat_g: ["nutrition/fat"], fibre_g: ["nutrition/fibre"] },
      reasons: [],
    },
    safety_reasons: [reason("parq_review_vigorous", "a PAR-Q+ YES, so a qualified exercise professional or clinician reviews vigorous or maximal work", "recovery-habits/par-q-specific-thresholds", "limit")],
    rules: [
      { key: "cardio-health/weekly-baseline-dose", grade: "strong", title: "Weekly baseline dose" },
      { key: "strength-hypertrophy/double-progression", grade: "moderate", title: "Double progression" },
    ],
    engine_sha: "69e5537",
    narrative: "",
    created_at: "2026-10-29T10:00:00Z",
    applied_at: null,
    ...over,
  });
}

export function makeState(over: Partial<PlanState> = {}): PlanState {
  return planState.parse({
    week_start: "2026-10-26",
    active: null,
    draft: null,
    defaults: { mma_days_detected: ["tue"], mma_days: ["tue"], gym_days: ["mon", "thu"], min_gym_days: 2, max_gym_days: 6 },
    blocked: null,
    ...over,
  });
}
