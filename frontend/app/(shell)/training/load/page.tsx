"use client";

import { useState } from "react";
import Link from "next/link";
import { BoltIcon, InfoIcon } from "@/components/icons";

/* datos de ejemplo (vendrán del motor de carga de M2 backend) */
const DATA = {
  readiness: 78,
  acwr: 1.18,
  weekLoad: [320, 0, 540, 610, 0, 700, 480], // AU/día
  monotonia: 1.4,
};
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

const INFO: Record<string, string> = {
  readiness: "Tu preparación para entrenar hoy, combinando fatiga y recuperación. Alto = listo para intensidad; bajo = mejor recuperar.",
  acwr: "Ratio carga aguda (7 días) / crónica (28 días). Entre 0.8 y 1.3 = zona segura; por encima sube el riesgo de lesión.",
  carga: "Carga de cada sesión = duración × RPE (en unidades arbitrarias, AU). Sumada da tu carga semanal.",
  monotonia: "Cómo de iguales son tus cargas diarias. Muy alta (poca variación) = más riesgo; alterna días duros y suaves.",
  tension: "Tensión = carga semanal × monotonía. Mide el estrés acumulado total de la semana.",
};

function Info({ k, open, setOpen }: { k: string; open: string | null; setOpen: (v: string | null) => void }) {
  return (
    <button type="button" aria-label="Más info" onClick={() => setOpen(open === k ? null : k)}
      className={`shrink-0 ${open === k ? "text-neon" : "text-muted hover:text-neon"}`}>
      <InfoIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function ReadinessRing({ value }: { value: number }) {
  const r = 54, C = 2 * Math.PI * r;
  const color = value >= 75 ? "#45e9ff" : value >= 50 ? "#ffd25a" : "#ff5d80";
  return (
    <div className="relative grid place-items-center">
      <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(150,190,255,0.12)" strokeWidth="11" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - value / 100)} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="stat text-4xl" style={{ color }}>{value}</span>
        <span className="t-eyebrow text-muted">ready</span>
      </div>
    </div>
  );
}

export default function LoadPage() {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...DATA.weekLoad);
  const weekSum = DATA.weekLoad.reduce((a, b) => a + b, 0);
  const tension = Math.round(weekSum * DATA.monotonia);
  const acwrPct = (v: number) => ((v - 0.5) / (1.8 - 0.5)) * 100;
  const acwrColor = DATA.acwr >= 0.8 && DATA.acwr <= 1.3 ? "text-good" : "text-warn";

  const Tip = ({ k }: { k: string }) =>
    open === k ? (
      <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{INFO[k]}</p>
    ) : null;

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><BoltIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Carga y estado</h1>
        <span className="badge">ejemplo</span>
      </div>

      {/* Readiness */}
      <section className="glass neon-edge mt-4 flex items-center gap-4 p-5">
        <ReadinessRing value={DATA.readiness} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="t-eyebrow text-muted">Readiness</p>
            <Info k="readiness" open={open} setOpen={setOpen} />
          </div>
          <p className="t-title mt-1 text-ink">Listo para <span className="text-neon">alta intensidad</span></p>
          <Tip k="readiness" />
        </div>
      </section>

      {/* ACWR */}
      <section className="glass mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink">ACWR · riesgo de lesión</span>
            <Info k="acwr" open={open} setOpen={setOpen} />
          </div>
          <span className={`stat text-xl ${acwrColor}`}>{DATA.acwr.toFixed(2)}</span>
        </div>
        <div className="mt-3 relative h-2.5 w-full rounded-full bg-[rgba(150,190,255,0.12)]">
          <div className="absolute inset-y-0 rounded-full bg-[rgba(67,232,160,0.35)]" style={{ left: `${acwrPct(0.8)}%`, width: `${acwrPct(1.3) - acwrPct(0.8)}%` }} />
          <div className="glow absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon" style={{ left: `${acwrPct(DATA.acwr)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-muted"><span>0.5</span><span className="text-good">zona óptima</span><span>1.8</span></div>
        <Tip k="acwr" />
      </section>

      {/* Carga semanal */}
      <section className="glass mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink">Carga semanal</span>
            <Info k="carga" open={open} setOpen={setOpen} />
          </div>
          <span className="t-label text-muted">{weekSum} AU</span>
        </div>
        <div className="mt-4 flex h-24 items-end justify-between gap-2">
          {DATA.weekLoad.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="w-full rounded-md" style={{ height: `${Math.max((v / max) * 100, 4)}%`, opacity: v === 0 ? 0.25 : 1, background: "linear-gradient(to top,#2b6bff,#45e9ff)" }} />
              <span className="text-[10px] text-muted">{DAYS[i]}</span>
            </div>
          ))}
        </div>
        <Tip k="carga" />
      </section>

      {/* Monotonía / Tensión */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="glass p-4">
          <div className="flex items-center gap-1.5"><span className="t-label text-muted">Monotonía</span><Info k="monotonia" open={open} setOpen={setOpen} /></div>
          <p className="stat mt-2 text-2xl text-ink">{DATA.monotonia.toFixed(1)}</p>
          <Tip k="monotonia" />
        </div>
        <div className="glass p-4">
          <div className="flex items-center gap-1.5"><span className="t-label text-muted">Tensión</span><Info k="tension" open={open} setOpen={setOpen} /></div>
          <p className="stat mt-2 text-2xl text-ink">{tension}</p>
          <Tip k="tension" />
        </div>
      </section>

      <p className="t-body mt-4 text-center text-xs text-muted">Datos de ejemplo · se calcularán con tus sesiones reales (M2 backend).</p>
    </div>
  );
}
