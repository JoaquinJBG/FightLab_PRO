import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { expect } from "vitest";
import en from "@/messages/en.json";

export const errors: unknown[] = [];

export function renderEn(ui: ReactElement) {
  errors.length = 0;
  return render(
    <NextIntlClientProvider locale="en" messages={en} onError={(e) => { errors.push(e); }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SPANISH = /[áéíóúñ¿¡]|\b(sesión|entreno|deporte|actividad|guardar|borrar|descartar|iniciar|pausar|reanudar|compañero|duración|este mes|tiempo|carga|plan sugerido|enviar|cerrar)\b/i;

/** Comprueba que no hay claves en crudo ni español reconocible en el DOM. */
export function expectClean(container: HTMLElement) {
  expect(errors).toEqual([]);
  const text = container.textContent ?? "";
  for (const node of container.querySelectorAll("*")) {
    for (const v of [node.getAttribute("aria-label"), node.getAttribute("placeholder"), node.getAttribute("title")]) {
      if (v) expect(v).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
    }
    if (node.children.length === 0 && node.textContent) {
      expect(node.textContent.trim()).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
    }
  }
  const attrs = [...container.querySelectorAll("[aria-label],[placeholder]")]
    .map((n) => `${n.getAttribute("aria-label") ?? ""} ${n.getAttribute("placeholder") ?? ""}`).join(" ");
  expect(`${text} ${attrs}`).not.toMatch(SPANISH);
}
