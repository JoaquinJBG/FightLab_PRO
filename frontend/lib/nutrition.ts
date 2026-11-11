// Lógica y datos de nutrición (mockup). Persistencia local; copia de
// seguridad y sincronización entre dispositivos vía backend/userstate
// (ver lib/user-state.ts): localStorage sigue siendo la fuente inmediata.

import { hydrateUserState, hydrateUserStatePrefix, rawStringSerde, syncUserState } from "@/lib/user-state";

/** De dónde sale cada entrada del diario (F6). `menu` la pone el servidor al marcar una comida
 * del menú como «Hecha» en Hoy, con `link` a esa marca; las de antes no traen origen. */
export const ITEM_SOURCES = ["menu", "food", "manual", "photo", "recent", "yesterday"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

export type Item = {
  id: string;
  meal: string;
  name: string;
  grams: number | null;
  kcal: number;
  p: number;
  c: number;
  f: number;
  source?: ItemSource;
  link?: string;
};

/** El origen que se enseña de una entrada; las antiguas sin origen cuentan como apuntadas a mano. */
export function itemSource(item: Pick<Item, "source">): ItemSource {
  return item.source && (ITEM_SOURCES as readonly string[]).includes(item.source) ? item.source : "manual";
}

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

/** F24: los gramos de un objetivo de macros (proteína, grasa, hidratos, fibra) como se enseñan en
 * Nutrición, el Menú y el Plan: al gramo entero más cercano. Una sola función para todos, para que
 * la misma cifra del servidor nunca salga distinta en dos pantallas. */
export function roundGrams(grams: number): number {
  return Math.round(grams);
}

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

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayKeyFor(d: Date) {
  return `flp_nutri_${isoDate(d)}`;
}
function dayKey() {
  return dayKeyFor(new Date());
}
function bareDayKey(d: Date) {
  return `nutri_${isoDate(d)}`;
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
  let all: Item[] = [];
  try {
    all = [...loadToday(), { ...it, id: newId() }];
    localStorage.setItem(dayKey(), JSON.stringify(all));
  } catch { /* almacenamiento lleno: no es crítico */ }
  syncUserState(bareDayKey(new Date()), all);
}
export function removeItem(id: string) {
  let all: Item[] = [];
  try {
    all = loadToday().filter((i) => i.id !== id);
    localStorage.setItem(dayKey(), JSON.stringify(all));
  } catch { /* noop */ }
  syncUserState(bareDayKey(new Date()), all);
}

/** Hidrata el diario y el agua de los últimos `days` días (hoy incluido) desde
 *  el servidor si tiene algo más nuevo que lo local: útil al abrir la app en
 *  un dispositivo nuevo, o tras usar otro dispositivo. Ver lib/user-state.ts. */
export async function hydrateRecentNutritionDays(days = 7): Promise<void> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  await Promise.all([
    hydrateUserStatePrefix("nutri_", isoDate(from), isoDate(to)),
    hydrateUserStatePrefix("water_", isoDate(from), isoDate(to)),
  ]);
}

/** Si el servidor tiene un objetivo (perder/mantener/ganar) más nuevo que el
 *  local, lo adopta y lo devuelve; si no, null (el local ya vale). */
export async function hydrateGoal(): Promise<Goal | null> {
  const g = await hydrateUserState<string>("nutri_goal", rawStringSerde);
  return g === "perder" || g === "ganar" || g === "mantener" ? g : null;
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
  return `flp_${bareWaterKey()}`;
}
function bareWaterKey() {
  return `water_${isoDate(new Date())}`;
}
export function loadWater(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(localStorage.getItem(waterKey()));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 30) : 0;
}
export function saveWater(n: number) {
  const clamped = Math.max(0, Math.min(30, n));
  try {
    localStorage.setItem(waterKey(), String(clamped));
  } catch { /* noop */ }
  syncUserState(bareWaterKey(), clamped);
}

export function loadGoal(): Goal {
  if (typeof window === "undefined") return "mantener";
  const g = localStorage.getItem("flp_nutri_goal");
  return g === "perder" || g === "ganar" ? g : "mantener";
}
export function saveGoal(g: Goal) {
  localStorage.setItem("flp_nutri_goal", g);
  syncUserState("nutri_goal", g, rawStringSerde);
}

/* ---- foto → plato: mensajes honestos para los fallos conocidos de la IA
   de visión, en vez de inventar un plato de ejemplo ---- */

/**
 * Mensaje honesto para cada fallo conocido de la IA de visión. `null`
 * significa "no es uno de estos códigos": el llamante decide qué hacer
 * (seguir leyendo la respuesta o caer al error genérico de conexión).
 */
export function photoErrorForStatus(status: number): string | null {
  if (status === 503) return "La IA no está disponible ahora mismo. Añade la comida a mano mientras tanto.";
  if (status === 429) return "Has llegado al límite diario de fotos con IA. Añade la comida a mano mientras tanto.";
  if (status === 502) return "La IA no ha podido analizar la foto. Añade la comida a mano mientras tanto.";
  return null;
}

/** Lo mismo que `photoErrorForStatus`, pero como clave estable para el
 *  catálogo de textos (`nutrition.add.photo.errors.<clave>`). */
export type PhotoErrorKind = "unavailable" | "quota" | "failed";
export function photoErrorKind(status: number): PhotoErrorKind | null {
  if (status === 503) return "unavailable";
  if (status === 429) return "quota";
  if (status === 502) return "failed";
  return null;
}
