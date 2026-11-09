"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  RunIcon,
  GloveIcon,
  TrainingIcon,
  ClipboardIcon,
  TimerIcon,
  ChevronRight,
} from "@/components/icons";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import { LoadSummary } from "@/components/load/LoadSummary";

const cards = [
  { href: "/training/sports", Icon: RunIcon, id: "sports" },
  { href: "/training/mma", Icon: GloveIcon, id: "mma" },
  { href: "/training/gym", Icon: TrainingIcon, id: "gym" },
  { href: "/training/exercises", Icon: TrainingIcon, id: "exercises" },
  { href: "/training/plan", Icon: ClipboardIcon, id: "plan" },
  { href: "/training/review", Icon: ClipboardIcon, id: "review" },
  { href: "/training/my-routine", Icon: ClipboardIcon, id: "myRoutine" },
  { href: "/training/tools", Icon: TimerIcon, id: "tools" },
] as const;

export default function TrainingHubPage() {
  const t = useTranslations("training.index");
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
      <h1 className="t-display text-2xl text-ink">{t("title")}</h1>

      {/* Mini-resumen de carga real */}
      <LoadSummary metrics={metrics} className="glass neon-edge rise mt-4 flex items-center gap-4 p-4" style={{ animationDelay: "0ms" }} />

      {/* Tarjetas */}
      <div className="mt-4 flex flex-col gap-3">
        {cards.map(({ href, Icon, id }, i) => (
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
              <p className="t-title text-lg text-ink">{t(`cards.${id}.title`)}</p>
              <p className="t-body text-xs text-muted">{t(`cards.${id}.sub`)}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
