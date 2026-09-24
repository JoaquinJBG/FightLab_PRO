import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";
import { guardAuthRequest } from "@/lib/proxy-guard";

export async function POST(req: Request) {
  const guardResponse = guardAuthRequest(req);
  if (guardResponse) return guardResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido" }, { status: 400 });
  }
  const r = await djangoFetch("/auth/password-reset/confirm", {
    method: "POST",
    body,
    headers: clientIpHeaders(req),
  });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
