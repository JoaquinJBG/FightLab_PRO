"use client";

import { useEffect } from "react";

/**
 * Registra el service worker para que la app sea instalable como PWA.
 * No cachea datos (modo online); solo habilita la instalación y el modo standalone.
 */
/** Donde la app deja su idioma para la página sin conexión del service worker (R4-3): la cookie
 * `flp_lang` es httpOnly y `public/offline.html` no la puede leer. */
export const OFFLINE_LANG_KEY = "flp_lang";

export function ServiceWorkerRegister({ locale }: { locale?: string }) {
  useEffect(() => {
    if (!locale) return;
    try {
      localStorage.setItem(OFFLINE_LANG_KEY, locale);
    } catch {
      // modo privado o sin espacio: la página sin conexión usará el idioma del navegador
    }
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      return; // los service workers requieren contexto seguro
    }
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
