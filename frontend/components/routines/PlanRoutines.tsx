"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFolders, usePlanRoutines, useSyncPlanRoutines, type PlanRoutines as PlanRoutinesData } from "@/lib/routines";
import { RoutineCard } from "./RoutineCard";

/** «Mi rutina»: las rutinas que genera el plan por reglas, editables como cualquier otra.
 *
 * Con un plan nuevo aplicado, se regeneran solas si nadie las ha tocado. Si el usuario editó
 * alguna, no se pisa: se le pregunta si mantener su versión (se queda junto a la nueva) o
 * sustituirla. */
export function PlanRoutines({ planId }: { planId: number }) {
  const t = useTranslations("routines.plan");
  const { data } = usePlanRoutines();
  const folders = useFolders();
  const sync = useSyncPlanRoutines();
  const tried = useRef<number | null>(null);
  const [asking, setAsking] = useState(false);

  const stale = !!data && data.plan_id === planId && !data.in_sync;
  const silent = stale && data.edited.length === 0;
  useEffect(() => {
    // Una vez por plan: sin ediciones se regenera sin preguntar.
    if (silent && tried.current !== planId) {
      tried.current = planId;
      sync.mutate({});
    }
  }, [silent, planId, sync]);

  if (!data) return null;
  const code = sync.error?.code ?? null;
  const editedTitles = (d: PlanRoutinesData) => d.routines.filter((r) => d.edited.includes(r.id)).map((r) => r.title).join(", ");

  return (
    <section data-testid="plan-routines" className="mt-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      {((stale && data.edited.length > 0) || asking) && (
        <div data-testid="plan-routines-edited" role="alert" className="glass mt-3 flex flex-col gap-2 p-3">
          <p className="t-body text-sm text-warn">{t("editedWarning", { names: editedTitles(data) })}</p>
          <button
            type="button"
            data-testid="plan-routines-keep"
            className="btn btn-primary btn-sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ on_edited: "keep" }, { onSuccess: () => setAsking(false) })}
          >
            {t("keep")}
          </button>
          <button
            type="button"
            data-testid="plan-routines-overwrite"
            className="btn btn-outline btn-sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ on_edited: "overwrite" }, { onSuccess: () => setAsking(false) })}
          >
            {t("overwrite")}
          </button>
        </div>
      )}
      {code === "no_training" && (
        <p role="alert" data-testid="plan-routines-blocked" className="t-body mt-3 text-sm text-warn">
          {t("blocked")}
        </p>
      )}
      {sync.isError && code !== "no_training" && code !== "edited" && (
        <p role="alert" className="t-body mt-3 text-sm text-warn">
          {t("syncError")}
        </p>
      )}
      {sync.isPending && <p className="t-body mt-3 text-sm text-muted">{t("syncing")}</p>}

      <div className="mt-3 flex flex-col gap-3">
        {data.routines.map((r) => (
          <RoutineCard key={r.id} routine={r} folders={folders.data ?? []} />
        ))}
      </div>

      {data.in_sync && !asking && (
        <button
          type="button"
          data-testid="plan-routines-regenerate"
          className="btn btn-outline btn-sm btn-block mt-3"
          disabled={sync.isPending}
          onClick={() => (data.edited.length ? setAsking(true) : sync.mutate({ on_edited: "overwrite" }))}
        >
          {t("regenerate")}
        </button>
      )}
    </section>
  );
}
