import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { clientIpHeaders } from "@/lib/auth-forward";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido" }, { status: 400 });
  }
  const r = await djangoFetch("/auth/verify-email/resend", {
    method: "POST",
    body,
    headers: clientIpHeaders(req),
  });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
