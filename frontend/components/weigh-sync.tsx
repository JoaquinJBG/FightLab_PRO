"use client";

import { useEffect, useRef } from "react";
import { useProfile, useSaveWeighIn, useWeighIn } from "@/lib/hooks";
import { LEGACY_WEIGH_KEY, WEIGH_MIGRATED_KEY, mirrorValue, parseLegacyWeigh } from "@/lib/weigh";

/**
 * Puente provisional del pesaje (spec §6.2, Task 4.4). La fuente de verdad es el servidor.
 *
 * 1. Una vez por navegador, el `flp_weigh` del mockup (localStorage) pasa a la base de datos si
 *    el servidor aún no tiene pesaje y no está bloqueado.
 * 2. El servidor se refleja en `flp_weigh`, que aún leen Biometría y Coach (fase I): con el
 *    pesaje bloqueado (`no_weight_targets`) la clave se borra, para que esas vistas tampoco
 *    muestren nada de pesaje (spec §8.3).
 *
 * Se borra cuando Biometría y Coach lean `/coach/weigh-in`.
 */
export function WeighSync() {
  const { data: profile } = useProfile();
  const { data } = useWeighIn(!!profile);
  const save = useSaveWeighIn();
  const migrating = useRef(false);

  useEffect(() => {
    if (!data) return;
    try {
      const migrated = localStorage.getItem(WEIGH_MIGRATED_KEY) === "1";
      if (!migrated && !data.blocked) {
        const legacy = parseLegacyWeigh(localStorage.getItem(LEGACY_WEIGH_KEY));
        if (legacy && data.goal_weight_kg == null) {
          if (migrating.current) return;
          migrating.current = true;
          // Un peso objetivo por debajo del actual puede ser rechazado con el déficit bloqueado:
          // se marca como migrado igualmente, para no reintentarlo en cada carga.
          save.mutate(
            { goal_weight_kg: legacy.target, weigh_in_at: legacy.date },
            { onSettled: () => localStorage.setItem(WEIGH_MIGRATED_KEY, "1") },
          );
          return;
        }
        localStorage.setItem(WEIGH_MIGRATED_KEY, "1");
      }
      const mirror = mirrorValue(data);
      if (mirror) localStorage.setItem(LEGACY_WEIGH_KEY, JSON.stringify(mirror));
      else localStorage.removeItem(LEGACY_WEIGH_KEY);
    } catch {
      /* sin localStorage: no hay nada que reflejar */
    }
  }, [data, save]);

  return null;
}
