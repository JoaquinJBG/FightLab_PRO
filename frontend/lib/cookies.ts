import { cookies } from "next/headers";

export const ACCESS = "fl_access";
export const REFRESH = "fl_refresh";

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setAuthCookies(access: string, refresh: string) {
  const jar = await cookies();
  jar.set(ACCESS, access, { ...base, maxAge: 60 * 15 });
  jar.set(REFRESH, refresh, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export async function setAccessCookie(access: string) {
  const jar = await cookies();
  jar.set(ACCESS, access, { ...base, maxAge: 60 * 15 });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function getAccess() {
  return (await cookies()).get(ACCESS)?.value ?? null;
}

export async function getRefresh() {
  return (await cookies()).get(REFRESH)?.value ?? null;
}
