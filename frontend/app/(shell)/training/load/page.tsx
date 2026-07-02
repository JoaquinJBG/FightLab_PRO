"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import { computeRecovery, type Recovery } from "@/lib/recovery";
import { loadMetrics, type LoadMetrics, type LoadBand, type LoadBandStatus } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import { BoltIcon, InfoIcon, ArrowUpRight } from "@/components/icons";

const INFO: Record<string, string> = {
  estado: "Tu preparación para entrenar hoy, según tus señales de recuperación (FC en reposo y HRV) comparadas con tu propia media.",
  banda: "Tu carga de esta semana comparada con tu propio rango de las últimas 3 semanas: verde = dentro de tu rango habitual; ámbar/rojo = por encima (vigila la recuperación); azul = por debajo (semana de descarga). Se calibra hasta acumular 4 semanas de historial.",
  carga: "Carga de cada sesión = duración × RPE (unidades arbitrarias, AU). Aquí se suman tus sesiones de Deportes, MMA y Gimnasio registradas con RPE.",
  monotonia: "Cómo de iguales son tus cargas diarias (media/desviación de los últimos 7 días). Muy alta = poca variación, más riesgo; alterna días duros y suaves.",
  tension: "Tensión = carga semanal × monotonía. Mide el estrés acumulado total de la semana.",
};

const BAND_META: Record<LoadBandStatus, { label: string; color: string; hint: string }> = {
  descarga: { label: "Descarga", color: "var(--color-neon)", hint: "Por debajo de tu rango: semana de recuperación." },
  sostenible: { label: "Sostenible", color: "var(--color-good)", hint: "Dentro de tu rango habitual: carga sostenible." },
  elevada: { label: "Elevada", color: "var(--color-warn)", hint: "Por encima de tu rango: vigila la recuperación." },
  alta: { label: "Alta", color: "var(--color-bad)", hint: "Muy por encima de tu rango: prioriza recuperar." },
};

// Geometría de la banda: escala 0..(overreach + σ_eff) para que el marcador no se salga.
function bandGeometry(b: LoadBand) {
  const sigmaEff = (b.high - b.low) / 2;
  const axisMax = b.overreach + sigmaEff || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / axisMax) * 100));
  return { pct };
}

function dayLabels(): string[] {
  const L = ["D", "L", "M", "X", "J", "V", "S"];
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(L[d.getDay()]);
  }
  return out;
}

function Info({ k, open, setOpen }: { k: string; open: string | null; setOpen: (v: string | null) => void }) {
  return (
    <button type="button" aria-label="Más info" onClick={() => setOpen(open === k ? null : k)}
      className={`shrink-0 ${open === k ? "text-neon" : "text-muted hover:text-neon"}`}>
      <InfoIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function Tip({ k, open }: { k: string; open: string | null }) {
  return open === k ? (
    <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{INFO[k]}</p>
  ) : null;
}

export default function LoadPage() {
  const { data: logs = [] } = useBiometrics();
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const local = loadMetrics();
    setMetrics(local); // pintura inmediata con lo local
    // El servidor manda en las métricas agregadas, pero aún no calcula la banda:
    // conservamos la banda local hasta que el backend la provea (parity: follow-up).
    fetchServerMetrics().then((s) => {
      if (alive && s) setMetrics({ ...s, band: s.band ?? local.band });
    });
    return () => { alive = false; };
  }, []);

  const recovery: Recovery | null = computeRecovery(logs);
  const m = metrics;
  const max = m ? Math.max(...m.daily7, 1) : 1;
  const labels = dayLabels();

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><BoltIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Carga y estado</h1>
      </div>
      <p className="t-body mt-1 text-xs text-muted">Calculado con tus sesiones y mediciones reales.</p>

      {/* Estado de hoy (recuperación) */}
      {recovery ? (
        <section className="glass neon-edge mt-4 p-5">
          <div className="flex items-center gap-1.5">
            <p className="t-eyebrow text-muted">Estado de hoy</p>
            <Info k="estado" open={open} setOpen={setOpen} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: recovery.color, boxShadow: `0 0 12px ${recovery.color}` }} />
            <p className="t-display text-2xl" style={{ color: recovery.color }}>{recovery.label}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recovery.chips.map((c) => <span key={c} className="badge">{c}</span>)}
          </div>
          <Tip k="estado" open={open} />
        </section>
      ) : (
        <section className="glass mt-4 p-5">
          <p className="t-eyebrow text-muted">Estado de hoy</p>
          <p className="t-body mt-2 text-sm text-muted">
            Registra FC en reposo y HRV unos días en Biometría y aquí verás tu estado de recuperación.
          </p>
          <Link href="/biometrics/new" className="btn btn-tonal btn-sm mt-3">Añadir medidas <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </section>
      )}

      {/* Carga vs tu rango */}
      <section className="glass mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink">Carga vs tu rango</span>
            <Info k="banda" open={open} setOpen={setOpen} />
          </div>
          <span className="t-label text-muted">{m?.weekAU ?? 0} AU</span>
        </div>
        {m?.band && m.weekAU > 0 ? (
          <>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: BAND_META[m.band.status].color, boxShadow: `0 0 12px ${BAND_META[m.band.status].color}` }} />
              <p className="t-display text-2xl" style={{ color: BAND_META[m.band.status].color }}>{BAND_META[m.band.status].label}</p>
            </div>
            {m.band.provisional && (
              <p className="t-body mt-1 text-[11px] text-muted">Rango calibrándose: {m.historyDays}/28 días de historial.</p>
            )}
            {(() => {
              const b = m.band;
              const { pct } = bandGeometry(b);
              return (
                <>
                  <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[rgba(150,190,255,0.12)]">
                    <div className="absolute inset-y-0" style={{ left: 0, width: `${pct(b.low)}%`, background: "rgba(69,233,255,0.30)" }} />
                    <div className="absolute inset-y-0" style={{ left: `${pct(b.low)}%`, width: `${pct(b.high) - pct(b.low)}%`, background: "rgba(67,232,160,0.35)" }} />
                    <div className="absolute inset-y-0" style={{ left: `${pct(b.high)}%`, width: `${pct(b.overreach) - pct(b.high)}%`, background: "rgba(255,210,90,0.32)" }} />
                    <div className="absolute inset-y-0" style={{ left: `${pct(b.overreach)}%`, right: 0, background: "rgba(255,93,128,0.32)" }} />
                    <div className="glow absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon" style={{ left: `${pct(b.weekAU)}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] text-muted"><span>descarga</span><span className="text-good">tu rango</span><span>alta</span></div>
                </>
              );
            })()}
            <p className="t-body mt-2 text-xs text-muted">{BAND_META[m.band.status].hint}</p>
          </>
        ) : m && m.weekAU === 0 && m.band ? (
          <p className="t-body mt-2 text-xs text-muted">Sin sesiones esta semana: registra un entreno y verás dónde cae respecto a tu rango.</p>
        ) : (
          <p className="t-body mt-2 text-xs text-muted">
            {m && m.historyDays > 0
              ? `Se activa con ~2 semanas de sesiones con RPE (llevas ${m.historyDays} ${m.historyDays === 1 ? "día" : "días"}).`
              : "Registra tus entrenos con RPE (Deportes, MMA o Gimnasio) y tu banda de carga se calculará sola."}
          </p>
        )}
        <Tip k="banda" open={open} />
      </section>

      {/* Carga semanal */}
      <section className="glass mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink">Carga semanal</span>
            <Info k="carga" open={open} setOpen={setOpen} />
          </div>
          <span className="t-label text-muted">{m?.weekAU ?? 0} AU</span>
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
          <p className="t-body mt-2 text-xs text-muted">Sin sesiones esta semana. Tus entrenos con RPE aparecerán aquí.</p>
        )}
        <Tip k="carga" open={open} />
      </section>

      {/* Monotonía / Tensión */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="glass p-4">
          <div className="flex items-center gap-1.5"><span className="t-label text-muted">Monotonía</span><Info k="monotonia" open={open} setOpen={setOpen} /></div>
          {m?.sinVariacion ? (
            <>
              <p className="stat mt-2 text-2xl text-warn">máx</p>
              <p className="t-body mt-1 text-[10px] text-muted">Sin variación entre días: alterna duros y suaves</p>
            </>
          ) : (
            <p className="stat mt-2 text-2xl text-ink">{m?.monotonia != null ? m.monotonia.toFixed(1) : "—"}</p>
          )}
          <Tip k="monotonia" open={open} />
        </div>
        <div className="glass p-4">
          <div className="flex items-center gap-1.5"><span className="t-label text-muted">Tensión</span><Info k="tension" open={open} setOpen={setOpen} /></div>
          <p className="stat mt-2 text-2xl text-ink">{m?.tension != null ? m.tension.toLocaleString("es") : "—"}</p>
          <Tip k="tension" open={open} />
        </div>
      </section>

      <p className="t-body mt-4 text-center text-xs text-muted">
        Datos de este dispositivo · pasarán a tu cuenta con el backend de sesiones.
      </p>
    </div>
  );
}
