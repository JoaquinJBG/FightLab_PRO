import { NextResponse } from "next/server";
import { djangoDownload, djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, setAccessCookie, setAuthCookies } from "@/lib/cookies";

/**
 * El menú y la lista de la compra en PDF (fase 8.5). El proxy general (`/api/proxy`) lee todo como
 * JSON, así que el PDF pasa por aquí tal cual: mismo token (con un refresco si ha caducado) y el
 * idioma de la app. Los errores (404, 409 con los bloqueos) llegan como JSON.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const path = `/coach/menu/${id}/pdf`;

  let res = await djangoDownload(path, await getAccess());
  if (res.status === 401) {
    const refresh = await getRefresh();
    if (!refresh) return NextResponse.json({ detail: "No autenticado" }, { status: 401 });
    const ref = await djangoFetch("/auth/refresh", { method: "POST", body: { refresh } });
    if (ref.status !== 200 || !ref.data || typeof ref.data !== "object") {
      return NextResponse.json({ detail: "Sesión expirada" }, { status: 401 });
    }
    const d = ref.data as { access: string; refresh?: string };
    if (d.refresh) await setAuthCookies(d.access, d.refresh);
    else await setAccessCookie(d.access);
    res = await djangoDownload(path, d.access);
  }

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("application/pdf")) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 502 : res.status });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": res.headers.get("content-disposition") ?? `attachment; filename="fightlab-menu.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
