"use client";

import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { EXERCISE_KEYS } from "@/lib/gym";
import { intlLocale } from "@/lib/locale";
import { useStrengthSets } from "@/lib/plan";

/** Series duras por músculo de la última semana con registros (`coach.strength`), con aviso de
 * los ejercicios que el mapa de músculos no conoce (no cuentan). */
export function StrengthSetsCard() {
  const t = useTranslations("weeklyPlan");
  const tg = useTranslations("training.gym");
  const locale = intlLocale(useLocale());
  const { data } = useStrengthSets();
  if (!data) return null;
  const muscles = Object.entries(data.sets);
  const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const label = (name: string) => (EXERCISE_KEYS[name] ? tg(`exercises.${EXERCISE_KEYS[name]}`) : name);
  return (
    <section data-testid="strength-sets" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("sections.strength")}</p>
      {muscles.length === 0 && data.unmapped.length === 0 ? (
        <p className="t-body mt-2 text-sm text-muted">{t("strength.empty")}</p>
      ) : (
        <>
          <p className="t-label mt-2 text-muted">{t("strength.week", { start: fmt(data.week.start), end: fmt(data.week.end) })}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {muscles.map(([muscle, n]) => (
              <li key={muscle} className="t-body flex justify-between text-xs">
                <span className="text-muted">{t.has(`muscles.${muscle}`) ? t(`muscles.${muscle}`) : muscle}</span>
                <span className={n >= data.reference_sets_per_week ? "text-neon" : "text-ink"}>{n.toLocaleString(locale)}</span>
              </li>
            ))}
          </ul>
          {data.unmapped.length > 0 && (
            <p data-testid="strength-unmapped" className="t-body mt-2 text-[11px] text-warn">
              {t("strength.unmapped", { names: data.unmapped.map(label).join(", ") })}
            </p>
          )}
        </>
      )}
      <p className="t-body mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {t("strength.reference", { n: data.reference_sets_per_week })}
        {data.rules.map((r) => <EvidenceChip key={r.key} ruleKey={r.key} grade={r.grade} />)}
      </p>
    </section>
  );
}
