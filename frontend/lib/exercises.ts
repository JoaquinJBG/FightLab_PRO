"use client";

// Biblioteca de ejercicios (F17): catálogo de la app (`cat:<slug>`) y ejercicios propios del
// usuario (`custom:<id>`), servidos por `api/v1/gym/exercises` (backend/exercises). El selector
// (`components/exercises/ExercisePicker`) pide la lista entera una vez y filtra en el navegador,
// con la misma búsqueda que el servidor: sin mayúsculas ni acentos y en los dos idiomas.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

/* ------------------------------ vocabulario ------------------------------ */
// Los mismos slugs que backend/exercises/vocab.py (los textos, en messages: exercises.muscles.*).

export const MUSCLES = [
  "chest", "lats", "upper_back", "traps", "lower_back", "front_delts", "side_delts", "rear_delts",
  "biceps", "triceps", "forearms", "abs", "obliques", "quads", "hamstrings", "glutes", "adductors",
  "abductors", "calves", "neck", "hip_flexors", "full_body", "cardio",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = [
  "barbell", "dumbbell", "kettlebell", "machine", "cable", "smith_machine", "ez_bar", "bench",
  "pull_up_bar", "band", "plate", "medicine_ball", "suspension", "heavy_bag", "jump_rope", "mat",
  "bodyweight", "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const CATEGORIES = ["strength", "mobility", "combat", "cardio"] as const;
export type Category = (typeof CATEGORIES)[number];

/* --------------------------------- tipos --------------------------------- */

export const exerciseImage = z.object({
  url: z.string(),
  source: z.string(),
  author: z.string(),
  license: z.string(),
  license_url: z.string(),
  source_url: z.string(),
  modified: z.string().default(""),
});
export type ExerciseImage = z.infer<typeof exerciseImage>;

export const textCredit = z
  .object({
    source: z.string(),
    author: z.string().optional(),
    license: z.string().optional(),
    license_url: z.string().optional(),
    source_url: z.string().optional(),
    modified: z.string().optional(),
  })
  .nullable();

export const exerciseSchema = z.object({
  key: z.string(),
  id: z.number().optional(),
  name: z.string(),
  aliases: z.array(z.string()),
  primary_muscles: z.array(z.string()),
  secondary_muscles: z.array(z.string()),
  equipment: z.array(z.string()),
  category: z.string().default("strength"),
  images: z.array(exerciseImage),
  instructions: z.array(z.string()),
  instructions_lang: z.string().nullable().default(null),
  text_credit: textCredit.default(null),
  notes: z.string().default(""),
  source: z.string(),
  attribution: z.string().nullable(),
  custom: z.boolean(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

export type CustomExerciseInput = {
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string[];
  notes: string;
};

/* --------------------------------- claves -------------------------------- */

export const isCustomKey = (key: string) => key.startsWith("custom:");
export const isCatalogKey = (key: string) => key.startsWith("cat:");

/** Ruta del proxy para la ficha. El BFF no deja pasar «:» en un segmento, así que
 * `cat:<slug>` va como `gym/exercises/cat/<slug>` y `custom:<id>` como `gym/exercises/custom/<id>`. */
export function exerciseApiPath(key: string): string | null {
  const m = /^(cat|custom):([A-Za-z0-9._~-]+)$/.exec(key);
  if (!m) return null;
  return `gym/exercises/${m[1]}/${m[2]}`;
}

/** Ruta de la ficha en la app: /training/exercises/cat/<slug> o /training/exercises/custom/<id>. */
export function exerciseHref(key: string): string | null {
  const path = exerciseApiPath(key);
  return path ? `/training/exercises/${path.slice("gym/exercises/".length)}` : null;
}

/* --------------------------------- búsqueda ------------------------------ */

/** Minúsculas, sin acentos y con la puntuación como espacios (igual que `catalog.normalize`). */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rank(names: string[], query: string, tokens: string[]): number | null {
  const norm = names.map(normalize);
  if (!norm.length) return null;
  if (norm.includes(query)) return 0;
  if (norm.some((n) => n.startsWith(query))) return 1;
  if (norm.some((n) => n.includes(query))) return 2;
  const hay = norm.join(" ");
  return tokens.every((t) => hay.includes(t)) ? 3 : null;
}

export type ExerciseFilter = { q?: string; muscle?: string; equipment?: string };

/** La búsqueda del servidor en el navegador: el nombre antes que los alias, el músculo
 * principal antes que el secundario y, sin búsqueda, por orden alfabético. */
export function filterExercises(list: Exercise[], { q = "", muscle = "", equipment = "" }: ExerciseFilter): Exercise[] {
  const query = normalize(q);
  const tokens = query.split(" ").filter(Boolean);
  const scored: { score: [number, number, string]; ex: Exercise }[] = [];
  for (const ex of list) {
    if (muscle && !ex.primary_muscles.includes(muscle) && !ex.secondary_muscles.includes(muscle)) continue;
    if (equipment && !ex.equipment.includes(equipment)) continue;
    let r = 0;
    if (query) {
      const byName = rank([ex.name], query, tokens);
      if (byName !== null) r = byName * 2;
      else {
        const byAlias = rank(ex.aliases, query, tokens);
        if (byAlias === null) continue;
        r = byAlias * 2 + 1;
      }
    }
    const secondaryOnly = muscle && !ex.primary_muscles.includes(muscle) ? 1 : 0;
    scored.push({ score: [secondaryOnly, r, normalize(ex.name)], ex });
  }
  scored.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2].localeCompare(b.score[2]));
  return scored.map((s) => s.ex);
}

/* ---------------------------------- API ---------------------------------- */

const BASE = "/api/proxy/gym/exercises";

export class ExerciseApiError extends Error {
  constructor(
    public status: number,
    public fields: Record<string, string[]> = {},
  ) {
    super(String(status));
  }
}

async function errorFrom(res: Response): Promise<ExerciseApiError> {
  let fields: Record<string, string[]> = {};
  try {
    const body = await res.json();
    if (body && typeof body === "object") {
      fields = Object.fromEntries(
        Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]),
      );
    }
  } catch { /* sin cuerpo */ }
  return new ExerciseApiError(res.status, fields);
}

export async function fetchExercises(params: ExerciseFilter & { lang?: string } = {}): Promise<Exercise[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const res = await fetch(`${BASE}${qs.size ? `?${qs}` : ""}`, { credentials: "include" });
  if (!res.ok) throw await errorFrom(res);
  return z.array(exerciseSchema).parse(await res.json());
}

export async function fetchExercise(key: string, lang?: string): Promise<Exercise | null> {
  const path = exerciseApiPath(key);
  if (!path) return null;
  const res = await fetch(`/api/proxy/${path}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res);
  return exerciseSchema.parse(await res.json());
}

async function send(method: string, url: string, body?: unknown): Promise<Exercise | null> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return null;
  return exerciseSchema.parse(await res.json());
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<Exercise> {
  return (await send("POST", `${BASE}/custom`, input)) as Exercise;
}

export async function updateCustomExercise(id: number, input: Partial<CustomExerciseInput>): Promise<Exercise> {
  return (await send("PATCH", `${BASE}/custom/${id}`, input)) as Exercise;
}

export async function deleteCustomExercise(id: number): Promise<void> {
  await send("DELETE", `${BASE}/custom/${id}`);
}

export const exercisesQueryKey = (lang: string) => ["exercises", lang] as const;

/** La lista entera (biblioteca y propios) en el idioma de la app; se filtra en el navegador. */
export function useExercises(lang: string) {
  return useQuery({
    queryKey: exercisesQueryKey(lang),
    staleTime: 5 * 60_000,
    queryFn: () => fetchExercises({ lang }),
  });
}

export function useExercise(key: string, lang: string) {
  return useQuery({
    queryKey: ["exercise", key, lang],
    staleTime: 5 * 60_000,
    queryFn: () => fetchExercise(key, lang),
  });
}

/* -------------------------------- recientes ------------------------------ */
// Los últimos elegidos en este dispositivo (como «Recientes» de Hevy). Lleva el prefijo flp_:
// si entra otra cuenta en el dispositivo, se purga con el resto.

export const RECENT_KEY = "flp_ex_recent";
export const RECENT_MAX = 12;

export function loadRecentKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentKeys(keys: string[]): string[] {
  const next = [...new Set([...keys.slice().reverse(), ...loadRecentKeys()])].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* sin almacenamiento */ }
  return next;
}

export function forgetRecentKey(key: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecentKeys().filter((k) => k !== key)));
  } catch { /* sin almacenamiento */ }
}
