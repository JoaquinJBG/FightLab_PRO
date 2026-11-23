"use client";

// Menús y lista de la compra (fase 8). El servidor propone los platos (con un LLM simulado) y el
// motor del coach comprueba cada día contra los objetivos: aquí solo se pinta, se guardan los
// gustos y se valoran los platos. Los productos del súper salen de Open Food Facts por el proxy
// del servidor, que puede no estar configurado (`off_not_configured`).
//
// Fase 12: menús completos (JSON `schema: 1` y YAML del coach importados), sesiones de batch con su
// cronograma por aparato, nevera o congelador de cada tupper, tareas de la víspera y la lista de la
// compra por sección, con formato, semana y casillas.

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

export const APPLIANCES = ["pressure_cooker", "pot", "wok", "frying_pan", "air_fryer", "oven", "microwave", "hands"] as const;
export type Appliance = (typeof APPLIANCES)[number];

const batchStep = z.union([
  z.string(),
  z.object({ step: z.string(), min: z.number().optional(), where: z.string().optional(), where_label: z.string().optional() }),
]);

export const menuDish = z.object({
  id: z.string().nullable().optional(),
  dish: z.string(),
  source: z.string().nullable(),
  servings: z.number(),
  seasoning: z.array(z.string()),
  steps: z.array(z.string()),
  steps_batch: z.array(batchStep).optional().default([]),
  storage: z.record(z.string(), z.unknown()).nullable().optional(),
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

export const mealStorage = z.object({
  where: z.enum(["fridge", "freezer"]),
  days: z.number(),
  rice: z.boolean(),
  rules: z.array(z.string()),
  no_freeze: z.array(z.string()).optional(),
  session_date: z.string().optional(),
});
export type MealStorage = z.infer<typeof mealStorage>;

export const eveTask = z.object({
  kind: z.enum(["meal", "batch", "defrost"]),
  text: z.string().optional(),
  meal: z.string().nullable().optional(),
  dish: z.string().optional(),
  rule_key: z.string().optional(),
});
export type EveTask = z.infer<typeof eveTask>;

export const menuMeal = z.object({
  meal: z.string(),
  label: z.string().nullable().optional(),
  tupper: z.boolean(),
  free: z.boolean(),
  free_budget_kcal: z.number().nullable().optional(),
  dish_id: z.string().nullable().optional(),
  prep: z.array(z.string()).optional().default([]),
  eve: z.array(z.string()).optional().default([]),
  storage: mealStorage.nullable().optional(),
  dishes: z.array(menuDish),
});
export type MenuMeal = z.infer<typeof menuMeal>;

export const menuDay = z.object({
  date: z.string(),
  meals: z.array(menuMeal),
  totals: z.record(z.string(), z.number().nullable()).nullable().optional(),
  check: z.object({ date: z.string(), totals, check, ok: z.boolean() }).passthrough().nullable(),
  eve: z.array(eveTask).optional().default([]),
});
export type MenuDay = z.infer<typeof menuDay>;

export const rejectedDay = z.object({
  date: z.string(),
  check: check.nullable(),
  unknown: z.array(z.string()),
  repeats: z.boolean(),
  blocking: z.array(z.object({ kind: z.string(), entry: z.string() })),
  empty: z.boolean().optional(),
  // R3-1: comidas pedidas para las que no quedó ningún plato que valiera.
  missing: z.array(z.string()).optional().default([]),
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

export const timelineStep = z.object({
  min: z.number(),
  until: z.number(),
  where: z.string(),
  where_label: z.string().optional(),
  step: z.string(),
  dish: z.string().optional(),
  substituted_from: z.string().optional(),
});
export type TimelineStep = z.infer<typeof timelineStep>;

export const batchSession = z.object({
  date: z.string(),
  dishes: z.array(z.object({ id: z.string(), name: z.string(), batch_servings: z.number().nullable().optional() })),
  eve: z.array(z.string()),
  timeline: z.array(timelineStep),
  total_min: z.number(),
  appliances: z.array(z.string()),
  missing: z.array(z.object({ dish: z.string(), step: z.string(), where: z.string() })),
  rebuilt: z.boolean(),
  checked: z.boolean(),
  rules: z.array(z.string()),
});
export type BatchSession = z.infer<typeof batchSession>;

export const PRODUCT_RATINGS = ["bueno", "regular", "evitar", "sin_datos", "no_aplica"] as const;
export type ProductRating = (typeof PRODUCT_RATINGS)[number];

export const shoppingLine = z.object({
  key: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  amount_two: z.number().nullable(),
  unit: z.enum(["g", "ml"]),
  section: z.string(),
  pack: z.string().nullable().optional(),
  chain: z.string().nullable().optional(),
  when: z.array(z.number()),
  // R3-2: lo de cada semana en un menú de más de 7 días ("1", "2"), calculado con los platos.
  by_week: z.record(z.string(), z.number()).nullable().optional(),
  dishes: z.array(z.string()),
  batches: z.unknown().optional(),
  // Producto de la cadena (lo elige la F13 en el servidor): formato, envases, valoración y precio.
  product: z.object({
    chain: z.string().nullable().optional(),
    product: z.string().nullable().optional(),
    pack: z.string().nullable().optional(),
    pack_grams: z.number().nullable().optional(),
    packs: z.number().nullable().optional(),
    section: z.string().nullable().optional(),
    rating: z.enum(PRODUCT_RATINGS).nullable().optional(),
    review: z.boolean().optional(),
    price: z.number().nullable().optional(),
    price_per_kg: z.number().nullable().optional(),
  }).passthrough().nullable(),
  checked: z.boolean(),
});
export type ShoppingLine = z.infer<typeof shoppingLine>;

export const shoppingList = z.object({
  source: z.enum(["menu", "engine"]),
  sections: z.array(z.object({ section: z.string(), items: z.array(shoppingLine) })),
  weeks: z.array(z.number()),
  note: z.string(),
  total: z.number(),
  checked: z.number(),
  unknown: z.array(z.string()),
  pantry_skipped: z.array(z.string()),
  batches: z.array(z.object({ dish: z.string(), servings: z.number(), dates: z.array(z.string()), left_over: z.number() })),
});
export type ShoppingList = z.infer<typeof shoppingList>;

// Fase 14: `user_ai` es el JSON que prepara la IA del propio usuario (skill de Claude Code o pegado).
export const MENU_SOURCES = ["generated", "json", "yaml", "partediario", "user_ai"] as const;
export const MENU_ORIGINS = ["user_ai", "auto", "import"] as const;

export const menu = z.object({
  id: z.number(),
  menu_id: z.string().nullable().optional(),
  title: z.string().optional().default(""),
  source: z.enum(MENU_SOURCES).optional().default("generated"),
  origin: z.enum(MENU_ORIGINS).optional(),
  notes: z.array(z.string()).optional().default([]),
  start_date: z.string(),
  end_date: z.string().optional(),
  imported_at: z.string().nullable().optional(),
  batch_sessions: z.array(batchSession).optional().default([]),
  kitchen_filled: z.boolean().optional().default(false),
  batch_rules: z.array(ruleRef).optional().default([]),
  shopping_list: shoppingList.optional(),
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
  }).partial().passthrough(),
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
  menus: z.array(z.object({
    id: z.number(),
    title: z.string(),
    start_date: z.string(),
    end_date: z.string().nullable(),
    source: z.string(),
    origin: z.string().optional(),
    menu_id: z.string().nullable(),
  })).optional().default([]),
  tastes,
  max_days: z.number(),
  meals: z.array(z.enum(MEALS)),
});
export type MenuState = z.infer<typeof menuState>;

export type MenuRequest = { start_date: string; days: number; meals: MealKey[]; tupper_meals: MealKey[]; batch?: boolean };

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

/** El último menú guardado o, con `id`, otro de los guardados. */
export function useMenu(id?: number | null) {
  return useQuery<MenuState>({
    queryKey: id ? ["menu", id] : ["menu"],
    queryFn: async () => menuState.parse(await send(`${BASE}/menu${id ? `?id=${id}` : ""}`, "GET")),
    // Al cambiar de menú se sigue viendo el anterior hasta que llega el nuevo (no se desmonta la
    // pantalla, p. ej. el aviso de "importado").
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------- importar (fase 12)

export const MENU_ACCEPT = ".json,.yaml,.yml,application/json,application/x-yaml,text/yaml";
export const MAX_MENU_MB = 2;

export const importResponse = z.object({
  summary: z.object({
    menu_id: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    days: z.number(),
    dishes: z.number(),
    batch_sessions: z.number(),
    shopping_items: z.number(),
    source: z.string(),
  }),
  replaced: z.boolean(),
  kept_checks: z.number(),
  menu,
});
export type ImportResponse = z.infer<typeof importResponse>;

/** Importa un menú (JSON `schema: 1` o YAML del coach). `start_taken` (409): otro menú empieza
 * ese día; se repite con `replaceStart` para sustituirlo. */
export function useImportMenu() {
  const qc = useQueryClient();
  return useMutation<ImportResponse, MenuError, { file: File; replaceStart?: boolean }>({
    mutationFn: async ({ file, replaceStart }) => {
      if (file.size > MAX_MENU_MB * 1024 * 1024) throw new MenuError("import_invalid", "");
      const form = new FormData();
      form.append("file", file);
      if (replaceStart) form.append("replace_start", "true");
      const res = await fetch(`${BASE}/menu/import`, { method: "POST", credentials: "include", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "", data);
      }
      return importResponse.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["menu"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useDeleteMenu() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, number>({
    mutationFn: async (id) => {
      const res = await fetch(`${BASE}/menu/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new MenuError(String(res.status), "");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/** Tacha o destacha una línea de la lista de la compra (se guarda en el servidor). */
export function useShoppingCheck(menuId: number) {
  const qc = useQueryClient();
  return useMutation<ShoppingList, MenuError, { item: string; checked: boolean }>({
    mutationFn: async (body) => shoppingList.parse(await send(`${BASE}/menu/${menuId}/shopping`, "PUT", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/** Si la lista se puede repartir por semanas: el menú tiene dos y alguna línea dice cuándo. */
export function hasWeeks(list: ShoppingList): boolean {
  return list.weeks.length > 1 && list.sections.some((s) => s.items.some((i) => i.when.length > 0));
}

/** Una línea por semana elegida (`0` = todas): las que no dicen semana van siempre. */
export function filterByWeek(list: ShoppingList, week: number): ShoppingList["sections"] {
  if (!week) return list.sections;
  return list.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.when.length === 0 || i.when.includes(week)) }))
    .filter((s) => s.items.length > 0);
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

/** La valoración del motor de la fase 13 (Nutri-Score + semáforo FSA), la misma que en el catálogo
 * de cadena. Opcional: las respuestas guardadas antes de la fase 13 no la traen. */
export const productRating = z.object({
  rating: z.string(),
  check: z.string(),
  nutriscore: z.string().nullable(),
  rule_key: z.string(),
}).passthrough();

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
  rating: productRating.optional(),
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
  rating: productRating.optional(),
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

/** Descarga el PDF del menú (`/api/menu-pdf/<id>`, hecho en memoria en el servidor). Lanza
 * `MenuError` con el código del servidor si no se puede (p. ej. `no_calorie_targets`). */
export async function downloadMenuPdf(id: number): Promise<void> {
  const res = await fetch(`/api/menu-pdf/${id}`, { credentials: "include" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("application/pdf")) {
    const data = await res.json().catch(() => ({}));
    throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), "");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "fightlab-menu.pdf";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Las reglas de batch cooking del anexo de FightLab (`knowledge_fightlab/batch-cooking.md`) y el
// nombre corto con que se traducen en la app.
export const BATCH_RULES = {
  order: "batch-cooking/order-the-batch-session-from-longest-to-shortest-in-parallel-by-appliance",
  cool: "batch-cooking/cool-cooked-food-and-refrigerate-it-within-2-hours-rice-within-1-hour",
  fridge: "batch-cooking/eat-from-the-fridge-within-2-days-and-freeze-the-rest-the-same-day",
  no_freeze: "batch-cooking/do-not-freeze-potatoes-mayonnaise-fried-food-or-yogurt-sauces",
  defrost: "batch-cooking/defrost-in-the-fridge-the-night-before",
  reheat: "batch-cooking/reheat-until-steaming-hot-throughout-and-reheat-rice-only-once",
  air_fryer: "batch-cooking/check-air-fried-meat-with-a-thermometer",
  label: "batch-cooking/label-each-container-with-the-dish-and-the-date-first-in-first-out",
} as const;
export type BatchRuleName = keyof typeof BATCH_RULES;

export function batchRuleName(key: string): BatchRuleName | null {
  const hit = Object.entries(BATCH_RULES).find(([, k]) => k === key);
  return hit ? (hit[0] as BatchRuleName) : null;
}
