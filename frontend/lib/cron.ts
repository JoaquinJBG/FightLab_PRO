// Disparo de los avisos (fase 11): Vercel Cron llama a /api/cron/<slot> con
// `Authorization: Bearer <CRON_SECRET>` (lo añade Vercel solo si CRON_SECRET existe), y esta
// ruta llama al backend con el secreto del BFF. El backend decide a quién avisar.
//
// Render (plan free) duerme a los 15 min y tarda hasta ~50 s en despertar: el primer intento
// tiene margen para el arranque en frío y, si falla por tiempo o porque el backend aún no
// responde (502/503/504), se reintenta mientras quede presupuesto, siempre por debajo del
// límite de la función de Vercel. Repetir es seguro: el backend apunta cada aviso enviado y no
// lo manda dos veces el mismo día.

import { timingSafeEqual } from "node:crypto";

export const SLOTS = ["evening", "morning"] as const;
export type Slot = (typeof SLOTS)[number];

export function isSlot(value: string): value is Slot {
  return (SLOTS as readonly string[]).includes(value);
}

/** `Authorization: Bearer <secret>` comparado en tiempo constante. Sin secreto, nada vale. */
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type Attempt = (timeoutMs: number) => Promise<Response>;

export type RetryOpts = {
  /** Presupuesto total en ms (por debajo de maxDuration). */
  budgetMs: number;
  /** Tope de cada intento (el primero cubre el arranque en frío). */
  attemptMs: number;
  /** Lo mínimo que tiene que quedar para que valga la pena otro intento. */
  minAttemptMs: number;
  /** Espera entre intentos. */
  pauseMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_STATUS = new Set([502, 503, 504]);

export type RetryResult = { response: Response | null; attempts: number; error: string | null };

/** Llama a `attempt` hasta que responda algo que no sea "aún dormido" o se acabe el tiempo. */
export async function callWithRetry(attempt: Attempt, opts: RetryOpts): Promise<RetryResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.budgetMs;
  let attempts = 0;
  let last: RetryResult = { response: null, attempts: 0, error: "no_attempt" };
  while (deadline - now() >= opts.minAttemptMs) {
    attempts += 1;
    const timeout = Math.min(opts.attemptMs, deadline - now());
    try {
      const response = await attempt(timeout);
      last = { response, attempts, error: null };
      if (!RETRY_STATUS.has(response.status)) return last;
    } catch (err) {
      last = { response: null, attempts, error: err instanceof Error ? err.name : "error" };
    }
    if (deadline - now() < opts.minAttemptMs + opts.pauseMs) break;
    await sleep(opts.pauseMs);
  }
  return { ...last, attempts };
}
