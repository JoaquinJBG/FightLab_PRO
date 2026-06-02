"use client";

import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import {
  RunIcon, WalkIcon, BikeIcon, SwimIcon, BallIcon, RopeIcon, PulseIcon, ChevronRight,
} from "@/components/icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type Sport = { key: string; name: string; met: number; Icon: Icon; speeds?: [string, string, string] };

const SPORTS: Sport[] = [
  { key: "run", name: "Correr", met: 9.8, Icon: RunIcon, speeds: ["7–9 km/h", "9–12 km/h", "12–16 km/h"] },
  { key: "walk", name: "Caminar", met: 3.5, Icon: WalkIcon, speeds: ["3–4.5 km/h", "4.5–6 km/h", "6–7.5 km/h"] },
  { key: "bike", name: "Ciclismo", met: 7.5, Icon: BikeIcon, speeds: ["15–20 km/h", "20–28 km/h", "28–35 km/h"] },
  { key: "swim", name: "Natación", met: 8.0, Icon: SwimIcon },
  { key: "football", name: "Fútbol", met: 7.0, Icon: BallIcon },
  { key: "rope", name: "Saltar cuerda", met: 11.5, Icon: RopeIcon },
  { key: "hike", name: "Senderismo", met: 6.0, Icon: WalkIcon, speeds: ["3–4 km/h", "4–5.5 km/h", "5.5–7 km/h"] },
  { key: "elliptical", name: "Elíptica", met: 5.0, Icon: PulseIcon },
];
const SPORT_BY_KEY: Record<string, Sport> = Object.fromEntries(SPORTS.map((s) => [s.key, s]));

const INTENSITIES: [string, number][] = [["Suave", 0.85], ["Moderado", 1], ["Intenso", 1.2]];
const EFFORT = ["RPE 3-4 · puedes hablar", "RPE 5-7 · respiración agitada", "RPE 8-10 · casi al límite"];

const kcalOf = (met: number, factor: number, weight: number, minutes: number) =>
  Math.round((met * factor * 3.5 * weight) / 200 * minutes);

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/* ---- registro de actividad (mock en localStorage) ---- */
type Activity = { id: string; sportKey: string; sportName: string; durationSec: number; kcal: number; intensity: string; ts: number };
const KEY = "flp_activities";
function loadActivities(): Activity[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function pushActivity(a: Activity) {
  const all = [a, ...loadActivities()].slice(0, 100);
  localStorage.setItem(KEY, JSON.stringify(all));
}
function fmtDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Hoy · ${time}` : `${d.toLocaleDateString("es", { day: "2-digit", month: "short" })} · ${time}`;
}

export default function SportsPage() {
  const { data: logs = [] } = useBiometrics();
  const latestWeight = (() => {
    for (const l of logs) { const w = l.weight_kg ? parseFloat(l.weight_kg) : null; if (w && Number.isFinite(w)) return w; }
    return null;
  })();
  const weight = latestWeight ?? 70;
  const weightNote = latestWeight
    ? `kcal estimadas según tu peso: ${weight} kg (último registro).`
    : "kcal estimadas con 70 kg por defecto — registra tu peso en Biometría.";

  const [sel, setSel] = useState<Sport | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  useEffect(() => setActivities(loadActivities()), []);

  // estado del tracker en vivo
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [intIdx, setIntIdx] = useState(1);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const factor = INTENSITIES[intIdx][1];
  const liveKcal = sel ? kcalOf(sel.met, factor, weight, elapsed / 60) : 0;

  function openSport(s: Sport) {
    setSel(s); setElapsed(0); setRunning(false); setStarted(false); setFinished(false); setIntIdx(1);
  }
  function stop() {
    setRunning(false);
    setFinished(true);
    if (sel && elapsed > 0) {
      const a: Activity = {
        id: `${Date.now()}`, sportKey: sel.key, sportName: sel.name, durationSec: elapsed,
        kcal: liveKcal, intensity: INTENSITIES[intIdx][0], ts: Date.now(),
      };
      pushActivity(a);
      setActivities(loadActivities());
    }
  }

  /* ---------- vista: tracker de un deporte ---------- */
  if (sel) {
    const Icon = sel.Icon;
    const detail = sel.speeds ? sel.speeds[intIdx] : EFFORT[intIdx];

    if (finished) {
      return (
        <div className="pt-4">
          <h1 className="t-display text-2xl text-ink">Actividad guardada</h1>
          <div className="glass neon-edge mt-6 flex flex-col items-center gap-3 p-8 text-center">
            <span className="text-neon glow flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]"><Icon className="h-8 w-8" /></span>
            <p className="t-title text-ink">{sel.name}</p>
            <div className="flex gap-6">
              <div><p className="stat text-3xl text-ink">{fmtClock(elapsed)}</p><p className="t-label text-muted">tiempo</p></div>
              <div><p className="stat text-3xl neon-text">{liveKcal}</p><p className="t-label text-muted">kcal</p></div>
            </div>
            <p className="t-body text-xs text-good">Guardado en tu actividad ✓</p>
            <div className="mt-1 flex gap-3">
              <button onClick={() => openSport(sel)} className="btn btn-tonal btn-sm">Otra vez</button>
              <button onClick={() => setSel(null)} className="btn btn-primary btn-sm">Hecho</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="pt-4">
        <button onClick={() => setSel(null)} className="t-label text-muted">← Deportes</button>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-neon glow flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]"><Icon className="h-6 w-6" /></span>
          <h1 className="t-display text-2xl text-ink">{sel.name}</h1>
        </div>
        <p className="t-body mt-2 text-xs text-muted">{weightNote}</p>

        {/* cronómetro en vivo + kcal */}
        <div className="glass neon-edge mt-4 flex flex-col items-center gap-2 p-6">
          <span className="stat text-6xl text-ink tabular-nums">{fmtClock(elapsed)}</span>
          <span className="stat text-2xl neon-text">{liveKcal} <span className="text-sm text-muted">kcal</span></span>
        </div>

        {/* intensidad */}
        <div className="mt-3">
          <div className="glass grid grid-cols-3 gap-1 rounded-2xl p-1">
            {INTENSITIES.map(([label], i) => (
              <button key={label} onClick={() => setIntIdx(i)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
                style={intIdx === i ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
                {label}
              </button>
            ))}
          </div>
          <p className="t-body mt-2 text-center text-xs text-muted">{INTENSITIES[intIdx][0]} · <span className="text-ink">{detail}</span></p>
        </div>

        {/* controles */}
        <div className="mt-4 flex gap-3">
          {!started ? (
            <button className="btn btn-primary flex-1" onClick={() => { setStarted(true); setRunning(true); }}>Iniciar</button>
          ) : running ? (
            <>
              <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>Pausar</button>
              <button className="btn btn-outline flex-1" onClick={stop}>Parar</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>Reanudar</button>
              <button className="btn btn-outline flex-1" onClick={stop}>Parar</button>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ---------- vista: lista + registro ---------- */
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Deportes</h1>
      <p className="t-body mt-1 text-muted">Elige tu actividad, cronométrala y cuenta kcal.</p>

      <div className="glass mt-3 flex items-center gap-2 p-3">
        <PulseIcon className="h-4 w-4 shrink-0 text-neon" />
        <p className="t-body text-xs text-muted">{weightNote}</p>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {SPORTS.map((s, i) => (
          <button key={s.key} onClick={() => openSport(s)} className="glass rise flex items-center gap-4 p-4 text-left" style={{ animationDelay: `${i * 35}ms` }}>
            <span className="text-neon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]"><s.Icon className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="t-title block text-lg text-ink">{s.name}</span>
              <span className="t-body text-xs text-muted">~{kcalOf(s.met, 1, weight, 30)} kcal / 30 min</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
          </button>
        ))}
      </div>

      {/* Registro de actividad */}
      <div className="mt-7">
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-muted">Tu actividad</p>
          {activities.length > 0 && (
            <button onClick={() => { localStorage.removeItem(KEY); setActivities([]); }} className="t-label text-muted">Borrar</button>
          )}
        </div>
        {activities.length === 0 ? (
          <div className="glass mt-2 p-4">
            <p className="t-body text-xs text-muted">Aún no has registrado ninguna actividad. Cronometra un deporte y aparecerá aquí.</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {activities.map((a) => {
              const Icon = SPORT_BY_KEY[a.sportKey]?.Icon ?? PulseIcon;
              return (
                <div key={a.id} className="glass flex items-center gap-3 p-3.5">
                  <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="t-label text-ink">{a.sportName} <span className="text-muted">· {a.intensity}</span></p>
                    <p className="t-body text-[11px] text-muted">{fmtDate(a.ts)}</p>
                  </div>
                  <div className="text-right">
                    <p className="stat text-ink">{fmtClock(a.durationSec)}</p>
                    <p className="t-body text-[11px] text-neon">{a.kcal} kcal</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
