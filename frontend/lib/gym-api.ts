"use client";

// Lo que el gimnasio (F17, rama H) pide al servidor: empezar desde una rutina (`start` de la
// rama R, por el contrato), actualizarla con lo hecho, récords y progreso por ejercicio, y el
// historial, el calendario y el detalle de cada sesión.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { ActivityKind, ServerActivity, ServerActivityDetail, SyncSet } from "./activities";
import type { ExerciseEntry, SavedExercise, SetEntry, SetType } from "./gym";
import type { PriorRecords } from "./gym-log";

const PROXY = "/api/proxy";

/* ------------------------- empezar desde una rutina ------------------------ */

const plannedSet = z.object({
  set_type: z.enum(["warmup", "normal", "drop", "failure"]).catch("normal"),
  reps: z.number().nullable().default(null),
  reps_max: z.number().nullable().default(null),
  weight_kg: z.number().nullable().default(null),
  rpe: z.number().nullable().default(null),
  rir: z.number().nullable().default(null),
});

/** El borrador del entreno (`GET gym/routines/<id>/start`, contrato de F17). */
export const routineStart = z.object({
  routine_id: z.number(),
  title: z.string(),
  exercises: z.array(z.object({
    exercise_key: z.string().nullable(),
    name: z.string(),
    notes: z.string().default(""),
    rest_s: z.number().nullable().default(null),
    superset: z.number().nullable().default(null),
    sets: z.array(plannedSet).default([]),
  })),
  // Lo añade R: lesiones que pausan un ejercicio y bloqueos del coach.
  safety: z.object({
    blocked: z.boolean().default(false),
    paused: z.array(z.object({ exercise_key: z.string().nullable(), name: z.string() })).default([]),
  }).partial().optional(),
});
export type RoutineStart = z.infer<typeof routineStart>;

export async function fetchRoutineStart(id: number): Promise<RoutineStart> {
  const res = await fetch(`${PROXY}/gym/routines/${id}/start`, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return routineStart.parse(await res.json());
}

const fmt = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/** El borrador de la rutina → ejercicios del entreno: las series planificadas se rellenan con el
    peso y las reps (la mínima del rango) y quedan sin marcar. */
export function exercisesFromStart(start: RoutineStart): ExerciseEntry[] {
  return start.exercises.map((e) => ({
    name: e.name,
    key: e.exercise_key,
    notes: e.notes,
    restS: e.rest_s,
    superset: e.superset,
    sets: (e.sets.length ? e.sets : [plannedSet.parse({})]).map((s): SetEntry => ({
      kg: fmt(s.weight_kg),
      reps: s.reps !== null ? String(s.reps) : "",
      done: false,
      ...(s.set_type !== "normal" ? { type: s.set_type as SetType } : {}),
      ...(s.rpe !== null ? { rpe: fmt(s.rpe) } : {}),
      ...(s.rir !== null ? { rir: fmt(s.rir) } : {}),
    })),
  }));
}

/** Lo hecho → los ejercicios de la rutina (para «actualizar la rutina con lo hecho»). */
export function routineExercisesFromSession(saved: SavedExercise[]) {
  return saved.map((x) => ({
    exercise_key: x.key ?? null,
    name: x.name,
    notes: x.notes ?? "",
    rest_s: x.restS ?? null,
    superset: x.superset ?? null,
    sets: x.sets.map((s) => ({
      set_type: s.type ?? "normal",
      reps: s.reps,
      reps_max: null,
      weight_kg: s.kg > 0 ? s.kg : null,
      rpe: s.rpe ?? null,
      rir: s.rir ?? null,
    })),
  }));
}

/** `PATCH gym/routines/<id>` con los ejercicios de lo hecho. true si la rutina se actualizó. */
export async function updateRoutineFromSession(id: number, saved: SavedExercise[]): Promise<boolean> {
  try {
    const res = await fetch(`${PROXY}/gym/routines/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exercises: routineExercisesFromSession(saved) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------------------------- récords y progreso --------------------------- */

const record = z.object({
  name: z.string(),
  sessions: z.number(),
  max_weight_kg: z.number().nullable(),
  max_weight_date: z.string().nullable(),
  max_reps: z.number(),
  best_e1rm_kg: z.number().nullable(),
  best_e1rm_date: z.string().nullable(),
  best_set_volume_kg: z.number().nullable(),
  best_session_volume_kg: z.number().nullable(),
  reps_by_weight: z.array(z.object({ weight_kg: z.number().nullable(), reps: z.number(), date: z.string() })),
});
export type ExerciseRecord = z.infer<typeof record> & PriorRecords;
const recordsResponse = z.object({ records: z.record(z.string(), record.nullable()), convention: z.string() });

/** Identificador de un ejercicio para récords y progreso: su clave o, sin ella, su nombre. */
export const exerciseId = (x: { key?: string | null; name: string }) => x.key || x.name;

export function useRecords(ids: string[] | null) {
  const unique = ids === null ? null : [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["gym-records", unique],
    enabled: unique === null || unique.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = (unique ?? []).map((n) => `exercise=${encodeURIComponent(n)}`).join("&");
      const res = await fetch(`${PROXY}/gym/records${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return recordsResponse.parse(await res.json()).records as Record<string, ExerciseRecord | null>;
    },
  });
}

/** Los récords de un ejercicio por su id (clave o nombre), como los devuelve el servidor. */
export function recordFor(records: Record<string, ExerciseRecord | null> | undefined, x: { key?: string | null; name: string }): ExerciseRecord | null {
  if (!records) return null;
  return records[exerciseId(x)] ?? records[`name:${x.name.trim().toLowerCase()}`] ?? null;
}

const progressPoint = z.object({
  date: z.string(),
  activity_id: z.number(),
  e1rm_kg: z.number().nullable(),
  max_weight_kg: z.number().nullable(),
  volume_kg: z.number(),
  reps: z.number(),
  best_set: z.object({ weight_kg: z.number(), reps: z.number() }).nullable(),
});
export type ProgressPoint = z.infer<typeof progressPoint>;
const progressResponse = z.object({
  exercise: z.string(),
  name: z.string().nullable(),
  sessions: z.array(progressPoint),
  convention: z.string(),
});

export function useProgress(id: string) {
  return useQuery({
    queryKey: ["gym-progress", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`${PROXY}/gym/progress?exercise=${encodeURIComponent(id)}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return progressResponse.parse(await res.json());
    },
  });
}

/* ------------------------ historial, calendario, detalle ------------------------ */

export const HISTORY_PAGE = 20;

/** Una página del historial del servidor. null si no responde (la vista cae a lo local). */
export async function fetchHistoryPage(kind: ActivityKind, offset: number, limit = HISTORY_PAGE): Promise<ServerActivity[] | null> {
  try {
    const res = await fetch(`${PROXY}/activities?kind=${kind}&limit=${limit}&offset=${offset}`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data as ServerActivity[]) : null;
  } catch {
    return null;
  }
}

export type CalendarDays = Record<string, Partial<Record<ActivityKind, number>>>;

export async function fetchCalendar(month: string): Promise<CalendarDays | null> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    const res = await fetch(`${PROXY}/activities/calendar?month=${month}&tz=${encodeURIComponent(tz)}`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { days?: CalendarDays };
    return data.days ?? {};
  } catch {
    return null;
  }
}

export async function fetchActivityDetail(id: number): Promise<ServerActivityDetail | null> {
  try {
    const res = await fetch(`${PROXY}/activities/${id}`, { credentials: "include" });
    return res.ok ? ((await res.json()) as ServerActivityDetail) : null;
  } catch {
    return null;
  }
}

export type PatchBody = { title?: string; note?: string; rpe?: number | null; duration_sec?: number; sets?: SyncSet[] };

/** Edita una sesión. `{ok: false, errors}` con el motivo del servidor (400). */
export async function patchActivity(id: number, body: PatchBody): Promise<{ ok: true; data: ServerActivityDetail } | { ok: false; errors: unknown }> {
  try {
    const res = await fetch(`${PROXY}/activities/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: data as ServerActivityDetail } : { ok: false, errors: data };
  } catch {
    return { ok: false, errors: null };
  }
}

export async function deleteActivity(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${PROXY}/activities/${id}`, { method: "DELETE", credentials: "include" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Las series del servidor → ejercicios (para el detalle y para editarlo). */
export function exercisesFromServerSets(sets: ServerActivityDetail["sets"]): ExerciseEntry[] {
  const out: ExerciseEntry[] = [];
  const byIndex = new Map<number, ExerciseEntry>();
  for (const s of [...sets].sort((a, b) => a.exercise_index - b.exercise_index || a.set_index - b.set_index)) {
    let ex = byIndex.get(s.exercise_index);
    if (!ex) {
      ex = { name: s.exercise, key: s.exercise_key, notes: s.notes, restS: s.rest_s, superset: s.superset, sets: [] };
      byIndex.set(s.exercise_index, ex);
      out.push(ex);
    }
    const type = (["warmup", "drop", "failure"].includes(s.set_type) ? s.set_type : s.set_type === "dropset" ? "drop" : "normal") as SetType;
    ex.sets.push({
      kg: s.weight_kg !== null ? fmt(s.weight_kg) : "",
      reps: s.reps !== null ? String(s.reps) : "",
      done: true,
      ...(type !== "normal" ? { type } : {}),
      ...(s.rpe !== null ? { rpe: fmt(s.rpe) } : {}),
      ...(s.rir !== null ? { rir: fmt(s.rir) } : {}),
    });
  }
  return out;
}
