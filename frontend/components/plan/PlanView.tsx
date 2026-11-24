"use client";

import { roundGrams } from "@/lib/nutrition";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { ChevronRight, InfoIcon } from "@/components/icons";
import { BottomSheet } from "@/components/today/BottomSheet";
import { EXERCISE_KEYS } from "@/lib/gym";
import { intlLocale } from "@/lib/locale";
import {
  DAYS,
  gradeIndex,
  type Modality,
  type PlanDeload,
  type PlanItem,
  type PlanSession,
  type ScheduleEntry,
  type WeeklyPlan,
} from "@/lib/plan";
import type { CoachReason } from "@/lib/schemas";

const SEVERITY_COLOR: Record<string, string> = {
  stop: "#ff5a6e",
  refer: "#ffd25a",
  limit: "#45e9ff",
  info: "var(--color-muted)",
};

/** Chip de la regla de una línea. Sin regla, la etiqueta de convención (de FightLab por
 * defecto, del coach si la convención es suya). */
export function LineChip({ ruleKey, grades, convention }: {
  ruleKey: string | null | undefined;
  grades: Record<string, string | null>;
  convention?: "coach" | "fightlab" | null;
}) {
  const t = useTranslations("weeklyPlan");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {(ruleKey || convention !== "coach") && <EvidenceChip ruleKey={ruleKey ?? null} grade={ruleKey ? grades[ruleKey] : null} />}
      {ruleKey && convention === "fightlab" && <EvidenceChip ruleKey={null} />}
      {convention === "coach" && (
        <span data-testid="convention-coach" className="t-label inline-flex rounded-full border border-white/20 px-2.5 py-0.5 text-muted">
          {t("conventionCoach")}
        </span>
      )}
    </span>
  );
}

function useExerciseLabel() {
  const tg = useTranslations("training.gym");
  return (name: string) => (EXERCISE_KEYS[name] ? tg(`exercises.${EXERCISE_KEYS[name]}`) : name);
}

export function ReasonLine({ reason }: { reason: CoachReason }) {
  return (
    <li data-testid="plan-reason" data-code={reason.code} className="flex flex-wrap items-center gap-2">
      <span className="t-body text-xs first-letter:uppercase" style={{ color: SEVERITY_COLOR[reason.severity] ?? "inherit" }}>
        {reason.text}
      </span>
      <EvidenceChip ruleKey={reason.rule_key} grade={reason.grade} />
    </li>
  );
}

/** Botón ⓘ que abre el detalle en un panel inferior (docs/ux/simplificar.md: las explicaciones
 * van detrás de un toque, nunca en un párrafo fijo). */
export function InfoSheet({ label, title, testId, children }: {
  label: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-open`}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="-my-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:text-neon"
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      {open && (
        <BottomSheet title={title} onClose={() => setOpen(false)} testId={testId}>
          {children}
        </BottomSheet>
      )}
    </>
  );
}

/** Un aviso en una línea, con su detalle detrás de ⓘ. */
function NoticeLine({ testId, color, title, label, children, extra }: {
  testId: string;
  color: string;
  title: string;
  label: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section data-testid={testId} className="glass mt-3 px-4 py-2.5" style={{ borderColor: color }}>
      <div className="flex items-center justify-between gap-2">
        <p className="t-title text-sm text-ink">{title}</p>
        <InfoSheet label={label} title={title} testId={`${testId}-why`}>
          {children}
        </InfoSheet>
      </div>
      {extra}
    </section>
  );
}

function Section({ title, children, testId, action }: { title: string; children: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <section data-testid={testId} className="glass mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="t-eyebrow text-muted">{title}</p>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ItemRow({ item, grades }: { item: PlanItem; grades: Record<string, string | null> }) {
  const t = useTranslations("weeklyPlan");
  const label = useExerciseLabel();
  const locale = intlLocale(useLocale());
  const kg = (v: number) => v.toLocaleString(locale);
  let load: string;
  let short: string;
  if (item.load_kg === null) {
    load = item.action === "paused" ? t("item.pausedNoLoad") : t("item.noLoad");
    short = item.action === "paused" ? t("item.pausedNoLoadShort") : t("item.noLoadShort");
  } else {
    load = item.action === "paused" ? t("item.ceiling", { kg: kg(item.load_kg) }) : t("item.load", { kg: kg(item.load_kg) });
    short = load;
  }
  // Lo de seguridad se queda a la vista en una palabra: en pausa o cambiado por una lesión.
  const tag = item.action === "paused" ? t("item.pausedTag") : item.swapped_from ? t("item.swappedTag") : null;
  const name = label(item.exercise);
  const scheme = item.sets > 0 ? t("item.scheme", { sets: item.sets, low: item.rep_range[0], high: item.rep_range[1] }) : null;
  return (
    <li data-testid="plan-item" data-exercise={item.exercise} data-action={item.action} className="flex items-center gap-2 border-t border-[rgba(150,190,255,0.08)] py-1.5 first:border-t-0">
      <p className="t-body min-w-0 flex-1 truncate text-sm text-ink">
        {name}
        {tag && <span data-testid="plan-item-tag" className="ml-1.5 text-[11px] text-warn">{tag}</span>}
      </p>
      {scheme && <span className="stat shrink-0 text-xs text-neon">{scheme}</span>}
      <span className="t-body max-w-[34%] shrink-0 truncate text-right text-xs text-muted">{short}</span>
      <InfoSheet label={t("item.why", { name })} title={name} testId="plan-item-why">
        <div className="flex flex-col gap-2">
          <p className="t-body text-sm text-ink">
            {scheme && <span className="stat text-neon">{scheme} · </span>}
            {load}
          </p>
          <p className="t-body text-xs text-muted">
            {t(`patterns.${item.pattern}`)} · {t(`actions.${item.action}`)}
          </p>
          {item.swapped_from && <p className="t-body text-xs text-muted">{t("item.swapped", { name: label(item.swapped_from) })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <LineChip ruleKey={item.rule_key} grades={grades} />
            <span className="t-body text-[11px] text-muted">{t(`setsBasis.${item.sets_basis}`)}</span>
            {item.sets_basis === "coach_convention" && <LineChip ruleKey={null} grades={grades} convention="coach" />}
            {item.sets_basis === "deload" && <LineChip ruleKey={null} grades={grades} />}
            {item.sets_rule_key && <LineChip ruleKey={item.sets_rule_key} grades={grades} />}
          </div>
          {item.reasons.length > 0 && <ul className="flex flex-col gap-1">{item.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>}
        </div>
      </InfoSheet>
    </li>
  );
}

export function SessionCard({ session, grades, action, deload }: {
  session: PlanSession;
  grades: Record<string, string | null>;
  action?: ReactNode;
  deload?: PlanDeload | null;
}) {
  const t = useTranslations("weeklyPlan");
  const title = t("session", { key: session.key });
  return (
    <div data-testid="plan-session" data-session={session.key} className="rounded-2xl border border-[rgba(150,190,255,0.1)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="t-title text-ink">{title}</p>
        <p className="t-body flex items-center gap-1 text-[11px] text-muted">
          {deload ? t("deload.effortShort", { rir: deload.stop_rir }) : t("effortShort", { low: session.effort.rir[0], high: session.effort.rir[1] })}
          <InfoSheet label={t("sessionWhy", { key: session.key })} title={title} testId="plan-session-why">
            <div className="flex flex-col gap-2">
              <p className="t-body flex flex-wrap items-center gap-2 text-sm text-ink">
                {deload ? t("deload.effort", { rir: deload.stop_rir }) : t("effort", { low: session.effort.rir[0], high: session.effort.rir[1] })}
                <LineChip ruleKey={session.effort.rule_key} grades={grades} />
              </p>
              <p className="t-body flex flex-wrap items-center gap-2 text-xs text-muted">
                {t("fullBody")}
                <LineChip ruleKey={session.rule_key} grades={grades} />
              </p>
            </div>
          </InfoSheet>
        </p>
      </div>
      <ul className="mt-1.5 flex flex-col">
        {session.items.map((item) => <ItemRow key={`${item.pattern}-${item.exercise}`} item={item} grades={grades} />)}
      </ul>
      {action}
    </div>
  );
}

function ModalityChips({ items, grades, excluded = false }: { items: Modality[]; grades: Record<string, string | null>; excluded?: boolean }) {
  const t = useTranslations("weeklyPlan");
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((m) => (
        <li key={m.key} data-testid={excluded ? "modality-excluded" : "modality-allowed"} data-key={m.key} className="flex flex-wrap items-center gap-2">
          <span className={`t-body text-xs ${excluded ? "text-muted line-through" : "text-ink"}`}>{t(`modalities.${m.key}`)}</span>
          <span className="t-label text-[10px] text-muted">{t(`intensity.${m.intensity}`)}</span>
          <LineChip ruleKey={m.rule_key} grades={grades} convention={m.convention} />
          {excluded && <span className="t-body text-[11px] text-muted">{m.blocked_by.map((b) => t(`blockedBy.${b}`)).join(" · ")}</span>}
        </li>
      ))}
    </ul>
  );
}

function DayRow({ day, entries, grades }: { day: string; entries: ScheduleEntry[]; grades: Record<string, string | null> }) {
  const t = useTranslations("weeklyPlan");
  const td = useTranslations("training.myRoutine.days");
  return (
    <li data-testid="plan-day" data-day={day} className="flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.08)] pt-2 first:border-t-0 first:pt-0">
      <p className="t-title text-sm text-ink">{td(day)}</p>
      {entries.length === 0 && <p className="t-body text-xs text-muted">{t("day.rest")}</p>}
      {entries.map((e, i) => (
        <div key={`${e.kind}-${i}`} data-testid={`plan-entry-${e.kind}`} className="flex flex-col gap-1.5">
          <p className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
            <ChevronRight className="h-3 w-3 shrink-0 text-neon" />
            {e.kind === "gym" && t("day.gym", { session: e.session })}
            {e.kind === "mma" && t("day.mma")}
            {e.kind === "cardio" && t("day.cardio", { minutes: e.minutes })}
            {e.time && <span className="text-muted">{t("day.at", { time: e.time })}</span>}
            {e.kind !== "mma" && <LineChip ruleKey={e.rule_key} grades={grades} />}
            {e.kind === "gym" && e.rotation_convention === "coach" && <LineChip ruleKey={null} grades={grades} convention="coach" />}
          </p>
          {e.kind === "mma" && (
            <div className="flex flex-col gap-2 pl-5">
              <p className="t-label text-[10px] text-muted">{t("mma.allowed")}</p>
              <ModalityChips items={e.allowed} grades={grades} />
              {e.excluded.length > 0 && (
                <>
                  <p className="t-label text-[10px] text-muted">{t("mma.excluded")}</p>
                  <ModalityChips items={e.excluded} grades={grades} excluded />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </li>
  );
}

/** El plan de la semana completo, con la regla de cada línea detrás de ⓘ. `sessionAction` pinta
 * el botón de cada sesión (en Mi rutina, "Empezar sesión"). La narrativa de la IA no se pinta
 * aquí (docs/ux/simplificar.md: IA solo en Coach). */
export function PlanView({ plan, sessionAction }: { plan: WeeklyPlan; sessionAction?: (session: PlanSession) => ReactNode }) {
  const t = useTranslations("weeklyPlan");
  const ts = useTranslations("safety");
  const locale = intlLocale(useLocale());
  const grades = gradeIndex(plan);
  const byDay = (day: string) => plan.training_schedule.filter((e) => e.day === day);
  const { cardio, nutrition } = plan;
  const n = (v: number) => v.toLocaleString(locale);
  const rotationKeys = plan.sessions.map((s) => s.key).join(", ");

  return (
    <div data-testid="weekly-plan" data-status={plan.status}>
      {plan.live && (plan.live.changed || plan.live.no_contact) && (
        <NoticeLine
          testId="plan-live"
          color="#ff5a6e"
          title={t("live.title")}
          label={t("live.why")}
          extra={plan.live.no_contact && (
            <p data-testid="plan-live-no-contact" className="t-body mt-1 text-xs text-ink">{t("live.noContactShort")}</p>
          )}
        >
          <p className="t-body text-sm text-ink">{t("live.body")}</p>
          {plan.live.no_contact && (
            <p data-testid="plan-live-no-contact-detail" className="t-body mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
              {t("live.noContact")}
              <LineChip ruleKey={plan.live.return_rule_key} grades={grades} />
            </p>
          )}
        </NoticeLine>
      )}

      {plan.deload && (
        <NoticeLine testId="plan-deload" color="#ffd25a" title={t("deload.title")} label={t("deload.why")}>
          <p className="t-body text-sm text-ink">
            {t("deload.body", {
              low: Math.round(plan.deload.volume_cut[0] * 100),
              high: Math.round(plan.deload.volume_cut[1] * 100),
              rir: plan.deload.stop_rir,
            })}
          </p>
          {plan.deload.extra_rest_days[1] > 0 && (
            <p className="t-body mt-1 text-xs text-muted">
              {t("deload.rest", { low: plan.deload.extra_rest_days[0], high: plan.deload.extra_rest_days[1] })}
            </p>
          )}
          <div className="mt-2"><LineChip ruleKey={plan.deload.rule_key} grades={grades} /></div>
        </NoticeLine>
      )}

      <Section
        title={t("sections.sessions")}
        testId="plan-sessions"
        action={
          <span data-testid="plan-rotation" className="t-body flex items-center gap-1 text-[11px] text-muted">
            {t("rotationLine", { keys: rotationKeys })}
            <InfoSheet label={t("rotationWhy")} title={t("rotationLine", { keys: rotationKeys })} testId="plan-rotation-why">
              <p className="t-body text-sm text-ink">{t("rotation")}</p>
            </InfoSheet>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {plan.sessions.map((s) => <SessionCard key={s.key} session={s} grades={grades} action={sessionAction?.(s)} deload={plan.deload} />)}
        </div>
      </Section>

      <Section title={t("sections.week")} testId="plan-week">
        <ul className="flex flex-col gap-2">
          {DAYS.map((d) => <DayRow key={d} day={d} entries={byDay(d)} grades={grades} />)}
        </ul>
      </Section>

      <Section title={t("sections.cardio")} testId="plan-cardio">
        <p className="t-body flex flex-wrap items-center gap-2 text-sm text-ink">
          {t("cardio.dose", { minutes: cardio.minutes_week })}
          <LineChip ruleKey={cardio.rule_key} grades={grades} />
        </p>
        {cardio.mma_minutes > 0 && (
          <p className="t-body mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            {t("cardio.mma", { minutes: cardio.mma_minutes })}
            <LineChip ruleKey={null} grades={grades} convention={cardio.mma_convention} />
          </p>
        )}
        <p className="t-body mt-1 text-xs text-ink">
          {cardio.minutes_needed > 0
            ? t("cardio.remaining", { minutes: cardio.minutes_needed, perDay: cardio.minutes_per_day, days: cardio.days.length })
            : t("cardio.covered")}
        </p>
        {cardio.minutes_needed > 0 && cardio.min_session != null && (
          <p data-testid="cardio-min-session" className="t-body mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            {t("cardio.minSession", { minutes: cardio.min_session })}
            <LineChip ruleKey={null} grades={grades} convention={cardio.min_session_convention ?? "fightlab"} />
          </p>
        )}
        {cardio.zone && (
          <p className="t-body mt-1 text-xs text-muted">
            {t("cardio.zone", { low: cardio.zone.rpe[0], high: cardio.zone.rpe[1] })}
            {cardio.zone.bpm && ` · ${t("cardio.zoneBpm", { low: cardio.zone.bpm[0], high: cardio.zone.bpm[1] })}`}
          </p>
        )}
        <p className="t-label mt-3 text-[10px] text-muted">{t("cardio.options")}</p>
        <div className="mt-1"><ModalityChips items={cardio.options} grades={grades} /></div>
        {cardio.excluded.length > 0 && (
          <>
            <p className="t-label mt-3 text-[10px] text-muted">{t("cardio.excluded")}</p>
            <div className="mt-1"><ModalityChips items={cardio.excluded} grades={grades} excluded /></div>
          </>
        )}
      </Section>

      <Section title={t("sections.nutrition")} testId="plan-nutrition">
        {nutrition && nutrition.kcal != null && nutrition.macros ? (
          <div className="flex flex-col gap-1.5">
            <p className="t-body flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="stat text-neon">{t("nutrition.kcal", { kcal: n(nutrition.kcal) })}</span>
              {nutrition.in_deficit && <span className="text-muted">{t("nutrition.deficit")}</span>}
              {(nutrition.rules?.kcal ?? []).slice(0, 1).map((k) => <LineChip key={k} ruleKey={k} grades={grades} />)}
            </p>
            {([
              ["protein", nutrition.macros.protein_g, "protein_g"],
              ["fat", nutrition.macros.fat_g, "fat_g"],
              ["carbs", nutrition.macros.carbs_g, null],
              ["fibre", nutrition.macros.fibre_g, "fibre_g"],
            ] as const).map(([key, g, ruleName]) => (
              <p key={key} className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
                {t(`nutrition.${key}`, { g: n(roundGrams(g)) })}
                {ruleName && (nutrition.rules?.[ruleName] ?? []).slice(0, 1).map((k) => <LineChip key={k} ruleKey={k} grades={grades} />)}
              </p>
            ))}
          </div>
        ) : (
          <p className="t-body text-sm text-muted">{nutrition?.missing ? t("nutrition.missing") : t("nutrition.blocked")}</p>
        )}
        {(nutrition?.reasons ?? []).length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">{nutrition!.reasons!.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>
        )}
      </Section>

      <Section title={t("sections.safety")} testId="plan-safety">
        {plan.safety_reasons.length ? (
          <ul className="flex flex-col gap-1.5">{plan.safety_reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}</ul>
        ) : (
          <p className="t-body text-sm text-muted">{t("safetyNone")}</p>
        )}
        <p className="t-body mt-2 text-[11px] text-muted">{ts("disclaimer")}</p>
      </Section>

      <section data-testid="plan-rules" className="glass mt-4 flex items-center justify-between gap-2 px-4 py-2.5">
        <p className="t-eyebrow text-muted">{t("rulesCount", { count: plan.rules.length })}</p>
        <InfoSheet label={t("rulesWhy")} title={t("sections.rules")} testId="plan-rules-why">
          <ul className="flex flex-col gap-1.5">
            {plan.rules.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2">
                <span className="t-body text-xs text-ink">{r.title}</span>
                <EvidenceChip ruleKey={r.key} grade={r.grade} />
              </li>
            ))}
          </ul>
          <p className="t-body mt-2 text-[11px] text-muted">
            <Link href="/profile/credits" className="underline">{plan.engine_sha}</Link>
          </p>
        </InfoSheet>
      </section>
    </div>
  );
}
