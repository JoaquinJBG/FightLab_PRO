"use client";

import { useEffect, useRef } from "react";
import { useProfile, useSaveWeighIn, useWeighIn } from "@/lib/hooks";
import { LEGACY_WEIGH_KEY, WEIGH_MIGRATED_KEY, parseLegacyWeigh } from "@/lib/weigh";

/**
 * Migración, una sola vez por navegador, del `flp_weigh` del mockup (localStorage) a la base de
 * datos (spec §6.2, Task 4.4). Sustituye al antiguo `WeighSync`: ya no refleja el servidor en
 * `flp_weigh`, porque Biometría y Coach leen `/coach/weigh-in`.
 *
 * Solo migra si el servidor aún no tiene pesaje y no está bloqueado (`no_weight_targets`). Con la
 * migración hecha, o si no hay nada que migrar, el `flp_weigh` antiguo se borra.
 */
export function WeighMigrate() {
  const { data: profile } = useProfile();
  const { data } = useWeighIn(!!profile);
  const save = useSaveWeighIn();
  const migrating = useRef(false);

  useEffect(() => {
    if (!data || data.blocked) return;
    try {
      if (localStorage.getItem(WEIGH_MIGRATED_KEY) === "1") return;
      const legacy = parseLegacyWeigh(localStorage.getItem(LEGACY_WEIGH_KEY));
      const done = () => {
        localStorage.setItem(WEIGH_MIGRATED_KEY, "1");
        localStorage.removeItem(LEGACY_WEIGH_KEY);
      };
      if (legacy && data.goal_weight_kg == null) {
        if (migrating.current) return;
        migrating.current = true;
        // Un peso objetivo por debajo del actual puede ser rechazado con el déficit bloqueado:
        // se da por migrado igualmente, para no reintentarlo en cada carga.
        save.mutate({ goal_weight_kg: legacy.target, weigh_in_at: legacy.date }, { onSettled: done });
        return;
      }
      done();
    } catch {
      /* sin localStorage: no hay nada que migrar */
    }
  }, [data, save]);

  return null;
}
