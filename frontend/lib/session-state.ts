"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/* Estado de la pestaña que sobrevive a que la vista se desmonte (R3-9 de la prueba en móvil: la
 * conversación del coach se vaciaba). Va en sessionStorage, no en localStorage: dura lo que la
 * pestaña o la PWA abierta, y al cerrar sesión se borra (finishLogout en lib/hooks.ts).
 *
 * Se lee después de montar, para que el primer render sea igual que el HTML del servidor. */
export function useSessionState<T>(
  key: string,
  initial: T,
  trim: (v: T) => T = (v) => v,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch { /* sin sessionStorage o dato roto: se empieza de cero */ }
    loaded.current = true;
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(trim(value)));
    } catch { /* lleno o bloqueado: sigue en memoria */ }
  }, [key, value, trim]);

  return [value, setValue];
}

/** Borra el estado de la pestaña de FightLab (`flp_*`), al cerrar sesión. */
export function clearSessionState(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("flp_")) sessionStorage.removeItem(k);
    }
  } catch { /* noop */ }
}
