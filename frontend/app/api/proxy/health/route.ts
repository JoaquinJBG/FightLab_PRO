import { DJANGO_ORIGIN, assertDjangoConfigured } from "@/lib/api";

// El backend de Render (plan free) se duerme tras 15 min de inactividad y puede
// tardar ~50 s en volver a responder. Este endpoint solo sirve para
// despertarlo: no lleva autenticación ni pasa por el proxy genérico, porque
// /health vive en la raíz del origen de Django, no bajo /api/v1.
// Timeout corto: el cliente reintenta la sonda, y esperar más ocuparía una función por intento.
export const maxDuration = 15;

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10_000;

let lastOk = 0;

function ok() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, max-age=10" } });
}

export async function GET() {
  try {
    assertDjangoConfigured();
  } catch (e) {
    console.error(e);
    return new Response(null, { status: 500 });
  }
  if (Date.now() - lastOk < CACHE_TTL_MS) return ok();
  try {
    const res = await fetch(`${DJANGO_ORIGIN}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return new Response(null, { status: 502 });
    lastOk = Date.now();
    return ok();
  } catch {
    return new Response(null, { status: 502 });
  }
}
