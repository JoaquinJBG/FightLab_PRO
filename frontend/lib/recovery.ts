import type { Biometrics } from "./schemas";

/* Estado de hoy: estimación cualitativa con señales reales de recuperación
   (FC reposo / HRV del usuario vs su propia media). Sin pseudo-precisión. */

export type Recovery = {
  state: "listo" | "normal" | "cuidado";
  label: string;
  phrase: string;
  color: string;
  chips: string[];
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function computeRecovery(logs: Biometrics[]): Recovery | null {
  // logs llegan ordenados del más reciente al más antiguo
  const rhrs = logs.map((l) => l.resting_heart_rate).filter((v): v is number => v != null);
  const hrvs = logs.map((l) => l.hrv_ms).filter((v): v is number => v != null);

  const chips: string[] = [];
  let good = 0;
  let bad = 0;
  let signals = 0;

  if (rhrs.length >= 4) {
    const base = mean(rhrs.slice(1, 31));
    const delta = Math.round((rhrs[0] - base) * 10) / 10;
    signals++;
    chips.push(`FC reposo ${delta > 0 ? "+" : ""}${delta} vs tu media`);
    if (delta >= 5) bad++;
    else if (delta <= 0) good++;
  }
  if (hrvs.length >= 4) {
    const base = mean(hrvs.slice(1, 31));
    if (base > 0) {
      const pct = Math.round(((hrvs[0] - base) / base) * 100);
      signals++;
      chips.push(`HRV ${pct > 0 ? "+" : ""}${pct}% vs tu media`);
      if (pct <= -10) bad++;
      else if (pct >= 0) good++;
    }
  }
  if (signals === 0) return null;

  if (bad > 0) {
    return {
      state: "cuidado",
      label: "Tómatelo suave",
      phrase: "Tus señales de recuperación están por debajo de tu media. Hoy: técnica ligera o descanso activo.",
      color: "#ffd25a",
      chips,
    };
  }
  if (good === signals) {
    return {
      state: "listo",
      label: "Listo para entrenar",
      phrase: "Recuperación por encima de tu media. Buen día para trabajo exigente.",
      color: "#43e8a0",
      chips,
    };
  }
  return {
    state: "normal",
    label: "Día normal",
    phrase: "Señales en torno a tu media. Entrena según tu plan.",
    color: "#45e9ff",
    chips,
  };
}
