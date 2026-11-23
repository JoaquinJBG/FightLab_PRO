import { NextResponse } from "next/server";
import { GET as proxyGet } from "../../proxy/[...path]/route";

/**
 * El menú y la lista de la compra en PDF (fase 8.5): `/coach/menu/<id>/pdf` a través del proxy
 * general del BFF, que reenvía las respuestas que no son JSON tal cual (con su
 * `Content-Disposition`) y aplica el mismo refresco de token, timeouts e IP del cliente.
 */
type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const res = await proxyGet(req, { params: Promise.resolve({ path: ["coach", "menu", id, "pdf"] }) });
  // Datos personales: que no lo guarde ninguna caché intermedia.
  if (!res.headers.get("cache-control")) res.headers.set("cache-control", "private, no-store");
  return res;
}
