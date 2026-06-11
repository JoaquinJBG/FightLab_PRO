"use client";

import { useEffect } from "react";

/**
 * Registra el service worker para que la app sea instalable como PWA.
 * No cachea datos (modo online); solo habilita la instalación y el modo standalone.
 */
export function ServiceWorkerRegister() {
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
