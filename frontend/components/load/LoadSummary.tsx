"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BoltIcon, ChevronRight } from "@/components/icons";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import type { LoadMetrics } from "@/lib/load";
import { COMBAT_RULES } from "@/lib/combat-rules";
import { comparisonRule, comparisonShort } from "@/lib/load-texts";

type Props = { metrics: LoadMetrics | null; className?: string; style?: CSSProperties };

/** Tarjeta pequeña de carga (Home y Entreno): AU de la semana y la semana frente a la media de
 * 4 semanas, o cuántos días faltan para compararla. Sin colores de semáforo (anexo de combate).
 * Los chips van debajo, fuera del enlace, para que tocarlos no navegue. */
export function LoadSummary({ metrics: m, className = "glass rise mt-4 flex items-center gap-3 p-4", style }: Props) {
  const tl = useTranslations("load");
  const active = m != null && m.weekAU > 0;
  const short = comparisonShort(m, tl);
  const rule = comparisonRule(m);
  return (
    <>
      <Link href="/training/load" className={className} style={style} data-testid="load-summary">
        <span className={active ? "text-neon" : "text-muted"}>
          <BoltIcon className="h-5 w-5" />
        </span>
        {active ? (
          <div className="flex flex-1 items-center gap-5">
            <div>
              <p className="t-label text-muted">{tl("week")}</p>
              <p className="stat text-xl text-ink">{m.weekAU}<span className="text-xs text-muted"> {tl("au")}</span></p>
            </div>
            {short && (
              <div>
                <p className="t-label text-muted">{tl("comparisonTitle")}</p>
                <p className="stat text-base text-ink" data-testid="load-comparison">{short}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1">
            <p className="t-label text-ink">{tl("title")}</p>
            <p className="t-body text-xs text-muted">{tl("soon")}</p>
          </div>
        )}
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
      </Link>
      {active && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <EvidenceChip ruleKey={COMBAT_RULES.sessionRpe.key} grade={COMBAT_RULES.sessionRpe.grade} />
          {rule && <EvidenceChip ruleKey={rule.key} grade={rule.grade} />}
        </p>
      )}
    </>
  );
}
