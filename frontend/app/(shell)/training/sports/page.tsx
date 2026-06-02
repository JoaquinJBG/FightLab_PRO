"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import {
  RunIcon, WalkIcon, BikeIcon, SwimIcon, BallIcon, RopeIcon, PulseIcon, ChevronRight,
} from "@/components/icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type Sport = { key: string; name: string; met: number; Icon: Icon };

const SPORTS: Sport[] = [
  { key: "run", name: "Correr", met: 9.8, Icon: RunIcon },
  { key: "walk", name: "Caminar", met: 3.5, Icon: WalkIcon },
  { key: "bike", name: "Ciclismo", met: 7.5, Icon: BikeIcon },
  { key: "swim", name: "Natación", met: 8.0, Icon: SwimIcon },
  { key: "football", name: "Fútbol", met: 7.0, Icon: BallIcon },
  { key: "rope", name: "Saltar cuerda", met: 11.5, Icon: RopeIcon },
  { key: "hike", name: "Senderismo", met: 6.0, Icon: WalkIcon },
  { key: "elliptical", name: "Elíptica", met: 5.0, Icon: PulseIcon },
];

const INTENSITIES: [string, number][] = [
  ["Suave", 0.85],
  ["Moderado", 1],
  ["Intenso", 1.2],
];

const kcalOf = (met: number, factor: number, weight: number, minutes: number) =>
  Math.round((met * factor * 3.5 * weight) / 200 * minutes);

export default function SportsPage() {
  const { data: logs = [] } = useBiometrics();
  const latestWeight = (() => {
    for (const l of logs) {
      const w = l.weight_kg ? parseFloat(l.weight_kg) : null;
      if (w && Number.isFinite(w)) return w;
    }
    return null;
  })();
  const weight = latestWeight ?? 70;

  const [sel, setSel] = useState<Sport | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [intIdx, setIntIdx] = useState(1);
  const [saved, setSaved] = useState(false);

  const factor = INTENSITIES[intIdx][1];
  const kcal = sel ? kcalOf(sel.met, factor, weight, minutes) : 0;

  // ---- Detalle de deporte ----
  if (sel) {
    const Icon = sel.Icon;
    if (saved) {
      return (
        <div className="pt-4">
          <h1 className="t-display text-2xl text-ink">Sesión registrada</h1>
          <div className="glass neon-edge mt-6 flex flex-col items-center gap-3 p-8 text-center">
            <span className="text-neon glow flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <Icon className="h-8 w-8" />
            </span>
            <p className="t-title text-ink">{sel.name} · {minutes} min</p>
            <p className="stat text-4xl neon-text">{kcal} <span className="text-base text-muted">kcal</span></p>
            <Link href="/training" className="btn btn-primary mt-2">Volver al hub</Link>
          </div>
        </div>
      );
    }
    return (
      <div className="pt-4">
        <button onClick={() => setSel(null)} className="t-label text-muted">← Deportes</button>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-neon glow flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
            <Icon className="h-6 w-6" />
          </span>
          <h1 className="t-display text-2xl text-ink">{sel.name}</h1>
        </div>

        {/* kcal estimadas */}
        <div className="glass neon-edge mt-5 flex flex-col items-center gap-1 p-6">
          <span className="t-eyebrow text-muted">Estimación</span>
          <p className="stat text-5xl neon-text">{kcal}</p>
          <span className="t-label text-muted">kcal · {minutes} min · {INTENSITIES[intIdx][0].toLowerCase()}</span>
        </div>

        {/* duración */}
        <div className="glass mt-4 flex items-center justify-between p-4">
          <span className="t-label text-ink">Duración</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setMinutes((m) => Math.max(5, m - 5))}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
            <span className="stat w-16 text-center text-xl text-ink">{minutes} min</span>
            <button onClick={() => setMinutes((m) => Math.min(240, m + 5))}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
          </div>
        </div>

        {/* intensidad */}
        <div className="glass mt-3 grid grid-cols-3 gap-1 rounded-2xl p-1">
          {INTENSITIES.map(([label], i) => (
            <button key={label} onClick={() => setIntIdx(i)}
              className="rounded-xl py-2.5 text-sm font-medium transition-colors"
              style={intIdx === i
                ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                : { background: "transparent", color: "var(--color-muted)" }}>
              {label}
            </button>
          ))}
        </div>

        <p className="t-body mt-3 text-xs text-muted">
          Sobre tu peso {latestWeight ? `(${weight} kg, último registro)` : "(70 kg por defecto — registra tu peso en Biometría)"}.
          Con reloj conectado se usarán tus datos reales. <span className="text-muted/70">(próximamente)</span>
        </p>

        <button className="btn btn-primary mt-4 w-full" onClick={() => setSaved(true)}>
          Guardar sesión
        </button>
      </div>
    );
  }

  // ---- Rejilla de deportes ----
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Deportes</h1>
      <p className="t-body mt-1 text-muted">Elige tu actividad y calcula las kcal.</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {SPORTS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => { setSel(s); setSaved(false); }}
            className="glass rise flex items-center gap-3 p-4 text-left"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="text-neon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <s.Icon className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-label block text-ink">{s.name}</span>
              <span className="t-body text-[11px] text-muted">~{kcalOf(s.met, 1, weight, 30)} kcal/30min</span>
            </span>
          </button>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1 text-xs text-muted">
        <ChevronRight className="h-3 w-3" /> kcal estimadas sobre {latestWeight ? `${weight} kg` : "70 kg (por defecto)"}.
      </p>
    </div>
  );
}
