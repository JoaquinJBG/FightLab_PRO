"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { dismissRejected, firstReason, rejectedActivities, type ActivityKind, type RejectedActivity } from "@/lib/activities";

/** Sesiones que el servidor no aceptó (o guardó sin alguna serie), con el motivo (F17, F2): la
    cola offline ya no las pierde en silencio. Se cierran una a una. */
export function RejectedNotice({ kind }: { kind: ActivityKind }) {
  const t = useTranslations("training.history");
  const [items, setItems] = useState<RejectedActivity[]>([]);
  useEffect(() => {
    // Lectura de localStorage tras montar (no existe en el servidor de Next).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(rejectedActivities(kind));
  }, [kind]);
  if (items.length === 0) return null;
  return (
    <div role="alert" data-testid="rejected-notice" className="glass mt-4 border border-[rgba(255,107,107,0.35)] p-3">
      {items.map((r) => (
        <div key={r.client_id} className="flex items-start justify-between gap-2">
          <p className="t-body text-xs text-[#ff8a8a]">
            {r.dropped_sets
              ? t("droppedSets", { title: r.title || t("untitled"), n: r.dropped_sets })
              : t("rejected", { title: r.title || t("untitled"), reason: firstReason(r.errors) ?? t("noReason") })}
          </p>
          <button type="button" className="t-label min-h-11 shrink-0 px-2 text-muted"
            onClick={() => { dismissRejected(r.client_id); setItems((xs) => xs.filter((x) => x.client_id !== r.client_id)); }}>
            {t("dismiss")}
          </button>
        </div>
      ))}
    </div>
  );
}
