// Motor de carga (versión local): agrega las sesiones registradas en el
// dispositivo (deportes, MMA y gimnasio, cada una con su carga sRPE en AU)
// y calcula las métricas de Foster: carga semanal, ACWR, monotonía y tensión.
// Pasa al backend (ActivityLog) en la fase 3 — las fórmulas son las mismas.
// E.5 (anexo de combate): el ratio solo con 28 días de historial (convención de FightLab) y
// mostrado como "la semana frente a tu media de 4 semanas", sin "zona segura".

/** Días de historial antes de mostrar el ratio (convención de FightLab). */
export const RATIO_MIN_DAYS = 28;

export type LoadPoint = { ts: number; load: number };

const DAY = 86_400_000;
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function collectTrainingLoads(): LoadPoint[] {
  if (typeof window === "undefined") return [];
  const out: LoadPoint[] = [];
  // Bucket por INICIO de sesión (ts de guardado − duración): misma semántica
  // que el backend (started_at), para que ambos motores den el mismo día
  const pull = (key: string, durSec: (s: Record<string, unknown>) => number) => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (!Array.isArray(v)) return;
      for (const s of v) {
        if (s && typeof s.ts === "number" && typeof s.load === "number" && s.load > 0) {
          out.push({ ts: s.ts - Math.max(0, durSec(s)) * 1000, load: s.load });
        }
      }
    } catch { /* clave corrupta: se ignora */ }
  };
  pull("flp_activities", (s) => (typeof s.durationSec === "number" ? s.durationSec : 0));
  pull("flp_mma", (s) => (typeof s.minutes === "number" ? s.minutes * 60 : 0));
  pull("flp_gym_sessions", (s) => (typeof s.durationSec === "number" ? s.durationSec : 0));
  return out;
}

/** AU por día de los últimos n días (el último índice es hoy). */
export function dailyAU(n: number, loads: LoadPoint[] = collectTrainingLoads()): number[] {
  const today = startOfDay(Date.now());
  const arr = Array(n).fill(0) as number[];
  for (const p of loads) {
    const idx = n - 1 - Math.round((today - startOfDay(p.ts)) / DAY);
    if (idx >= 0 && idx < n) arr[idx] += p.load;
  }
  return arr;
}

export type LoadMetrics = {
  weekAU: number;
  daily7: number[];
  acwr: number | null; // solo con 28 días de historial
  weekVsAvgPct: number | null; // la semana frente a la media semanal de 4 semanas, en %
  ratioDaysLeft: number; // días que faltan para el ratio (0 cuando ya hay 28)
  gaps: boolean; // alguna de las 4 semanas sin carga: el número puede engañar
  monotonia: number | null;
  tension: number | null;
  sinVariacion: boolean; // 7 días con carga idéntica (SD=0): monotonía máxima
  historyDays: number;
};

export function loadMetrics(): LoadMetrics {
  const loads = collectTrainingLoads();
  const daily28 = dailyAU(28, loads);
  const daily7 = daily28.slice(-7);
  const weekAU = daily7.reduce((a, b) => a + b, 0);

  const firstTs = loads.length > 0 ? Math.min(...loads.map((l) => l.ts)) : null;
  // Math.round (no floor): absorbe el ±1 h del cambio horario, igual que dailyAU
  const historyDays = firstTs
    ? Math.min(28, Math.round((startOfDay(Date.now()) - startOfDay(firstTs)) / DAY) + 1)
    : 0;

  // Ratio: media diaria aguda (7 d) vs crónica (28 d, incluida la semana aguda). Solo con
  // 28 días de historial; antes se ven las cargas y cuántos días faltan.
  let acwr: number | null = null;
  let weekVsAvgPct: number | null = null;
  let gaps = false;
  if (historyDays >= RATIO_MIN_DAYS && weekAU > 0) {
    const chronicAvg = daily28.reduce((a, b) => a + b, 0) / 28;
    acwr = weekAU / 7 / chronicAvg;
    weekVsAvgPct = Math.round((acwr - 1) * 100);
    gaps = [0, 7, 14, 21].some((i) => daily28.slice(i, i + 7).every((v) => v === 0));
  }

  // Monotonía (media/SD de la carga diaria de 7 d) y tensión (semanal × monotonía)
  let monotonia: number | null = null;
  let tension: number | null = null;
  let sinVariacion = false;
  if (historyDays >= 7 && daily7.some((v) => v > 0)) {
    const meanDaily = weekAU / 7;
    const sd = Math.sqrt(daily7.reduce((a, v) => a + (v - meanDaily) ** 2, 0) / 7);
    if (sd > 0) {
      monotonia = meanDaily / sd;
      tension = Math.round(weekAU * monotonia);
    } else {
      // SD = 0 con carga: cero variación entre días = monotonía MÁXIMA, no "sin datos"
      sinVariacion = true;
    }
  }

  return {
    weekAU: Math.round(weekAU), daily7, acwr, weekVsAvgPct,
    ratioDaysLeft: Math.max(0, RATIO_MIN_DAYS - historyDays), gaps,
    monotonia, tension, sinVariacion, historyDays,
  };
}
