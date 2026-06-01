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
  timestamp: z.string(),
  source: z.string(),
});
export type Biometrics = z.infer<typeof biometrics>;

export const profile = z.object({
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  height_cm: z.number().nullable(),
  dominant_stance: z.string().nullable(),
  preferred_units: z.string(),
  timezone: z.string(),
});
export type Profile = z.infer<typeof profile>;

export const me = z.object({
  id: z.number(),
  email: z.string(),
  role: z.string(),
  is_email_verified: z.boolean(),
});
export type Me = z.infer<typeof me>;
