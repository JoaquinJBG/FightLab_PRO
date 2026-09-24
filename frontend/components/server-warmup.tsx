"use client";

import { useEffect, useState } from "react";

const SLOW_AFTER_MS = 3000;
const WARMUP_PATH = "/api/proxy/health";

/**
 * Ping en segundo plano al despertar el backend de Render (plan free: hasta ~50 s
 * en frío tras 15 min de inactividad). No bloquea nada: la app sigue funcionando
 * en local (localStorage) mientras tanto. Si tarda más de 3 s, muestra un aviso
 * discreto que desaparece solo en cuanto el ping responde.
 */
export function ServerWarmup() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, SLOW_AFTER_MS);

    fetch(WARMUP_PATH, { method: "GET", cache: "no-store" })
      .catch(() => {
        // Fire-and-forget: si falla, el resto de la app sigue funcionando en local.
      })
      .finally(() => {
        cancelled = true;
        window.clearTimeout(slowTimer);
        setSlow(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, []);

  if (!slow) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <p className="t-body pointer-events-auto rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-xs text-muted shadow-lg backdrop-blur">
        Despertando el servidor…
      </p>
    </div>
  );
}
