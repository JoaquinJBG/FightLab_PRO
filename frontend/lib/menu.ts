"use client";

// Menús y lista de la compra (fase 8). El servidor propone los platos (con un LLM simulado) y el
// motor del coach comprueba cada día contra los objetivos: aquí solo se pinta, se guardan los
// gustos y se valoran los platos. Los productos del súper salen de Open Food Facts por el proxy
// del servidor, que puede no estar configurado (`off_not_configured`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { coachReason, ruleRef } from "./schemas";

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealKey = (typeof MEALS)[number];
export const RATINGS = ["loved", "liked", "disliked", "never_again"] as const;
export type Rating = (typeof RATINGS)[number];
export const STATUSES = ["ok", "under", "over", "missing"] as const;

const status = z.enum(STATUSES);

export const menuItem = z.object({
  name: z.string(),
  amount: z.number(),
  unit: z.enum(["g", "ml"]),
  known: z.boolean(),
  product: z.boolean(),
  url: z.string().nullable(),
});
export type MenuItem = z.infer<typeof menuItem>;

export const menuDish = z.object({
  dish: z.string(),
  source: z.string().nullable(),
  servings: z.number(),
  seasoning: z.array(z.string()),
  steps: z.array(z.string()),
  items: z.array(menuItem),
});
export type MenuDish = z.infer<typeof menuDish>;

const totals = z.object({
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fibre_g: z.number(),
  unknown: z.array(z.string()),
  missing: z.record(z.string(), z.array(z.string())),
});

const check = z.object({ kcal: status, protein_g: status, fat_g: status, fibre_g: status });
export type DayCheck = z.infer<typeof check>;

export const menuDay = z.object({
  date: z.string(),
  meals: z.array(z.object({ meal: z.string(), tupper: z.boolean(), free: z.boolean(), dishes: z.array(menuDish) })),
  check: z.object({ date: z.string(), totals, check, ok: z.boolean() }).passthrough().nullable(),
});
export type MenuDay = z.infer<typeof menuDay>;

export const rejectedDay = z.object({
  date: z.string(),
  check: check.nullable(),
  unknown: z.array(z.string()),
  repeats: z.boolean(),
  blocking: z.array(z.object({ kind: z.string(), entry: z.string() })),
  empty: z.boolean().optional(),
});
export type RejectedDay = z.infer<typeof rejectedDay>;

const tasteFlag = z.object({
  date: z.string(),
  dish: z.string(),
  kind: z.string(),
  where: z.string(),
  entry: z.string(),
  text: z.string(),
  blocking: z.boolean(),
});

export const menu = z.object({
  id: z.number(),
  start_date: z.string(),
  provider: z.string(),
  days: z.array(menuDay),
  rejected: z.array(rejectedDay),
  taste_flags: z.array(tasteFlag),
  targets: z.object({
    kcal: z.number(),
    protein_g: z.number(),
    fat_min_g: z.number(),
    fibre_g: z.number(),
    in_deficit: z.boolean(),
  }).passthrough(),
  rules: z.record(z.string(), z.array(ruleRef)),
  shopping: z.object({
    chains: z.array(z.object({
      chain: z.string(),
      items: z.array(z.object({ name: z.string(), grams: z.number().optional(), ml: z.number().optional() })),
    })),
    unknown: z.array(z.string()),
    batches: z.array(z.object({ dish: z.string(), servings: z.number(), dates: z.array(z.string()), left_over: z.number() })),
    pantry_skipped: z.array(z.string()),
  }),
  conventions: z.object({ kcal_margin: z.number(), no_repeat_days: z.number() }),
  engine_sha: z.string(),
  created_at: z.string(),
});
export type Menu = z.infer<typeof menu>;

const words = z.array(z.string()).nullable();
export const tastes = z.object({
  loved_foods: words,
  disliked_foods: words,
  allergies: words,
  intolerances: words,
  cuisines: words,
  flavours: words,
  equipment: words,
  chains: words,
  pantry: words,
  untried: words,
  cooking_minutes: z.number().nullable(),
  cooking_skill: z.string().nullable(),
  budget: z.string().nullable(),
  missing: z.array(z.string()),
  favoured: z.array(z.string()),
  disliked: z.array(z.string()),
  excluded: z.array(z.string()),
});
export type Tastes = z.infer<typeof tastes>;
export const TASTE_LISTS = ["allergies", "intolerances", "disliked_foods", "loved_foods", "pantry", "chains"] as const;
export type TasteList = (typeof TASTE_LISTS)[number];

export const menuState = z.object({
  today: z.string(),
  blocked: z.object({ code: z.literal("no_calorie_targets"), reasons: z.array(coachReason) }).nullable(),
  missing: z.string().nullable(),
  menu: menu.nullable(),
  tastes,
  max_days: z.number(),
  meals: z.array(z.enum(MEALS)),
});
export type MenuState = z.infer<typeof menuState>;

export type MenuRequest = { start_date: string; days: number; meals: MealKey[]; tupper_meals: MealKey[] };

/** Error de la API con su código (`menu_rejected`, `no_calorie_targets`, `off_not_configured`…). */
export class MenuError extends Error {
  constructor(public code: string, message: string, public data: unknown = null) {
    super(message);
  }
}

async function send(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MenuError(
      typeof data?.code === "string" ? data.code : String(res.status),
      typeof data?.detail === "string" ? data.detail : "",
      data,
    );
  }
  return data;
}

const BASE = "/api/proxy/coach";

export function useMenu() {
  return useQuery<MenuState>({
    queryKey: ["menu"],
    queryFn: async () => menuState.parse(await send(`${BASE}/menu`, "GET")),
  });
}

export function useGenerateMenu() {
  const qc = useQueryClient();
  return useMutation<Menu, MenuError, MenuRequest>({
    mutationFn: async (body) => menu.parse(await send(`${BASE}/menu`, "POST", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUpdateTastes() {
  const qc = useQueryClient();
  return useMutation<Tastes, MenuError, Partial<Record<TasteList, string[]>>>({
    mutationFn: async (body) => tastes.parse(await send(`${BASE}/tastes`, "PUT", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useRateDish() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, { dish: string; rating: Rating }>({
    mutationFn: (body) => send(`${BASE}/menu/rate`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/** "pollo, arroz,  avena" → ["pollo", "arroz", "avena"]. */
export function splitWords(text: string): string[] {
  return [...new Set(text.split(",").map((w) => w.trim().replace(/\s+/g, " ")).filter(Boolean))];
}

// ---------------------------------------------------------------- alimentos y productos

export const food = z.object({
  name: z.string(),
  name_es: z.string(),
  name_en: z.string(),
  per: z.enum(["100 g", "100 ml"]),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fibre_g: z.number().nullable(),
  missing: z.array(z.string()),
  source: z.string(),
  kind: z.enum(["food", "product"]),
  barcode: z.string().nullable(),
  chain: z.string().nullable(),
  url: z.string().nullable(),
  unverified: z.boolean(),
});
export type Food = z.infer<typeof food>;

/** Alimentos de la tabla del motor y productos del catálogo (`/coach/foods`), en el idioma del
 * usuario. Sustituye a la lista de ejemplo que tenía `lib/nutrition.ts`. */
export function useFoodSearch(query: string) {
  const q = query.trim();
  return useQuery<Food[]>({
    queryKey: ["foods", q],
    queryFn: async () => z.object({ foods: z.array(food) }).parse(
      await send(`${BASE}/foods?q=${encodeURIComponent(q)}`, "GET"),
    ).foods,
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

export const offProduct = z.object({
  barcode: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  stores: z.string().nullable(),
  per: z.string().nullable(),
  values: z.record(z.string(), z.number().nullable()),
  missing: z.array(z.string()),
  allergens: z.array(z.string()),
  url: z.string(),
});
export type OffProduct = z.infer<typeof offProduct>;

export const catalogueProduct = z.object({
  barcode: z.string(),
  product_name: z.string(),
  brand: z.string(),
  chain: z.string(),
  per: z.string(),
  kcal: z.number().nullable(),
  missing: z.array(z.string()),
  allergens: z.array(z.string()),
  url: z.string(),
  unverified: z.boolean(),
}).passthrough();
export type CatalogueProduct = z.infer<typeof catalogueProduct>;

export function useCatalogue() {
  return useQuery<CatalogueProduct[]>({
    queryKey: ["catalogue"],
    queryFn: async () => z.object({ products: z.array(catalogueProduct) }).parse(await send(`${BASE}/products`, "GET")).products,
  });
}

/** Búsqueda en Open Food Facts por el proxy del servidor. */
export function useProductSearch() {
  return useMutation<OffProduct[], MenuError, string>({
    mutationFn: async (q) => z.object({ hits: z.array(offProduct) }).parse(
      await send(`${BASE}/products/search?q=${encodeURIComponent(q)}`, "GET"),
    ).hits,
  });
}

export function useAddProduct() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, { barcode: string; chain?: string }>({
    mutationFn: (body) => send(`${BASE}/products`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue"] }),
  });
}

export function useRemoveProduct() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, string>({
    mutationFn: async (barcode) => {
      const res = await fetch(`${BASE}/products/${barcode}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new MenuError(String(res.status), "");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue"] }),
  });
}
