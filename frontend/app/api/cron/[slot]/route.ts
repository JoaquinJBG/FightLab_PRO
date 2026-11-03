import { NextResponse } from "next/server";
import { djangoRequest } from "@/lib/api";
import { callWithRetry, isAuthorized, isSlot } from "@/lib/cron";

// Vercel Cron (vercel.json): /api/cron/evening y /api/cron/morning, una vez al día cada una.
// Límite de la función en el plan Hobby: 60 s.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Primer intento de hasta 45 s (Render dormido tarda ~50 s en total, pero el despertar ya empieza
// con él); si no llega, otro con lo que quede. Todo cabe en 55 s.
const RETRY = { budgetMs: 55_000, attemptMs: 45_000, minAttemptMs: 5_000, pauseMs: 2_000 };

type Ctx = { params: Promise<{ slot: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ code: "cron_not_configured" }, { status: 503 });
  }
  if (!isAuthorized(req.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
  const { slot } = await ctx.params;
  if (!isSlot(slot)) {
    return NextResponse.json({ code: "unknown_slot" }, { status: 404 });
  }
  // El backend solo se fía del BFF con su secreto compartido (X-Bff-Secret).
  const bffSecret = process.env.BFF_SHARED_SECRET;
  if (!bffSecret) {
    return NextResponse.json({ code: "bff_secret_missing" }, { status: 503 });
  }

  const result = await callWithRetry(
    (timeoutMs) =>
      djangoRequest("/cron/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bff-Secret": bffSecret },
        body: JSON.stringify({ slot }),
        timeoutMs,
      }),
    RETRY,
  );
  if (!result.response) {
    console.error(`cron ${slot}: el backend no ha respondido tras ${result.attempts} intentos (${result.error})`);
    return NextResponse.json({ code: "backend_unavailable", attempts: result.attempts }, { status: 504 });
  }
  const body: unknown = await result.response.json().catch(() => null);
  // Solo recuentos: el backend no devuelve datos de nadie.
  console.log(`cron ${slot}: ${result.response.status} tras ${result.attempts} intento(s)`, body);
  return NextResponse.json(
    { slot, status: result.response.status, attempts: result.attempts, result: body },
    { status: result.response.ok ? 200 : 502 },
  );
}
