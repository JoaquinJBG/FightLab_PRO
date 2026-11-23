"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { InfoIcon } from "@/components/icons";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import type { LoadMetrics } from "@/lib/load";
import { COMBAT_RULES, type RuleRef } from "@/lib/combat-rules";
import { comparisonLong, isBigJump, loadState } from "@/lib/load-texts";

const Chip = ({ r }: { r: RuleRef | null }) => <EvidenceChip ruleKey={r?.key} grade={r?.grade} />;

function InfoToggle({ text }: { text: string }) {
  const tl = useTranslations("training.load");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={tl("moreInfo")} onClick={() => setOpen(!open)}
        className={`shrink-0 ${open ? "text-neon" : "text-muted hover:text-neon"}`}>
        <InfoIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <p className="t-body mt-2 w-full rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{text}</p>
      )}
    </>
  );
}

/** La semana frente a la media de 4 semanas (combat-sports "Present load as a neutral
 * comparison with the recent average"). Sin ratio antes de 28 días, sin bandas ni colores de
 * riesgo, con la nota de que se ha estudiado en deportes de equipo y no en combate. */
export function LoadComparisonCard({ metrics }: { metrics: LoadMetrics | null }) {
  const tl = useTranslations("load");
  const format = useFormatter();
  const s = loadState(metrics);
  return (
    <section className="glass mt-4 p-4" data-testid="load-comparison-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="t-label text-ink">{tl("comparisonTitle")}</span>
        <InfoToggle text={tl("comparisonInfo")} />
      </div>

      {s.kind === "ratio" && (
        <>
          <p className="stat mt-2 text-xl text-ink" data-testid="load-week-vs-avg">{comparisonLong(s.pct, tl)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip r={COMBAT_RULES.comparison} />
            {isBigJump(metrics) && (
              <>
                <span className="t-body text-[11px] text-muted">{tl("bigJump")}</span>
                <Chip r={null} />
              </>
            )}
          </div>
          <p className="t-body mt-2 text-[11px] text-muted">
            {tl("ratio", { value: format.number(s.ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}{" "}
            <Chip r={COMBAT_RULES.notPredictor} />
          </p>
          {s.gaps && <p className="t-body mt-2 text-[11px] text-warn" data-testid="load-gaps">{tl("gaps")}</p>}
        </>
      )}
      {s.kind === "building" && (
        <p className="t-body mt-2 text-xs text-muted" data-testid="load-days-left">
          {tl("daysLeft", { days: s.daysLeft, have: s.have })} <Chip r={COMBAT_RULES.ratio28} />
        </p>
      )}
      {s.kind === "paused" && <p className="t-body mt-2 text-xs text-muted">{tl("paused")}</p>}
      {s.kind === "empty" && <p className="t-body mt-2 text-xs text-muted">{tl("empty")}</p>}

      <p className="t-body mt-3 text-[11px] text-muted">{tl("context")}</p>
      <p className="t-body mt-1 text-[11px] text-muted">
        {tl("combatNote")} <Chip r={COMBAT_RULES.combatStudies} />
      </p>
    </section>
  );
}

/** Monotonía y tensión: índices descriptivos, sin etiquetas de riesgo ni umbrales. */
export function LoadIndices({ metrics: m }: { metrics: LoadMetrics | null }) {
  const tl = useTranslations("load");
  const format = useFormatter();
  return (
    <section className="mt-4 grid grid-cols-2 gap-3">
      <div className="glass p-4">
        <div className="flex flex-wrap items-center gap-1.5"><span className="t-label text-muted">{tl("monotony")}</span><InfoToggle text={tl("monotonyInfo")} /></div>
        {m?.sinVariacion ? (
          <>
            <p className="stat mt-2 text-2xl text-ink">{tl("max")}</p>
            <p className="t-body mt-1 text-[10px] text-muted">{tl("noVariation")}</p>
          </>
        ) : (
          <p className="stat mt-2 text-2xl text-ink">{m?.monotonia != null ? format.number(m.monotonia, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : "—"}</p>
        )}
        <div className="mt-2"><Chip r={COMBAT_RULES.monotony} /></div>
      </div>
      <div className="glass p-4">
        <div className="flex flex-wrap items-center gap-1.5"><span className="t-label text-muted">{tl("strain")}</span><InfoToggle text={tl("strainInfo")} /></div>
        <p className="stat mt-2 text-2xl text-ink">{m?.tension != null ? format.number(m.tension) : "—"}</p>
        <div className="mt-2"><Chip r={COMBAT_RULES.monotony} /></div>
      </div>
    </section>
  );
}
