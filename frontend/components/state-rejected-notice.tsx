"use client";

import { useEffect, useState } from "react";

import { STATE_REJECTED_EVENT } from "@/lib/user-state";

export function StateRejectedNotice() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onRejected = () => setShown(true);
    window.addEventListener(STATE_REJECTED_EVENT, onRejected);
    return () => window.removeEventListener(STATE_REJECTED_EVENT, onRejected);
  }, []);

  if (!shown) return null;
  return (
    <div role="status" className="glass mx-4 mt-3 flex items-start justify-between gap-3 px-4 py-2 text-[12px]">
      <p>Un cambio no se pudo guardar en tu cuenta (datos no válidos o límite alcanzado). Sigue en este dispositivo.</p>
      <button type="button" className="shrink-0 underline" onClick={() => setShown(false)}>
        Cerrar
      </button>
    </div>
  );
}
