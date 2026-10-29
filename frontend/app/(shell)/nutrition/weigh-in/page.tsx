"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useClearWeighIn, useSafety, useSaveWeighIn, useWeighIn, WeighInError } from "@/lib/hooks";
import { weighInDate } from "@/lib/weigh";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import type { CoachReason, SafetyReason } from "@/lib/schemas";
import { ScaleIcon } from "@/components/icons";

const isSafetyReason = (r: CoachReason): r is CoachReason & { severity: SafetyReason["severity"] } => r.severity !== "info";

export default function WeighInPage() {
  const t = useTranslations("nutrition.weighIn");
  const format = useFormatter();
  const { data, isLoading, isError } = useWeighIn();
  const { data: safety } = useSafety();
  const save = useSaveWeighIn();
  const clear = useClearWeighIn();

  // Lo que el usuario toca; hasta que lo toca, se parte de lo guardado en el servidor.
  const [targetEdit, setTargetEdit] = useState<number | null>(null);
  const [days, setDays] = useState(14);

  const header = (
    <>
      <Link href="/nutrition" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><ScaleIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
    </>
  );

  if (isLoading) return <div className="pt-4">{header}<p className="t-body mt-4 text-xs text-muted">{t("loading")}</p></div>;
  if (isError || !data) return <div className="pt-4">{header}<p className="t-body mt-4 text-xs text-bad">{t("loadError")}</p></div>;

  // `no_weight_targets`: el servidor no devuelve nada de pesaje y aquí tampoco se ve (spec §8.3).
  if (data.blocked) {
    return (
      <div className="pt-4" data-testid="weigh-blocked">
        {header}
        <section className="glass neon-edge mt-4 p-5">
          <p className="t-title text-ink">{t("blocked.title")}</p>
          <p className="t-body mt-1.5 text-sm text-muted">{t("blocked.body")}</p>
        </section>
        {safety && data.reasons.length > 0 && (
          <SafetyPanel data={{ ...safety, reasons: data.reasons.filter(isSafetyReason), parq_pending: false }} />
        )}
      </div>
    );
  }

  const saved = data.goal_weight_kg != null;
  const target = targetEdit ?? data.goal_weight_kg ?? 70;
  const left = data.days_left;
  const toGo = data.to_go_kg; // null con el déficit bloqueado: sin "a X kg de tu categoría"
  const current = data.current_kg;

  function onSave() {
    save.mutate({ goal_weight_kg: target, weigh_in_at: weighInDate(days), weight_class: data?.weight_class ?? null });
    setTargetEdit(null);
  }
  function onClear() {
    clear.mutate();
    setTargetEdit(null);
  }
  const errorCode = save.error instanceof WeighInError ? save.error.code : save.isError ? "generic" : null;

  const stepBtn = "flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95";
  return (
    <div className="pt-4">
      {header}

      {saved && (
        <section data-testid="weigh-summary" className="glass neon-edge mt-4 p-5 text-center">
          <p className="stat text-6xl neon-text">{left != null && left >= 0 ? left : 0}</p>
          <p className="t-label text-muted">{t("daysLeft")}</p>
          <div className="mt-4 flex justify-around">
            <div><p className="stat text-2xl text-ink">{current != null ? format.number(current) : "—"}</p><p className="t-label text-muted">{t("current")}</p></div>
            <div><p className="stat text-2xl text-neon">{format.number(data.goal_weight_kg!)}</p><p className="t-label text-muted">{t("goal")}</p></div>
            {toGo != null && (
              <div data-testid="weigh-to-go"><p className={`stat text-2xl ${toGo > 0 ? "text-warn" : "text-good"}`}>{format.number(toGo > 0 ? toGo : 0)}</p><p className="t-label text-muted">{t("toGo")}</p></div>
            )}
          </div>
          {current == null && <p className="t-body mt-3 text-xs text-muted">{t("needWeight")}</p>}
        </section>
      )}

      {data.deficit_blocked && (
        <p data-testid="weigh-deficit-note" className="t-body mt-3 text-xs text-muted">{t("deficitNote")}</p>
      )}
      {safety && data.deficit_blocked && data.reasons.length > 0 && (
        <SafetyPanel data={{ ...safety, reasons: data.reasons.filter(isSafetyReason), parq_pending: false }} />
      )}

      {/* Configurar */}
      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{saved ? t("updateTitle") : t("configureTitle")}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-label text-ink">{t("goalWeight")}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setTargetEdit(+(target - 0.5).toFixed(1))} aria-label={t("lessGoal")} className={stepBtn}>−</button>
            <span className="stat w-20 text-center text-lg text-ink" data-testid="weigh-target">{t("kg", { kg: format.number(target) })}</span>
            <button onClick={() => setTargetEdit(+(target + 0.5).toFixed(1))} aria-label={t("moreGoal")} className={stepBtn}>+</button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-label text-ink">{t("daysUntil")}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setDays((d) => Math.max(1, d - 1))} aria-label={t("lessDays")} className={stepBtn}>−</button>
            <span className="stat w-20 text-center text-lg text-ink">{t("days", { days })}</span>
            <button onClick={() => setDays((d) => Math.min(180, d + 1))} aria-label={t("moreDays")} className={stepBtn}>+</button>
          </div>
        </div>
        {errorCode && (
          <p data-testid="weigh-error" data-code={errorCode} className="t-body mt-3 text-xs text-warn">
            {errorCode === "deficit_blocked" ? t("errors.deficit_blocked") : errorCode === "weight_targets_blocked" ? t("errors.weight_targets_blocked") : t("errors.generic")}
          </p>
        )}
        <button onClick={onSave} disabled={save.isPending} data-testid="weigh-save" className="btn btn-primary mt-4 w-full disabled:opacity-60">
          {saved ? t("update") : t("save")}
        </button>
        {saved && <button onClick={onClear} disabled={clear.isPending} className="btn btn-outline mt-2 w-full">{t("clear")}</button>}
      </section>

      <p className="t-body mt-4 text-center text-xs text-muted">{t("footer")}</p>
    </div>
  );
}
