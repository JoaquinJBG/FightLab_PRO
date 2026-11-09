"use client";

// Catálogo de cadena privado (fase 13). El usuario sube su propio CSV (la tabla puntuada o la de la
// app del Entrenador IA); el servidor lo lee, lo valora con su motor (Nutri-Score + semáforo FSA) y
// lo guarda en su cuenta, sin compartirlo con nadie. Aquí solo se sube el archivo, se pinta la vista
// previa (`dry_run`) y se importa. La app nunca descarga datos de la cadena ni de sus fuentes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const BASE = "/api/proxy/coach";
export const MAX_FILE_MB = 5; // el tope del servidor (MAX_IMPORT_BYTES)
export const CATALOGUE_ACCEPT = ".csv,.txt,text/csv";
export const DEFAULT_CHAIN = "Mercadona";
export const RATINGS = ["bueno", "regular", "evitar", "sin datos", "no aplica"] as const;
export type RatingValue = (typeof RATINGS)[number];

/** Clave de texto de una valoración (`sin datos` → `noData`). */
export const RATING_KEY: Record<RatingValue, string> = {
  bueno: "good", regular: "fair", evitar: "avoid", "sin datos": "noData", "no aplica": "notFood",
};

const reason = z.object({ code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) });

export const importResult = z.object({
  dry_run: z.boolean(),
  format: z.enum(["scored", "table"]),
  chain: z.string(),
  rows: z.number(),
  new: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  discarded_total: z.number(),
  discarded: z.array(z.object({ code: z.string(), field: z.string(), count: z.number(), lines: z.array(z.number()) })),
  ratings: z.record(z.string(), z.number()),
  review: z.number(),
  differences: z.object({
    count: z.number(),
    examples: z.array(z.object({ line: z.number(), name: z.string(), file: z.string(), engine: z.string() })),
  }),
  notices: z.array(z.object({ code: z.string(), count: z.number() })),
  rule_key: z.string(),
  rule_grades: z.record(z.string(), z.string()).default({}),
});
export type ImportResult = z.infer<typeof importResult>;

export const chainProduct = z.object({
  id: z.number(),
  chain: z.string(),
  chain_ref: z.string().nullable(),
  ean: z.string().nullable(),
  name: z.string(),
  brand: z.string(),
  pack: z.string(),
  price_per_kg: z.number().nullable(),
  equivalent_of: z.string().nullable(),
  per: z.string(),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  nutriscore: z.string().nullable(),
  rating: z.string(),
  check: z.string().nullable(),
  reasons: z.array(reason),
  file_rating: z.string().nullable(),
  rule_key: z.string(),
}).passthrough();
export type ChainProduct = z.infer<typeof chainProduct>;

export const threshold = z.object({
  key: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string(),
  source: z.enum(["fsa_2016", "nutriscore_2023", "eu_1169_2011", "convention"]),
});
export type Threshold = z.infer<typeof threshold>;

export const catalogue = z.object({
  total: z.number(),
  chains: z.array(z.string()),
  ratings: z.record(z.string(), z.number()),
  review: z.number(),
  matched: z.number(),
  products: z.array(chainProduct),
  thresholds: z.array(threshold),
  rule_key: z.string(),
  energy_rule_key: z.string(),
  rule_grades: z.record(z.string(), z.string()).default({}),
});
export type Catalogue = z.infer<typeof catalogue>;

export const substitutesResult = z.object({
  food: z.object({ name: z.string(), grams: z.number(), kcal: z.number(), rating: z.string().nullable() }),
  substitutes: z.array(z.object({
    name: z.string(),
    kind: z.enum(["food", "product", "chain"]),
    chain: z.string().nullable(),
    pack: z.string().nullable(),
    grams: z.number(),
    kcal: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    rating: z.string().nullable(),
    check: z.string().nullable(),
    penalised: z.boolean(),
  }).passthrough()),
  rule_key: z.string(),
  rule_grades: z.record(z.string(), z.string()).default({}),
});
export type SubstitutesResult = z.infer<typeof substitutesResult>;

/** Un error de la subida: `code` se traduce (`chainCatalogue.errors.*`). */
export class CatalogueError extends Error {
  constructor(public code: string, public params: Record<string, string | number> = {}) {
    super(code);
  }
}

export const CATALOGUE_ERROR_CODES = [
  "missing_file", "too_large", "not_csv", "unknown_columns", "empty_file", "bad_encoding", "too_many_rows",
] as const;

/** Lo que se comprueba antes de subir nada. */
export function checkFile(file: File | null): CatalogueError | null {
  if (!file) return new CatalogueError("missing_file");
  if (file.size > MAX_FILE_MB * 1024 * 1024) return new CatalogueError("too_large", { mb: MAX_FILE_MB });
  if (!/\.(csv|txt)$/i.test(file.name)) return new CatalogueError("not_csv");
  return null;
}

async function failure(res: Response): Promise<CatalogueError> {
  const data = await res.json().catch(() => ({}));
  if (res.status === 400 && typeof data?.code === "string") {
    const code = (CATALOGUE_ERROR_CODES as readonly string[]).includes(data.code) ? data.code : "server";
    return new CatalogueError(code, typeof data.params === "object" && data.params ? data.params : {});
  }
  return new CatalogueError(res.status === 429 ? "throttled" : "server");
}

export function useImportCatalogue() {
  const qc = useQueryClient();
  return useMutation<ImportResult, CatalogueError, { file: File | null; dryRun: boolean; chain: string }>({
    mutationFn: async ({ file, dryRun, chain }) => {
      const problem = checkFile(file);
      if (problem) throw problem;
      const form = new FormData();
      form.append("file", file!);
      form.append("chain", chain.trim() || DEFAULT_CHAIN);
      if (dryRun) form.append("dry_run", "1");
      const res = await fetch(`${BASE}/chain-products/import`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw await failure(res);
      return importResult.parse(await res.json());
    },
    onSuccess: (result) => {
      if (!result.dry_run) qc.invalidateQueries({ queryKey: ["chain-catalogue"] });
    },
  });
}

export function useChainCatalogue(query: string, rating: string) {
  return useQuery<Catalogue, CatalogueError>({
    queryKey: ["chain-catalogue", query.trim(), rating],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (rating) params.set("rating", rating);
      const res = await fetch(`${BASE}/chain-products?${params}`, { credentials: "include" });
      if (!res.ok) throw await failure(res);
      return catalogue.parse(await res.json());
    },
  });
}

export function useDeleteCatalogue() {
  const qc = useQueryClient();
  return useMutation<number, CatalogueError, void>({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/chain-products`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw await failure(res);
      return z.object({ deleted: z.number() }).parse(await res.json()).deleted;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chain-catalogue"] }),
  });
}

/** Sustitutos isocalóricos de un alimento (los `evitar`, al final). `null`: alimento desconocido. */
export function useSubstitutes() {
  return useMutation<SubstitutesResult | null, CatalogueError, { food: string; grams: number }>({
    mutationFn: async ({ food, grams }) => {
      const params = new URLSearchParams({ food, grams: String(grams) });
      const res = await fetch(`${BASE}/substitutes?${params}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res);
      return substitutesResult.parse(await res.json());
    },
  });
}

/** El coste estimado de una cantidad a partir del precio por kilo (o litro); `null` sin precio. */
export function estimatedCost(grams: number, pricePerKg: number | null | undefined): number | null {
  if (pricePerKg == null || !Number.isFinite(grams) || grams < 0) return null;
  return Math.round((grams / 1000) * pricePerKg * 100) / 100;
}

export function isRating(value: string | null | undefined): value is RatingValue {
  return !!value && (RATINGS as readonly string[]).includes(value);
}
