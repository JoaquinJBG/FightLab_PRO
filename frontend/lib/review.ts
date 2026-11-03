"use client";

// Revisión semanal (fase 7). La calcula el servidor con el motor del coach (`/coach/review`):
// adherencia al plan, tendencia de peso, TDEE recalibrado, series y progresión, y las señales de
// descarga. Aquí solo se pinta, se mandan las señales y se aceptan las propuestas.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { coachReason, ruleRef } from "./schemas";

export const SIGNS = [
  "performance_stall", "joint_aches", "poor_sleep", "low_motivation", "drop_despite_rest", "low_mood",
] as const;
export type Sign = (typeof SIGNS)[number];
export type ProposalKind = "calories" | "deload";

const entry = z.object({
  day: z.string(),
  date: z.string(),
  kind: z.enum(["gym", "mma", "cardio"]),
  session: z.string().nullable().optional(),
  done: z.boolean(),
});

const count = z.object({ planned: z.number().nullable(), done: z.number() });

export const adherence = z.object({
  start: z.string(),
  end: z.string(),
  plan_id: z.number().nullable(),
  plan_week_start: z.string().nullable(),
  planned_total: z.number().nullable(),
  done_planned: z.number().nullable(),
  sessions: z.object({ gym: count, mma: count, cardio: count }),
  entries: z.array(entry),
  nutrition: z.object({
    blocked: z.boolean(),
    days_logged: z.number(),
    mean_kcal: z.number().nullable(),
    target_kcal: z.number().nullable(),
    diff_kcal: z.number().nullable(),
  }),
});

export const reviewTrend = z.object({
  status: z.enum(["ok", "insufficient_data", "disabled"]),
  blocked: z.boolean(),
  rate_kg_week: z.number().nullable().optional(),
  rate_pct_week: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  points: z.number().optional(),
  days: z.number().optional(),
  min_points: z.number().optional(),
  min_days: z.number().optional(),
  rule_key: z.string().optional(),
  reasons: z.array(coachReason),
});

export const reviewCalories = z.object({
  status: z.enum(["blocked", "insufficient_data", "in_range", "out_of_range", "no_rate_rule"]),
  goal: z.string().nullable().optional(),
  rate_rule_key: z.string().nullable().optional(),
  range_pct: z.tuple([z.number(), z.number()]).nullable().optional(),
  in_range: z.boolean().nullable().optional(),
  tdee_status: z.enum(["ok", "wait", "no_intake"]).nullable().optional(),
  tdee_kcal: z.number().nullable().optional(),
  intake_days: z.number().optional(),
  intake_mean_kcal: z.number().nullable().optional(),
  recalibrate_rule_key: z.string().optional(),
  current_kcal: z.number().nullable().optional(),
  proposal: z.boolean().optional(),
  reasons: z.array(coachReason).optional(),
});

export const reviewLift = z.object({
  exercise: z.string(),
  action: z.string(),
  load_kg: z.number().nullable(),
  rep_range: z.tuple([z.number(), z.number()]),
  rule_key: z.string().nullable(),
  reasons: z.array(coachReason),
});

export const reviewTraining = z.object({
  week: z.object({ start: z.string(), end: z.string() }),
  sets: z.record(z.string(), z.number()),
  unmapped: z.array(z.string()),
  reference_sets_per_week: z.number(),
  sets_rule_key: z.string(),
  lifts: z.array(reviewLift),
  stalled: z.array(z.string()),
});

export const caloriesProposal = z.object({
  kind: z.literal("calories"),
  kcal: z.number(),
  current_kcal: z.number(),
  change_kcal: z.number(),
  tdee_kcal: z.number(),
  deficit_kcal: z.number(),
  in_deficit: z.boolean(),
  stepped: z.boolean(),
  rule_key: z.string(),
  reasons: z.array(coachReason),
});

export const deloadProposal = z.object({
  kind: z.literal("deload"),
  volume_cut: z.tuple([z.number(), z.number()]),
  stop_rir: z.number(),
  extra_rest_days: z.tuple([z.number(), z.number()]),
  rule_key: z.string(),
  reasons: z.array(coachReason),
});

export const proposal = z.discriminatedUnion("kind", [caloriesProposal, deloadProposal]);
export type Proposal = z.infer<typeof proposal>;

export const weeklyReview = z.object({
  id: z.number(),
  week_end: z.string(),
  status: z.enum(["pending", "accepted"]),
  goal: z.string().nullable(),
  adherence,
  trend: reviewTrend,
  calories: reviewCalories,
  training: reviewTraining.nullable(),
  signs: z.array(z.enum(SIGNS)),
  deload: z.object({
    status: z.enum(["no_training", "no_signs", "not_indicated", "indicated"]),
    rule_key: z.string(),
    signs_given: z.array(z.enum(SIGNS)),
    signs_derived: z.array(z.enum(SIGNS)),
  }),
  proposals: z.array(proposal),
  accepted: z.array(z.enum(["calories", "deload"])),
  accepted_at: z.string().nullable(),
  target_kcal: z.number().nullable(),
  plan_id: z.number().nullable(),
  plan_week_start: z.string().nullable(),
  safety_reasons: z.array(coachReason),
  rules: z.array(ruleRef),
  engine_sha: z.string(),
  narrative: z.string(),
  created_at: z.string(),
});
export type WeeklyReview = z.infer<typeof weeklyReview>;

// Evidencia antigua (`coach knowledge stale`): el servidor solo la manda al admin.
export const staleKnowledge = z.object({
  months: z.number(),
  files: z.array(z.object({ file: z.string(), checked: z.string().nullable(), origin: z.enum(["upstream", "fightlab"]) })),
});
export type StaleKnowledge = z.infer<typeof staleKnowledge>;

export const reviewState = z.object({
  today: z.string(),
  week_end: z.string(),
  max_past_days: z.number(),
  signs: z.array(z.enum(SIGNS)),
  latest: weeklyReview.nullable(),
  stale: staleKnowledge.optional(),
});
export type ReviewState = z.infer<typeof reviewState>;

/** Error de la API con su código (`profile_incomplete`, `already_accepted`, `no_training`…). */
export class ReviewError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const BASE = "/api/proxy/coach/review";

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ReviewError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "");
  }
  return weeklyReview.parse(data);
}

export function useWeeklyReview() {
  return useQuery<ReviewState>({
    queryKey: ["weekly-review"],
    queryFn: async () => {
      const res = await fetch(BASE, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return reviewState.parse(await res.json());
    },
  });
}

export function useRunReview() {
  const qc = useQueryClient();
  return useMutation<WeeklyReview, ReviewError, { week_end?: string; signs: Sign[] }>({
    mutationFn: (body) => post(BASE, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weekly-review"] }),
  });
}

export function useAcceptReview() {
  const qc = useQueryClient();
  return useMutation<WeeklyReview, ReviewError, { id: number; accept: ProposalKind[] }>({
    mutationFn: ({ id, accept }) => post(`${BASE}/${id}/accept`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly-review"] });
      qc.invalidateQueries({ queryKey: ["weekly-plan"] });
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });
}

/** Grado de cada regla de la revisión, para el chip de evidencia. */
export function reviewGrades(review: WeeklyReview): Record<string, string | null> {
  return Object.fromEntries(review.rules.map((r) => [r.key, r.grade]));
}
