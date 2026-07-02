import { DJANGO_ORIGIN } from "@/lib/api";
import { getRefresh } from "@/lib/cookies";

/**
 * Sirve los archivos de /media del backend a través del frontend, para que
 * el móvil (que solo ve el túnel/dominio de Next) pueda cargar las fotos.
 * Son fotos corporales: se exige sesión (cookie) para servirlas.
 */
type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!(await getRefresh())) {
    return new Response(null, { status: 401 });
  }
  const { path } = await ctx.params;
  const res = await fetch(`${DJANGO_ORIGIN}/media/${path.map(encodeURIComponent).join("/")}`, {
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    return new Response(null, { status: res.status || 404 });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
