import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido" }, { status: 400 });
  }
  const r = await djangoFetch("/auth/password-reset/confirm", { method: "POST", body });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
