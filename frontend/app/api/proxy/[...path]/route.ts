import { NextResponse } from "next/server";
import { djangoFetch, djangoRequest } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";
import {
  getAccess,
  getRefresh,
  setAuthCookies,
  setAccessCookie,
  clearAuthCookies,
} from "@/lib/cookies";
import {
  isPathSafe,
  isPrefixAllowed,
  isBodyTooLarge,
  isOriginAllowed,
  buildProxyResponse,
  isRefreshTokenExpiredOrMalformed,
  classifyGatewayError,
} from "@/lib/proxy-guard";

// Backend en Render (plan free): hasta ~50 s en frío. Deja margen bajo los 60 s
// que soporta una función de Vercel (plan Hobby).
export const maxDuration = 60;

// Solo la primera petición necesita margen para un cold start de Render. Si
// Django ya respondió (aunque fuera con un 401), ya está despierto: el
// refresh y el reintento posterior usan un timeout corto para no encadenar
// hasta 3×55 s, muy por encima de maxDuration.
const RETRY_TIMEOUT_MS = 15_000;

async function handle(req: Request, path: string[]) {
  if (!isPathSafe(path) || !isPrefixAllowed(path)) {
    return NextResponse.json({ detail: "Ruta no permitida" }, { status: 404 });
  }

  const selfOrigin = new URL(req.url).origin;
  if (!isOriginAllowed(req.method, req.headers.get("origin"), selfOrigin)) {
    return NextResponse.json({ detail: "Origen no permitido" }, { status: 403 });
  }

  if (isBodyTooLarge(req.headers.get("content-length"))) {
    return NextResponse.json({ detail: "El cuerpo supera el límite de 10 MB" }, { status: 413 });
  }

  // Conserva los query params (?tz=, ?kind=, ?limit=…) al reenviar a Django.
  // Defensa en profundidad: encodeURIComponent además de isPathSafe. Un
  // segmento ya pasó la allowlist estricta de isSegmentSafe, así que esto no
  // debería cambiar nada para una ruta legítima, pero evita que cualquier
  // carácter que se colara igualmente acabe interpretado como separador o
  // como "." / ".." por el parser de URL de fetch.
  const target = "/" + path.map(encodeURIComponent).join("/") + new URL(req.url).search;
  const method = req.method;
  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.startsWith("multipart/form-data");
  // La IP real del cliente, firmada con BFF_SHARED_SECRET, para que el
  // throttling de Django no la confunda con la del propio BFF. Reenviar
  // X-Forwarded-For tal cual no vale: es una cabecera que controla el
  // propio cliente, así que cualquiera podría falsificarla para saltarse
  // el límite si además se llamara directamente al backend público de
  // Render. Django solo se fía de esta IP cuando viene con el secreto
  // correcto (ver backend/users/throttling.py); sin BFF_SHARED_SECRET,
  // clientIpHeaders() devuelve {} y el comportamiento es el de siempre.
  const ipHeaders = clientIpHeaders(req);

  let body: unknown = undefined;
  let form: FormData | null = null;
  if (isMultipart) {
    form = await req.formData();
  } else if (method !== "GET" && method !== "DELETE") {
    const text = await req.text();
    try {
      if (text) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ detail: "Body JSON inválido" }, { status: 400 });
    }
  }

  const doReq = (acc: string | null, timeoutMs?: number) =>
    form
      ? djangoRequest(target, { method, body: form, access: acc, headers: ipHeaders, timeoutMs })
      : djangoRequest(target, {
          method,
          headers: { "Content-Type": "application/json", ...ipHeaders },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          access: acc,
          timeoutMs,
        });

  try {
    let access = await getAccess();
    let upstream = await doReq(access);

    if (upstream.status === 401) {
      const refreshBefore = await getRefresh();
      if (!refreshBefore) {
        await clearAuthCookies();
        return NextResponse.json({ detail: "No autenticado" }, { status: 401 });
      }
      const ref = await djangoFetch("/auth/refresh", {
        method: "POST",
        body: { refresh: refreshBefore },
        timeoutMs: RETRY_TIMEOUT_MS,
        headers: ipHeaders,
      });
      if (ref.status === 200 && ref.data && typeof ref.data === "object") {
        const d = ref.data as { access: string; refresh?: string };
        if (d.refresh) await setAuthCookies(d.access, d.refresh);
        else await setAccessCookie(d.access);
        access = d.access;
        upstream = await doReq(access, RETRY_TIMEOUT_MS);
      } else {
        // Solo se borran las cookies si el refresh que teníamos ya no sirve
        // (expirado o mal formado). Una petición concurrente puede haber
        // rotado fl_refresh justo mientras este refresh fallaba (red, 500 de
        // Django…); comparar cookies antes/después de esta misma petición no
        // detecta esa rotación (cookies() ve el jar de ESTA petición, no el
        // Set-Cookie que puso otra en paralelo), así que en vez de eso se
        // decodifica el propio token para decidir.
        if (isRefreshTokenExpiredOrMalformed(refreshBefore)) {
          await clearAuthCookies();
        }
        return NextResponse.json({ detail: "Sesión expirada" }, { status: 401 });
      }
    }

    return buildProxyResponse(upstream);
  } catch (err) {
    // Timeout (cold start que no llega a tiempo) o fallo de red al hablar con
    // Django: sin este catch, el error se propaga como un 500 genérico. Antes
    // del refresh esto podía además encadenar hasta 3 llamadas de hasta 55 s,
    // muy por encima de maxDuration=60; RETRY_TIMEOUT_MS ya acorta el refresh
    // y el reintento.
    const { status, detail } = classifyGatewayError(err);
    return NextResponse.json({ detail }, { status });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PUT(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
