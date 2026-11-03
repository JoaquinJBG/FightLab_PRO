"use client";

import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import type { Readiness } from "@/lib/schemas";

const COLOR = { no_data: "var(--color-muted)", ok: "#43e8a0", easy: "#ffd25a", reduce: "#ff9f5a" } as const;

/** Readiness a partir del bienestar del check-in, comparado con la propia línea base de la
 * persona. Cita "Simple readiness monitoring" y, si hay HRV en caída, "HRV is optional". */
export function ReadinessCard({ readiness }: { readiness: Readiness }) {
  const t = useTranslations("checkin");
  const drops = readiness.drops_today.map((k) => t(`wellness.scores.${k}.label`));
  const listFmt = new Intl.ListFormat(undefined, { type: "conjunction" });
  return (
    <section data-testid="readiness-card" data-status={readiness.status} className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("readiness.title")}</p>
      <p className="t-body mt-2 text-sm" style={{ color: COLOR[readiness.status] }}>
        {t(`readiness.${readiness.status}`)}
      </p>
      {drops.length > 0 && readiness.status !== "no_data" && (
        <p className="t-body mt-1 text-xs text-muted">{t("readiness.drops", { items: listFmt.format(drops) })}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <EvidenceChip ruleKey={readiness.rule_key} grade={readiness.grade} />
        {readiness.hrv_drop && <EvidenceChip ruleKey={readiness.hrv_rule_key} grade={readiness.hrv_grade} />}
        {/* La línea base de 14 días y la bajada de 1 punto no las fija la regla: convención de FightLab */}
        <EvidenceChip />
      </div>
      <p className="t-body mt-2 text-[11px] italic text-muted">{t("readiness.pragmatic")}</p>
    </section>
  );
}
