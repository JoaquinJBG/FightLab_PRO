import { NextResponse } from "next/server";
import { djangoFetch, djangoRequest } from "@/lib/api";
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
} from "@/lib/proxy-guard";

// Backend en Render (plan free): hasta ~50 s en frío. Deja margen bajo los 60 s
// que soporta una función de Vercel (plan Hobby).
export const maxDuration = 60;

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

  // Conserva los query params (?tz=, ?kind=, ?limit=…) al reenviar a Django
  const target = "/" + path.join("/") + new URL(req.url).search;
  const method = req.method;
  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.startsWith("multipart/form-data");
  // La IP real del cliente, para que el throttling de Django no la confunda
  // con la del propio BFF (Django necesita NUM_PROXIES=1 para leerla bien).
  const forwardedFor = req.headers.get("x-forwarded-for");

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

  const doReq = (acc: string | null) =>
    form
      ? djangoRequest(target, { method, body: form, access: acc, forwardedFor })
      : djangoRequest(target, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          access: acc,
          forwardedFor,
        });

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
    });
    if (ref.status === 200 && ref.data && typeof ref.data === "object") {
      const d = ref.data as { access: string; refresh?: string };
      if (d.refresh) await setAuthCookies(d.access, d.refresh);
      else await setAccessCookie(d.access);
      access = d.access;
      upstream = await doReq(access);
    } else {
      // Defensa en profundidad: si otra petición concurrente ya rotó
      // fl_refresh mientras este refresh fallaba, no lo pisamos borrándolo.
      const refreshAfter = await getRefresh();
      if (refreshAfter === refreshBefore) {
        await clearAuthCookies();
      }
      return NextResponse.json({ detail: "Sesión expirada" }, { status: 401 });
    }
  }

  return buildProxyResponse(upstream);
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
