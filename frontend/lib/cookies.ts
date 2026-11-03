import { cookies } from "next/headers";
import { LANG_COOKIE, LOCALES, type Locale } from "./locale";

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

/** Idioma del perfil (`profile.language`) en la cookie que leen la UI y el BFF (spec §7.5). */
export async function setLangCookie(lang: unknown) {
  if (typeof lang !== "string" || !(LOCALES as readonly string[]).includes(lang)) return;
  const jar = await cookies();
  if (jar.get(LANG_COOKIE)?.value === lang) return;
  jar.set(LANG_COOKIE, lang as Locale, { ...base, maxAge: 60 * 60 * 24 * 365 });
}
