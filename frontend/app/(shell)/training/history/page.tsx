"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { ChevronRight } from "@/components/icons";
import { TrainingCalendar } from "@/components/gym/TrainingCalendar";
import type { ServerActivity } from "@/lib/activities";

const LIMIT = 60;

/* Historial de todo lo entrenado (gimnasio, MMA y deporte): calendario del mes + lista reciente.
   Solo reúne lo que ya existe (`GET activities` y el calendario); el detalle de gimnasio es el de siempre. */
export default function TrainingHistoryPage() {
  const t = useTranslations("training.history");
  const tk = useTranslations("training.calendar");
  const locale = intlLocale(useLocale());
  const [items, setItems] = useState<ServerActivity[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/proxy/activities?limit=${LIMIT}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="pt-4 pb-6">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>

      <TrainingCalendar />

      {items === null && <p className="t-body mt-4 text-sm text-muted">{tk("loading")}</p>}
      {items !== null && items.length === 0 && <p data-testid="history-empty" className="t-body mt-4 text-sm text-muted">{t("empty")}</p>}
      {items !== null && items.length > 0 && (
        <ul data-testid="history-list" className="mt-4 flex flex-col gap-2">
          {items.map((a) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="t-label block truncate text-ink">{tk(`kinds.${a.kind}`)} · {a.title || tk("untitled")}</span>
                  <span className="t-body block text-[11px] text-muted">
                    {new Date(a.started_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })} · {Math.round(a.duration_sec / 60)} min
                  </span>
                </span>
                {a.kind === "GYM" && <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
              </>
            );
            return (
              <li key={a.id}>
                {a.kind === "GYM"
                  ? <Link href={`/training/gym/history/${a.id}`} className="glass flex items-center gap-2 p-3">{body}</Link>
                  : <div className="glass flex items-center gap-2 p-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
