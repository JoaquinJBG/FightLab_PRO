import { NextResponse } from "next/server";
import { djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, clearAuthCookies } from "@/lib/cookies";

export async function POST() {
  const refresh = await getRefresh();
  const access = await getAccess();
  if (refresh) {
    await djangoFetch("/auth/logout", { method: "POST", body: { refresh }, access });
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
