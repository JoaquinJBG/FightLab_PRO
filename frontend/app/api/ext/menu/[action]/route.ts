import { NextResponse } from "next/server";
import { djangoRequest } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";
import { buildProxyResponse, classifyGatewayError, isBodyTooLarge } from "@/lib/proxy-guard";

// Fase 14: la puerta para la skill de Claude Code del PC del usuario (vía B). Solo dos rutas,
// `GET /api/ext/menu/context` y `POST /api/ext/menu/import`, y solo con un token personal
// (`Authorization: Bearer flm_…`) que se reenvía tal cual a Django. Sin cookies: la sesión de la
// app no sirve aquí, y el token no sirve en `/api/proxy` (Django solo lo acepta en estas dos rutas).
// Así la skill usa la misma dirección que la app y el arranque en frío de Render queda detrás.

export const maxDuration = 60;
const DEADLINE_MS = 55_000;
const ACTIONS: Record<string, "GET" | "POST"> = { context: "GET", import: "POST" };
const TOKEN = /^Bearer flm_[A-Za-z0-9_-]{20,100}$/;

async function handle(req: Request, action: string) {
  const method = ACTIONS[action];
  if (!method) return NextResponse.json({ detail: "Ruta no permitida" }, { status: 404 });
  if (req.method !== method) return NextResponse.json({ detail: "Método no permitido" }, { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  if (!TOKEN.test(auth)) {
    return NextResponse.json({ code: "menu_token_missing", detail: "Falta el token personal (Authorization: Bearer flm_…)" }, { status: 401 });
  }
  if (isBodyTooLarge(req.headers.get("content-length"))) {
    return NextResponse.json({ detail: "El cuerpo supera el límite de 10 MB" }, { status: 413 });
  }
  const search = action === "context" ? new URL(req.url).search : "";
  try {
    const upstream = await djangoRequest(`/menu/${action}${search}`, {
      method,
      headers: {
        Authorization: auth,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...clientIpHeaders(req),
      },
      body: method === "POST" ? await req.text() : undefined,
      timeoutMs: DEADLINE_MS,
    });
    return await buildProxyResponse(upstream);
  } catch (err) {
    const { status, detail } = classifyGatewayError(err);
    return NextResponse.json({ detail }, { status });
  }
}

type Ctx = { params: Promise<{ action: string }> };
export async function GET(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).action);
}
export async function POST(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).action);
}
