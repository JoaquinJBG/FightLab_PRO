"use client";

// Plan de la semana (fase 6). Lo genera el servidor por reglas (`/coach/plan`): cada número sale
// del motor y cada línea lleva su regla o su etiqueta de convención. Aquí solo se pinta y se
// aplica ("Aplicar" lo pasa a Mi rutina).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { coachReason, ruleRef } from "./schemas";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

const convention = z.enum(["coach", "fightlab"]).nullable();

export const modality = z.object({
  key: z.string(),
  intensity: z.enum(["light", "moderate", "vigorous", "maximal"]),
  rule_key: z.string().nullable(),
  convention,
  blocked_by: z.array(z.string()),
});
export type Modality = z.infer<typeof modality>;

export const planItem = z.object({
  exercise: z.string(),
  pattern: z.enum(["legs", "push", "pull"]),
  sets: z.number(),
  sets_basis: z.enum(["log", "coach_convention", "weekly_sets"]),
  sets_rule_key: z.string().nullable(),
  rep_range: z.tuple([z.number(), z.number()]),
  load_kg: z.number().nullable(),
  action: z.string(),
  rule_key: z.string().nullable(),
  reasons: z.array(coachReason),
  swapped_from: z.string().nullable(),
});
export type PlanItem = z.infer<typeof planItem>;

export const planSession = z.object({
  key: z.string(),
  kind: z.literal("gym"),
  rule_key: z.string().nullable(),
  effort: z.object({ rir: z.tuple([z.number(), z.number()]), rule_key: z.string() }),
  items: z.array(planItem),
});
export type PlanSession = z.infer<typeof planSession>;

export const scheduleEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("gym"), day: z.enum(DAYS), time: z.string().nullable(), session: z.string(),
    rule_key: z.string(), rotation_convention: convention,
  }),
  z.object({
    kind: z.literal("mma"), day: z.enum(DAYS), time: z.string().nullable(),
    allowed: z.array(modality), excluded: z.array(modality),
  }),
  z.object({
    kind: z.literal("cardio"), day: z.enum(DAYS), time: z.string().nullable(), minutes: z.number(), rule_key: z.string(),
  }),
]);
export type ScheduleEntry = z.infer<typeof scheduleEntry>;

export const cardio = z.object({
  minutes_week: z.number(),
  mma_minutes: z.number(),
  minutes_needed: z.number(),
  days: z.array(z.enum(DAYS)),
  minutes_per_day: z.number(),
  intensity: z.string(),
  zone: z.object({ rpe: z.tuple([z.number(), z.number()]), bpm: z.tuple([z.number(), z.number()]).nullable() }).nullable(),
  rule_key: z.string(),
  mma_convention: convention,
  options: z.array(modality),
  excluded: z.array(modality),
});

export const nutrition = z.object({
  missing: z.string().optional(),
  blocked: z.object({ code: z.string(), reason_code: z.string() }).nullable().optional(),
  kcal: z.number().nullable().optional(),
  in_deficit: z.boolean().optional(),
  macros: z.object({
    protein_g: z.number(), fat_g: z.number(), carbs_g: z.number(), fibre_g: z.number(),
  }).passthrough().nullable().optional(),
  rules: z.record(z.string(), z.array(z.string())).optional(),
  reasons: z.array(coachReason).optional(),
});

export const weeklyPlan = z.object({
  id: z.number(),
  week_start: z.string(),
  status: z.enum(["draft", "active", "superseded"]),
  target_kcal: z.number().nullable(),
  in_deficit: z.boolean(),
  training_schedule: z.array(scheduleEntry),
  sessions: z.array(planSession),
  cardio,
  nutrition: nutrition.nullable(),
  safety_reasons: z.array(coachReason),
  rules: z.array(ruleRef),
  engine_sha: z.string(),
  narrative: z.string(),
  created_at: z.string(),
  applied_at: z.string().nullable(),
});
export type WeeklyPlan = z.infer<typeof weeklyPlan>;

export const planState = z.object({
  week_start: z.string(),
  active: weeklyPlan.nullable(),
  draft: weeklyPlan.nullable(),
  defaults: z.object({
    mma_days_detected: z.array(z.enum(DAYS)),
    mma_days: z.array(z.enum(DAYS)),
    gym_days: z.array(z.enum(DAYS)),
    min_gym_days: z.number(),
    max_gym_days: z.number(),
  }).nullable(),
  blocked: z.object({ code: z.literal("no_training"), reasons: z.array(coachReason) }).nullable(),
});
export type PlanState = z.infer<typeof planState>;

export type PlanRequest = { gym_days: Day[]; mma_days: Day[] };

/** Error de la API con su código (`too_few_gym_days`, `no_training`, `profile_incomplete`…). */
export class PlanError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const BASE = "/api/proxy/coach/plan";

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlanError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "");
  }
  return weeklyPlan.parse(data);
}

export function useWeeklyPlan(enabled = true) {
  return useQuery<PlanState>({
    queryKey: ["weekly-plan"],
    queryFn: async () => {
      const res = await fetch(BASE, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return planState.parse(await res.json());
    },
    enabled,
  });
}

export function useGeneratePlan() {
  const qc = useQueryClient();
  return useMutation<WeeklyPlan, PlanError, PlanRequest>({
    mutationFn: (body) => post(BASE, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weekly-plan"] }),
  });
}

export function useApplyPlan() {
  const qc = useQueryClient();
  return useMutation<WeeklyPlan, PlanError, number>({
    mutationFn: (id) => post(`${BASE}/${id}/apply`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weekly-plan"] }),
  });
}

/** Grado de cada regla del plan, para el chip de evidencia. */
export function gradeIndex(plan: WeeklyPlan): Record<string, string | null> {
  return Object.fromEntries(plan.rules.map((r) => [r.key, r.grade]));
}

export function sessionByKey(plan: WeeklyPlan, key: string): PlanSession | undefined {
  return plan.sessions.find((s) => s.key === key);
}

// Series duras por músculo de la última semana registrada (`/coach/strength/sets`, Task 6.2).
export const strengthSets = z.object({
  week: z.object({ start: z.string(), end: z.string() }),
  sets: z.record(z.string(), z.number()),
  unmapped: z.array(z.string()),
  reference_sets_per_week: z.number(),
  rules: z.array(ruleRef),
});
export type StrengthSets = z.infer<typeof strengthSets>;

export function useStrengthSets() {
  return useQuery<StrengthSets>({
    queryKey: ["strength-sets"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/coach/strength/sets", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return strengthSets.parse(await res.json());
    },
  });
}
