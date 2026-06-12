"use client";

import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import { deleteServerActivities, enqueueActivity } from "@/lib/activities";
import {
  RunIcon, WalkIcon, BikeIcon, SwimIcon, BallIcon, RopeIcon, PulseIcon, ChevronRight, InfoIcon,
} from "@/components/icons";

const RPE_INFO =
  "RPE = Esfuerzo Percibido (escala 1-10): cómo de duro ha sido. 1 = muy suave, 10 = máximo esfuerzo (no podías más).";

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
  Math.round(((met * factor * 3.5 * weight) / 200) * minutes);
// kcal por SEGUNDO al factor actual: cambiar la intensidad solo afecta hacia delante
const kcalPerSec = (met: number, factor: number, weight: number) =>
  ((met * factor * 3.5 * weight) / 200) / 60;

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/* ---- registro de actividad (localStorage + sync al backend) ---- */
type Activity = {
  id: string;
  client_id?: string; // misma identidad en el dispositivo y en el servidor
  sportKey: string;
  sportName: string;
  durationSec: number;
  kcal: number;
  intensity: string;
  rpe: number | null;
  load: number | null; // sRPE: minutos × RPE (AU)
  ts: number;
};
const KEY = "flp_activities";
const LIVE_KEY = "flp_live_session";

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

type LiveSession = { sportKey: string; elapsed: number; kcal: number; intIdx: number; savedAt: number };

export default function SportsPage() {
  const { data: logs = [] } = useBiometrics();
  const latestWeight = (() => {
    for (const l of logs) { const w = l.weight_kg ? parseFloat(l.weight_kg) : null; if (w && Number.isFinite(w)) return w; }
    return null;
  })();
  const weight = latestWeight ?? 70;
  const weightNote = "Kcal estimadas según tu peso.";

  const [view, setView] = useState<"deporte" | "actividad">("deporte");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [resume, setResume] = useState<LiveSession | null>(null);

  useEffect(() => {
    setActivities(loadActivities());
    try {
      const raw = localStorage.getItem(LIVE_KEY);
      if (raw) {
        const s: LiveSession = JSON.parse(raw);
        // recuperable durante 12 h; más allá se descarta en silencio
        if (s && SPORT_BY_KEY[s.sportKey] && Date.now() - s.savedAt < 12 * 3600_000 && s.elapsed > 0) {
          setResume(s);
        } else {
          localStorage.removeItem(LIVE_KEY);
        }
      }
    } catch { /* sesión corrupta: se ignora */ }
  }, []);

  /* ---------------- estado del tracker ---------------- */
  const [sel, setSel] = useState<Sport | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "live" | "summary">("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [kcalAcc, setKcalAcc] = useState(0);
  const [running, setRunning] = useState(false);
  const [intIdx, setIntIdx] = useState(1);
  const [rpe, setRpe] = useState<number | null>(null);
  const [rpeInfo, setRpeInfo] = useState(false);
  const [holdPct, setHoldPct] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRequested = useRef(false);
  const elapsedRef = useRef(0);

  // Tick con wall-clock (el setInterval se throttlea en background en móvil):
  // el tiempo sale de Date.now() y las kcal acumulan por delta al ritmo de la
  // intensidad ACTUAL (por tramos: cambiarla solo afecta hacia delante).
  useEffect(() => {
    if (!running || !sel) return;
    const rate = kcalPerSec(sel.met, INTENSITIES[intIdx][1], weight);
    const baseElapsed = elapsedRef.current;
    const startTime = Date.now();
    const id = setInterval(() => {
      const total = baseElapsed + Math.floor((Date.now() - startTime) / 1000);
      const delta = total - elapsedRef.current;
      if (delta > 0) {
        elapsedRef.current = total;
        setElapsed(total);
        setKcalAcc((k) => k + rate * delta);
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sel, intIdx, weight]);

  // persistir la sesión en vivo (recuperable si se cierra la app)
  useEffect(() => {
    if (phase !== "live" || !sel) return;
    try {
      localStorage.setItem(
        LIVE_KEY,
        JSON.stringify({ sportKey: sel.key, elapsed, kcal: kcalAcc, intIdx, savedAt: Date.now() } satisfies LiveSession),
      );
    } catch { /* sin espacio: no es crítico */ }
  }, [phase, sel, elapsed, kcalAcc, intIdx]);

  // wake lock mientras corre el cronómetro
  useEffect(() => {
    if (!running) return;
    let lock: { release?: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { if (cancelled) l.release?.(); else lock = l; }).catch(() => {});
    return () => { cancelled = true; lock?.release?.().catch(() => {}); };
  }, [running]);

  // cuenta atrás 3-2-1 (sin frame en 0: del 1 pasa directo a live)
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 1) {
      const id = setTimeout(() => {
        setPhase("live");
        setRunning(true);
      }, 800);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(id);
  }, [phase, count]);

  function openSport(s: Sport) {
    if (resume) discardLive(); // el usuario ignora el banner: descarta la pendiente
    setSel(s); setPhase("idle"); setElapsed(0); setKcalAcc(0); setRunning(false); setIntIdx(1); setRpe(null);
    elapsedRef.current = 0;
  }
  function start() {
    setCount(3);
    setPhase("countdown");
  }
  function stop() {
    setRunning(false);
    setHoldPct(0);
    setPhase("summary");
  }
  function resumeSession(s: LiveSession) {
    const sport = SPORT_BY_KEY[s.sportKey];
    if (!sport) return;
    setSel(sport); setElapsed(s.elapsed); setKcalAcc(s.kcal); setIntIdx(s.intIdx);
    elapsedRef.current = s.elapsed;
    setPhase("live"); setRunning(false); setRpe(null);
    setResume(null);
  }
  function discardLive() {
    localStorage.removeItem(LIVE_KEY);
    setResume(null);
  }
  function save() {
    if (!sel || elapsed === 0) return; // nada de sesiones vacías
    const minutes = elapsed / 60;
    const ts = Date.now();
    const clientId = crypto.randomUUID();
    const a: Activity = {
      id: `${ts}`,
      client_id: clientId,
      sportKey: sel.key,
      sportName: sel.name,
      durationSec: elapsed,
      kcal: Math.round(kcalAcc),
      intensity: INTENSITIES[intIdx][0],
      rpe,
      load: rpe ? Math.round(minutes * rpe) : null,
      ts,
    };
    pushActivity(a);
    enqueueActivity({
      client_id: clientId,
      kind: "SPORT",
      title: sel.name,
      started_at: new Date(ts - elapsed * 1000).toISOString(),
      duration_sec: Math.min(86_400, Math.max(1, Math.round(elapsed))),
      rpe,
      kcal: Math.min(20_000, Math.max(0, Math.round(kcalAcc))),
      detail: { sport_key: sel.key, intensity: INTENSITIES[intIdx][0] },
    });
    localStorage.removeItem(LIVE_KEY);
    setActivities(loadActivities());
    setSel(null);
    setPhase("idle");
    setView("actividad"); // ver la sesión recién guardada en el registro
  }
  function discardSession() {
    localStorage.removeItem(LIVE_KEY);
    setSel(null);
    setPhase("idle");
  }

  // mantener pulsado para parar (evita paradas accidentales)
  function holdStart() {
    if (holdTimer.current) return;
    stopRequested.current = false;
    holdTimer.current = setInterval(() => {
      setHoldPct((p) => {
        const next = Math.min(100, p + 8); // ~800 ms hasta completar
        if (next >= 100) stopRequested.current = true; // marca síncrona: soltar ya no cancela
        return next;
      });
    }, 60);
  }
  function holdEnd() {
    if (stopRequested.current) return; // el hold se completó: el stop va a ejecutarse
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; }
    setHoldPct(0);
  }
  useEffect(() => {
    if (holdPct >= 100 && stopRequested.current) {
      stopRequested.current = false;
      if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; }
      stop();
    }
  }, [holdPct]);
  useEffect(() => () => { if (holdTimer.current) clearInterval(holdTimer.current); }, []);

  /* ---------------- vistas del tracker ---------------- */
  if (sel) {
    const Icon = sel.Icon;
    const detail = sel.speeds ? sel.speeds[intIdx] : EFFORT[intIdx];

    /* resumen + RPE antes de guardar */
    if (phase === "summary") {
      const minutes = elapsed / 60;
      return (
        <div className="pt-4">
          <h1 className="t-display text-2xl text-ink">¿Cómo ha ido?</h1>
          <div className="glass neon-edge mt-4 flex flex-col items-center gap-3 p-6 text-center">
            <span className="text-neon glow flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <Icon className="h-7 w-7" />
            </span>
            <p className="t-title text-ink">{sel.name}</p>
            <div className="flex gap-8">
              <div><p className="stat text-3xl text-ink">{fmtClock(elapsed)}</p><p className="t-label text-muted">tiempo</p></div>
              <div><p className="stat text-3xl neon-text">{Math.round(kcalAcc)}</p><p className="t-label text-muted">kcal</p></div>
            </div>
          </div>

          <div className="glass mt-4 p-4">
            <div className="flex items-center gap-1.5">
              <p className="t-label text-ink">Esfuerzo percibido (RPE)</p>
              <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label="Qué es RPE"
                className={rpeInfo ? "text-neon" : "text-muted hover:text-neon"}>
                <InfoIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {rpeInfo && (
              <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">
                {RPE_INFO}
              </p>
            )}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setRpe(rpe === n ? null : n)}
                  className="rounded-xl py-2 text-sm font-medium transition-colors"
                  style={rpe === n
                    ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                    : { background: "rgba(255,255,255,0.05)", color: "var(--color-muted)" }}>
                  {n}
                </button>
              ))}
            </div>
            {rpe && (
              <p className="t-body mt-2.5 text-center text-xs text-muted">
                Carga de la sesión: <span className="text-neon">{Math.round(minutes * rpe)} AU</span> (min × RPE)
              </p>
            )}
          </div>

          <div className="mt-4 flex gap-3">
            <button onClick={discardSession} className="btn btn-outline flex-1">Descartar</button>
            <button onClick={save} disabled={elapsed === 0} className="btn btn-primary flex-1 disabled:opacity-60">Guardar</button>
          </div>
          {!rpe && (
            <p className="t-body mt-2 text-center text-[11px] text-muted">
              Puedes guardar sin RPE, pero con él calculamos tu carga.
            </p>
          )}
        </div>
      );
    }

    /* countdown + en vivo */
    return (
      <div className="pt-4">
        {phase === "idle" ? (
          <button onClick={() => setSel(null)} className="t-label text-muted">← Deportes</button>
        ) : (
          <span className="t-label text-muted">Sesión en curso</span>
        )}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-neon glow flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
            <Icon className="h-6 w-6" />
          </span>
          <h1 className="t-display text-2xl text-ink">{sel.name}</h1>
        </div>
        <p className="t-body mt-2 text-xs text-muted">{weightNote}</p>

        <div className="glass neon-edge mt-4 flex flex-col items-center gap-2 p-6">
          {phase === "countdown" ? (
            <span className="stat neon-text text-7xl tabular-nums">{count}</span>
          ) : (
            <>
              <span className="stat text-6xl text-ink tabular-nums">{fmtClock(elapsed)}</span>
              <span className="stat text-2xl neon-text">{Math.round(kcalAcc)} <span className="text-sm text-muted">kcal</span></span>
            </>
          )}
        </div>

        <div className="mt-3">
          <div className="glass grid grid-cols-3 gap-1 rounded-2xl p-1">
            {INTENSITIES.map(([label], i) => (
              <button key={label} onClick={() => setIntIdx(i)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
                style={intIdx === i
                  ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                  : { background: "transparent", color: "var(--color-muted)" }}>
                {label}
              </button>
            ))}
          </div>
          <p className="t-body mt-2 text-center text-xs text-muted">
            {INTENSITIES[intIdx][0]} · <span className="text-ink">{detail}</span>
          </p>
        </div>

        <div className="mt-4 flex gap-3">
          {phase === "idle" && (
            <button className="btn btn-primary flex-1" onClick={start}>Iniciar</button>
          )}
          {phase === "countdown" && (
            <button className="btn btn-outline flex-1" onClick={() => setPhase("idle")}>Cancelar</button>
          )}
          {phase === "live" && (
            <>
              {running ? (
                <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>Pausar</button>
              ) : (
                <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>Reanudar</button>
              )}
              <button
                className="btn btn-outline relative flex-1 touch-none select-none overflow-hidden"
                onPointerDown={holdStart}
                onPointerUp={holdEnd}
                onPointerLeave={holdEnd}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${holdPct}%`, background: "rgba(255,93,128,0.25)" }}
                />
                <span className="relative">Mantén para parar</span>
              </button>
            </>
          )}
        </div>
        {phase === "live" && (
          <p className="t-body mt-2 text-center text-[11px] text-muted">
            La pantalla no se apagará durante la sesión. Si cierras la app, podrás retomarla.
          </p>
        )}
      </div>
    );
  }

  /* ---------------- lista + registro ---------------- */
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Deportes</h1>
      <p className="t-body mt-1 text-muted">Elige tu actividad, cronométrala y cuenta kcal.</p>

      {/* sesión sin terminar (recuperación) */}
      {resume && (
        <div className="glass neon-edge mt-3 flex items-center gap-3 p-4">
          <span className="text-warn"><PulseIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="t-label text-ink">Sesión sin terminar</p>
            <p className="t-body text-xs text-muted">
              {SPORT_BY_KEY[resume.sportKey]?.name} · {fmtClock(resume.elapsed)} · {Math.round(resume.kcal)} kcal
            </p>
          </div>
          <button onClick={() => resumeSession(resume)} className="btn btn-tonal btn-sm shrink-0">Reanudar</button>
          <button onClick={discardLive} aria-label="Descartar sesión" className="t-label shrink-0 text-muted">✕</button>
        </div>
      )}

      <div className="glass mt-3 grid grid-cols-2 gap-1 rounded-2xl p-1">
        {([["deporte", "Deporte"], ["actividad", "Actividad"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={view === k ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {view === "deporte" ? (
        <>
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
        </>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="t-eyebrow text-muted">Tu actividad</p>
            {activities.length > 0 && (
              <button onClick={() => { localStorage.removeItem(KEY); setActivities([]); void deleteServerActivities("SPORT"); }} className="t-label text-muted">Borrar</button>
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
                      <p className="t-body text-[11px] text-muted">
                        {fmtDate(a.ts)}{a.rpe ? ` · RPE ${a.rpe}` : ""}{a.load ? ` · ${a.load} AU` : ""}
                      </p>
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
      )}
    </div>
  );
}
