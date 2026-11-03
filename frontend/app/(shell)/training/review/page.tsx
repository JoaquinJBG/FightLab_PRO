"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardIcon } from "@/components/icons";
import { ReviewView } from "@/components/review/ReviewView";
import { intlLocale } from "@/lib/locale";
import { SIGNS, type Sign, type StaleKnowledge, useAcceptReview, useRunReview, useWeeklyReview } from "@/lib/review";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Evidencia antigua (Task 7.4): el servidor solo la manda al admin. */
function StaleCard({ stale }: { stale: StaleKnowledge }) {
  const t = useTranslations("weeklyReview.stale");
  const locale = intlLocale(useLocale());
  if (!stale.files.length) return null;
  const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  return (
    <section data-testid="review-stale" className="glass mt-4 p-4" style={{ borderColor: "#ffd25a" }}>
      <p className="t-title text-ink">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("body", { months: stale.months })}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {stale.files.map((f) => (
          <li key={`${f.origin}-${f.file}`} className="t-body text-xs text-ink">
            {f.file} · {t(`origin.${f.origin}`)} · {f.checked ? t("checked", { date: fmt(f.checked) }) : t("never")}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function WeeklyReviewPage() {
  const t = useTranslations("weeklyReview");
  const state = useWeeklyReview();
  const run = useRunReview();
  const accept = useAcceptReview();
  const [signs, setSigns] = useState<Sign[]>([]);
  const [weekEnd, setWeekEnd] = useState<string | null>(null);

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

  const data = state.data;
  const end = weekEnd ?? data.week_end;
  const review = data.latest;
  const toggle = (s: Sign) => setSigns((v) => (v.includes(s) ? v.filter((x) => x !== s) : SIGNS.filter((x) => x === s || v.includes(x))));
  const errorCode = run.error?.code;

  return (
    <div className="pt-4 pb-6">
      {header}
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      {data.stale && <StaleCard stale={data.stale} />}

      <form
        data-testid="review-form"
        className="glass mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          accept.reset();
          run.mutate({ week_end: end, signs });
        }}
      >
        <p className="t-title text-ink">{t("form.title")}</p>
        <label className="mt-3 flex flex-col gap-1">
          <span className="t-label text-ink">{t("form.weekEnd")}</span>
          <input
            type="date"
            data-testid="review-week-end"
            value={end}
            max={data.today}
            min={addDays(data.today, -data.max_past_days)}
            onChange={(e) => setWeekEnd(e.target.value || null)}
            className="field px-3 py-2 text-sm"
          />
        </label>
        <fieldset className="mt-3">
          <legend className="t-label text-ink">{t("form.signsQuestion")}</legend>
          <div className="mt-2 flex flex-col gap-2">
            {data.signs.map((s) => (
              <label key={s} className="t-body flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" data-testid="review-sign" data-sign={s} checked={signs.includes(s)} onChange={() => toggle(s)} />
                {t(`signs.${s}`)}
              </label>
            ))}
          </div>
          <p className="t-body mt-1.5 text-[11px] text-muted">{t("form.signsHint")}</p>
        </fieldset>
        <button type="submit" disabled={run.isPending} className="btn btn-primary mt-4 w-full disabled:opacity-60">
          {run.isPending ? t("form.running") : review ? t("form.rerun") : t("form.run")}
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

      {review && (
        <ReviewView
          key={review.id}
          review={review}
          accepting={accept.isPending}
          acceptError={accept.error}
          onAccept={(kinds) => accept.mutate({ id: review.id, accept: kinds })}
        />
      )}
    </div>
  );
}
