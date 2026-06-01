import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import {
  getAccess,
  getRefresh,
  setAuthCookies,
  setAccessCookie,
  clearAuthCookies,
} from "@/lib/cookies";

async function handle(req: Request, path: string[]) {
  const target = "/" + path.join("/");
  const method = req.method;
  let body: unknown = undefined;
  if (method !== "GET" && method !== "DELETE") {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  }

  let access = await getAccess();
  let r = await djangoFetch(target, { method, body, access });

  if (r.status === 401) {
    const refresh = await getRefresh();
    if (!refresh) {
      await clearAuthCookies();
      return NextResponse.json({ detail: "No autenticado" }, { status: 401 });
    }
    const ref = await djangoFetch("/auth/refresh", { method: "POST", body: { refresh } });
    if (ref.status === 200 && ref.data && typeof ref.data === "object") {
      const d = ref.data as { access: string; refresh?: string };
      if (d.refresh) await setAuthCookies(d.access, d.refresh);
      else await setAccessCookie(d.access);
      access = d.access;
      r = await djangoFetch(target, { method, body, access });
    } else {
      await clearAuthCookies();
      return NextResponse.json({ detail: "Sesión expirada" }, { status: 401 });
    }
  }

  return NextResponse.json(r.data ?? {}, { status: r.status });
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
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
