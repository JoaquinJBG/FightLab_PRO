"use client";

// Importar series de un CSV de Hevy o genérico (Task 9.1, `POST /coach/import`). El servidor lee
// el archivo con los importadores del coach, deduplica y guarda en `SetLog`; aquí solo se sube y
// se pinta el resumen.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

export const IMPORTERS = ["auto", "hevy_csv", "generic_csv"] as const;
export type ImporterChoice = (typeof IMPORTERS)[number];
export const MAX_IMPORT_MB = 5; // el mismo tope que el servidor (`MAX_IMPORT_BYTES`)

export const importResult = z.object({
  importer: z.enum(["hevy_csv", "generic_csv"]),
  dry_run: z.boolean(),
  sessions: z.object({ new: z.number(), updated: z.number(), total: z.number() }),
  sets: z.object({ imported: z.number(), duplicates: z.number(), in_file: z.number() }),
  range: z.object({ first: z.string(), last: z.string() }).nullable(),
  warnings: z.array(z.object({ code: z.string(), count: z.number() })),
  // F17: rutinas de Hevy (una por título, con su última sesión), creadas con la API de rutinas
  routines: z.object({ new: z.number(), existing: z.number(), unavailable: z.number() }).optional(),
});
export type ImportResult = z.infer<typeof importResult>;

/** Un archivo que el servidor no ha podido leer: `code` se traduce, `params` van al texto. */
export class ImportError extends Error {
  constructor(public code: string, public params: Record<string, string | number> = {}) {
    super(code);
  }
}

export const IMPORT_ERROR_CODES = [
  "missing_file", "too_large", "not_csv", "empty_file", "encoding", "unknown_format", "ambiguous_format",
  "missing_columns", "decimal_comma", "not_a_number", "not_whole", "bad_date", "no_sets", "too_many_sets", "invalid",
] as const;

export function useImportSets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, importer, dryRun }: { file: File; importer: ImporterChoice; dryRun: boolean }) => {
      if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new ImportError("too_large", { mb: MAX_IMPORT_MB });
      const form = new FormData();
      form.append("file", file);
      form.append("importer", importer);
      if (dryRun) form.append("dry_run", "1");
      const res = await fetch("/api/proxy/coach/import", { method: "POST", credentials: "include", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && typeof data?.code === "string") {
        const code = (IMPORT_ERROR_CODES as readonly string[]).includes(data.code) ? data.code : "invalid";
        throw new ImportError(code, typeof data.params === "object" && data.params ? data.params : {});
      }
      if (!res.ok) throw new ImportError(res.status === 429 ? "throttled" : "server");
      return importResult.parse(data);
    },
    onSuccess: (result) => {
      if (result.dry_run) return;
      for (const key of ["strength-last", "strength-sets", "weekly-plan", "weekly-review"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
