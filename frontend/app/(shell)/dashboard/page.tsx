"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBiometrics, useMe } from "@/lib/hooks";
import type { Biometrics } from "@/lib/schemas";
import {
  ScaleIcon,
  HeartIcon,
  PulseIcon,
  BoltIcon,
  ArrowUpRight,
  ChevronRight,
  TrainingIcon,
  GloveIcon,
} from "@/components/icons";

/* ----------------------------- helpers ----------------------------------- */

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function daysSince(iso: string): number {
  const d = new Date(iso);
  const now = new Date();
  d.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - d.getTime()) / 86_400_000);
}

/* --------- estado de hoy: estimación con señales de recuperación ----------
   Honesto: solo con datos reales del usuario (FC reposo / HRV vs su media).
   Sin sesiones de entreno aún no hay ACWR: eso llega con el ActivityLog.
   Nada de números inventados.                                               */

type Recovery = {
  state: "listo" | "normal" | "cuidado";
  label: string;
  phrase: string;
  color: string;
  chips: string[];
};

function computeRecovery(logs: Biometrics[]): Recovery | null {
  // logs llegan ordenados del más reciente al más antiguo
  const rhrs = logs.map((l) => l.resting_heart_rate).filter((v): v is number => v != null);
  const hrvs = logs.map((l) => l.hrv_ms).filter((v): v is number => v != null);

  const chips: string[] = [];
  let good = 0;
  let bad = 0;
  let signals = 0;

  if (rhrs.length >= 4) {
    const base = mean(rhrs.slice(1, 31));
    const delta = Math.round((rhrs[0] - base) * 10) / 10;
    signals++;
    chips.push(`FC reposo ${delta > 0 ? "+" : ""}${delta} vs tu media`);
    if (delta >= 5) bad++;
    else if (delta <= 0) good++;
  }
  if (hrvs.length >= 4) {
    const base = mean(hrvs.slice(1, 31));
    if (base > 0) {
      const pct = Math.round(((hrvs[0] - base) / base) * 100);
      signals++;
      chips.push(`HRV ${pct > 0 ? "+" : ""}${pct}% vs tu media`);
      if (pct <= -10) bad++;
      else if (pct >= 0) good++;
    }
  }
  if (signals === 0) return null;

  if (bad > 0) {
    return {
      state: "cuidado",
      label: "Tómatelo suave",
      phrase: "Tus señales de recuperación están por debajo de tu media. Hoy: técnica ligera o descanso activo.",
      color: "#ffd25a",
      chips,
    };
  }
  if (good === signals) {
    return {
      state: "listo",
      label: "Listo para entrenar",
      phrase: "Recuperación por encima de tu media. Buen día para trabajo exigente.",
      color: "#43e8a0",
      chips,
    };
  }
  return {
    state: "normal",
    label: "Día normal",
    phrase: "Señales en torno a tu media. Entrena según tu plan.",
    color: "#45e9ff",
    chips,
  };
}

/* ----------------------------- subcomponentes ----------------------------- */

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
      <path
        d={path}
        fill="none"
        stroke="#45e9ff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 4px rgba(69,233,255,0.7))" }}
      />
    </svg>
  );
}

function DeltaCard({
  icon,
  label,
  value,
  unit,
  delta,
  goodWhenDown,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  delta: number | null;
  goodWhenDown: boolean;
  delay: number;
}) {
  const improving = delta != null && (goodWhenDown ? delta < 0 : delta > 0);
  return (
    <div className="glass rise p-3.5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 text-muted">
        <span className="text-neon">{icon}</span>
        <span className="t-label">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="stat text-2xl text-ink">{value}</span>
        <span className="mb-0.5 text-xs text-muted">{unit}</span>
      </div>
      {delta != null && delta !== 0 && (
        <p className={`t-body mt-1 text-[11px] ${improving ? "text-good" : "text-warn"}`}>
          {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} vs tu media
        </p>
      )}
    </div>
  );
}

/* --------------------------------- página --------------------------------- */

type LocalData = {
  weighTarget: number | null;
  gymWeek: string[] | null;
  trainedTs: number[];
};

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data: logs = [], isLoading } = useBiometrics();

  const [greeting, setGreeting] = useState("Hola");
  const [local, setLocal] = useState<LocalData>({ weighTarget: null, gymWeek: null, trainedTs: [] });

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches");
    try {
      const weigh = JSON.parse(localStorage.getItem("flp_weigh") ?? "null");
      const week = JSON.parse(localStorage.getItem("flp_gym_week") ?? "null");
      const acts = JSON.parse(localStorage.getItem("flp_activities") ?? "[]");
      const mma = JSON.parse(localStorage.getItem("flp_mma") ?? "[]");
      const gym = JSON.parse(localStorage.getItem("flp_gym_sessions") ?? "[]");
      setLocal({
        weighTarget: weigh && typeof weigh.target === "number" ? weigh.target : null,
        gymWeek: Array.isArray(week) && week.length === 7 ? week : null,
        trainedTs: [
          ...(Array.isArray(acts) ? acts.map((a: { ts: number }) => a.ts) : []),
          ...(Array.isArray(mma) ? mma.map((s: { ts: number }) => s.ts) : []),
          ...(Array.isArray(gym) ? gym.map((s: { ts: number }) => s.ts) : []),
        ].filter((t) => typeof t === "number"),
      });
    } catch {
      /* datos locales corruptos: se ignoran */
    }
  }, []);

  const name = me?.email ? me.email.split("@")[0] : "atleta";

  const Header = (
    <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
      <div>
        <p className="t-label text-muted">{greeting},</p>
        <h1 className="t-display text-2xl text-ink">{name}</h1>
      </div>
      <Link
        href="/profile"
        aria-label="Perfil"
        className="flex h-11 w-11 items-center justify-center rounded-full glass font-display text-sm text-neon"
      >
        {name[0]?.toUpperCase() ?? "?"}
      </Link>
    </header>
  );

  if (isLoading) {
    return (
      <div className="pt-3">
        {Header}
        <div className="glass mt-5 h-32 animate-pulse rounded-3xl" />
        <div className="glass mt-4 h-20 animate-pulse rounded-3xl" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass h-20 animate-pulse rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  /* ---------- datos derivados (todos reales) ---------- */
  const recovery = computeRecovery(logs);
  const latest: Biometrics | undefined = logs[0];

  // El peso y su frescura se calculan sobre el último registro CON peso
  // (el registro más reciente puede ser solo de FC/HRV).
  const lastWeightLog = logs.find((l) => num(l.weight_kg ?? null) !== null);
  const weight = lastWeightLog ? num(lastWeightLog.weight_kg ?? null) : null;
  const lastWeightDays = lastWeightLog ? daysSince(lastWeightLog.timestamp) : null;

  const spark = logs
    .slice(0, 14)
    .reverse()
    .map((l) => num(l.weight_kg))
    .filter((n): n is number => n !== null)
    .slice(-7);
  const weightDelta = spark.length >= 2 ? spark[spark.length - 1] - spark[0] : null;

  const rhrs = logs.map((l) => l.resting_heart_rate).filter((v): v is number => v != null);
  const hrvs = logs.map((l) => l.hrv_ms).filter((v): v is number => v != null);
  const fats = logs.map((l) => num(l.body_fat_pct ?? null)).filter((v): v is number => v !== null);
  const deltaOf = (xs: number[]) =>
    xs.length >= 4 ? Math.round((xs[0] - mean(xs.slice(1, 31))) * 10) / 10 : null;

  /* próxima acción de hoy */
  const todayIdx = (new Date().getDay() + 6) % 7; // 0 = lunes
  const todayFocus = local.gymWeek?.[todayIdx] ?? null;
  const trainedToday = local.trainedTs.filter((t) => sameDay(new Date(t), new Date())).length;

  /* consistencia semanal: medición o entreno por día */
  const eventTs = [...logs.map((l) => new Date(l.timestamp).getTime()), ...local.trainedTs];
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (todayIdx - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

  const stale = lastWeightDays !== null && lastWeightDays >= 14;

  return (
    <div className="pt-3">
      {Header}

      {/* ---------- Estado de hoy (readiness-first, sin datos inventados) ---------- */}
      {recovery ? (
        <section className="glass neon-edge rise mt-5 p-5" style={{ animationDelay: "40ms" }}>
          <p className="t-eyebrow text-muted">Estado de hoy · según tu recuperación</p>
          <div className="mt-2 flex items-center gap-3">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: recovery.color, boxShadow: `0 0 12px ${recovery.color}` }}
            />
            <p className="t-display text-2xl" style={{ color: recovery.color }}>{recovery.label}</p>
          </div>
          <p className="t-body mt-2 text-sm text-muted">{recovery.phrase}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recovery.chips.map((c) => (
              <span key={c} className="badge">{c}</span>
            ))}
          </div>
        </section>
      ) : (
        <section className="glass neon-edge rise mt-5 p-5" style={{ animationDelay: "40ms" }}>
          <p className="t-eyebrow text-muted">Estado de hoy</p>
          <p className="t-title mt-2 text-ink">Activa tu readiness</p>
          <p className="t-body mt-1.5 text-sm text-muted">
            Registra FC en reposo y HRV durante unos días y te diré cada mañana cómo venir a entrenar.
          </p>
          <Link href="/biometrics/new" className="btn btn-tonal btn-sm mt-3">
            Añadir medidas <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      {/* ---------- Hoy / próxima acción ---------- */}
      <Link
        href={trainedToday > 0 ? "/training" : todayFocus && todayFocus !== "Descanso" ? "/training/gym" : "/training"}
        className="glass rise mt-4 flex items-center gap-3 p-4"
        style={{ animationDelay: "90ms" }}
      >
        <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]">
          {trainedToday > 0 ? <GloveIcon className="h-5 w-5" /> : <TrainingIcon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {trainedToday > 0 ? (
            <>
              <p className="t-label text-ink">Entreno de hoy hecho ✓</p>
              <p className="t-body text-xs text-muted">
                {trainedToday} {trainedToday === 1 ? "sesión registrada" : "sesiones registradas"} · buen trabajo
              </p>
            </>
          ) : todayFocus && todayFocus !== "Descanso" ? (
            <>
              <p className="t-label text-ink">
                Hoy toca: <span className="text-neon">{todayFocus}</span>
              </p>
              <p className="t-body text-xs text-muted">De tu calendario de gimnasio</p>
            </>
          ) : todayFocus === "Descanso" ? (
            <>
              <p className="t-label text-ink">Hoy: descanso programado</p>
              <p className="t-body text-xs text-muted">Movilidad suave y a recuperar</p>
            </>
          ) : (
            <>
              <p className="t-label text-ink">Nada planificado para hoy</p>
              <p className="t-body text-xs text-muted">Registra un entreno o planifica tu semana</p>
            </>
          )}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
      </Link>

      {/* ---------- Recordatorio quincenal ---------- */}
      {stale && (
        <Link
          href="/biometrics/new"
          className="glass neon-edge rise mt-4 flex items-center gap-3 p-4"
          style={{ animationDelay: "120ms" }}
        >
          <span className="text-neon"><ScaleIcon className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="t-label text-ink">¿Apuntamos tu peso?</p>
            <p className="t-body text-xs text-muted">
              Hace {lastWeightDays} días de tu último peso · recordatorio cada 2 semanas.
            </p>
          </div>
          <ArrowUpRight className="h-4 w-4 text-neon" />
        </Link>
      )}

      {/* ---------- Peso ---------- */}
      {weight !== null ? (
        <Link href="/biometrics" className="glass rise mt-4 block p-5" style={{ animationDelay: "150ms" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted">
              <span className="text-neon"><ScaleIcon className="h-[18px] w-[18px]" /></span>
              <span className="t-label">
                Peso · {lastWeightDays === 0 ? "hoy" : lastWeightDays === 1 ? "ayer" : `hace ${lastWeightDays} días`}
              </span>
            </div>
            {weightDelta !== null && weightDelta !== 0 && (
              <span className={`t-label ${weightDelta < 0 ? "text-good" : "text-warn"}`}>
                {weightDelta > 0 ? "+" : ""}{weightDelta.toFixed(1)} kg
              </span>
            )}
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="flex items-end gap-1">
              <span className="stat text-4xl text-ink">{weight.toFixed(1)}</span>
              <span className="mb-1 text-xs text-muted">kg</span>
            </div>
            <div className="w-36"><Sparkline points={spark} /></div>
          </div>
          {local.weighTarget !== null && (
            <p className="t-body mt-2 text-xs text-muted">
              {weight - local.weighTarget > 0 ? (
                <>
                  A <span className="text-neon">{(weight - local.weighTarget).toFixed(1)} kg</span> de tu objetivo ({local.weighTarget} kg)
                </>
              ) : (
                <span className="text-good">Objetivo de peso alcanzado ✓ ({local.weighTarget} kg)</span>
              )}
            </p>
          )}
          <p className="t-body mt-2 text-[11px] text-neon">Ver historial y tendencia →</p>
        </Link>
      ) : (
        <section
          className="glass neon-edge rise mt-4 flex flex-col items-center gap-3 p-6 text-center"
          style={{ animationDelay: "150ms" }}
        >
          <span className="text-neon glow flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.06)]">
            <ScaleIcon className="h-7 w-7" />
          </span>
          <div>
            <p className="t-title text-ink">Aún no hay mediciones</p>
            <p className="t-body mt-1 text-xs text-muted">Registra tu primera medición para empezar a ver tu evolución.</p>
          </div>
          <Link href="/biometrics/new" className="btn btn-primary btn-sm">
            Registrar medición <ArrowUpRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {/* ---------- Métricas de recuperación con delta vs tu media ---------- */}
      {rhrs.length > 0 || hrvs.length > 0 || fats.length > 0 ? (
        <section className="mt-4 grid grid-cols-3 gap-3">
          {rhrs.length > 0 && (
            <DeltaCard
              delay={190}
              icon={<HeartIcon className="h-[18px] w-[18px]" />}
              label="FC reposo"
              value={`${rhrs[0]}`}
              unit="bpm"
              delta={deltaOf(rhrs)}
              goodWhenDown
            />
          )}
          {hrvs.length > 0 && (
            <DeltaCard
              delay={230}
              icon={<PulseIcon className="h-[18px] w-[18px]" />}
              label="HRV"
              value={`${hrvs[0]}`}
              unit="ms"
              delta={deltaOf(hrvs)}
              goodWhenDown={false}
            />
          )}
          {fats.length > 0 && (
            <DeltaCard
              delay={270}
              icon={<ScaleIcon className="h-[18px] w-[18px]" />}
              label="% Grasa"
              value={fats[0].toFixed(1)}
              unit="%"
              delta={deltaOf(fats)}
              goodWhenDown
            />
          )}
        </section>
      ) : (
        latest && (
          <Link
            href="/biometrics/new"
            className="glass rise mt-4 flex items-center gap-3 p-4"
            style={{ animationDelay: "190ms" }}
          >
            <span className="text-neon"><PulseIcon className="h-5 w-5" /></span>
            <div className="flex-1">
              <p className="t-label text-ink">Activa tus métricas de recuperación</p>
              <p className="t-body text-xs text-muted">Añade FC en reposo y HRV para ver tu estado diario y tendencias.</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted" />
          </Link>
        )
      )}

      {/* ---------- Consistencia semanal ---------- */}
      <section className="glass rise mt-4 p-4" style={{ animationDelay: "310ms" }}>
        <div className="flex items-center justify-between">
          <span className="t-label text-ink">Tu semana</span>
          <span className="t-body text-[11px] text-muted">medición o entreno</span>
        </div>
        <div className="mt-3 flex justify-between">
          {weekDays.map((d, i) => {
            const active = eventTs.some((t) => sameDay(new Date(t), d));
            const isToday = i === todayIdx;
            const future = i > todayIdx;
            return (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full transition-colors"
                  style={{
                    background: active ? "#45e9ff" : "rgba(150,190,255,0.15)",
                    boxShadow: active ? "0 0 8px rgba(69,233,255,0.7)" : undefined,
                    outline: isToday ? "1.5px solid rgba(69,233,255,0.6)" : undefined,
                    outlineOffset: "2px",
                    opacity: future ? 0.35 : 1,
                  }}
                />
                <span className={`text-[10px] ${isToday ? "text-neon" : "text-muted"}`}>{DAY_LABELS[i]}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Carga (honesto: se activa con sesiones) ---------- */}
      <Link
        href="/training/load"
        className="glass rise mt-4 flex items-center gap-3 p-4 opacity-90"
        style={{ animationDelay: "350ms" }}
      >
        <span className="text-muted"><BoltIcon className="h-5 w-5" /></span>
        <div className="flex-1">
          <p className="t-label text-ink">Carga de entreno (ACWR)</p>
          <p className="t-body text-xs text-muted">Se activará cuando registres sesiones · vista previa disponible</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted" />
      </Link>

      {/* ---------- CTA ---------- */}
      <Link href="/biometrics/new" className="btn btn-primary rise mt-5 w-full" style={{ animationDelay: "390ms" }}>
        {latest ? "Actualizar biometría" : "Registrar biometría"} <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
