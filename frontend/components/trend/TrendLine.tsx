"use client";

import { useFormatter, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { missingWeighIns } from "@/lib/checkin";
import type { Trend } from "@/lib/schemas";

/** La tendencia de peso del coach (`/coach/trend`), nunca un pesaje suelto: el ritmo semanal si
 * hay datos suficientes y, si no, cuántos pesajes faltan. Con `no_weight_targets`, una frase.
 * La EWMA de la gráfica de Biometría no pasa por aquí: es solo la línea. */
export function TrendLine({ trend, compact = false, chip = true }: { trend: Trend; compact?: boolean; chip?: boolean }) {
  const t = useTranslations("weightTrend");
  const format = useFormatter();

  if (trend.blocked || trend.status === "disabled") {
    return <p data-testid="trend-blocked" className="t-body text-xs text-muted">{t("blocked")}</p>;
  }

  if (trend.status === "ok" && trend.rate_kg_week !== null && trend.rate_pct_week !== null) {
    const sign = { signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
    return (
      <div data-testid="trend-ok">
        <p className="t-label text-ink">
          {t("ok", {
            rate: format.number(trend.rate_kg_week, sign),
            pct: format.number(trend.rate_pct_week, { ...sign, minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          })}{" "}
          {chip && <EvidenceChip ruleKey={trend.rule_key} grade={trend.grade} />}
        </p>
        {!compact && trend.weight_kg !== null && (
          <p className="t-body mt-1 text-xs text-muted">
            {t("okNow", { kg: format.number(trend.weight_kg, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
          </p>
        )}
        {!compact && <p className="t-body mt-1 text-[11px] text-muted">{t("okBasis")}</p>}
      </div>
    );
  }

  const missing = missingWeighIns(trend.points, trend.min_points);
  return (
    <div data-testid="trend-insufficient">
      <p className="t-body text-xs text-muted">
        {trend.points === 0
          ? t("empty")
          : t("insufficient", {
              min_points: trend.min_points,
              min_days: trend.min_days,
              points: trend.points,
              days: trend.days,
            })}{" "}
        {trend.points > 0 && missing > 0 && t("insufficientMore", { missing })}{" "}
        {chip && <EvidenceChip ruleKey={trend.rule_key} grade={trend.grade} />}
      </p>
    </div>
  );
}
