import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, clearAuthCookies } from "@/lib/cookies";
import { clientIpHeaders } from "@/lib/auth-forward";
import { guardAuthRequest } from "@/lib/proxy-guard";

const BLACKLIST_TIMEOUT_MS = 8_000;

export async function POST(req: Request) {
  // Logout no espera cuerpo (no manda JSON), así que no se exige Content-Type.
  const guardResponse = guardAuthRequest(req, { requireJsonBody: false });
  if (guardResponse) return guardResponse;

  const refresh = await getRefresh();
  const access = await getAccess();
  if (refresh) {
    // Invalidar el refresh en Django es best-effort: si está dormido o falla,
    // las cookies se borran igualmente (cerrar sesión no puede depender de él).
    try {
      await djangoFetch("/auth/logout", {
        method: "POST",
        body: { refresh },
        access,
        headers: clientIpHeaders(req),
        timeoutMs: BLACKLIST_TIMEOUT_MS,
      });
    } catch (err) {
      console.error("logout: no se pudo invalidar el refresh token en Django", err);
    }
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
