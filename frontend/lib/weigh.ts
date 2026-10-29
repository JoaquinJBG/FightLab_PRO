// Pesaje: el servidor es la fuente de verdad (`/coach/weigh-in`, fase 4). `flp_weigh` en
// localStorage era el pesaje del mockup; hoy solo se migra una vez y se refleja ahí de forma
// provisional para las vistas que aún lo leen (Biometría y Coach, de la fase I).
import type { WeighIn } from "./schemas";

export const LEGACY_WEIGH_KEY = "flp_weigh";
export const WEIGH_MIGRATED_KEY = "flp_weigh_migrated";

export type LegacyWeigh = { target: number; date: string };

/** El `flp_weigh` antiguo (`{target, date}`), o null si falta o está corrupto. */
export function parseLegacyWeigh(raw: string | null): LegacyWeigh | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v.target === "number" &&
      Number.isFinite(v.target) &&
      typeof v.date === "string" &&
      !Number.isNaN(new Date(v.date).getTime())
    ) {
      return { target: v.target, date: v.date };
    }
  } catch {
    /* corrupto: se ignora */
  }
  return null;
}

/** Lo que se refleja en `flp_weigh` a partir del servidor: nada si está bloqueado o vacío. */
export function mirrorValue(data: WeighIn | undefined): LegacyWeigh | null {
  if (!data || data.blocked || data.goal_weight_kg == null || !data.weigh_in_at) return null;
  return { target: data.goal_weight_kg, date: data.weigh_in_at };
}

/** Los días que elige el usuario → la fecha del pesaje (hoy + N días, a las 9:00). */
export function weighInDate(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/** Días que quedan hasta `iso` (negativo si ya pasó), por día natural local. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - n.getTime()) / 86_400_000);
}
