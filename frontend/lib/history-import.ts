"use client";

// Importar el historial de ParteDiario y del coach (fase 10, `POST /coach/import/history`). El
// servidor reconoce cada archivo, valida con las reglas del check-in, compara con lo que ya hay y
// guarda; aquí solo se suben los archivos y se pinta el resumen. Primero se revisa (`dry_run`) y
// luego se importa con la opción elegida para los días en conflicto.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { importResult } from "./gym-import";

export const MAX_HISTORY_FILES = 60; // los mismos topes que el servidor
export const MAX_HISTORY_MB = 25;
export const MAX_FILE_MB = 5;
export const HISTORY_ACCEPT = ".json,.csv,.txt,.md,application/json,text/csv,text/markdown";
export const CONFLICT_MODES = ["keep", "replace"] as const;
export type ConflictMode = (typeof CONFLICT_MODES)[number];

const fileError = z.object({ code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) });

export const historyResult = z.object({
  dry_run: z.boolean(),
  on_conflict: z.enum(CONFLICT_MODES),
  files: z.array(z.object({
    name: z.string(),
    kind: z.string().nullable(),
    days: z.number(),
    reviews: z.number(),
    error: fileError.nullable(),
  })),
  days: z.object({
    total: z.number(), new: z.number(), filled: z.number(), conflict: z.number(), unchanged: z.number(), written: z.number(),
  }),
  conflicts: z.array(z.object({ date: z.string(), fields: z.array(z.string()) })),
  range: z.object({ first: z.string(), last: z.string() }).nullable(),
  items: z.object({
    checkins: z.number(), weights: z.number(), waists: z.number(), resting_hr: z.number(),
    meals: z.number(), cardio: z.number(), day_logs: z.number(), heart: z.number(),
  }),
  reviews: z.object({
    total: z.number(), new: z.number(), conflict: z.number(), unchanged: z.number(), kept_app: z.number(), written: z.number(),
  }),
  // Fase 12: los menús de la copia de ParteDiario y lo tachado de sus listas.
  menus: z.object({
    total: z.number(), new: z.number(), replaced: z.number(), kept: z.number(), invalid: z.number(), checks: z.number(),
  }).optional(),
  sets: z.array(z.object({
    name: z.string(),
    // `coach_sessions` es el `sessions.csv` del coach; el resto, como en la fase 9.
    result: importResult.extend({ importer: z.string() }).nullable(),
    error: fileError.nullable(),
  })),
  discarded: z.array(z.object({ code: z.string(), field: z.string(), count: z.number(), examples: z.array(z.string()) })),
  weight_blocked: z.object({ active: z.boolean(), count: z.number(), fields: z.array(z.string()) }),
  notices: z.array(z.object({ code: z.string(), count: z.number() })),
});
export type HistoryResult = z.infer<typeof historyResult>;

/** ¿No hay nada que escribir? Ni días, ni revisiones, ni series, ni menús nuevos. */
export function nothingToImport(r: HistoryResult): boolean {
  const sets = r.sets.filter((s) => s.result);
  return r.days.written === 0 && r.days.conflict === 0 && r.reviews.written === 0 && r.reviews.conflict === 0
    && sets.every((s) => s.result!.sets.imported === 0)
    && !(r.menus && (r.menus.new > 0 || r.menus.replaced > 0));
}

/** F17 de la prueba en móvil: ¿no se ha podido leer ningún archivo? (formato desconocido, o un CSV
 * de series con error). Entonces no es «todo ya estaba»: es que no se entendió nada. */
export function allFilesUnreadable(r: HistoryResult): boolean {
  const readable = (f: HistoryResult["files"][number]) =>
    !!f.kind && !f.error && (f.kind !== "sets" || r.sets.some((s) => s.name === f.name && s.result));
  return r.files.length > 0 && !r.files.some(readable);
}

/** Un error de toda la subida (no de un archivo): `code` se traduce. */
export class HistoryImportError extends Error {
  constructor(public code: string, public params: Record<string, string | number> = {}) {
    super(code);
  }
}

export const HISTORY_ERROR_CODES = ["missing_file", "too_many_files", "too_large", "bad_conflict_mode", "too_many_days"] as const;

/** Los topes que se comprueban antes de subir nada. */
export function checkFiles(files: File[]): HistoryImportError | null {
  if (files.length === 0) return new HistoryImportError("missing_file");
  if (files.length > MAX_HISTORY_FILES) return new HistoryImportError("too_many_files", { max: MAX_HISTORY_FILES });
  if (files.reduce((n, f) => n + f.size, 0) > MAX_HISTORY_MB * 1024 * 1024) return new HistoryImportError("too_large", { mb: MAX_HISTORY_MB });
  return null;
}

export function useImportHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, dryRun, onConflict }: { files: File[]; dryRun: boolean; onConflict: ConflictMode }) => {
      const problem = checkFiles(files);
      if (problem) throw problem;
      const form = new FormData();
      for (const file of files) form.append("files", file);
      form.append("on_conflict", onConflict);
      if (dryRun) form.append("dry_run", "1");
      const res = await fetch("/api/proxy/coach/import/history", { method: "POST", credentials: "include", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && typeof data?.code === "string") {
        const code = (HISTORY_ERROR_CODES as readonly string[]).includes(data.code) ? data.code : "server";
        throw new HistoryImportError(code, typeof data.params === "object" && data.params ? data.params : {});
      }
      if (!res.ok) throw new HistoryImportError(res.status === 429 ? "throttled" : "server");
      return historyResult.parse(data);
    },
    onSuccess: (result) => {
      if (result.dry_run) return;
      for (const key of ["menu", "today", "checkin", "trend", "targets", "biometrics", "weigh-in", "weekly-review", "weekly-plan", "strength-last", "strength-sets"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
