"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardIcon } from "@/components/icons";
import { PlanView } from "@/components/plan/PlanView";
import { StrengthSetsCard } from "@/components/plan/StrengthSetsCard";
import { intlLocale } from "@/lib/locale";
import { DAYS, type Day, useApplyPlan, useGeneratePlan, useWeeklyPlan } from "@/lib/plan";

function DayPicker({ label, hint, value, onChange, testId }: {
  label: string;
  hint: string;
  value: Day[];
  onChange: (v: Day[]) => void;
  testId: string;
}) {
  const td = useTranslations("training.myRoutine.days");
  const toggle = (d: Day) => onChange(value.includes(d) ? value.filter((x) => x !== d) : DAYS.filter((x) => x === d || value.includes(x)));
  return (
    <fieldset data-testid={testId} className="mt-3">
      <legend className="t-label text-ink">{label}</legend>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {DAYS.map((d) => {
          const on = value.includes(d);
          return (
            <button key={d} type="button" aria-pressed={on} aria-label={td(d)} data-day={d} onClick={() => toggle(d)}
              className="rounded-xl py-2 text-xs font-medium transition-colors"
              style={on
                ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                : { background: "rgba(255,255,255,0.05)", color: "var(--color-muted)" }}>
              {td(d).slice(0, 2)}
            </button>
          );
        })}
      </div>
      <p className="t-body mt-1.5 text-[11px] text-muted">{hint}</p>
    </fieldset>
  );
}

export default function WeeklyPlanPage() {
  const t = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const state = useWeeklyPlan();
  const generate = useGeneratePlan();
  const apply = useApplyPlan();
  // null: sin tocar, se usan los días por defecto del servidor.
  const [gymChoice, setGymDays] = useState<Day[] | null>(null);
  const [mmaChoice, setMmaDays] = useState<Day[] | null>(null);
  const defaults = state.data?.defaults;
  const gymDays = gymChoice ?? defaults?.gym_days ?? [];
  const mmaDays = mmaChoice ?? defaults?.mma_days ?? [];

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" });

  const header = (
    <>
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><ClipboardIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
    </>
  );

  if (state.isLoading) return <div className="pt-4">{header}<p className="t-body mt-4 text-muted">{t("loading")}</p></div>;
  if (state.isError || !state.data) return <div className="pt-4">{header}<p className="t-body mt-4 text-bad">{t("error")}</p></div>;

  const { blocked, draft, active } = state.data;
  if (blocked) {
    return (
      <div className="pt-4">
        {header}
        <section data-testid="plan-blocked" className="glass mt-4 p-4" style={{ borderColor: "#ff5a6e" }}>
          <p className="t-title text-ink">{t("blocked.title")}</p>
          <p className="t-body mt-1 text-sm text-muted">{t("blocked.body")}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {blocked.reasons.map((r, i) => <li key={`${r.code}-${i}`} className="t-body text-xs text-ink first-letter:uppercase">{r.text}</li>)}
          </ul>
        </section>
      </div>
    );
  }

  const shown = draft ?? active;
  const errorCode = generate.error?.code;
  const minGym = defaults?.min_gym_days ?? 2;

  return (
    <div className="pt-4 pb-6">
      {header}
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <p className="t-label mt-2 text-muted">{t("weekOf", { date: fmtDate(state.data.week_start) })}</p>

      <form
        data-testid="plan-form"
        className="glass mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          generate.mutate({ gym_days: gymDays, mma_days: mmaDays });
        }}
      >
        <DayPicker testId="gym-days" label={t("form.gymDays")} hint={t("form.gymHint", { min: minGym })} value={gymDays} onChange={setGymDays} />
        <DayPicker testId="mma-days" label={t("form.mmaDays")} hint={t("form.mmaHint")} value={mmaDays} onChange={setMmaDays} />
        <button type="submit" disabled={generate.isPending || gymDays.length < minGym} className="btn btn-primary mt-4 w-full disabled:opacity-60">
          {generate.isPending ? t("form.generating") : shown ? t("form.regenerate") : t("form.generate")}
        </button>
        {errorCode && (
          <p role="alert" className="t-body mt-2 text-xs text-bad">
            {t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t("errors.generic")}
            {errorCode === "profile_incomplete" && (
              <> <Link href="/onboarding" className="neon-text underline">{t("completeOnboarding")}</Link></>
            )}
          </p>
        )}
      </form>

      <StrengthSetsCard />

      {shown && (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span data-testid="plan-status" className={`badge ${shown.status === "active" ? "badge-neon" : ""}`}>{t(`status.${shown.status}`)}</span>
            {shown.status === "draft" ? (
              <button type="button" onClick={() => apply.mutate(shown.id)} disabled={apply.isPending} className="btn btn-primary btn-sm disabled:opacity-60">
                {apply.isPending ? t("applying") : t("apply")}
              </button>
            ) : (
              <Link href="/training/my-routine" className="btn btn-tonal btn-sm">{t("goRoutine")}</Link>
            )}
          </div>
          {apply.isSuccess && (
            <p role="status" className="t-body mt-2 text-xs text-good">
              {t("applied")} <Link href="/training/my-routine" className="neon-text underline">{t("goRoutine")}</Link>
            </p>
          )}
          {apply.error && <p role="alert" className="t-body mt-2 text-xs text-bad">{t.has(`errors.${apply.error.code}`) ? t(`errors.${apply.error.code}`) : t("errors.generic")}</p>}
          <PlanView plan={shown} />
        </>
      )}
    </div>
  );
}
