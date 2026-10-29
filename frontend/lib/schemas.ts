import { z } from "zod";

export const credentials = z.object({
  email: z.string().email("Email no válido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});
export type Credentials = z.infer<typeof credentials>;

export const biometrics = z.object({
  id: z.number(),
  weight_kg: z.string().nullable(),
  body_fat_pct: z.string().nullable(),
  resting_heart_rate: z.number().nullable(),
  sleep_quality_score: z.number().nullable(),
  hrv_ms: z.number().nullable(),
  waist_cm: z.string().nullable(),
  hip_cm: z.string().nullable(),
  chest_cm: z.string().nullable(),
  arm_cm: z.string().nullable(),
  thigh_cm: z.string().nullable(),
  neck_cm: z.string().nullable(),
  timestamp: z.string(),
  source: z.string(),
});
export type Biometrics = z.infer<typeof biometrics>;

export const progressPhoto = z.object({
  id: z.number(),
  image: z.string(), // ruta /media/... (se sirve vía /api/media)
  taken_at: z.string(),
});
export type ProgressPhoto = z.infer<typeof progressPhoto>;

export const profile = z.object({
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  height_cm: z.number().nullable(),
  dominant_stance: z.string().nullable(),
  preferred_units: z.string(),
  timezone: z.string(),
  // Perfil ampliado (spec §6.2)
  equation_sex: z.string().nullable(),
  goal: z.string().nullable(),
  experience: z.string().nullable(),
  activity_level: z.string().nullable(),
  language: z.enum(["es", "en"]),
  region: z.string().nullable(),
  emergency_number: z.string().nullable(),
  medications: z.array(z.string()),
  medications_other: z.array(z.string()),
  conditions: z.array(z.string()),
  conditions_other: z.array(z.string()),
  disciplines: z.array(z.string()),
  training_frequency: z.number().nullable(),
  goal_weight_kg: z.string().nullable(),
  goal_date: z.string().nullable(),
  weight_class: z.string().nullable(),
  weigh_in_at: z.string().nullable(),
});
export type Profile = z.infer<typeof profile>;

export const me = z.object({
  id: z.number(),
  email: z.string(),
  role: z.string(),
  is_email_verified: z.boolean(),
});
export type Me = z.infer<typeof me>;

// --- Evidencia (coach) ---
export const engineInfo = z.object({
  sha: z.string(),
  sha_full: z.string(),
  knowledge_checked_on: z.string().nullable(),
});
export type EngineInfo = z.infer<typeof engineInfo>;

export const evidenceSource = z.object({
  sid: z.string(),
  citation: z.string(),
  type: z.string(),
  doi: z.string(),
  url: z.string(),
});
export type EvidenceSource = z.infer<typeof evidenceSource>;

export const ruleTranslation = z.object({
  lang: z.string(),
  status: z.enum(["machine", "reviewed", "stale"]),
  heading: z.string(),
  rule_text: z.string(),
  evidence: z.string(),
  applies_to: z.string(),
  conflicts: z.string(),
});
export type RuleTranslation = z.infer<typeof ruleTranslation>;

export const ruleDetail = z.object({
  key: z.string(),
  heading: z.string(),
  section: z.string(),
  grade: z.string(),
  rule_text: z.string(),
  applies_to: z.string(),
  conflicts: z.string(),
  translation: ruleTranslation.nullable(),
  sources: z.array(evidenceSource),
});
export type RuleDetail = z.infer<typeof ruleDetail>;

// --- Seguridad y cribado (coach, fase 3) ---
export const safetyReason = z.object({
  code: z.string(),
  rule_key: z.string().nullable(),
  grade: z.string().nullable(),
  params: z.record(z.string(), z.unknown()),
  text: z.string(),
  professional: z.string().nullable(),
  severity: z.enum(["stop", "refer", "limit"]),
});
export type SafetyReason = z.infer<typeof safetyReason>;

export const safety = z.object({
  screened: z.boolean(),
  flags: z.record(z.string(), z.boolean()),
  reasons: z.array(safetyReason),
  paused_exercises: z.record(
    z.string(),
    z.object({ assessed: z.boolean(), reasons: z.array(safetyReason) }),
  ),
  refer_gp: z.boolean(),
  deferral_line: z.string().nullable(),
  disclaimer: z.string(),
  emergency_number: z.string().nullable(),
  parq_pending: z.boolean(),
  weight: z.object({ kg: z.number(), date: z.string() }).nullable(),
});
export type Safety = z.infer<typeof safety>;

export const screeningValues = z.object({
  scoff_yes_count: z.number().nullable(),
  scoff_positive: z.boolean().nullable(),
  parq_any_yes: z.boolean().nullable(),
  parq_followup_yes: z.boolean().nullable(),
  vigorous_reviewed: z.boolean().nullable(),
  cardiac_symptoms: z.boolean().nullable(),
  menstrual: z.string().nullable(),
  bp_systolic: z.number().nullable(),
  bp_diastolic: z.number().nullable(),
});
export type ScreeningValues = z.infer<typeof screeningValues>;

export const screening = z.object({
  values: screeningValues,
  parq_url: z.string(),
  parq_native_form: z.boolean(),
});
export type Screening = z.infer<typeof screening>;

export const injury = z.object({
  id: z.number(),
  area: z.string(),
  status: z.enum(["active", "cleared"]),
  since: z.string().nullable(),
  professional: z.string().nullable(),
  cleared_on: z.string().nullable(),
  exercises: z.array(z.string()),
  origin: z.string(),
});
export type Injury = z.infer<typeof injury>;

// --- Objetivos de energía, macros, zonas y pesaje (coach, fase 4) ---
export const ruleRef = z.object({
  key: z.string(),
  grade: z.string().nullable(),
  title: z.string(),
});
export type RuleRef = z.infer<typeof ruleRef>;

// Como `safetyReason`, más `info`: un motivo que solo explica de dónde sale un número.
export const coachReason = z.object({
  code: z.string(),
  rule_key: z.string().nullable(),
  grade: z.string().nullable(),
  params: z.record(z.string(), z.unknown()),
  text: z.string(),
  professional: z.string().nullable(),
  severity: z.enum(["stop", "refer", "limit", "info"]),
});
export type CoachReason = z.infer<typeof coachReason>;

export const EQUATIONS = ["mifflin_st_jeor", "cunningham", "ten_haaf"] as const;

export const targets = z.object({
  blocked: z.object({ code: z.string(), reason_code: z.string() }).nullable(),
  goal: z.string().nullable(),
  kcal: z.number().nullable(),
  maintenance_kcal: z.number().nullable(),
  deficit_kcal: z.number().nullable(),
  in_deficit: z.boolean(),
  deficit_blocked: z.boolean(),
  clamped: z.boolean(),
  macros: z
    .object({
      protein_g: z.number(),
      fat_g: z.number(),
      fat_min_g: z.number(),
      carbs_g: z.number(),
      fibre_g: z.number(),
      protein_g_per_kg: z.number(),
    })
    .nullable(),
  equation: z
    .object({
      code: z.enum(EQUATIONS),
      rmr_kcal: z.number(),
      ffm_kg: z.number().nullable(),
      pal: z.number(),
      activity_level: z.string().nullable(),
      rule_key: z.string(),
    })
    .nullable(),
  rules: z.record(z.string(), z.array(ruleRef)),
  reasons: z.array(coachReason),
  weight: z.object({ kg: z.number(), date: z.string(), stale_days: z.number() }).nullable(),
  engine: z.object({ sha: z.string(), knowledge_checked_on: z.string().nullable() }),
});
export type Targets = z.infer<typeof targets>;

export const zones = z.object({
  method: z.string(),
  zones: z.array(
    z.object({
      name: z.enum(["light", "moderate", "vigorous"]),
      rpe: z.tuple([z.number(), z.number()]),
      talk_test: z.string(),
      bpm: z.tuple([z.number(), z.number()]).nullable(),
    }),
  ),
  hr_max: z.number().nullable(),
  hr_max_source: z.string().nullable(),
  hr_rest: z.number().nullable(),
  hr_rest_date: z.string().nullable(),
  rules: z.array(ruleRef),
  reasons: z.array(coachReason),
});
export type Zones = z.infer<typeof zones>;

export const weighIn = z.object({
  blocked: z.boolean(),
  deficit_blocked: z.boolean(),
  reasons: z.array(coachReason),
  goal_weight_kg: z.number().nullable(),
  goal_date: z.string().nullable(),
  weigh_in_at: z.string().nullable(),
  weight_class: z.string().nullable(),
  days_left: z.number().nullable(),
  current_kg: z.number().nullable(),
  to_go_kg: z.number().nullable(),
});
export type WeighIn = z.infer<typeof weighIn>;
