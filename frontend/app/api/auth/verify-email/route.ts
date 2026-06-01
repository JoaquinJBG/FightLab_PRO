import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";

export async function POST(req: Request) {
  const body = await req.json();
  const r = await djangoFetch("/auth/verify-email", { method: "POST", body });
  return NextResponse.json(r.data ?? {}, { status: r.status });
}
