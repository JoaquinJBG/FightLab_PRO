"use client";

// Pantalla "Hoy" (fase 11): el parte rápido de ParteDiario. Todo lo calcula el servidor
// (`/coach/today`): el plan del día sale del plan activo, las comidas del menú y el total de cardio
// de la semana va hacia los 150 min de "Weekly baseline dose" (el vigoroso cuenta doble). Cada
// escritura devuelve el día entero, que sustituye al que había en caché.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DAYS } from "./plan";

export const DAY_TYPES = ["gym", "cardio", "rest"] as const;
export type DayType = (typeof DAY_TYPES)[number];
export const MEAL_STATES = ["done", "skipped", "changed"] as const;
export type MealState = (typeof MEAL_STATES)[number];
export const INTENSITIES = ["moderate", "vigorous"] as const;
export type Intensity = (typeof INTENSITIES)[number];

const planEntry = z.object({
  kind: z.enum(["gym", "cardio", "mma"]),
  time: z.string().nullable().optional(),
  session: z.string().nullable().optional(),
  exercises: z.array(z.string()).optional(),
  minutes: z.number().nullable().optional(),
});
export type PlanEntry = z.infer<typeof planEntry>;

const meal = z.object({
  meal: z.string(),
  label: z.string().nullable().optional(),
  free: z.boolean(),
  tupper: z.boolean(),
  dishes: z.array(z.string()),
  prep: z.array(z.string()).optional().default([]),
  // Fase 12: una lista de tareas (antes, un texto).
  eve: z.preprocess((v) => (typeof v === "string" ? [v] : v ?? []), z.array(z.string())),
  mark: z.object({ state: z.enum(MEAL_STATES), change: z.string().nullable() }).nullable(),
  // F29: la marca de un plato que ya no está en el menú de ese día (no pasa al plato nuevo).
  previous_mark: z.object({ state: z.enum(MEAL_STATES), change: z.string().nullable(), dish: z.string() }).nullable().optional(),
});
export type TodayMeal = z.infer<typeof meal>;

const cardioSession = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  minutes: z.number(),
  vigorous: z.boolean(),
  equivalent: z.number(),
  deletable: z.boolean(),
});
export type CardioSession = z.infer<typeof cardioSession>;

export const todayState = z.object({
  date: z.string(),
  today: z.string(),
  weekday: z.enum(DAYS),
  plan: z
    .object({ id: z.number(), week_start: z.string(), entries: z.array(planEntry), type: z.enum(DAY_TYPES) })
    .nullable(),
  day_type: z.enum(DAY_TYPES).nullable(),
  day_type_set: z.boolean(),
  trained: z.boolean().nullable(),
  mobility: z.boolean().nullable(),
  weight_kg: z.number().nullable(),
  weight_blocked: z.boolean(),
  menu: z.object({ id: z.number(), start_date: z.string(), meals: z.array(meal) }).nullable(),
  next_meal: z
    .union([
      z.object({ all_done: z.literal(true) }),
      z.object({ all_done: z.literal(false), meal: z.string(), free: z.boolean(), dishes: z.array(z.string()) }),
    ])
    .nullable(),
  cardio: z.object({
    sessions: z.array(cardioSession),
    week: z.object({
      start: z.string(),
      minutes: z.number(),
      equivalent: z.number(),
      goal: z.number(),
      mma_minutes: z.number(),
      mma_convention: z.string().nullable(),
      rule_key: z.string(),
      grade: z.string().nullable(),
      vigorous_rule_key: z.string(),
      vigorous_grade: z.string().nullable(),
    }),
    types: z.array(z.object({ key: z.string(), vigorous: z.boolean() })),
  }),
  // Fase 12: lo que hay que dejar hecho esta noche para mañana (tareas `eve` del menú, de la sesión
  // de batch de mañana y pasar a la nevera lo congelado que se come mañana).
  tonight: z.object({
    date: z.string(),
    rule_key: z.string(),
    tasks: z.array(z.object({
      kind: z.enum(["meal", "batch", "defrost"]),
      text: z.string().optional(),
      meal: z.string().nullable().optional(),
      dish: z.string().optional(),
      rule_key: z.string().optional(),
    })),
  }).optional(),
});
export type TodayState = z.infer<typeof todayState>;

/** Error de `/coach/today`: `code` (p. ej. `weight_targets_blocked`) o errores por campo. */
export class TodayError extends Error {
  status: number;
  code: string;
  errors: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.code === "string" ? body.code : "";
    super(code || String(status));
    this.status = status;
    this.code = code;
    this.errors = body;
  }
}

const BASE = "/api/proxy/coach/today";

async function send(path: string, method: string, body?: unknown): Promise<TodayState> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TodayError(res.status, data ?? {});
  return todayState.parse(data);
}

export function useToday() {
  return useQuery<TodayState>({
    queryKey: ["today"],
    queryFn: () => send(BASE, "GET"),
  });
}

function useTodayMutation<T>(run: (vars: T) => Promise<TodayState>, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      qc.setQueryData(["today"], data);
      for (const key of invalidate) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export type DayPatch = Partial<{ day_type: DayType | null; trained: boolean | null; mobility: boolean | null; weight_kg: number }>;

export function useSaveDay() {
  // El peso y el tipo de día también los leen el Inicio, la tendencia y el check-in.
  return useTodayMutation((patch: DayPatch) => send(BASE, "POST", patch), ["checkin", "weigh-in", "trend", "biometrics"]);
}

export function useMarkMeal() {
  return useTodayMutation((v: { meal: string; state: MealState | null; change?: string }) => send(`${BASE}/meal`, "PUT", v));
}

export function useAddCardio() {
  return useTodayMutation((v: { type: string; minutes: number; intensity: Intensity }) => send(`${BASE}/cardio`, "POST", v));
}

export function useDeleteCardio() {
  return useTodayMutation((id: number) => send(`${BASE}/cardio/${id}`, "DELETE"));
}

/** Cuánto llevas hacia los 150 min (0-100), para la barra. */
export function weekProgress(equivalent: number, goal: number): number {
  if (goal <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((equivalent / goal) * 100)));
}
