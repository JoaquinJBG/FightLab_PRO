"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { LineChip, ReasonLine } from "@/components/plan/PlanView";
import { EXERCISE_KEYS } from "@/lib/gym";
import { intlLocale } from "@/lib/locale";
import {
  reviewGrades,
  type Proposal,
  type ProposalKind,
  type ReviewError,
  type WeeklyReview,
} from "@/lib/review";

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{title}</p>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Line({ children, testId }: { children: ReactNode; testId?: string }) {
  return <p data-testid={testId} className="t-body flex flex-wrap items-center gap-2 text-sm text-ink">{children}</p>;
}

function useFormat() {
  const locale = intlLocale(useLocale());
  return {
    n: (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits }),
    signed: (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits, signDisplay: "exceptZero" }),
    date: (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" }),
  };
}

/** Una propuesta de la revisión, con su regla y los motivos del motor. */
function ProposalRow({ proposal, grades, checked, onToggle, pending, accepted }: {
  proposal: Proposal;
  grades: Record<string, string | null>;
  checked: boolean;
  onToggle: () => void;
  pending: boolean;
  accepted: boolean;
}) {
  const t = useTranslations("weeklyReview.proposals");
  const tsec = useTranslations("weeklyReview.sections");
  const f = useFormat();
  let body: ReactNode;
  if (proposal.kind === "calories") {
    body = (
      <>
        <Line>
          <span className="stat text-neon">
            {t("calories", { current: f.n(proposal.current_kcal), kcal: f.n(proposal.kcal), change: f.signed(proposal.change_kcal) })}
          </span>
          <LineChip ruleKey={proposal.rule_key} grades={grades} />
        </Line>
        {proposal.stepped && <p className="t-body text-xs text-muted">{t("caloriesStep", { step: f.n(Math.abs(proposal.change_kcal)) })}</p>}
        {proposal.in_deficit && <p className="t-body text-xs text-muted">{t("caloriesDeficit", { deficit: f.n(proposal.deficit_kcal) })}</p>}
      </>
    );
  } else {
    body = (
      <>
        <Line>
          <span>
            {t("deload", {
              low: Math.round(proposal.volume_cut[0] * 100),
              high: Math.round(proposal.volume_cut[1] * 100),
              rir: proposal.stop_rir,
            })}
          </span>
          <LineChip ruleKey={proposal.rule_key} grades={grades} />
        </Line>
        {proposal.extra_rest_days[1] > 0 && (
          <p className="t-body text-xs text-muted">{t("rest", { low: proposal.extra_rest_days[0], high: proposal.extra_rest_days[1] })}</p>
        )}
      </>
    );
  }
  return (
    <li data-testid="review-proposal" data-kind={proposal.kind} className="flex gap-3 rounded-2xl border border-[rgba(150,190,255,0.1)] p-3">
      {pending ? (
        <input type="checkbox" data-testid="proposal-check" aria-label={proposal.kind === "calories" ? tsec("calories") : tsec("recovery")} checked={checked} onChange={onToggle} className="mt-1" />
      ) : (
        <span className={`badge shrink-0 self-start ${accepted ? "badge-neon" : ""}`}>{accepted ? t("accepted") : t("declined")}</span>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        {body}
        {proposal.reasons.length > 0 && <ul className="flex flex-col gap-1">{proposal.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>}
      </div>
    </li>
  );
}

export function ReviewView({ review, onAccept, accepting, acceptError }: {
  review: WeeklyReview;
  onAccept: (accept: ProposalKind[]) => void;
  accepting: boolean;
  acceptError: ReviewError | null;
}) {
  const t = useTranslations("weeklyReview");
  const tp = useTranslations("weeklyPlan");
  const tg = useTranslations("training.gym");
  const ts = useTranslations("safety");
  const f = useFormat();
  const grades = reviewGrades(review);
  const pending = review.status === "pending";
  const [ticked, setTicked] = useState<ProposalKind[]>(() => review.proposals.map((p) => p.kind));
  const toggle = (kind: ProposalKind) => setTicked((v) => (v.includes(kind) ? v.filter((k) => k !== kind) : [...v, kind]));
  const label = (name: string) => (EXERCISE_KEYS[name] ? tg(`exercises.${EXERCISE_KEYS[name]}`) : name);

  const { adherence, trend, calories, training, deload } = review;
  const nutrition = adherence.nutrition;
  const kinds = ["gym", "mma", "cardio"] as const;

  return (
    <div data-testid="weekly-review" data-status={review.status}>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="t-label text-muted">{t("weekEnding", { start: f.date(adherence.start), end: f.date(adherence.end) })}</p>
        <span data-testid="review-status" className={`badge ${pending ? "" : "badge-neon"}`}>{t(`status.${review.status}`)}</span>
      </div>

      {review.narrative && (
        <Section title={t("sections.narrative")} testId="review-narrative">
          <p className="t-body text-sm text-ink">{review.narrative}</p>
          <p className="t-body text-[11px] text-muted">{t("narrativeNote")}</p>
        </Section>
      )}

      <Section title={t("sections.adherence")} testId="review-adherence">
        <Line>
          {adherence.planned_total !== null
            ? t("adherence.planned", { done: adherence.done_planned ?? 0, planned: adherence.planned_total })
            : t("adherence.noPlan")}
          <EvidenceChip ruleKey={null} />
        </Line>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {kinds.map((kind) => {
            const c = adherence.sessions[kind];
            const name = t(`adherence.kinds.${kind}`);
            return (
              <li key={kind} data-testid="adherence-count" data-kind={kind} className="t-body text-xs text-muted">
                {c.planned !== null ? t("adherence.count", { kind: name, done: c.done, planned: c.planned }) : t("adherence.countNoPlan", { kind: name, done: c.done })}
              </li>
            );
          })}
        </ul>
        {adherence.entries.length > 0 && (
          <ul className="flex flex-col gap-1">
            {adherence.entries.map((e, i) => (
              <li key={`${e.date}-${e.kind}-${i}`} data-testid="adherence-entry" data-done={e.done} data-planned={e.planned} className="t-body flex justify-between gap-2 text-xs">
                <span className="text-ink">
                  {f.date(e.date)} · {t(`adherence.kinds.${e.kind}`)}{e.session ? ` ${e.session}` : ""}
                </span>
                <span className={e.done ? "text-good" : "text-muted"}>
                  {!e.planned
                    ? t("adherence.extra")
                    : !e.done
                      ? t("adherence.missed")
                      : e.done_date && e.done_date !== e.date
                        ? t(e.done_date < e.date ? "adherence.doneEarlier" : "adherence.doneLater", { date: f.date(e.done_date) })
                        : t("adherence.done")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {adherence.entries.some((e) => e.planned && e.done && e.done_date && e.done_date !== e.date) && (
          <p data-testid="adherence-moved-note" className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {t("adherence.movedNote")}
            <LineChip ruleKey={null} grades={grades} convention="fightlab" />
          </p>
        )}
        {adherence.entries.some((e) => !e.done && e.kind === "gym") && (
          <p className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {t("adherence.rotation")}
            <LineChip ruleKey={null} grades={grades} convention="coach" />
          </p>
        )}
        <p data-testid="adherence-intake" className="t-body text-xs text-ink">
          {nutrition.blocked
            ? t("adherence.intakeBlocked")
            : nutrition.mean_kcal === null
              ? t("adherence.intakeNone")
              : nutrition.target_kcal !== null && nutrition.diff_kcal !== null
                ? t("adherence.intake", { mean: f.n(nutrition.mean_kcal), days: nutrition.days_logged, target: f.n(nutrition.target_kcal), diff: f.signed(nutrition.diff_kcal) })
                : t("adherence.intakeNoTarget", { mean: f.n(nutrition.mean_kcal), days: nutrition.days_logged })}
        </p>
      </Section>

      <Section title={t("sections.weight")} testId="review-weight">
        {trend.status === "disabled" ? (
          <Line>{t("weight.disabled")}</Line>
        ) : trend.status === "ok" && trend.weight_kg != null && trend.rate_kg_week != null && trend.rate_pct_week != null ? (
          <Line testId="review-trend">
            {t("weight.ok", { kg: f.n(trend.weight_kg, 2), rate: f.signed(trend.rate_kg_week, 2), pct: f.signed(trend.rate_pct_week, 2), days: trend.days ?? 0 })}
            <LineChip ruleKey={trend.rule_key} grades={grades} />
          </Line>
        ) : (
          <Line>
            {t("weight.insufficient", { minPoints: trend.min_points ?? 0, minDays: trend.min_days ?? 0, points: trend.points ?? 0 })}
            <LineChip ruleKey={trend.rule_key} grades={grades} />
          </Line>
        )}
        {trend.reasons.length > 0 && <ul className="flex flex-col gap-1">{trend.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>}
      </Section>

      {trend.status !== "disabled" && (
        <Section title={t("sections.calories")} testId="review-calories">
          {calories.status === "blocked" ? (
            <Line>{t("calories.blocked")}</Line>
          ) : (
            <>
              {calories.range_pct && (
                <Line>
                  {t("calories.range", {
                    low: f.n(Math.min(...calories.range_pct.map(Math.abs)), 2),
                    high: f.n(Math.max(...calories.range_pct.map(Math.abs)), 2),
                  })}
                  <LineChip ruleKey={calories.rate_rule_key} grades={grades} />
                </Line>
              )}
              <Line testId="calories-status">
                {calories.status === "in_range" && t("calories.inRange")}
                {calories.status === "out_of_range" && (calories.proposal ? t("calories.outOfRange") : t("calories.noChange"))}
                {calories.status === "no_rate_rule" && t("calories.noRateRule")}
                {calories.status === "insufficient_data" && t("calories.insufficient")}
              </Line>
              {calories.tdee_status && (
                <Line testId="calories-tdee">
                  {calories.tdee_status === "ok" && calories.tdee_kcal != null && t("calories.tdee", { kcal: f.n(calories.tdee_kcal) })}
                  {calories.tdee_status === "wait" && t("calories.tdeeWait")}
                  {calories.tdee_status === "no_intake" && t("calories.tdeeNoIntake")}
                  <LineChip ruleKey={calories.recalibrate_rule_key} grades={grades} />
                </Line>
              )}
              {calories.current_kcal != null && <p className="t-body text-xs text-muted">{t("calories.current", { kcal: f.n(calories.current_kcal) })}</p>}
            </>
          )}
          {(calories.reasons ?? []).length > 0 && !calories.proposal && (
            <ul className="flex flex-col gap-1">{calories.reasons!.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>
          )}
        </Section>
      )}

      <Section title={t("sections.training")} testId="review-training">
        {training === null ? (
          <Line>{t("training.blocked")}</Line>
        ) : (
          <>
            <Line>
              {t("training.sets", { start: f.date(training.week.start), end: f.date(training.week.end), ref: training.reference_sets_per_week })}
              <LineChip ruleKey={training.sets_rule_key} grades={grades} />
            </Line>
            {Object.keys(training.sets).length > 0 && (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(training.sets).map(([muscle, n]) => (
                  <li key={muscle} className="t-body flex justify-between text-xs">
                    <span className="text-muted">{tp.has(`muscles.${muscle}`) ? tp(`muscles.${muscle}`) : muscle}</span>
                    <span className="text-ink">{f.n(n, 2)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="t-label mt-1 text-[10px] text-muted">{t("training.lifts")}</p>
            {training.lifts.length === 0 ? (
              <p className="t-body text-xs text-muted">{t("training.noLifts")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {training.lifts.map((lift) => (
                  <li key={lift.exercise} data-testid="review-lift" data-exercise={lift.exercise} data-action={lift.action} className="flex flex-col gap-1">
                    <p className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
                      <span className="t-title text-sm">{label(lift.exercise)}</span>
                      {lift.load_kg !== null && <span className="stat text-neon">{t("training.load", { kg: f.n(lift.load_kg, 2) })}</span>}
                      <span className="text-muted">{tp.has(`actions.${lift.action}`) ? tp(`actions.${lift.action}`) : lift.action}</span>
                      <LineChip ruleKey={lift.rule_key} grades={grades} />
                    </p>
                    {lift.action === "stalled" && <p className="t-body text-[11px] text-warn">{t("training.stalled")}</p>}
                    {lift.reasons.length > 0 && <ul className="flex flex-col gap-1">{lift.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title={t("sections.recovery")} testId="review-recovery">
        <Line testId="recovery-status">
          {t(`recovery.${deload.status}`)}
          <LineChip ruleKey={deload.rule_key} grades={grades} />
        </Line>
        {deload.signs_derived.length > 0 && (
          <p className="t-body text-xs text-muted">{t("recovery.derived", { signs: deload.signs_derived.map((s) => t(`signs.${s}`)).join(", ") })}</p>
        )}
        {deload.status === "indicated" && review.signs.includes("joint_aches") && <p className="t-body text-xs text-muted">{t("recovery.ache")}</p>}
      </Section>

      <Section title={t("sections.proposals")} testId="review-proposals">
        {review.proposals.length === 0 ? (
          <p className="t-body text-sm text-muted">{t("proposals.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {review.proposals.map((p) => (
              <ProposalRow key={p.kind} proposal={p} grades={grades} pending={pending} checked={ticked.includes(p.kind)}
                onToggle={() => toggle(p.kind)} accepted={review.accepted.includes(p.kind)} />
            ))}
          </ul>
        )}
        {pending ? (
          <button type="button" data-testid="review-accept" disabled={accepting} onClick={() => onAccept(ticked)} className="btn btn-primary mt-2 w-full disabled:opacity-60">
            {accepting ? t("proposals.accepting") : ticked.length ? t("proposals.accept") : t("proposals.acceptNone")}
          </button>
        ) : (
          <>
            <p role="status" className="t-body text-xs text-good">{t("proposals.acceptedNote")}</p>
            {review.plan_id && review.plan_week_start ? (
              <p className="t-body text-xs text-ink">
                {t("proposals.planReady", { date: f.date(review.plan_week_start) })}{" "}
                <Link data-testid="review-plan-link" href="/training/plan" className="neon-text underline">{t("proposals.goPlan")}</Link>
              </p>
            ) : (
              <p className="t-body text-xs text-muted">{t("proposals.noPlan")}</p>
            )}
          </>
        )}
        {acceptError && (
          <p role="alert" className="t-body text-xs text-bad">
            {t.has(`errors.${acceptError.code}`) ? t(`errors.${acceptError.code}`) : t("errors.generic")}
          </p>
        )}
      </Section>

      <Section title={t("sections.safety")} testId="review-safety">
        {review.safety_reasons.length ? (
          <ul className="flex flex-col gap-1.5">{review.safety_reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>
        ) : (
          <p className="t-body text-sm text-muted">{t("safetyNone")}</p>
        )}
        <p className="t-body text-[11px] text-muted">{ts("disclaimer")}</p>
      </Section>

      <Section title={t("sections.rules")} testId="review-rules">
        <ul className="flex flex-col gap-1.5">
          {review.rules.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2">
              <span className="t-body text-xs text-ink">{r.title}</span>
              <EvidenceChip ruleKey={r.key} grade={r.grade} />
            </li>
          ))}
        </ul>
        <p className="t-body text-[11px] text-muted">
          <Link href="/profile/credits" className="underline">{review.engine_sha}</Link>
        </p>
      </Section>
    </div>
  );
}
