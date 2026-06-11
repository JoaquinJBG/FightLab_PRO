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

export type Goal = "perder" | "mantener" | "ganar";
export const GOAL_LABEL: Record<Goal, string> = { perder: "Perder", mantener: "Mantener", ganar: "Ganar" };

export type Macros = { kcal: number; p: number; c: number; f: number };

// Alimentos de ejemplo, valores por 100 g
export const FOODS: { name: string; kcal: number; p: number; c: number; f: number }[] = [
  { name: "Pechuga de pollo", kcal: 165, p: 31, c: 0, f: 3.6 },
  { name: "Arroz blanco cocido", kcal: 130, p: 2.7, c: 28, f: 0.3 },
  { name: "Huevo", kcal: 155, p: 13, c: 1.1, f: 11 },
  { name: "Avena", kcal: 389, p: 17, c: 66, f: 7 },
  { name: "Plátano", kcal: 89, p: 1.1, c: 23, f: 0.3 },
  { name: "Atún en lata", kcal: 132, p: 28, c: 0, f: 1 },
  { name: "Pan integral", kcal: 247, p: 13, c: 41, f: 3.4 },
  { name: "Yogur natural", kcal: 61, p: 3.5, c: 4.7, f: 3.3 },
  { name: "Almendras", kcal: 579, p: 21, c: 22, f: 50 },
  { name: "Lentejas cocidas", kcal: 116, p: 9, c: 20, f: 0.4 },
  { name: "Salmón", kcal: 208, p: 20, c: 0, f: 13 },
  { name: "Patata cocida", kcal: 87, p: 2, c: 20, f: 0.1 },
  { name: "Boniato", kcal: 86, p: 1.6, c: 20, f: 0.1 },
  { name: "Aguacate", kcal: 160, p: 2, c: 9, f: 15 },
  { name: "Queso fresco batido", kcal: 72, p: 12, c: 4, f: 0.2 },
];

export function scale(food: { kcal: number; p: number; c: number; f: number }, grams: number) {
  const k = grams / 100;
  return {
    kcal: Math.round(food.kcal * k),
    p: Math.round(food.p * k),
    c: Math.round(food.c * k),
    f: Math.round(food.f * k),
  };
}

export function targets(weightKg: number, heightCm: number, age: number, gender: string | null, goal: Goal): Macros {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === "FEMALE" ? -161 : 5);
  const tdee = bmr * 1.55;
  const kcal = Math.round(goal === "perder" ? tdee - 500 : goal === "ganar" ? tdee + 300 : tdee);
  const p = Math.round(weightKg * 2);
  const f = Math.round((kcal * 0.25) / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, c, f };
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
