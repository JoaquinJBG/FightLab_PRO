// Sesión "en vivo" del tracker de deporte: se guarda en localStorage mientras
// corre un cronómetro en foreground, para poder recuperarla si se recarga la
// página o se cierra la app a medias.

export const LIVE_KEY = "flp_live_session";

export type LiveSession = { sportKey: string; elapsed: number; kcal: number; intIdx: number; savedAt: number };

/**
 * Sesión en vivo recuperable durante 12 h; más allá (o si está corrupta, no
 * tiene tiempo transcurrido o ya no corresponde a un deporte válido) se
 * descarta en silencio y se limpia el storage.
 *
 * `validSportKeys` son las claves de deporte que la app reconoce hoy (las de
 * `SPORTS` en la página): así una sesión de una versión anterior con un
 * deporte que ya no existe no se da por buena.
 */
export function readLiveSession(validSportKeys: Iterable<string>): LiveSession | null {
  const valid = new Set(validSportKeys);
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const s: LiveSession = JSON.parse(raw);
    if (s && valid.has(s.sportKey) && Date.now() - s.savedAt < 12 * 3600_000 && s.elapsed > 0) {
      return s;
    }
    localStorage.removeItem(LIVE_KEY);
    return null;
  } catch {
    return null;
  }
}
