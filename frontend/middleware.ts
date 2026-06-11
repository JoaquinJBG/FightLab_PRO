import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = [
  "/dashboard",
  "/training",
  "/nutrition",
  "/coach",
  "/profile",
  "/biometrics",
  "/onboarding",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!needsAuth) return NextResponse.next();
  const hasSession = req.cookies.has("fl_refresh");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/training/:path*",
    "/nutrition/:path*",
    "/coach/:path*",
    "/profile/:path*",
    "/biometrics/:path*",
    "/onboarding",
  ],
};
