"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  RunIcon,
  GloveIcon,
  TrainingIcon,
  ClipboardIcon,
  TimerIcon,
  ChevronRight,
  BoltIcon,
} from "@/components/icons";
import { loadMetrics, LOAD_BAND_META, LOAD_BAND_MIN_DAYS, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";

const cards = [
  { href: "/training/sports", Icon: RunIcon, title: "Deportes", sub: "Corre, nada, pedalea… y cuenta kcal" },
  { href: "/training/mma", Icon: GloveIcon, title: "Entrenamiento MMA", sub: "Sparring, técnica, intensidad · coach IA" },
  { href: "/training/gym", Icon: TrainingIcon, title: "Gimnasio", sub: "Registro en sesión + calendario + rutina IA" },
  { href: "/training/my-routine", Icon: ClipboardIcon, title: "Mi rutina", sub: "La que te asigna tu coach" },
  { href: "/training/tools", Icon: TimerIcon, title: "Herramientas", sub: "Cronómetro y timer de rounds" },
];

export default function TrainingHubPage() {
  // Perezoso: loadMetrics() lee localStorage y solo debe correr en el cliente
  // (guarda typeof window por dentro); así no hay setState síncrono en el
  // efecto (react-hooks/set-state-in-effect) y la primera pintura ya es real.
  const [metrics, setMetrics] = useState<LoadMetrics | null>(() => loadMetrics());
  useEffect(() => {
    let alive = true;
    fetchServerMetrics().then((m) => { if (alive && m) setMetrics(m); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">Entreno</h1>

      {/* Mini-resumen de carga real */}
      <Link
        href="/training/load"
        className="glass neon-edge rise mt-4 flex items-center gap-4 p-4"
        style={{ animationDelay: "0ms" }}
      >
        <span className={metrics && metrics.weekAU > 0 ? "text-neon" : "text-muted"}>
          <BoltIcon className="h-5 w-5" />
        </span>
        {metrics && metrics.weekAU > 0 ? (
          <div className="flex flex-1 items-center gap-5">
            <div>
              <p className="t-label text-muted">Semana</p>
              <p className="stat text-xl text-ink">{metrics.weekAU}<span className="text-xs text-muted"> AU</span></p>
            </div>
            <div>
              <p className="t-label text-muted">Tu rango</p>
              {metrics.band ? (
                <p className="stat text-xl" style={{ color: LOAD_BAND_META[metrics.band.status].color }}>
                  {LOAD_BAND_META[metrics.band.status].label}
                </p>
              ) : (
                <p className="stat text-xl text-muted">—</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <p className="t-label text-ink">Carga y estado</p>
            <p className="t-body text-xs text-muted">Registra sesiones con RPE y se calcula sola</p>
          </div>
        )}
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
      </Link>
      {metrics && metrics.weekAU > 0 && (
        metrics.band ? (
          metrics.band.provisional && (
            <p className="t-body mt-1.5 text-[10px] text-muted">*Rango calibrándose: {metrics.historyDays}/28 días de historial</p>
          )
        ) : (
          <p className="t-body mt-1.5 text-[10px] text-muted">
            Necesitamos {Math.max(0, LOAD_BAND_MIN_DAYS - metrics.historyDays)} días más para calcular tu rango personal
          </p>
        )
      )}

      {/* Tarjetas */}
      <div className="mt-4 flex flex-col gap-3">
        {cards.map(({ href, Icon, title, sub }, i) => (
          <Link
            key={href}
            href={href}
            className="glass rise flex items-center gap-4 p-4"
            style={{ animationDelay: `${60 + i * 50}ms` }}
          >
            <span className="text-neon glow flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="t-title text-lg text-ink">{title}</p>
              <p className="t-body text-xs text-muted">{sub}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
