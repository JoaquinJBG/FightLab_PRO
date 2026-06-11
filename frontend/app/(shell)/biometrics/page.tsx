"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useBiometrics,
  useDeleteBiometrics,
  useProfile,
  usePhotos,
  useUploadPhoto,
  useDeletePhoto,
} from "@/lib/hooks";
import { ScaleIcon, ArrowUpRight, InfoIcon, HeartIcon, PulseIcon } from "@/components/icons";

const mediaUrl = (path: string) => `/api/media${path.replace(/^\/media/, "")}`;

/* ----------------------------- helpers ----------------------------------- */

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

type Pt = { t: number; w: number };

/** EWMA con suavizado consciente del tiempo (estilo Happy Scale/MacroFactor):
    separa la señal (tendencia) del ruido diario de agua/glucógeno. */
function trendSeries(pts: Pt[]): number[] {
  const out: number[] = [];
  let trend = 0;
  let prevT = 0;
  pts.forEach((p, i) => {
    if (i === 0) {
      trend = p.w;
    } else {
      const days = Math.max(0.25, (p.t - prevT) / 86_400_000);
      const alpha = 1 - Math.pow(0.9, days); // más días entre pesajes → más peso al nuevo dato
      trend = trend + alpha * (p.w - trend);
    }
    prevT = p.t;
    out.push(trend);
  });
  return out;
}

/** Ritmo semanal de la tendencia (kg/semana) sobre los últimos ~21 días. */
function weeklyRate(pts: Pt[], trend: number[]): number | null {
  if (pts.length < 3) return null;
  const lastT = pts[pts.length - 1].t;
  const windowStart = lastT - 21 * 86_400_000;
  let i0 = pts.findIndex((p) => p.t >= windowStart);
  if (i0 < 0) i0 = 0;
  if (i0 >= pts.length - 1) i0 = Math.max(0, pts.length - 2);
  const days = (lastT - pts[i0].t) / 86_400_000;
  if (days < 3) return null; // ventana demasiado corta para hablar de ritmo
  return ((trend[trend.length - 1] - trend[i0]) / days) * 7;
}

const RANGES: [string, number | null][] = [
  ["1M", 30],
  ["3M", 90],
  ["6M", 180],
  ["Todo", null],
];

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("es", { day: "2-digit", month: "short" });
}
function fmtEntry(ts: number) {
  if (!Number.isFinite(ts)) return "Fecha desconocida";
  const d = new Date(ts);
  return `${d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "2-digit" })} · ${d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ----------------------------- gráfica ----------------------------------- */

function TrendChart({ pts, trend }: { pts: Pt[]; trend: number[] }) {
  const W = 320;
  const H = 150;
  const PAD = 12;
  const all = [...pts.map((p) => p.w), ...trend];
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 1) { min -= 0.5; max += 0.5; } // evita aplastar la escala
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => PAD + ((t - t0) / span) * (W - 2 * PAD);
  const y = (w: number) => PAD + (1 - (w - min) / (max - min)) * (H - 2 * PAD);

  const trendPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(trend[i]).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfica de peso y tendencia">
        {/* pesos diarios: el ruido */}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.w)} r="2.4" fill="rgba(159,173,202,0.45)" />
        ))}
        {/* tendencia: la señal */}
        <path
          d={trendPath}
          fill="none"
          stroke="#45e9ff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 5px rgba(69,233,255,0.6))" }}
        />
      </svg>
      <div className="flex justify-between px-1">
        <span className="text-[10px] text-muted">{fmtDay(t0)}</span>
        <span className="text-[10px] text-muted">{max.toFixed(1)}–{min.toFixed(1)} kg</span>
        <span className="text-[10px] text-muted">{fmtDay(t1)}</span>
      </div>
    </div>
  );
}

/* ----------------------------- página ------------------------------------ */

export default function BiometricsPage() {
  const { data: logs = [], isLoading } = useBiometrics();
  const { data: profileData } = useProfile();
  const del = useDeleteBiometrics();
  const { data: photos = [] } = usePhotos();
  const upload = useUploadPhoto();
  const delPhoto = useDeletePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmPhotoId, setConfirmPhotoId] = useState<number | null>(null);
  const [range, setRange] = useState<number | null>(90);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showImcInfo, setShowImcInfo] = useState(false);
  const [weighTarget, setWeighTarget] = useState<number | null>(null);

  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem("flp_weigh") ?? "null");
      if (w && typeof w.target === "number") setWeighTarget(w.target);
    } catch { /* sin objetivo configurado */ }
  }, []);

  // puntos de peso ascendentes en el rango elegido
  const { pts, trend } = useMemo(() => {
    const asc = logs
      .map((l) => ({ t: new Date(l.timestamp).getTime(), w: num(l.weight_kg ?? null) }))
      .filter((p): p is Pt => p.w !== null && Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    const cut = range === null ? -Infinity : Date.now() - range * 86_400_000;
    const filtered = asc.filter((p) => p.t >= cut);
    return { pts: filtered, trend: trendSeries(filtered) };
  }, [logs, range]);

  const trendNow = trend.length > 0 ? trend[trend.length - 1] : null;
  const rate = weeklyRate(pts, trend);

  // IMC calculado (peso de tendencia + altura del perfil)
  const heightCm = profileData?.height_cm ?? null;
  const imc =
    trendNow !== null && heightCm && heightCm > 0
      ? trendNow / Math.pow(heightCm / 100, 2)
      : null;

  function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (file) upload.mutate(file);
  }

  function onDeletePhoto(id: number) {
    if (confirmPhotoId !== id) {
      setConfirmPhotoId(id);
      return;
    }
    setConfirmPhotoId(null);
    delPhoto.mutate(id, { onError: () => setConfirmPhotoId(id) });
  }

  function onDelete(id: number) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    del.mutate(id, {
      // si el borrado falla, vuelve a pedir confirmación (nada de fallos silenciosos)
      onError: () => setConfirmId(id),
    });
  }

  return (
    <div className="pt-4">
      <Link href="/dashboard" className="t-label text-muted">← Inicio</Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="t-display text-2xl text-ink">Biometría</h1>
        <Link href="/biometrics/new" className="btn btn-tonal btn-sm">+ Medición</Link>
      </div>

      {isLoading ? (
        <div className="glass mt-4 h-48 animate-pulse rounded-3xl" />
      ) : pts.length === 0 ? (
        <section className="glass neon-edge mt-4 flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-neon glow flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.06)]">
            <ScaleIcon className="h-7 w-7" />
          </span>
          <p className="t-title text-ink">Sin datos de peso {range !== null ? "en este rango" : "todavía"}</p>
          <p className="t-body text-xs text-muted">
            {range !== null && logs.length > 0
              ? "Prueba con un rango más amplio o registra una medición."
              : "Registra tu primera medición y aquí verás tu tendencia."}
          </p>
          <Link href="/biometrics/new" className="btn btn-primary btn-sm">
            Registrar medición <ArrowUpRight className="h-4 w-4" />
          </Link>
        </section>
      ) : (
        <>
          {/* cabecera de tendencia */}
          <section className="glass neon-edge mt-4 p-5">
            <div className="flex items-center gap-1.5">
              <p className="t-eyebrow text-muted">Peso de tendencia</p>
              <button type="button" onClick={() => setShowInfo((v) => !v)} aria-label="Qué es la tendencia"
                className={showInfo ? "text-neon" : "text-muted hover:text-neon"}>
                <InfoIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {showInfo && (
              <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">
                La tendencia es una media suavizada de tus pesajes: ignora las fluctuaciones diarias
                de agua y glucógeno y muestra hacia dónde va tu peso de verdad. Fíate de la línea, no del punto de hoy.
              </p>
            )}
            <div className="mt-2 flex items-end justify-between">
              <div className="flex items-end gap-1">
                <span className="stat text-4xl text-ink">{trendNow?.toFixed(1)}</span>
                <span className="mb-1 text-xs text-muted">kg</span>
              </div>
              {rate !== null && (
                <span className={`t-label ${rate < 0 ? "text-good" : rate > 0 ? "text-warn" : "text-muted"}`}>
                  {rate > 0 ? "+" : ""}{rate.toFixed(2)} kg/semana
                </span>
              )}
            </div>
            {weighTarget !== null && trendNow !== null && (
              <p className="t-body mt-1.5 text-xs text-muted">
                {trendNow - weighTarget > 0 ? (
                  <>Tendencia a <span className="text-neon">{(trendNow - weighTarget).toFixed(1)} kg</span> de tu objetivo ({weighTarget} kg)</>
                ) : (
                  <span className="text-good">Tendencia en tu objetivo ✓ ({weighTarget} kg)</span>
                )}
              </p>
            )}
            {imc !== null && (
              <div className="mt-2 flex items-center gap-1.5 border-t border-[rgba(150,190,255,0.1)] pt-2">
                <p className="t-body text-xs text-muted">
                  IMC <span className="text-ink">{imc.toFixed(1)}</span>
                </p>
                <button type="button" onClick={() => setShowImcInfo((v) => !v)} aria-label="Qué es el IMC"
                  className={showImcInfo ? "text-neon" : "text-muted hover:text-neon"}>
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {showImcInfo && (
              <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">
                IMC = peso / altura². Referencia general: 18.5–24.9 se considera "normal". Ojo: en
                atletas con masa muscular sobreestima la grasa — úsalo solo como orientación.
              </p>
            )}
          </section>

          {/* rango + gráfica */}
          <div className="glass mt-4 p-4">
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[rgba(255,255,255,0.04)] p-1">
              {RANGES.map(([label, days]) => (
                <button key={label} onClick={() => setRange(days)}
                  className="rounded-xl py-1.5 text-xs font-medium transition-colors"
                  style={range === days
                    ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                    : { background: "transparent", color: "var(--color-muted)" }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              {pts.length >= 2 && pts[0].t !== pts[pts.length - 1].t ? (
                <TrendChart pts={pts} trend={trend} />
              ) : (
                <p className="t-body py-6 text-center text-xs text-muted">
                  {pts.length >= 2
                    ? "Registra mediciones en días distintos para ver la gráfica."
                    : "Con un par de mediciones más aparecerá tu gráfica."}
                </p>
              )}
            </div>
            <p className="t-body mt-1 px-1 text-[10px] text-muted">
              Puntos = pesajes · línea = tendencia
            </p>
          </div>
        </>
      )}

      {/* historial */}
      {logs.length > 0 && (
        <div className="mt-5">
          <p className="t-eyebrow text-muted">Historial</p>
          <div className="mt-2 flex flex-col gap-2">
            {logs.map((l) => {
              const w = num(l.weight_kg ?? null);
              const extras: string[] = [];
              if (l.resting_heart_rate != null) extras.push(`${l.resting_heart_rate} bpm`);
              if (l.hrv_ms != null) extras.push(`HRV ${l.hrv_ms}`);
              const fat = num(l.body_fat_pct ?? null);
              if (fat !== null) extras.push(`${fat.toFixed(1)}% grasa`);
              const waist = num(l.waist_cm ?? null);
              if (waist !== null) extras.push(`cintura ${waist} cm`);
              return (
                <div key={l.id} className="glass flex items-center gap-3 p-3.5">
                  <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]">
                    {w !== null ? <ScaleIcon className="h-5 w-5" /> : l.hrv_ms != null ? <PulseIcon className="h-5 w-5" /> : <HeartIcon className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="t-label text-ink">
                      {w !== null ? `${w.toFixed(1)} kg` : "Recuperación"}
                    </p>
                    <p className="t-body text-[11px] text-muted">
                      {fmtEntry(new Date(l.timestamp).getTime())}{extras.length > 0 ? ` · ${extras.join(" · ")}` : ""}
                    </p>
                  </div>
                  {confirmId === l.id ? (
                    <button onClick={() => onDelete(l.id)} disabled={del.isPending}
                      className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-[#03101c] disabled:opacity-60"
                      style={{ background: "#ff5d80" }}>
                      ¿Borrar?
                    </button>
                  ) : (
                    <button onClick={() => onDelete(l.id)} aria-label="Borrar entrada"
                      className="t-label shrink-0 px-2 text-muted hover:text-bad">
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* fotos de progreso */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-muted">Fotos de progreso</p>
          <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="btn btn-tonal btn-sm disabled:opacity-60">
            {upload.isPending ? "Subiendo…" : "+ Foto"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPhotoSelected} className="hidden" />
        </div>
        {upload.isError && (
          <p className="mt-2 text-xs text-bad">{(upload.error as Error).message}</p>
        )}
        {photos.length === 0 ? (
          <div className="glass mt-2 p-4">
            <p className="t-body text-xs text-muted">
              Hazte una foto de vez en cuando (misma luz, misma pose) y verás el progreso que la
              báscula no enseña. Más adelante la IA también podrá analizarlas.
            </p>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative overflow-hidden rounded-2xl border border-[rgba(150,190,255,0.14)]">
                <a href={mediaUrl(p.image)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(p.image)} alt={`Foto de progreso ${p.taken_at}`} className="aspect-[3/4] w-full object-cover" />
                </a>
                <span className="absolute bottom-1 left-1 rounded-md bg-[rgba(2,4,10,0.7)] px-1.5 py-0.5 text-[9px] text-muted">
                  {fmtDay(new Date(p.taken_at + "T12:00:00").getTime())}
                </span>
                <button
                  onClick={() => onDeletePhoto(p.id)}
                  aria-label="Borrar foto"
                  className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[10px]"
                  style={confirmPhotoId === p.id
                    ? { background: "#ff5d80", color: "#03101c" }
                    : { background: "rgba(2,4,10,0.7)", color: "var(--color-muted)" }}
                >
                  {confirmPhotoId === p.id ? "¿Borrar?" : "✕"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
