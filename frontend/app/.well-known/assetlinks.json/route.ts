import { NextResponse } from "next/server";
import { buildAssetLinks } from "@/lib/assetlinks";

// Se lee la variable en cada petición (no se hornea en el build): basta un redeploy tras cambiarla.
export const dynamic = "force-dynamic";

export function GET() {
  const body = buildAssetLinks(process.env.ANDROID_CERT_SHA256, process.env.ANDROID_PACKAGE);
  return NextResponse.json(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
