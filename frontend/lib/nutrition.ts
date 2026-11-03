// Lógica y datos de nutrición (mockup). Persistencia local; luego backend + IA.

export type Item = {
  id: string;
  meal: string;
  name: string;
  grams: number | null;
  kcal: number;
  p: number;
  c: number;
  f: number;
};

export const MEALS = ["Desayuno", "Comida", "Cena", "Snack"];

// Los valores de siempre del selector de la pantalla de Nutrición. Los objetivos ya no se
// calculan aquí: salen de `GET /coach/targets` (fase 4).
export type Goal = "perder" | "mantener" | "ganar";

// Los alimentos ya no están aquí: la búsqueda usa la tabla del motor del coach, con nombre en
// español y en inglés (`useFoodSearch` en `lib/menu.ts`, fase 8). Solo quedan los nombres en
// inglés de los platos simulados de la foto (cuando la IA no está configurada). Lo que se guarda
// es el nombre que vio el usuario.
const EN_NAMES: Record<string, string> = {
  "Pechuga de pollo": "Chicken breast",
  "Arroz blanco cocido": "Cooked white rice",
  "Huevo": "Egg",
  "Avena": "Oats",
  "Plátano": "Banana",
  "Atún en lata": "Tinned tuna",
  "Pan integral": "Wholemeal bread",
  "Yogur natural": "Natural yoghurt",
  "Aguacate": "Avocado",
  "Verduras salteadas": "Stir-fried vegetables",
  "Ensalada mixta": "Mixed salad",
  "Aceite de oliva": "Olive oil",
  "Pollo con arroz y verduras": "Chicken with rice and vegetables",
  "Ensalada con atún": "Tuna salad",
  "Tostada de aguacate y huevo": "Avocado and egg toast",
  "Bol de avena con plátano": "Oat bowl with banana",
};

export function foodName(name: string, locale: string): string {
  return locale === "en" ? (EN_NAMES[name] ?? name) : name;
}

export function scale(food: { kcal: number; p: number; c: number; f: number }, grams: number) {
  const k = grams / 100;
  return {
    kcal: Math.round(food.kcal * k),
    p: Math.round(food.p * k),
    c: Math.round(food.c * k),
    f: Math.round(food.f * k),
  };
}

function dayKeyFor(d: Date) {
  return `flp_nutri_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayKey() {
  return dayKeyFor(new Date());
}

export function loadToday(): Item[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(dayKey()) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function newId(): string {
  // ids únicos aunque se añadan varios items en el mismo milisegundo
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
export function addItem(it: Omit<Item, "id">) {
  try {
    const all = [...loadToday(), { ...it, id: newId() }];
    localStorage.setItem(dayKey(), JSON.stringify(all));
  } catch { /* almacenamiento lleno: no es crítico */ }
}
export function removeItem(id: string) {
  try {
    localStorage.setItem(dayKey(), JSON.stringify(loadToday().filter((i) => i.id !== id)));
  } catch { /* noop */ }
}

/** Alimentos usados recientemente (últimos 14 días), sin repetidos. */
export function recentFoods(limit = 12): Omit<Item, "id" | "meal">[] {
  if (typeof window === "undefined") return [];
  const out: Omit<Item, "id" | "meal">[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    let items: Item[] = [];
    try {
      const v = JSON.parse(localStorage.getItem(dayKeyFor(d)) ?? "[]");
      if (Array.isArray(v)) items = v;
    } catch {
      continue;
    }
    for (const it of [...items].reverse()) {
      if (!it || typeof it.name !== "string") continue; // entrada corrupta
      const k = it.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: it.name, grams: it.grams, kcal: it.kcal, p: it.p, c: it.c, f: it.f });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Items que ayer fueron de esta comida (para "copiar de ayer"). */
export function yesterdayMealItems(meal: string): Item[] {
  if (typeof window === "undefined") return [];
  const d = new Date();
  d.setDate(d.getDate() - 1);
  try {
    const v = JSON.parse(localStorage.getItem(dayKeyFor(d)) ?? "[]");
    return Array.isArray(v) ? (v as Item[]).filter((i) => i.meal === meal) : [];
  } catch {
    return [];
  }
}

/* ---- agua (vasos de ~250 ml, por día) ---- */
function waterKey() {
  const d = new Date();
  return `flp_water_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function loadWater(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(localStorage.getItem(waterKey()));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 30) : 0;
}
export function saveWater(n: number) {
  try {
    localStorage.setItem(waterKey(), String(Math.max(0, Math.min(30, n))));
  } catch { /* noop */ }
}

export function loadGoal(): Goal {
  if (typeof window === "undefined") return "mantener";
  const g = localStorage.getItem("flp_nutri_goal");
  return g === "perder" || g === "ganar" ? g : "mantener";
}
export function saveGoal(g: Goal) {
  localStorage.setItem("flp_nutri_goal", g);
}
