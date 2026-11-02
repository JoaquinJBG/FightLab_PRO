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

const SPANISH =
  /[áéíóúñ¿¡]|\b(entreno|entrenos|gimnasio|rutina|semana|carga|series?|guardar|descartar|reanudar|pausar|saltar|descanso|ejercicios?|días?|volver|cargando|vuelta|empezar|herramientas|cronómetro|preparación|trabajo|hoy|nivel|objetivo|tensión|monotonía)\b/i;

/** Sin claves en crudo, sin MISSING_MESSAGE y sin español reconocible en el DOM. */
export function expectClean(container: HTMLElement, allow: string[] = []) {
  expect(errors).toEqual([]);
  let text = container.textContent ?? "";
  for (const a of allow) text = text.split(a).join("");
  for (const node of container.querySelectorAll("*")) {
    for (const v of [node.getAttribute("aria-label"), node.getAttribute("placeholder"), node.getAttribute("title")]) {
      if (v) expect(v).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
    }
    if (node.children.length === 0 && node.textContent) {
      expect(node.textContent.trim()).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
    }
  }
  const attrs = [...container.querySelectorAll("[aria-label],[placeholder]")]
    .map((n) => `${n.getAttribute("aria-label") ?? ""} ${n.getAttribute("placeholder") ?? ""}`)
    .join(" ");
  expect(`${text} ${attrs}`).not.toMatch(SPANISH);
}
