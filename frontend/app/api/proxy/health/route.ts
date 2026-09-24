import { DJANGO_ORIGIN, assertDjangoConfigured } from "@/lib/api";

// El backend de Render (plan free) se duerme tras 15 min de inactividad y puede
// tardar hasta ~50 s en volver a responder. Este endpoint solo sirve para
// despertarlo: no lleva autenticación ni pasa por el proxy genérico, porque
// /health vive en la raíz del origen de Django, no bajo /api/v1.
export const maxDuration = 60;

export async function GET() {
  try {
    assertDjangoConfigured();
  } catch (e) {
    console.error(e);
    return new Response(null, { status: 500 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await fetch(`${DJANGO_ORIGIN}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return new Response(null, { status: res.ok ? 204 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
