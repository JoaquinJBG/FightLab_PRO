"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber, intlLocale } from "@/lib/locale";
import { TrainingIcon } from "@/components/icons";
import { EXERCISE_KEYS } from "@/lib/gym";
import { useProgress, useRecords, type ProgressPoint } from "@/lib/gym-api";
import { ProgressChart } from "@/components/gym/ProgressChart";

const METRICS = ["e1rm", "weight", "volume", "bestSet"] as const;
type Metric = (typeof METRICS)[number];

const value = (p: ProgressPoint, m: Metric): number | null =>
  m === "e1rm" ? p.e1rm_kg : m === "weight" ? p.max_weight_kg : m === "volume" ? p.volume_kg : p.best_set ? p.best_set.weight_kg * p.best_set.reps : null;

/** Progreso de un ejercicio (F17): gráfica de e1RM, peso máximo, volumen y mejor serie por
    sesión, y sus récords. `?id=` es la clave (`cat:…`, `custom:…`) o el nombre. */
function ExerciseProgress() {
  const t = useTranslations("training.gymProgress");
  const tg = useTranslations("training.gym");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const params = useSearchParams();
  const id = params?.get("id") ?? "";
  const nameParam = params?.get("name") ?? "";
  const [metric, setMetric] = useState<Metric>("e1rm");
  const { data, isLoading, isError } = useProgress(id);
  const { data: records } = useRecords(id ? [id] : []);
  const rec = records ? Object.values(records)[0] : null;
  const rawName = data?.name ?? rec?.name ?? nameParam;
  const name = EXERCISE_KEYS[rawName] ? tg(`exercises.${EXERCISE_KEYS[rawName]}`) : rawName;
  const n = (v: number | null | undefined, max = 2) => (v == null ? "—" : formatNumber(locale, v, { max }));
  const kgOf = (v: number | null | undefined, max = 2) => (v == null ? "—" : `${n(v, max)} kg`);
  const points = (data?.sessions ?? []).map((p) => ({ date: p.date, value: value(p, metric) }));
  const last = data?.sessions[data.sessions.length - 1];

  return (
    <div className="pt-4 pb-24">
      <Link href="/training/gym/records" className="t-label inline-flex min-h-11 items-center text-muted">{t("back")}</Link>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{name || t("title")}</h1>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("metric")}>
        {METRICS.map((m) => (
          <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}
            className={`badge min-h-11 ${metric === m ? "badge-neon" : ""}`}>{t(`metrics.${m}`)}</button>
        ))}
      </div>

      <div className="glass mt-3 p-4">
        {isLoading && <p className="t-body text-sm text-muted">{t("loading")}</p>}
        {isError && <p role="alert" className="t-body text-sm text-[#ffd08a]">{t("error")}</p>}
        {data && data.sessions.length === 0 && <p className="t-body text-sm text-muted">{t("empty")}</p>}
        {data && data.sessions.length > 0 && (
          <>
            <ProgressChart points={points} label={t(`metrics.${metric}`)} unit="kg" locale={locale} />
            {metric === "e1rm" && (
              <p className="t-body mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                {t("e1rmNote")}
                <span className="t-label inline-flex rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-muted">{tp("conventionCoach")}</span>
              </p>
            )}
            {last?.best_set && (
              <p className="t-body mt-2 text-xs text-muted">{t("lastBest", { kg: n(last.best_set.weight_kg), reps: last.best_set.reps, date: new Date(last.date).toLocaleDateString(locale, { day: "numeric", month: "short" }) })}</p>
            )}
          </>
        )}
      </div>

      {rec && (
        <div className="glass mt-4 p-4" data-testid="exercise-records">
          <p className="t-eyebrow text-muted">{t("records")}</p>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <div><dt className="t-label text-muted">{t("maxWeight")}</dt><dd className="stat text-lg text-ink">{kgOf(rec.max_weight_kg)}</dd></div>
            <div><dt className="t-label text-muted">{t("bestE1rm")}</dt><dd className="stat text-lg text-ink">{kgOf(rec.best_e1rm_kg, 1)}</dd></div>
            <div><dt className="t-label text-muted">{t("bestSetVolume")}</dt><dd className="stat text-lg text-ink">{kgOf(rec.best_set_volume_kg)}</dd></div>
            <div><dt className="t-label text-muted">{t("bestSessionVolume")}</dt><dd className="stat text-lg text-ink">{kgOf(rec.best_session_volume_kg)}</dd></div>
          </dl>
          {rec.reps_by_weight.length > 0 && (
            <>
              <p className="t-label mt-3 text-muted">{t("repsByWeight")}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {rec.reps_by_weight.slice(0, 12).map((r) => (
                  <li key={String(r.weight_kg)} className="t-body flex justify-between text-xs text-ink">
                    <span>{n(r.weight_kg)} kg</span><span>{t("reps", { n: r.reps })}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExerciseProgressPage() {
  return (
    <Suspense fallback={null}>
      <ExerciseProgress />
    </Suspense>
  );
}
