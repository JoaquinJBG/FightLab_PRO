"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { TodayView } from "@/components/today/TodayView";
import { useToday } from "@/lib/today";

/** "Hoy": el parte rápido del día (fase 11) y la pantalla de inicio de la PWA. El resumen de
 * antes (estado, peso, carga y semana) sigue en /dashboard, enlazado desde aquí. */
export default function TodayPage() {
  const t = useTranslations("today");
  const { data, isLoading, isError, refetch } = useToday();

  // Los accesos directos del manifiesto abren /today#weight y /today#next-meal: al llegar los
  // datos, se baja hasta esa parte.
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [data]);

  if (isError) {
    return (
      <div className="glass mt-6 p-5" role="alert">
        <p className="t-body text-sm text-ink">{t("error")}</p>
        <button type="button" className="btn btn-tonal btn-sm mt-3" onClick={() => refetch()}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (isLoading || !data) {
    return <div className="glass mt-6 h-48 animate-pulse rounded-3xl" aria-label={t("loading")} />;
  }
  return <TodayView state={data} />;
}
