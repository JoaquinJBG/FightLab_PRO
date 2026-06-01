"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBiometrics, useMe, useLogout } from "@/lib/hooks";
import type { Biometrics } from "@/lib/schemas";
import {
  ScaleIcon,
  MoonIcon,
  HeartIcon,
  PulseIcon,
  BoltIcon,
  ArrowUpRight,
} from "@/components/icons";

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 100;
  const h = 34;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="#45e9ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px rgba(69,233,255,0.7))" }} />
    </svg>
  );
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  delay: number;
}) {
  return (
    <div className="glass rise p-3.5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 text-muted">
        <span className="text-neon">{icon}</span>
        <span className="t-label">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="stat text-2xl text-ink">{value}</span>
        {unit && <span className="mb-0.5 text-xs text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: logs = [], isLoading } = useBiometrics();
  const logout = useLogout();

  const name = me?.email ? me.email.split("@")[0] : "atleta";

  async function onLogout() {
    await logout.mutateAsync();
    router.push("/login");
  }

  const Header = (
    <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
      <div>
        <p className="t-label text-muted">Buenas,</p>
        <h1 className="t-display text-2xl text-ink">{name}</h1>
      </div>
      <button onClick={onLogout} className="badge" aria-label="Cerrar sesión">
        Salir
      </button>
    </header>
  );

  if (isLoading) {
    return (
      <div className="pt-3">
        {Header}
        <div className="glass mt-5 h-32 animate-pulse rounded-3xl" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="glass h-20 animate-pulse rounded-3xl" />)}
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="pt-3">
        {Header}
        <div className="glass neon-edge rise mt-6 flex flex-col items-center gap-4 p-8 text-center" style={{ animationDelay: "60ms" }}>
          <span className="text-neon glow flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.06)]">
            <ScaleIcon className="h-8 w-8" />
          </span>
          <div>
            <p className="t-title text-ink">Aún no hay datos</p>
            <p className="t-body mt-1 text-muted">Registra tu primera medición para empezar a ver tu evolución.</p>
          </div>
          <Link href="/biometrics/new" className="btn btn-primary">
            Registrar medición <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const latest: Biometrics = logs[0];
  const spark = logs
    .slice(0, 7)
    .reverse()
    .map((l) => num(l.weight_kg))
    .filter((n): n is number => n !== null);
  const weight = num(latest.weight_kg);
  const delta = spark.length >= 2 ? spark[spark.length - 1] - spark[0] : null;

  return (
    <div className="pt-3">
      {Header}

      {/* Peso (hero) */}
      <section className="glass neon-edge rise mt-5 p-5" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted">
            <span className="text-neon"><ScaleIcon className="h-[18px] w-[18px]" /></span>
            <span className="t-label">Peso · últimas mediciones</span>
          </div>
          {delta !== null && (
            <span className={`t-label ${delta <= 0 ? "text-good" : "text-warn"}`}>
              {delta > 0 ? "+" : ""}{delta.toFixed(1)} kg
            </span>
          )}
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="flex items-end gap-1">
            <span className="stat text-4xl text-ink">{weight !== null ? weight.toFixed(1) : "—"}</span>
            <span className="mb-1 text-xs text-muted">kg</span>
          </div>
          <div className="w-36"><Sparkline points={spark} /></div>
        </div>
      </section>

      {/* Métricas del último registro */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <MetricCard delay={120} icon={<MoonIcon className="h-[18px] w-[18px]" />} label="Sueño" value={latest.sleep_quality_score !== null ? `${latest.sleep_quality_score}` : "—"} unit="/10" />
        <MetricCard delay={160} icon={<HeartIcon className="h-[18px] w-[18px]" />} label="FC reposo" value={latest.resting_heart_rate !== null ? `${latest.resting_heart_rate}` : "—"} unit="bpm" />
        <MetricCard delay={200} icon={<PulseIcon className="h-[18px] w-[18px]" />} label="HRV" value={latest.hrv_ms !== null ? `${latest.hrv_ms}` : "—"} unit="ms" />
      </section>

      {/* ACWR / readiness — llega con M2 */}
      <section className="glass rise mt-4 flex items-center gap-3 p-4 opacity-80" style={{ animationDelay: "240ms" }}>
        <span className="text-muted"><BoltIcon className="h-[18px] w-[18px]" /></span>
        <div>
          <p className="t-label text-ink">Carga &amp; readiness (ACWR)</p>
          <p className="t-body text-xs text-muted">Disponible al activar Entrenamiento (M2).</p>
        </div>
      </section>

      <Link href="/biometrics/new" className="btn btn-primary rise mt-5 w-full" style={{ animationDelay: "300ms" }}>
        Registrar biometría <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
