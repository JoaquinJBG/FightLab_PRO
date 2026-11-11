"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { TrendLine } from "@/components/trend/TrendLine";
import { useTrend } from "@/lib/hooks";
import type { CheckinAlert, CheckinResult } from "@/lib/schemas";
import { ReadinessCard } from "./ReadinessCard";

const LEVEL_COLOR: Record<CheckinAlert["level"], string> = {
  emergency: "#ff5a6e",
  urgent: "#ff5a6e",
  stop: "#ff5a6e",
  refer: "#ffd25a",
  rest: "#ffd25a",
  info: "#45e9ff",
};

/** El resultado del check-in, en el orden de `checkin/SKILL.md`: primero las señales de alarma y
 * a quién acudir; después qué se ha registrado, la tendencia (solo si hubo peso) y la readiness;
 * al final, la línea de derivación si hay `refer_gp`. */
export function CheckinResultView({
  result,
  recorded,
  gaveWeight,
  onAgain,
}: {
  result: CheckinResult;
  recorded: string[];
  gaveWeight: boolean;
  onAgain: () => void;
}) {
  const t = useTranslations("checkin");
  const { data: trend } = useTrend(gaveWeight && !result.weight_blocked);
  const levelOf = (l: CheckinAlert["level"]) => t(`alertLevel.${l}`);
  const reasons = result.safety.reasons.filter((r) => r.severity === "stop" || r.severity === "refer");
  const items = recorded.map((k) => t(`result.items.${k}`));
  const listFmt = new Intl.ListFormat(undefined, { type: "conjunction" });

  return (
    <div data-testid="checkin-result" className="pt-4">
      <h1 className="t-display text-2xl text-ink">{t("result.title")}</h1>

      {result.alerts.length > 0 && (
        <section data-testid="checkin-alerts" className="glass mt-4 p-4">
          <p className="t-eyebrow text-muted">{t("result.alertsTitle")}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {result.alerts.map((a) => (
              <li key={a.code} data-testid="checkin-alert" data-code={a.code} className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <span className="t-label mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ color: LEVEL_COLOR[a.level], border: `1px solid ${LEVEL_COLOR[a.level]}` }}>
                    {levelOf(a.level)}
                  </span>
                  <p className="t-body text-sm text-ink">{a.text}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  {a.professional && <span className="t-body text-[11px] text-muted">{t("result.professional", { name: a.professional })}</span>}
                  <EvidenceChip ruleKey={a.rule_key} grade={a.grade} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reasons.length > 0 && (
        <section data-testid="checkin-reasons" className="glass mt-4 p-4">
          <p className="t-eyebrow text-muted">{t("result.newReasons")}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {reasons.map((r, i) => (
              <li key={`${r.code}-${i}`} className="flex flex-col gap-1.5">
                <p className="t-body text-sm text-ink first-letter:uppercase">{r.text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {r.professional && <span className="t-body text-[11px] text-muted">{t("result.professional", { name: r.professional })}</span>}
                  <EvidenceChip ruleKey={r.rule_key} grade={r.grade} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass mt-4 p-4">
        <p className="t-body text-sm text-ink">
          {items.length ? t("result.recorded", { items: listFmt.format(items) }) : t("result.nothing")}
        </p>
        {result.refused.length > 0 && (
          <p data-testid="checkin-refused" className="t-body mt-1 text-xs text-warn">
            {t("result.refused", { fields: result.refused.join(", ") })}
          </p>
        )}
        {gaveWeight && trend && !result.weight_blocked && (
          <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-3">
            <TrendLine trend={trend} />
          </div>
        )}
      </section>

      <ReadinessCard readiness={result.readiness} />

      {result.safety.refer_gp && result.safety.deferral_line && (
        <p data-testid="checkin-deferral" className="t-body mt-4 text-[11px] italic text-muted">
          {result.safety.deferral_line}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={onAgain} className="btn btn-tonal">{t("result.again")}</button>
        <Link href="/today" className="btn btn-primary">{t("result.home")}</Link>
      </div>
    </div>
  );
}
