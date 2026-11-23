import { DJANGO_ORIGIN, assertDjangoConfigured } from "@/lib/api";

// Despierta el backend de Render (plan free: se duerme a los 15 min, ~40-50 s en
// volver). Lo llaman la app al abrirse y el workflow keep-awake.yml cada 10 min.
// Sin auth y sin datos: solo hace GET a <origen de DJANGO_API_URL>/health desde el
// servidor, así nadie publica la URL de Render ni configura nada nuevo.
// Distinto de /api/proxy/health (timeout 10 s, para la sonda corta del cliente):
// este espera hasta ~60 s porque su trabajo es aguantar el cold start.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const TIMEOUT_MS = 58_000;

const HEADERS = { "Cache-Control": "no-store" };

function json(body: { ok: boolean; ms?: number }, status: number) {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET() {
  try {
    assertDjangoConfigured();
  } catch (e) {
    console.error(e);
    return json({ ok: false }, 503);
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${DJANGO_ORIGIN}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return json({ ok: false }, 503);
    return json({ ok: true, ms: Date.now() - t0 }, 200);
  } catch {
    return json({ ok: false }, 503);
  }
}
