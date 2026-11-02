"use client";

import { useFormatter, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useBiometrics } from "@/lib/hooks";
import { COMBAT_RULES } from "@/lib/combat-rules";
import { kcalRange, metFor } from "@/lib/combat-mets";

const DEFAULT_KG = 70;

/** Gasto estimado de una sesión de combate con el MET del Compendio 2024 (E.5), como rango y
 * con la entrada usada. No es el gasto real ni sirve para ajustar calorías. */
export function CombatKcal({ art, workType, minutes }: { art: string; workType: string; minutes: number }) {
  const tk = useTranslations("combat.kcal");
  const format = useFormatter();
  const { data: logs = [] } = useBiometrics();
  const entry = metFor(art, workType);
  let weight: number | null = null;
  for (const l of logs) {
    const w = l.weight_kg ? parseFloat(l.weight_kg) : NaN;
    if (Number.isFinite(w)) { weight = w; break; }
  }

  return (
    <section data-testid="combat-kcal" className="glass mt-3 p-3">
      <p className="t-label text-muted">{tk("title")}</p>
      {entry ? (
        <>
          {(() => {
            const r = kcalRange(entry.met, weight ?? DEFAULT_KG, minutes);
            return <p className="stat mt-1 text-lg text-ink" data-testid="combat-kcal-range">{tk("range", { low: format.number(r.low), high: format.number(r.high) })}</p>;
          })()}
          <p className="t-body mt-1 text-[11px] text-muted">
            {tk("entry", { entry: entry.entry, met: format.number(entry.met) })}{" "}
            <EvidenceChip ruleKey={COMBAT_RULES.compendium.key} grade={COMBAT_RULES.compendium.grade} />
          </p>
          {entry.approx && <p className="t-body mt-1 text-[11px] text-muted">{tk("approx")}</p>}
          {entry.estimated && <p className="t-body mt-1 text-[11px] text-muted">{tk("estimated")}</p>}
          <p className="t-body mt-1 text-[11px] text-muted">
            {tk("band")} <EvidenceChip />
          </p>
          <p className="t-body mt-1 text-[11px] text-muted">
            {tk("note")} <EvidenceChip ruleKey={COMBAT_RULES.metsRange.key} grade={COMBAT_RULES.metsRange.grade} />
          </p>
          {weight == null && <p className="t-body mt-1 text-[11px] text-muted">{tk("needWeight")}</p>}
        </>
      ) : (
        <p className="t-body mt-1 text-[11px] text-muted">{tk("none")}</p>
      )}
    </section>
  );
}
