"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { BottomSheet } from "@/components/today/BottomSheet";
import { useZones } from "@/lib/hooks";
import type { Zones } from "@/lib/schemas";

const COLORS = { light: "#43e8a0", moderate: "#45e9ff", vigorous: "#ffd25a" } as const;

/** Las zonas de esfuerzo (frecuencia cardiaca y RPE) que calcula el motor en el servidor, con la
 * regla de cada aviso. */
function ZonesDetail({ data }: { data: Zones }) {
  const t = useTranslations("dashboard.zones");
  const bands = data.rules.find((r) => r.key === "cardio-health/acsm-intensity-bands");
  return (
    <div data-testid="zones-card" data-method={data.method}>
      <ul className="flex flex-col gap-2.5">
        {data.zones.map((z) => (
          <li key={z.name} data-testid={`zone-${z.name}`} className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[z.name] }} />
            <div className="min-w-0 flex-1">
              <p className="t-label text-ink">
                {t(`names.${z.name}`)}
                {z.bpm && <span className="t-body ml-2 text-xs text-muted">{t("bpm", { low: z.bpm[0], high: z.bpm[1] })}</span>}
              </p>
              <p className="text-[11px] leading-snug text-muted">
                {t("rpe", { low: z.rpe[0], high: z.rpe[1] })} · {t(`talk.${z.name}`)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {bands && (
        <div className="mt-3">
          <EvidenceChip ruleKey={bands.key} grade={bands.grade} />
        </div>
      )}
      {data.reasons.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-[rgba(150,190,255,0.1)] pt-3">
          {data.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} data-testid="zones-reason" data-code={r.code} className="flex flex-wrap items-center gap-2">
              <span className="t-body text-xs text-ink first-letter:uppercase">{r.text}</span>
              <EvidenceChip ruleKey={r.rule_key} grade={r.grade} />
            </li>
          ))}
        </ul>
      )}
      {data.hr_max != null && (
        <p className="t-body mt-3 text-[11px] text-muted">
          {t(data.hr_max_source === "measured" ? "hrMaxMeasured" : "hrMaxEstimated", { bpm: data.hr_max })}
          {data.hr_rest != null && ` · ${t("hrRest", { bpm: data.hr_rest })}`}
        </p>
      )}
    </div>
  );
}

/** Mosaico «Zonas de esfuerzo» de Progreso: enseña la zona moderada y abre el detalle en un
 * panel inferior. Sin zonas (`no_training`) no se pinta nada: Hoy ya lo explica. */
export function ZonesTile({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const t = useTranslations("dashboard.zones");
  const { data } = useZones();
  const [open, setOpen] = useState(false);
  if (!data || data.zones.length === 0) return null;
  const z = data.zones.find((x) => x.name === "moderate") ?? data.zones[0];
  const sub = z.bpm ? t("bpm", { low: z.bpm[0], high: z.bpm[1] }) : t("rpe", { low: z.rpe[0], high: z.rpe[1] });
  return (
    <>
      <button type="button" data-testid="zones-tile" aria-haspopup="dialog" onClick={() => setOpen(true)} className={`${className} items-start text-left`} style={style}>
        <span className="t-label text-ink">{t("title")}</span>
        <span className="text-[11px] leading-snug text-muted">{t(`names.${z.name}`)} · {sub}</span>
      </button>
      {open && (
        <BottomSheet title={t("title")} onClose={() => setOpen(false)}>
          <ZonesDetail data={data} />
        </BottomSheet>
      )}
    </>
  );
}
