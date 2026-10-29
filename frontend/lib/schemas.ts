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
