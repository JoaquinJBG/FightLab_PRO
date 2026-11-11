// Un solo /auth/refresh en curso por refresh token (F30 de la prueba en móvil).
//
// Al volver a la app con el access caducado, varias peticiones a la vez (Hoy pide /me,
// /me/profile, /coach/safety…) recibían un 401 y cada una renovaba el token por su cuenta: 4
// POST /auth/refresh seguidos con el mismo refresh. Con la rotación de refresh tokens, el segundo
// puede llegar con un token ya usado y cerrar la sesión. Aquí todas las peticiones del BFF que
// llevan el mismo refresh comparten la misma llamada, y un resultado bueno se reutiliza unos
// segundos (las que llegan un poco tarde aún traen la cookie vieja).
//
// Es memoria del proceso: en Vercel ayuda dentro de cada instancia (las peticiones que llegan a
// la vez suelen caer en la misma). Solo guarda el resultado bueno; un fallo se olvida al momento.

export type RefreshOutcome = { status: number; data: unknown };

const KEEP_OK_MS = 10_000;

type Entry = { promise: Promise<RefreshOutcome>; expires: number };
const flights = new Map<string, Entry>();

export function sharedRefresh(
  refresh: string,
  run: () => Promise<RefreshOutcome>,
  now: () => number = Date.now,
): Promise<RefreshOutcome> {
  for (const [k, e] of flights) if (e.expires <= now()) flights.delete(k);
  const hit = flights.get(refresh);
  if (hit) return hit.promise;

  const entry: Entry = { promise: run(), expires: Number.POSITIVE_INFINITY };
  flights.set(refresh, entry);
  entry.promise.then(
    (r) => {
      if (r.status === 200) entry.expires = now() + KEEP_OK_MS;
      else if (flights.get(refresh) === entry) flights.delete(refresh);
    },
    () => {
      if (flights.get(refresh) === entry) flights.delete(refresh);
    },
  );
  return entry.promise;
}

/** Solo para las pruebas. */
export function resetRefreshFlights(): void {
  flights.clear();
}
