"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import { ScaleIcon } from "@/components/icons";

type Weigh = { target: number; date: string };
const KEY = "flp_weigh";

function daysUntil(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  d.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

export default function WeighInPage() {
  const { data: logs = [] } = useBiometrics();
  const current = (() => { for (const l of logs) { const w = l.weight_kg ? parseFloat(l.weight_kg) : null; if (w) return w; } return null; })();

  const [saved, setSaved] = useState<Weigh | null>(null);
  const [target, setTarget] = useState(70);
  const [days, setDays] = useState(14);

  useEffect(() => {
    try { const w = localStorage.getItem(KEY); if (w) { const v = JSON.parse(w); setSaved(v); setTarget(v.target); } } catch { /* noop */ }
  }, []);

  function save() {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const v: Weigh = { target, date: date.toISOString() };
    localStorage.setItem(KEY, JSON.stringify(v));
    setSaved(v);
  }
  function clear() { localStorage.removeItem(KEY); setSaved(null); }

  const left = saved ? daysUntil(saved.date) : null;
  const toGo = saved && current != null ? +(current - saved.target).toFixed(1) : null;

  return (
    <div className="pt-4">
      <Link href="/nutrition" className="t-label text-muted">← Nutrición</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><ScaleIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Pesaje</h1>
      </div>

      {saved && (
        <section className="glass neon-edge mt-4 p-5 text-center">
          <p className="stat text-6xl neon-text">{left! >= 0 ? left : 0}</p>
          <p className="t-label text-muted">días al pesaje</p>
          <div className="mt-4 flex justify-around">
            <div><p className="stat text-2xl text-ink">{current ?? "—"}</p><p className="t-label text-muted">actual (kg)</p></div>
            <div><p className="stat text-2xl text-neon">{saved.target}</p><p className="t-label text-muted">objetivo (kg)</p></div>
            <div><p className={`stat text-2xl ${toGo != null && toGo > 0 ? "text-warn" : "text-good"}`}>{toGo != null ? (toGo > 0 ? toGo : 0) : "—"}</p><p className="t-label text-muted">por bajar</p></div>
          </div>
          {current == null && <p className="t-body mt-3 text-xs text-muted">Registra tu peso en Biometría para ver el progreso.</p>}
        </section>
      )}

      {/* Configurar */}
      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{saved ? "Actualizar pesaje" : "Configurar pesaje"}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-label text-ink">Peso objetivo</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setTarget((t) => +(t - 0.5).toFixed(1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
            <span className="stat w-20 text-center text-lg text-ink">{target} kg</span>
            <button onClick={() => setTarget((t) => +(t + 0.5).toFixed(1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-label text-ink">Días hasta el pesaje</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setDays((d) => Math.max(1, d - 1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
            <span className="stat w-20 text-center text-lg text-ink">{days} d</span>
            <button onClick={() => setDays((d) => Math.min(180, d + 1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
          </div>
        </div>
        <button onClick={save} className="btn btn-primary mt-4 w-full">{saved ? "Actualizar" : "Guardar pesaje"}</button>
        {saved && <button onClick={clear} className="btn btn-outline mt-2 w-full">Quitar pesaje</button>}
      </section>

      <p className="t-body mt-4 text-center text-xs text-muted">Corte de peso básico (objetivo + countdown). Sin protocolos agresivos de fluidos.</p>
    </div>
  );
}
