"use client";

// Rutinas y programas del gimnasio (F17 R). Las rutinas viven en el servidor (`/gym/routines`),
// sin límite de número, en carpetas; los programas clásicos se cargan como rutinas del usuario y
// «Mi rutina» es la carpeta que genera el plan por reglas (`/gym/plan-routines`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ruleRef } from "./schemas";

export const SET_TYPES = ["warmup", "normal", "drop", "failure"] as const;
export type SetType = (typeof SET_TYPES)[number];

export const plannedSet = z.object({
  set_type: z.enum(SET_TYPES),
  reps: z.number().nullable(),
  reps_max: z.number().nullable(),
  weight_kg: z.number().nullable(),
  rpe: z.number().nullable(),
  rir: z.number().nullable(),
});
export type PlannedSet = z.infer<typeof plannedSet>;

export const routineExercise = z.object({
  id: z.number().optional(),
  exercise_key: z.string().nullable(),
  name: z.string(),
  order: z.number().optional(),
  superset: z.number().nullable(),
  notes: z.string(),
  rest_s: z.number().nullable(),
  sets: z.array(plannedSet),
});
export type RoutineExercise = z.infer<typeof routineExercise>;

export const routine = z.object({
  id: z.number(),
  title: z.string(),
  notes: z.string(),
  folder: z.number().nullable(),
  order: z.number(),
  source: z.string(),
  source_ref: z.string(),
  exercises: z.array(routineExercise),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Routine = z.infer<typeof routine>;

export const routineSummary = z.object({
  id: z.number(),
  title: z.string(),
  notes: z.string(),
  folder: z.number().nullable(),
  order: z.number(),
  source: z.string(),
  source_ref: z.string(),
  exercise_count: z.number(),
  set_count: z.number(),
  exercise_names: z.array(z.string()),
  exercise_keys: z.array(z.string().nullable()),
  updated_at: z.string(),
  edited: z.boolean().optional(),
});
export type RoutineSummary = z.infer<typeof routineSummary>;

export const folder = z.object({
  id: z.number(),
  name: z.string(),
  order: z.number(),
  kind: z.enum(["user", "program", "plan"]),
  program_slug: z.string(),
  routine_count: z.number(),
});
export type Folder = z.infer<typeof folder>;

export const programSummary = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  days_per_week: z.number(),
  level: z.string(),
  source: z.string(),
  source_note: z.string(),
  convention: z.boolean(),
  rules: z.array(ruleRef),
  routines: z.array(z.object({ key: z.string(), title: z.string(), exercise_count: z.number() })),
});
export type ProgramSummary = z.infer<typeof programSummary>;

export const planRoutines = z.object({
  plan_id: z.number().nullable(),
  week_start: z.string().nullable(),
  folder: folder.nullable(),
  routines: z.array(routineSummary),
  in_sync: z.boolean(),
  edited: z.array(z.number()),
});
export type PlanRoutines = z.infer<typeof planRoutines>;

/** Lo que se manda al guardar (PUT/POST): sin ids ni orden, el orden es el de la lista. */
export type RoutineDraft = {
  title: string;
  notes: string;
  folder: number | null;
  exercises: Omit<RoutineExercise, "id" | "order">[];
};

export class RoutineApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown>) {
    super(typeof data?.detail === "string" ? data.detail : String(status));
  }
  get code(): string | null {
    return typeof this.data?.code === "string" ? this.data.code : null;
  }
}

const BASE = "/api/proxy/gym";

async function call<T>(path: string, init: RequestInit = {}, parse?: (d: unknown) => T): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: "include",
    ...init,
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new RoutineApiError(res.status, (data ?? {}) as Record<string, unknown>);
  return parse ? parse(data) : (data as T);
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

export const KEYS = {
  routines: ["routines"] as const,
  folders: ["routine-folders"] as const,
  routine: (id: number) => ["routine", id] as const,
  programs: ["programs"] as const,
  planRoutines: ["plan-routines"] as const,
};

export function useRoutines() {
  return useQuery<RoutineSummary[]>({
    queryKey: KEYS.routines,
    queryFn: () => call("routines", {}, (d) => z.array(routineSummary).parse(d)),
  });
}

export function useFolders() {
  return useQuery<Folder[]>({
    queryKey: KEYS.folders,
    queryFn: () => call("routine-folders", {}, (d) => z.array(folder).parse(d)),
  });
}

export function useRoutine(id: number | null) {
  return useQuery<Routine>({
    queryKey: KEYS.routine(id ?? 0),
    queryFn: () => call(`routines/${id}`, {}, (d) => routine.parse(d)),
    enabled: id !== null,
  });
}

export function usePrograms() {
  return useQuery<ProgramSummary[]>({
    queryKey: KEYS.programs,
    queryFn: () => call("programs", {}, (d) => z.array(programSummary).parse(d)),
  });
}

export function usePlanRoutines(enabled = true) {
  return useQuery<PlanRoutines>({
    queryKey: KEYS.planRoutines,
    queryFn: () => call("plan-routines", {}, (d) => planRoutines.parse(d)),
    enabled,
  });
}

/** Invalida todo lo de rutinas tras un cambio (la lista, las carpetas y «Mi rutina»). */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEYS.routines });
    qc.invalidateQueries({ queryKey: KEYS.folders });
    qc.invalidateQueries({ queryKey: KEYS.planRoutines });
  };
}

export function useSaveRoutine() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation<Routine, RoutineApiError, { id: number | null; draft: RoutineDraft }>({
    mutationFn: ({ id, draft }) =>
      id === null
        ? call("routines", json("POST", draft), (d) => routine.parse(d))
        : call(`routines/${id}`, json("PUT", draft), (d) => routine.parse(d)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.routine(saved.id), saved);
      invalidate();
    },
  });
}

export function usePatchRoutine() {
  const invalidate = useInvalidate();
  return useMutation<Routine, RoutineApiError, { id: number; patch: Partial<RoutineDraft> }>({
    mutationFn: ({ id, patch }) => call(`routines/${id}`, json("PATCH", patch), (d) => routine.parse(d)),
    onSuccess: invalidate,
  });
}

export function useDeleteRoutine() {
  const invalidate = useInvalidate();
  return useMutation<unknown, RoutineApiError, number>({
    mutationFn: (id) => call(`routines/${id}`, json("DELETE")),
    onSuccess: invalidate,
  });
}

export function useDuplicateRoutine() {
  const invalidate = useInvalidate();
  return useMutation<Routine, RoutineApiError, number>({
    mutationFn: (id) => call(`routines/${id}/duplicate`, json("POST"), (d) => routine.parse(d)),
    onSuccess: invalidate,
  });
}

export function useReorderRoutines() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation<unknown, RoutineApiError, { folder: number | null; ids: number[] }>({
    mutationFn: (body) => call("routines/reorder", json("POST", body)),
    // Optimista: la lista se pinta ya en el orden nuevo.
    onMutate: ({ folder: f, ids }) => {
      qc.setQueryData<RoutineSummary[]>(KEYS.routines, (old) => (old ? applyOrder(old, f, ids) : old));
    },
    onSettled: invalidate,
  });
}

export function useCreateFolder() {
  const invalidate = useInvalidate();
  return useMutation<Folder, RoutineApiError, string>({
    mutationFn: (name) => call("routine-folders", json("POST", { name }), (d) => folder.parse(d)),
    onSuccess: invalidate,
  });
}

export function useRenameFolder() {
  const invalidate = useInvalidate();
  return useMutation<Folder, RoutineApiError, { id: number; name: string }>({
    mutationFn: ({ id, name }) => call(`routine-folders/${id}`, json("PATCH", { name }), (d) => folder.parse(d)),
    onSuccess: invalidate,
  });
}

export function useDeleteFolder() {
  const invalidate = useInvalidate();
  return useMutation<unknown, RoutineApiError, { id: number; withRoutines: boolean }>({
    mutationFn: ({ id, withRoutines }) =>
      call(`routine-folders/${id}${withRoutines ? "?routines=delete" : ""}`, json("DELETE")),
    onSuccess: invalidate,
  });
}

export function useReorderFolders() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation<unknown, RoutineApiError, number[]>({
    mutationFn: (ids) => call("routine-folders/reorder", json("POST", { ids })),
    onMutate: (ids) => {
      qc.setQueryData<Folder[]>(KEYS.folders, (old) =>
        old ? [...old].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : old,
      );
    },
    onSettled: invalidate,
  });
}

export function useLoadProgram() {
  const invalidate = useInvalidate();
  return useMutation<{ folder: Folder; routines: Routine[] }, RoutineApiError, string>({
    mutationFn: (slug) => call(`programs/${slug}/load`, json("POST")),
    onSuccess: invalidate,
  });
}

export function useSyncPlanRoutines() {
  const invalidate = useInvalidate();
  return useMutation<PlanRoutines, RoutineApiError, { on_edited?: "keep" | "overwrite" }>({
    mutationFn: (body) => call("plan-routines/sync", json("POST", body), (d) => planRoutines.parse(d)),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- funciones puras

/** Las rutinas de `folder` en el orden `ids`; el resto, igual. */
export function applyOrder(list: RoutineSummary[], folderId: number | null, ids: number[]): RoutineSummary[] {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return list
    .map((r) => (r.folder === folderId && pos.has(r.id) ? { ...r, order: pos.get(r.id)! } : r))
    .sort((a, b) => (a.folder ?? -1) - (b.folder ?? -1) || a.order - b.order || a.id - b.id);
}

/** Mueve el elemento `from` a la posición `to` (arrastrar o botones subir/bajar). */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Grupos de superserie renumerados 0, 1… en orden; un grupo de uno deja de serlo (como el
 * servidor, para que lo que se ve antes de guardar sea lo que se guarda). */
export function normaliseSupersets<T extends { superset: number | null }>(list: T[]): T[] {
  const counts = new Map<number, number>();
  for (const e of list) if (e.superset !== null) counts.set(e.superset, (counts.get(e.superset) ?? 0) + 1);
  const renumber = new Map<number, number>();
  return list.map((e) => {
    if (e.superset === null || (counts.get(e.superset) ?? 0) < 2) return { ...e, superset: null };
    if (!renumber.has(e.superset)) renumber.set(e.superset, renumber.size);
    return { ...e, superset: renumber.get(e.superset)! };
  });
}

/** Une el ejercicio `i` con el siguiente en una superserie (o al grupo del siguiente). */
export function linkWithNext<T extends { superset: number | null }>(list: T[], i: number): T[] {
  if (i < 0 || i >= list.length - 1) return list;
  const group = list[i].superset ?? list[i + 1].superset ?? Math.max(-1, ...list.map((e) => e.superset ?? -1)) + 1;
  const next = list.map((e, j) => (j === i || j === i + 1 ? { ...e, superset: group } : e));
  return normaliseSupersets(next);
}

/** Saca el ejercicio `i` de su superserie (si quedan dos o más, siguen juntos). */
export function unlink<T extends { superset: number | null }>(list: T[], i: number): T[] {
  return normaliseSupersets(list.map((e, j) => (j === i ? { ...e, superset: null } : e)));
}

export function newSet(prev?: PlannedSet): PlannedSet {
  return prev
    ? { ...prev }
    : { set_type: "normal", reps: null, reps_max: null, weight_kg: null, rpe: null, rir: null };
}

/** Lee un número que el usuario escribe (coma o punto, un solo separador). `null` si vacío;
 * `undefined` si no es un número válido. */
export function parseNumber(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+([.,]\d+)?$/.test(t)) return undefined;
  return Number(t.replace(",", "."));
}

/** El rango de repeticiones de una serie como texto («8-12», «8», «—»). */
export function repsLabel(s: Pick<PlannedSet, "reps" | "reps_max">): string {
  if (s.reps === null) return "—";
  return s.reps_max !== null && s.reps_max !== s.reps ? `${s.reps}-${s.reps_max}` : String(s.reps);
}

/** El borrador que se guarda a partir de una rutina leída del servidor. */
export function toDraft(r: Routine): RoutineDraft {
  return {
    title: r.title,
    notes: r.notes,
    folder: r.folder,
    exercises: r.exercises.map((e) => ({
      exercise_key: e.exercise_key,
      name: e.name,
      superset: e.superset,
      notes: e.notes,
      rest_s: e.rest_s,
      sets: e.sets,
    })),
  };
}

export const START_PATH = (id: number) => `/training/gym/session?routine=${id}`;
