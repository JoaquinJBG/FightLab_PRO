"use client";

import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { formatDate } from "@/lib/locale";
import type { TodaySafety } from "@/lib/safety-state";

const COLOR = { caution: "#ffd25a", stop: "#ff5a6e" } as const;

/** Por qué hoy un bloqueo: la frase de `vigorousBlockedBy` con los textos del plan. */
export function useBlockedWhy() {
  const tp = useTranslations("weeklyPlan.blockedBy");
  return (flags: string[]) => flags.map((f) => (tp.has(f) ? tp(f) : f)).join(" · ");
}

/** «Estado de hoy» cuando hay algo activo (R4-10, R4-13): manda sobre la recuperación de la
 * biometría, que nunca dice «Listo para entrenar» con un golpe, una lesión o un «para y consulta».
 * Cada motivo lleva su vigencia y su regla. */
export function SafetyStateCard({ state, className = "" }: { state: TodaySafety; className?: string }) {
  const t = useTranslations("safetyState");
  const locale = useLocale();
  if (state.level === "ok") return null;
  const color = COLOR[state.level];
  const body = state.level === "stop" ? t("stopBody") : state.vigorousAllowed ? t("cautionBodyVigorousOk") : t("cautionBody");
  return (
    <section data-testid="safety-state" data-level={state.level} className={`glass neon-edge p-5 ${className}`}>
      <p className="t-eyebrow text-muted">{t("eyebrow")}</p>
      <div className="mt-2 flex items-center gap-3">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
        <p data-testid="safety-state-label" className="t-display text-2xl" style={{ color }}>{t(state.level)}</p>
      </div>
      <p className="t-body mt-2 text-sm text-muted">{body}</p>
      {state.active.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {state.active.map((a, i) => (
            <li key={`${a.code}-${i}`} data-testid="safety-state-reason" data-kind={a.kind} className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
              <span className="first-letter:uppercase">{a.text}</span>
              <span className="text-muted">
                {[a.since ? t("since", { date: formatDate(locale, a.since) }) : null, t(`until.${a.until}`)].filter(Boolean).join(", ")}
              </span>
              <EvidenceChip ruleKey={a.rule_key} grade={a.grade} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
