"use client";

import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useSafety } from "@/lib/hooks";
import { COMBAT_RULES, type RuleRef } from "@/lib/combat-rules";
import type { Safety } from "@/lib/schemas";

// Los bloqueos de la fase 4 (spec §8.3) que también quitan el contenido de corte.
const CUT_BLOCKS = ["no_weight_targets", "no_deficit", "hold_deficit"] as const;

export type CutMode = "minor" | "blocked" | "info";

export function cutMode(s: Safety | undefined): CutMode | null {
  if (!s) return null;
  if (s.flags.no_cut_content) return "minor";
  if (CUT_BLOCKS.some((f) => s.flags[f])) return "blocked";
  return "info";
}

const ITEMS: { key: string; rule: RuleRef }[] = [
  { key: "planned", rule: COMBAT_RULES.plannedWeight },
  { key: "common", rule: COMBAT_RULES.rwlCommon },
  { key: "noSafePct", rule: COMBAT_RULES.noSafePercentage },
  { key: "regain", rule: COMBAT_RULES.regainNotRecovery },
  { key: "deaths", rule: COMBAT_RULES.cutDeaths },
  { key: "noWater", rule: COMBAT_RULES.noWaterLoading },
  { key: "rules", rule: COMBAT_RULES.weighInRules },
  { key: "recovery", rule: COMBAT_RULES.recoveryConsensus },
];

/** Hacer el peso (E.5): solo información con sus reglas y derivación, sin cantidades por kg ni
 * % perdido, sin contenido para menores de 18 y nada con los bloqueos de la fase 4. */
export function CutInfoCard() {
  const tc = useTranslations("combat.cut");
  const { data: safety } = useSafety();
  const mode = cutMode(safety);
  if (mode == null || mode === "blocked") return null;

  if (mode === "minor") {
    return (
      <section data-testid="cut-minor" className="glass mt-4 p-4">
        <p className="t-body text-sm text-ink">{tc("minor")}</p>
        <div className="mt-2"><EvidenceChip ruleKey={COMBAT_RULES.minorsCut.key} grade={COMBAT_RULES.minorsCut.grade} /></div>
        <p className="t-body mt-3 text-[11px] italic text-muted">{safety!.disclaimer}</p>
      </section>
    );
  }

  return (
    <section data-testid="cut-info" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{tc("title")}</p>
      <p className="t-body mt-1.5 text-xs text-muted">{tc("intro")}</p>
      <ul className="mt-2 flex flex-col gap-2.5">
        {ITEMS.map(({ key, rule }) => (
          <li key={key} className="t-body text-xs text-ink">
            {tc(key)} <EvidenceChip ruleKey={rule.key} grade={rule.grade} />
          </li>
        ))}
      </ul>
      <p data-testid="cut-emergency" className="t-body mt-3 rounded-xl p-2.5 text-xs text-ink" style={{ border: "1px solid #ff5a6e" }}>
        {tc("emergency")} <EvidenceChip ruleKey={COMBAT_RULES.cutEmergency.key} grade={COMBAT_RULES.cutEmergency.grade} />
      </p>
      <p className="t-label mt-3 text-ink">{tc("refer")}</p>
      <p data-testid="combat-disclaimer" className="t-body mt-2 text-[11px] italic text-muted">{safety!.disclaimer}</p>
    </section>
  );
}
