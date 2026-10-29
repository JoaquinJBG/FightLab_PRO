import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LANG_COOKIE, resolveLocale } from "@/lib/locale";

export default getRequestConfig(async () => {
  const locale = resolveLocale(
    (await cookies()).get(LANG_COOKIE)?.value,
    (await headers()).get("accept-language"),
  );
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
