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

/** Selector de idioma (spec §7.5): encendido por defecto desde que la UI está en es y en.
 * Se apaga con `NEXT_PUBLIC_LANGUAGE_SELECTOR_ENABLED=false` (en el build) y, en el backend,
 * `LANGUAGE_SELECTOR_ENABLED=False`; apagado, toda la app va en español. */
export const LANGUAGE_SELECTOR_ENABLED = process.env.NEXT_PUBLIC_LANGUAGE_SELECTOR_ENABLED !== "false";

/** El idioma de la app: con el selector apagado, siempre español. */
export function appLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
  selectorEnabled: boolean = LANGUAGE_SELECTOR_ENABLED,
): Locale {
  return selectorEnabled ? resolveLocale(cookie, acceptLanguage) : DEFAULT_LOCALE;
}

/** El locale para `Intl` (fechas, horas, números): el inglés de la app es británico. */
export function intlLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

/* ------------------------- Números y fechas con Intl (F11, F12) -------------------------
 * Toda la interfaz formatea con estas funciones: en español, coma decimal («92,5 kg») y fechas
 * «9 de noviembre»; en inglés (británico), «92.5 kg» y «9 November». Son funciones puras (sin
 * React) para usarlas también fuera de los componentes; en un componente, el idioma sale de
 * `useLocale()` de next-intl. No sirven para mandar números al servidor: ahí, `toFixed`. */

export type NumberOpts = {
  /** Decimales fijos, como `toFixed(digits)`: 80 → «80,0» con 1. */
  digits?: number;
  /** Hasta tantos decimales, sin ceros de relleno: 80 → «80», 80,25 → «80,3» con 1. */
  max?: number;
  /** Signo también en los positivos: «+1,5». */
  signed?: boolean;
};

/** Un número con el formato del idioma. `value` puede venir como texto del servidor ("34.1"). */
export function formatNumber(locale: string, value: number | string, opts: NumberOpts = {}): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  const fixed = opts.digits;
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: fixed ?? 0,
    maximumFractionDigits: fixed ?? opts.max ?? 2,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  }).format(n);
}

export type DateStyle =
  | "long" // 9 de noviembre · 9 November
  | "longYear" // 9 de noviembre de 2026 · 9 November 2026
  | "short" // 9 nov · 9 Nov
  | "shortYear" // 9 nov 2026 · 9 Nov 2026
  | "weekday" // lunes, 9 de noviembre · Monday 9 November
  | "numeric"; // 15/06/1990 · 15/06/1990

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { day: "numeric", month: "long" },
  longYear: { day: "numeric", month: "long", year: "numeric" },
  short: { day: "numeric", month: "short" },
  shortYear: { day: "numeric", month: "short", year: "numeric" },
  weekday: { weekday: "long", day: "numeric", month: "long" },
  numeric: { day: "2-digit", month: "2-digit", year: "numeric" },
};

/** Una fecha con el formato del idioma. Una fecha ISO «AAAA-MM-DD» es un día del calendario, sin
 * hora: se formatea tal cual, sin que la zona horaria la mueva al día de antes. */
export function formatDate(locale: string, value: string | Date, style: DateStyle = "long"): string {
  const iso = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12));
    return new Intl.DateTimeFormat(intlLocale(locale), { ...DATE_STYLES[style], timeZone: "UTC" }).format(d);
  }
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(intlLocale(locale), DATE_STYLES[style]).format(d);
}

/** Mayúscula solo en la primera letra, para empezar una frase («Lunes, 9 de noviembre»). La clase
 * CSS `capitalize` la ponía en cada palabra («Lunes, 9 De Noviembre»). */
export function capitalizeFirst(text: string, locale: string = DEFAULT_LOCALE): string {
  return text ? text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1) : text;
}
