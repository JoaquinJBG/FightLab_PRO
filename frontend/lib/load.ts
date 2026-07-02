// Motor de carga (versión local): agrega las sesiones registradas en el
// dispositivo (deportes, MMA y gimnasio, cada una con su carga sRPE en AU)
// y calcula las métricas de Foster: carga semanal, ACWR, monotonía y tensión.
// Pasa al backend (ActivityLog) en la fase 3 — las fórmulas son las mismas.

export type LoadPoint = { ts: number; load: number };

export type LoadBandStatus = "descarga" | "sostenible" | "elevada" | "alta";

export type LoadBand = {
  weekAU: number;    // carga de la semana en curso (marcador)
  low: number;       // límite inferior del rango habitual (μ − σ_eff)
  high: number;      // límite superior del rango habitual (μ + σ_eff)
  overreach: number; // umbral de carga alta (μ + 2σ_eff)
  status: LoadBandStatus;
  provisional: boolean; // 14..27 días de historial: el rango aún se calibra
};

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
  acwr: number | null;
  provisional: boolean; // historial < 28 días: el ACWR aún se está calibrando
  monotonia: number | null;
  tension: number | null;
  sinVariacion: boolean; // 7 días con carga idéntica (SD=0): monotonía máxima
  band: LoadBand | null; // carga semanal vs rango propio (P0.1); null si historial < 14 días
  historyDays: number;
};

/**
 * Banda de carga tipo Strava: sitúa la carga de la semana en curso dentro del
 * rango de las semanas previas del propio atleta (no umbrales fijos). Devuelve
 * null si no hay al menos una semana de baseline antes de la semana actual.
 */
export function computeLoadBand(
  daily28: number[],
  weekAU: number,
  historyDays: number,
): LoadBand | null {
  if (historyDays < 14) return null;

  // Ventanas móviles de 7 días que terminan ANTES de la semana en curso (índices
  // 21..27), acotadas al historial real para no incluir días sin datos.
  const d0 = 28 - historyDays;          // primer índice con datos reales
  const firstEnd = Math.max(6, d0 + 6); // primer día-fin con ventana completa dentro del historial
  const samples: number[] = [];
  for (let e = firstEnd; e <= 20; e++) {
    let s = 0;
    for (let i = e - 6; i <= e; i++) s += daily28[i];
    samples.push(s);
  }
  if (samples.length === 0) return null;

  const mu = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mu <= 0) return null; // baseline sin carga: nada que comparar

  const variance = samples.reduce((a, v) => a + (v - mu) ** 2, 0) / samples.length;
  const sigma = Math.sqrt(variance);
  const sigmaEff = Math.max(sigma, 0.1 * mu); // suelo de anchura (estabilidad visual, no umbral de seguridad)

  const low = mu - sigmaEff;
  const high = mu + sigmaEff;
  const overreach = mu + 2 * sigmaEff;

  let status: LoadBandStatus;
  if (weekAU < low) status = "descarga";
  else if (weekAU <= high) status = "sostenible";
  else if (weekAU <= overreach) status = "elevada";
  else status = "alta";

  return {
    weekAU: Math.round(weekAU),
    low: Math.max(0, Math.round(low)),
    high: Math.round(high),
    overreach: Math.round(overreach),
    status,
    provisional: historyDays < 28,
  };
}

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

  // ACWR: media diaria aguda (7 d) vs crónica (historial disponible, máx 28 d).
  // Umbral en 10 días: con exactamente 7, aguda ≡ crónica y el ratio sería un
  // 1.00 tautológico sin información.
  let acwr: number | null = null;
  let provisional = true;
  if (historyDays >= 10 && weekAU > 0) {
    const chronicWindow = daily28.slice(-historyDays);
    const chronicAvg = chronicWindow.reduce((a, b) => a + b, 0) / historyDays;
    if (chronicAvg > 0) {
      acwr = weekAU / 7 / chronicAvg;
      provisional = historyDays < 28;
    }
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
      // SD = 0 con carga: cero variación entre días = monotonía MÁXIMA (riesgo),
      // no "sin datos"
      sinVariacion = true;
    }
  }

  const band = computeLoadBand(daily28, weekAU, historyDays);

  return { weekAU: Math.round(weekAU), daily7, acwr, provisional, monotonia, tension, sinVariacion, band, historyDays };
}
