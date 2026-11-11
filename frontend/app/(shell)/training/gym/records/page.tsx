"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { TrainingIcon, ChevronRight } from "@/components/icons";
import { EXERCISE_KEYS } from "@/lib/gym";
import { useRecords } from "@/lib/gym-api";
import { normalize } from "@/lib/exercises";

/** Lista de récords (F17): peso máximo, mejor e1RM y volumen de cada ejercicio entrenado. */
export default function GymRecordsPage() {
  const t = useTranslations("training.gymRecords");
  const tg = useTranslations("training.gym");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const exLabel = (n: string) => (EXERCISE_KEYS[n] ? tg(`exercises.${EXERCISE_KEYS[n]}`) : n);
  const { data, isLoading, isError } = useRecords(null);
  const [q, setQ] = useState("");
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString(locale));
  const rows = Object.entries(data ?? {})
    .filter((e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== null)
    .filter(([, r]) => !q.trim() || normalize(exLabel(r.name)).includes(normalize(q)));

  return (
    <div className="pt-4 pb-24">
      <Link href="/training/gym" className="t-label inline-flex min-h-11 items-center text-muted">{t("back")}</Link>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
      <p className="t-body mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {t("intro")}
        <span className="t-label inline-flex rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-muted">{tp("conventionCoach")}</span>
      </p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")}
        className="field mt-3 min-h-11 w-full px-4 text-sm" />
      {isLoading && <p className="t-body mt-4 text-sm text-muted">{t("loading")}</p>}
      {isError && <p role="alert" className="t-body mt-4 text-sm text-[#ffd08a]">{t("error")}</p>}
      {data && rows.length === 0 && <p className="t-body mt-4 text-sm text-muted">{t("empty")}</p>}
      <ul className="mt-3 flex flex-col gap-2" data-testid="records-list">
        {rows.map(([id, r]) => (
          <li key={id}>
            <Link href={`/training/gym/exercise?id=${encodeURIComponent(id)}&name=${encodeURIComponent(r.name)}`} className="glass flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="t-label truncate text-ink">{exLabel(r.name)}</p>
                <p className="t-body text-[11px] text-muted">
                  {t("line", { weight: n(r.max_weight_kg), e1rm: n(r.best_e1rm_kg), volume: n(r.best_set_volume_kg), sessions: r.sessions })}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
