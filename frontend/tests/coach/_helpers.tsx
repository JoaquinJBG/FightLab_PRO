import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect } from "vitest";
import en from "@/messages/en.json";

/** Renderiza una vista en inglés; una clave que falta rompe el test (MISSING_MESSAGE). */
export function renderEn(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        onError={(e) => {
          throw e;
        }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const RAW_KEY = /^[a-z]+(\.[A-Za-z]+)+$/;
const SPANISH =
  /[áéíóúñ¿¡]|\b(el|la|los|las|tu|tus|con|para|hoy|peso|entreno|entrenar|carga|semana|perfil|guardar|editar|hombre|mujer|sesión|selecciona|una?)\b/i;

/** Textos visibles + aria-label/placeholder/title de un contenedor. */
export function visibleStrings(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const a of ["aria-label", "placeholder", "title", "alt"]) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
    if (el.tagName === "OPTION" || el.children.length === 0) {
      const t = el.textContent?.trim();
      if (t) out.push(t);
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  return out;
}

export function expectClean(root: HTMLElement, allow: RegExp[] = []) {
  const strings = visibleStrings(root);
  expect(strings.length).toBeGreaterThan(0);
  for (const s of strings) {
    expect(RAW_KEY.test(s), `clave en crudo: ${s}`).toBe(false);
    if (allow.some((r) => r.test(s))) continue;
    expect(SPANISH.test(s), `español: ${s}`).toBe(false);
  }
}
