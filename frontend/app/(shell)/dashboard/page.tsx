"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useBiometrics, useTrend, useWeighIn } from "@/lib/hooks";
import { TrendLine } from "@/components/trend/TrendLine";
import { LoadSummary } from "@/components/load/LoadSummary";
import { ZonesTile } from "@/components/zones/ZonesCard";
import { latestWeightKg } from "@/lib/body-inputs";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import { ArrowUpRight, ChartIcon } from "@/components/icons";

/* ----------------------------- helpers ----------------------------------- */

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function daysSince(iso: string): number {
  const d = new Date(iso);
  const now = new Date();
  d.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - d.getTime()) / 86_400_000);
}

const tile = "glass rise flex flex-col gap-1 rounded-2xl p-2.5";

/** Una métrica de recuperación con su diferencia frente a tu media (la misma cuenta de siempre). */
function Metric({ label, value, unit, delta, goodWhenDown }: { label: string; value: string; unit: string; delta: number | null; goodWhenDown: boolean }) {
  const t = useTranslations("dashboard.metrics");
  const format = useFormatter();
  const improving = delta != null && (goodWhenDown ? delta < 0 : delta > 0);
  return (
    <p className="flex items-baseline justify-between gap-2 text-[11px] leading-snug text-muted">
      <span>{label}</span>
      <span className="text-ink">
        <span className="stat text-sm">{value}</span> {unit}
        {delta != null && delta !== 0 && (
          <span
            className={improving ? "text-good" : "text-warn"}
            title={t("vsAvg", { delta: format.number(Math.abs(delta)) })}
            aria-label={t("vsAvg", { delta: format.number(Math.abs(delta)) })}
          >
            {" "}{delta > 0 ? "↑" : "↓"}
          </span>
        )}
      </span>
    </p>
  );
}

function LinkTile({ href, title, sub, testId, delay }: { href: string; title: string; sub: string; testId?: string; delay: number }) {
  return (
    <Link href={href} data-testid={testId} className={tile} style={{ animationDelay: `${delay}ms` }}>
      <span className="t-label text-ink">{title}</span>
      <span className="text-[11px] leading-snug text-muted">{sub}</span>
    </Link>
  );
}

/* --------------------------------- página --------------------------------- */

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const { data: logs = [], isLoading } = useBiometrics();
  const { data: weighIn } = useWeighIn();
  // La tendencia es la del coach (`/coach/trend`), no una diferencia entre pesajes sueltos.
  const { data: trend } = useTrend(!!weighIn && !weighIn.blocked);

  // La carga sale de las sesiones registradas (lib/load); el servidor manda si responde.
  const [metrics, setMetrics] = useState<LoadMetrics | null>(() => loadMetrics());
  useEffect(() => {
    let alive = true;
    fetchServerMetrics().then((m) => {
      if (alive && m) setMetrics(m);
    });
    return () => { alive = false; };
  }, []);

  const heading = (
    <header className="rise flex items-center gap-2">
      <span className="text-neon"><ChartIcon className="h-6 w-6" /></span>
      <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
    </header>
  );

  if (isLoading) {
    return (
      <div className="pt-4">
        {heading}
        <div className="glass mt-4 h-16 animate-pulse rounded-3xl" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass h-20 animate-pulse rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  // `no_weight_targets`: ni pesaje, ni tendencia de peso, ni % de grasa. Si aún no se sabe (carga),
  // se oculta: es lo seguro.
  const weightHidden = !weighIn || weighIn.blocked;

  const latest = logs[0];
  const lastWeightLog = logs.find((l) => num(l.weight_kg ?? null) !== null);
  // F28: con dos pesajes el mismo día cuenta la media del día (el mismo criterio en toda la app)
  const weight = lastWeightLog ? latestWeightKg(logs) : null;
  const lastWeightDays = lastWeightLog ? daysSince(lastWeightLog.timestamp) : null;
  const when = lastWeightDays === 0 ? t("weight.today") : lastWeightDays === 1 ? t("weight.yesterday") : t("weight.daysAgo", { days: lastWeightDays ?? 0 });

  const rhrs = logs.map((l) => l.resting_heart_rate).filter((v): v is number => v != null);
  const hrvs = logs.map((l) => l.hrv_ms).filter((v): v is number => v != null);
  const fats = weightHidden ? [] : logs.map((l) => num(l.body_fat_pct ?? null)).filter((v): v is number => v !== null);
  const deltaOf = (xs: number[]) => (xs.length >= 4 ? Math.round((xs[0] - mean(xs.slice(1, 31))) * 10) / 10 : null);
  // Distancia al peso objetivo: solo si el servidor la devuelve (con el déficit bloqueado, no).
  const toGo = weighIn && !weighIn.blocked && weighIn.goal_weight_kg != null && weighIn.to_go_kg != null ? weighIn : null;
  const hasMeasures = rhrs.length > 0 || hrvs.length > 0 || fats.length > 0;

  return (
    <div className="pt-4">
      {heading}

      {/* ---------- Carga y estado de la semana (→ /training/load) ---------- */}
      <LoadSummary metrics={metrics} className="glass rise mt-3 flex items-center gap-3 p-3" style={{ animationDelay: "40ms" }} />

      {/* ---------- Mosaicos 2 × 3 ---------- */}
      <section className="mt-3 grid grid-cols-2 gap-2.5" aria-label={t("title")}>
        {!weightHidden && (
          <Link href="/biometrics" data-testid="weight-card" className={tile} style={{ animationDelay: "80ms" }}>
            <span className="t-label text-ink">{t("tiles.weight")}</span>
            {weight !== null ? (
              <>
                <span className="flex items-baseline gap-1">
                  <span className="stat text-2xl text-ink">{format.number(weight, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  <span className="text-xs text-muted">{t("weight.kg")} · {when}</span>
                </span>
                {trend && (
                  <span data-testid="weight-trend" className="block">
                    <TrendLine trend={trend} compact chip={false} />
                  </span>
                )}
                {toGo && (
                  <span data-testid="weight-to-goal" className="block text-[11px] leading-snug text-muted">
                    {weight - toGo.goal_weight_kg! > 0 ? (
                      t.rich("weight.toGoal", {
                        kg: format.number(weight - toGo.goal_weight_kg!, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                        target: format.number(toGo.goal_weight_kg!),
                        neon: (c) => <span className="text-neon">{c}</span>,
                      })
                    ) : (
                      <span className="text-good">{t("weight.reached", { target: format.number(toGo.goal_weight_kg!) })}</span>
                    )}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] leading-snug text-muted">{t("weight.emptyTitle")}</span>
            )}
          </Link>
        )}

        <Link href="/biometrics" data-testid="measures-card" className={tile} style={{ animationDelay: "120ms" }}>
          <span className="t-label text-ink">{t("tiles.measures")}</span>
          {hasMeasures ? (
            <span className="flex flex-col gap-0.5">
              {rhrs.length > 0 && <Metric label={t("metrics.rhr")} value={`${rhrs[0]}`} unit={t("metrics.bpm")} delta={deltaOf(rhrs)} goodWhenDown />}
              {hrvs.length > 0 && <Metric label={t("metrics.hrv")} value={`${hrvs[0]}`} unit={t("metrics.ms")} delta={deltaOf(hrvs)} goodWhenDown={false} />}
              {fats.length > 0 && (
                <Metric label={t("metrics.fat")} value={format.number(fats[0], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} unit="%" delta={deltaOf(fats)} goodWhenDown />
              )}
            </span>
          ) : (
            <span className="text-[11px] leading-snug text-muted">{latest ? t("metrics.activateTitle") : t("tiles.measuresEmpty")}</span>
          )}
        </Link>

        <LinkTile href="/training/review" title={t("tiles.review")} sub={t("tiles.reviewSub")} delay={160} />
        <LinkTile href="/training/gym/records" title={t("tiles.records")} sub={t("tiles.recordsSub")} delay={200} />
        <ZonesTile className={tile} style={{ animationDelay: "240ms" }} />
        <LinkTile href="/biometrics" title={t("tiles.photos")} sub={t("tiles.photosSub")} delay={280} />
      </section>

      {/* ---------- CTA ---------- */}
      <Link href="/biometrics/new" className="btn btn-primary rise mt-3 w-full" style={{ animationDelay: "320ms" }}>
        {t("cta.measure")} <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
