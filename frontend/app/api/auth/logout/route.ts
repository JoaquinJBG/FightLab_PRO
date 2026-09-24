import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, clearAuthCookies } from "@/lib/cookies";
import { clientIpHeaders } from "@/lib/auth-forward";
import { guardAuthRequest } from "@/lib/proxy-guard";

export async function POST(req: Request) {
  // Logout no espera cuerpo (no manda JSON), así que no se exige Content-Type.
  const guardResponse = guardAuthRequest(req, { requireJsonBody: false });
  if (guardResponse) return guardResponse;

  const refresh = await getRefresh();
  const access = await getAccess();
  if (refresh) {
    await djangoFetch("/auth/logout", {
      method: "POST",
      body: { refresh },
      access,
      headers: clientIpHeaders(req),
    });
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
