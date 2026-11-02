"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useBiometrics } from "@/lib/hooks";
import { computeRecovery, type Recovery } from "@/lib/recovery";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import { BoltIcon, InfoIcon, ArrowUpRight } from "@/components/icons";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { LoadComparisonCard, LoadIndices } from "@/components/load/LoadComparisonCard";
import { COMBAT_RULES } from "@/lib/combat-rules";

/** Iniciales de los últimos 7 días, como índices 0-6 de `Date.getDay()` (0 = domingo). */
function dayIndexes(): number[] {
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.getDay());
  }
  return out;
}

function Info({ k, open, setOpen }: { k: string; open: string | null; setOpen: (v: string | null) => void }) {
  const t = useTranslations("training.load");
  return (
    <button type="button" aria-label={t("moreInfo")} onClick={() => setOpen(open === k ? null : k)}
      className={`shrink-0 ${open === k ? "text-neon" : "text-muted hover:text-neon"}`}>
      <InfoIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function Tip({ k, open }: { k: string; open: string | null }) {
  const t = useTranslations("training.load");
  return open === k ? (
    <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{t(`info.${k}`)}</p>
  ) : null;
}

export default function LoadPage() {
  const t = useTranslations("training.load");
  const tl = useTranslations("load");
  const { data: logs = [] } = useBiometrics();
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setMetrics(loadMetrics()); // pintura inmediata con lo local
    fetchServerMetrics().then((m) => { if (alive && m) setMetrics(m); }); // el servidor manda
    return () => { alive = false; };
  }, []);

  const recovery: Recovery | null = computeRecovery(logs);
  const m = metrics;
  const max = m ? Math.max(...m.daily7, 1) : 1;
  const labels = dayIndexes().map((i) => t(`dayInitials.${i}`));

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><BoltIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
      <p className="t-body mt-1 text-xs text-muted">{t("subtitle")}</p>

      {/* Estado de hoy (recuperación) */}
      {recovery ? (
        <section className="glass neon-edge mt-4 p-5">
          <div className="flex items-center gap-1.5">
            <p className="t-eyebrow text-muted">{t("todayState")}</p>
            <Info k="state" open={open} setOpen={setOpen} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: recovery.color, boxShadow: `0 0 12px ${recovery.color}` }} />
            <p className="t-display text-2xl" style={{ color: recovery.color }}>{t(`recoveryState.${recovery.state}`)}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recovery.rhrDelta !== undefined && <span className="badge">{t("chipRhr", { delta: `${recovery.rhrDelta > 0 ? "+" : ""}${recovery.rhrDelta}` })}</span>}
            {recovery.hrvPct !== undefined && <span className="badge">{t("chipHrv", { pct: `${recovery.hrvPct > 0 ? "+" : ""}${recovery.hrvPct}` })}</span>}
          </div>
          <Tip k="state" open={open} />
        </section>
      ) : (
        <section className="glass mt-4 p-5">
          <p className="t-eyebrow text-muted">{t("todayState")}</p>
          <p className="t-body mt-2 text-sm text-muted">
            {t("recoveryEmpty")}
          </p>
          <Link href="/biometrics/new" className="btn btn-tonal btn-sm mt-3">{t("addMeasures")} <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </section>
      )}

      {/* La semana frente a la media (anexo de combate, E.5) */}
      <LoadComparisonCard metrics={m} />

      {/* Carga semanal */}
      <section className="glass mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink">{t("weeklyLoad")}</span>
            <Info k="load" open={open} setOpen={setOpen} />
          </div>
          <span className="t-label text-muted">{t("au", { n: m?.weekAU ?? 0 })}</span>
        </div>
        {m && m.weekAU > 0 ? (
          <div className="mt-4 flex h-24 items-end justify-between gap-2">
            {m.daily7.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="w-full rounded-md" style={{ height: `${Math.max((v / max) * 100, 4)}%`, opacity: v === 0 ? 0.25 : 1, background: "linear-gradient(to top,#2b6bff,#45e9ff)" }} />
                <span className="text-[10px] text-muted">{labels[i]}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="t-body mt-2 text-xs text-muted">{t("weekEmpty")}</p>
        )}
        {open === "load" && (
          <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{tl("loadInfo")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <EvidenceChip ruleKey={COMBAT_RULES.sessionRpe.key} grade={COMBAT_RULES.sessionRpe.grade} />
          <EvidenceChip ruleKey={COMBAT_RULES.rpeCombat.key} grade={COMBAT_RULES.rpeCombat.grade} />
        </div>
      </section>

      {/* Monotonía / Tensión: descriptivas */}
      <LoadIndices metrics={m} />

      <p className="t-body mt-4 text-center text-xs text-muted">
        {t("footer")}
      </p>
    </div>
  );
}
