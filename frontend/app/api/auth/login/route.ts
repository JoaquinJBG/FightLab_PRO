import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";
import { guardAuthRequest } from "@/lib/proxy-guard";
import { setAuthCookies, setLangCookie } from "@/lib/cookies";

export async function POST(req: Request) {
  const guardResponse = guardAuthRequest(req);
  if (guardResponse) return guardResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido" }, { status: 400 });
  }
  const r = await djangoFetch("/auth/login", { method: "POST", body, headers: clientIpHeaders(req) });
  if (r.status === 200 && r.data && typeof r.data === "object") {
    const { access, refresh } = r.data as { access: string; refresh: string };
    await setAuthCookies(access, refresh);
    // La UI pasa al idioma del perfil desde la primera pantalla (spec §7.5).
    // Si falla (cold start, red), se entra igual: el proxy fija la cookie al leer el perfil.
    try {
      const me = await djangoFetch("/me/profile", { access });
      if (me.status === 200 && me.data && typeof me.data === "object") {
        await setLangCookie((me.data as { language?: unknown }).language);
      }
    } catch {
      // sin idioma del perfil: se queda el de la cookie o el del navegador
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(r.data ?? { detail: "Login fallido" }, { status: r.status || 401 });
}
