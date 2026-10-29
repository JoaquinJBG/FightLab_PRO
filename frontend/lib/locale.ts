// Idiomas de la app. Sin rutas por idioma: las URLs no cambian (así no se rompe
// la PWA instalada). El idioma sale de la cookie, luego del navegador y, si no, es.
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const LANG_COOKIE = "flp_lang";

function isLocale(v: string | null | undefined): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

/** Cookie `flp_lang` > cabecera `Accept-Language` > español. */
export function resolveLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookie)) return cookie;
  // "fr-FR,es;q=0.8,en;q=0.5" → primer idioma soportado, en el orden de la cabecera
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

/** Selector de idioma (spec §7.5): apagado hasta que acabe la fase I, para que nadie vea
 * la app a medias en inglés. Se activa con `NEXT_PUBLIC_LANGUAGE_SELECTOR_ENABLED=true`
 * (en el build) y, en el backend, `LANGUAGE_SELECTOR_ENABLED=True`. */
export const LANGUAGE_SELECTOR_ENABLED = process.env.NEXT_PUBLIC_LANGUAGE_SELECTOR_ENABLED === "true";

/** El idioma de la app: con el selector apagado, siempre español. */
export function appLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
  selectorEnabled: boolean = LANGUAGE_SELECTOR_ENABLED,
): Locale {
  return selectorEnabled ? resolveLocale(cookie, acceptLanguage) : DEFAULT_LOCALE;
}
