"use client";

import { useFormatter, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import type { CoachReason, RuleRef, Targets } from "@/lib/schemas";

function RuleLine({ rule }: { rule: RuleRef }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="t-body text-xs text-ink">{rule.title}</span>
      <EvidenceChip ruleKey={rule.key} grade={rule.grade} />
    </li>
  );
}

function ReasonLine({ reason }: { reason: CoachReason }) {
  return (
    <li data-testid="targets-reason" data-code={reason.code} className="flex flex-wrap items-center gap-2">
      <span className="t-body text-xs text-ink first-letter:uppercase">{reason.text}</span>
      <EvidenceChip ruleKey={reason.rule_key} grade={reason.grade} />
    </li>
  );
}

/** "Cómo se calculan": de dónde sale cada número, con la ecuación usada, su regla y la fuente
 * de cada motivo. Los motivos que limitan lo que se calcula van aparte, en el aviso de seguridad. */
export function TargetsDetails({ targets }: { targets: Targets }) {
  const t = useTranslations("nutrition.details");
  const format = useFormatter();
  const { equation, macros } = targets;
  if (!equation || !macros || targets.kcal == null || targets.maintenance_kcal == null) return null;
  const info = targets.reasons.filter((r) => r.severity === "info");
  const deficit = targets.deficit_kcal ?? 0;
  const rules = targets.rules;
  return (
    <details data-testid="targets-details" className="glass mt-4 p-4">
      <summary className="t-label cursor-pointer text-ink">{t("title")}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <ul className="flex flex-col gap-1.5">
          <li className="t-body text-xs text-muted">{t("maintenance", { kcal: format.number(targets.maintenance_kcal) })}</li>
          <li className="t-body text-xs text-muted">
            {deficit > 0
              ? t("deficit", { kcal: format.number(deficit) })
              : deficit < 0
                ? t("surplus", { kcal: format.number(-deficit) })
                : t("atMaintenance")}
          </li>
          <li data-testid="targets-equation" data-equation={equation.code} className="t-body text-xs text-ink">
            {t("equation", { name: t(`equations.${equation.code}`) })}
            {equation.ffm_kg != null && ` · ${t("ffm", { kg: format.number(equation.ffm_kg, { maximumFractionDigits: 1 }) })}`}
          </li>
          <li className="t-body text-xs text-muted">
            {t("pal", { pal: format.number(equation.pal, { maximumFractionDigits: 2 }) })}
          </li>
          <li className="t-body text-xs text-muted">{t("protein", { perKg: format.number(macros.protein_g_per_kg, { maximumFractionDigits: 1 }) })}</li>
          <li className="t-body text-xs text-muted">{t("fatMin", { g: format.number(macros.fat_min_g, { maximumFractionDigits: 0 }) })}</li>
        </ul>

        {info.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-[rgba(150,190,255,0.1)] pt-3">
            {info.map((r, i) => (
              <ReasonLine key={`${r.code}-${i}`} reason={r} />
            ))}
          </ul>
        )}

        <div className="border-t border-[rgba(150,190,255,0.1)] pt-3">
          <p className="t-label text-muted">{t("rules")}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {Object.entries(rules)
              .flatMap(([, list]) => list)
              .filter((r, i, all) => all.findIndex((x) => x.key === r.key) === i)
              .map((r) => (
                <RuleLine key={r.key} rule={r} />
              ))}
          </ul>
        </div>

        <p className="t-body text-[11px] text-muted">
          {t("engine", { sha: targets.engine.sha })}
          {targets.engine.knowledge_checked_on ? ` · ${t("checked", { date: targets.engine.knowledge_checked_on })}` : ""}
        </p>
      </div>
    </details>
  );
}
