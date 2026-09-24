// Configuración recordada del temporizador de rounds (round timer),
// guardada en localStorage entre sesiones.

export const CFG_KEY = "flp_round_cfg";

export type RoundConfig = { rounds?: number; work?: number; rest?: number; prep?: number; warn?: number };

/**
 * Última configuración guardada. Devuelve `{}` si no hay nada, el JSON está
 * corrupto o el valor guardado no es un objeto: el llamante aplica sus
 * propios valores por defecto campo a campo.
 */
export function readRoundConfig(): RoundConfig {
  try {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY) ?? "null");
    return cfg && typeof cfg === "object" ? (cfg as RoundConfig) : {};
  } catch {
    return {}; // config corrupta: defaults
  }
}
