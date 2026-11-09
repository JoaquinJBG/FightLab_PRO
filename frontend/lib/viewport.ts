"use client";

import { useEffect, useState } from "react";

/* Teclado en pantalla y zona visible (F4 de la prueba en móvil).
 *
 * En Android el teclado puede encoger solo la zona visible (`visualViewport`) o también la
 * ventana (`innerHeight`), según el navegador y si la PWA está instalada. Por eso no se fía de
 * una sola señal: el teclado cuenta como abierto si hay un campo de texto con el foco en una
 * pantalla táctil, o si la zona visible es claramente más baja que la ventana. */

// Tipos de <input> que abren el teclado. Fecha, hora, casillas, etc. abren otro selector o nada.
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "password", "number"]);

/** ¿Este elemento abre el teclado en pantalla al tener el foco? */
export function isTextEntry(el: Element | null): boolean {
  if (!el || typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return false;
  if (el.getAttribute("inputmode") === "none") return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type.toLowerCase()) && !el.readOnly && !el.disabled;
  }
  return el.isContentEditable === true;
}

function coarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

// Diferencia mínima entre la ventana y la zona visible para dar el teclado por abierto (px).
// La barra de direcciones de Chrome mide unos 56 px; el teclado más bajo, más de 200.
const KEYBOARD_MIN_PX = 150;

function viewportShrunk(): boolean {
  const vv = window.visualViewport;
  return !!vv && window.innerHeight - vv.height * vv.scale > KEYBOARD_MIN_PX;
}

/** `true` mientras el teclado en pantalla está (casi seguro) abierto. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      // Al saltar de un campo a otro llegan `focusout` y luego `focusin`: se mira en el
      // siguiente fotograma para no parpadear.
      frame = requestAnimationFrame(() => {
        setOpen((coarsePointer() && isTextEntry(document.activeElement)) || viewportShrunk());
      });
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    window.visualViewport?.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, []);
  return open;
}

export type ViewportBox = { top: number; height: number };

function readBox(): ViewportBox {
  const vv = window.visualViewport;
  return vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight };
}

/** La zona visible de verdad (sin el teclado), para fijar encima un panel a pantalla completa.
 * Con `enabled = false` no escucha nada y devuelve `null`. */
export function useVisualViewportBox(enabled: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBox(null);
      return;
    }
    const update = () => setBox(readBox());
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return box;
}
