"use client";

import { useTranslations } from "next-intl";
import { TodayView } from "@/components/today/TodayView";
import { useToday } from "@/lib/today";

/** "Hoy": el parte rápido del día (fase 11) y la pantalla de inicio de la PWA: entreno, próxima comida y
 * apuntar rápido. Lo demás está en Progreso, Nutrición y Entreno. */
export default function TodayPage() {
  const t = useTranslations("today");
  const { data, isLoading, isError, refetch } = useToday();

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
