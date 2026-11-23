import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";
import { guardAuthRequest } from "@/lib/proxy-guard";

/** ¿Vale el enlace de recuperación? Si vale, Django devuelve el email de la cuenta, que la pantalla
 * de nueva contraseña pone en un campo de usuario oculto para el gestor de contraseñas (F27). */
export async function POST(req: Request) {
  const guardResponse = guardAuthRequest(req);
  if (guardResponse) return guardResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido" }, { status: 400 });
  }
  const r = await djangoFetch("/auth/password-reset/check", {
    method: "POST",
    body,
    headers: clientIpHeaders(req),
  });
  return NextResponse.json(r.data ?? {}, { status: r.status, headers: { "cache-control": "no-store" } });
}
