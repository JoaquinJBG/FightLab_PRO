import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { setAuthCookies } from "@/lib/cookies";

export async function POST(req: Request) {
  const body = await req.json();
  const r = await djangoFetch("/auth/login", { method: "POST", body });
  if (r.status === 200 && r.data && typeof r.data === "object") {
    const { access, refresh } = r.data as { access: string; refresh: string };
    await setAuthCookies(access, refresh);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(r.data ?? { detail: "Login fallido" }, { status: r.status || 401 });
}
