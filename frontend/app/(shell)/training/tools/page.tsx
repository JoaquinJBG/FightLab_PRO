"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ----------------------------- helpers ---------------------------------- */
function fmtStopwatch(ms: number) {
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m)}:${p(s)}.${p(cs)}`;
}
function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function beep(freq: number, dur: number, gain = 0.3) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = "sine";
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
    o.onended = () => ctx.close();
  } catch {
    /* sin audio */
  }
}
/** Campana de boxeo sintetizada: parciales inarmónicos para timbre metálico. */
function bell(strikes = 1, base = 520) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const ratios = [1, 2.01, 2.92, 4.16, 5.43];
    const dur = 1.1;
    for (let k = 0; k < strikes; k++) {
      const t = ctx.currentTime + k * 0.32;
      ratios.forEach((r, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = base * r;
        o.connect(g);
        g.connect(ctx.destination);
        const peak = 0.32 / (i + 1.2);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t);
        o.stop(t + dur);
      });
    }
    setTimeout(() => ctx.close(), (strikes * 0.32 + dur + 0.3) * 1000);
  } catch { /* sin audio */ }
}
/** "Clack" de aviso (tablas de madera, como en boxeo). */
function clack() {
  beep(1700, 0.05, 0.25);
  setTimeout(() => beep(1700, 0.05, 0.25), 110);
  setTimeout(() => beep(1700, 0.05, 0.25), 220);
}
const bellStart = () => bell(2);
const bellRest = () => bell(1, 392);
const prepDing = () => beep(720, 0.12);
const tick = () => beep(680, 0.07);
const finalBell = () => bell(3);
const vibe = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* noop */ } };

const CFG_KEY = "flp_round_cfg";
const WARN_OPTS: [number, string][] = [[0, "Off"], [10, "10 s"], [30, "30 s"]];

type Phase = "prep" | "work" | "rest";
function buildSegments(rounds: number, workSec: number, restSec: number, prepSec: number) {
  const segs: { phase: Phase; round: number; start: number; end: number }[] = [];
  let t = 0;
  if (prepSec > 0) { segs.push({ phase: "prep", round: 1, start: 0, end: prepSec }); t = prepSec; }
  for (let r = 1; r <= rounds; r++) {
    segs.push({ phase: "work", round: r, start: t, end: t + workSec });
    t += workSec;
    if (r < rounds && restSec > 0) { segs.push({ phase: "rest", round: r, start: t, end: t + restSec }); t += restSec; }
  }
  return { segs, total: t };
}

const PHASE_COLOR: Record<Phase | "done", string> = {
  prep: "#3b74ff",
  work: "#35e6ff",
  rest: "#ffd25a",
  done: "#43e8a0",
};
const PHASE_LABEL: Record<Phase, string> = { prep: "Prepárate", work: "Trabajo", rest: "Descanso" };

const PRESETS = [
  { name: "Boxeo", rounds: 3, work: 180, rest: 60 },
  { name: "MMA", rounds: 5, work: 300, rest: 60 },
  { name: "Tabata", rounds: 8, work: 20, rest: 10 },
  { name: "HIIT", rounds: 10, work: 30, rest: 15 },
];

/* ----------------------------- stepper ----------------------------------- */
function Stepper({ label, value, set, min, max, step = 1, fmt = (n: number) => String(n) }: {
  label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; fmt?: (n: number) => string;
}) {
  return (
    <div className="glass flex flex-col items-center gap-2 p-3">
      <span className="t-label text-muted">{label}</span>
      <div className="flex w-full items-center justify-between">
        <button type="button" onClick={() => set(Math.max(min, value - step))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
        <span className="stat text-xl text-ink">{fmt(value)}</span>
        <button type="button" onClick={() => set(Math.min(max, value + step))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
      </div>
    </div>
  );
}

/* ----------------------------- ring -------------------------------------- */
function Ring({ progress, color, children }: { progress: number; color: string; children: React.ReactNode }) {
  const r = 92;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center">
      <svg viewBox="0 0 200 200" className="h-64 w-64 -rotate-90">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(150,190,255,0.1)" strokeWidth="12" />
        <circle cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, progress)))}
          style={{ transition: "stroke-dashoffset 0.4s linear, stroke 0.3s", filter: `drop-shadow(0 0 10px ${color})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/* ----------------------------- rounds ------------------------------------ */
function RoundTimer() {
  const [rounds, setRounds] = useState(5);
  const [workSec, setWorkSec] = useState(180);
  const [restSec, setRestSec] = useState(60);
  const [prepSec, setPrepSec] = useState(10);
  const [warnSec, setWarnSec] = useState(10);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const prevSeg = useRef(-1);
  const doneRef = useRef(false);

  // recuerda tu última configuración
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem(CFG_KEY) ?? "null");
      if (cfg && typeof cfg === "object") {
        if (typeof cfg.rounds === "number") setRounds(Math.min(20, Math.max(1, cfg.rounds)));
        if (typeof cfg.work === "number") setWorkSec(Math.min(600, Math.max(10, cfg.work)));
        if (typeof cfg.rest === "number") setRestSec(Math.min(300, Math.max(0, cfg.rest)));
        if (typeof cfg.prep === "number") setPrepSec(Math.min(30, Math.max(0, cfg.prep)));
        if ([0, 10, 30].includes(cfg.warn)) setWarnSec(cfg.warn);
      }
    } catch { /* config corrupta: defaults */ }
  }, []);

  const { segs, total } = buildSegments(rounds, workSec, restSec, prepSec);
  const done = elapsed >= total;
  const segIdx = done ? segs.length - 1 : Math.max(0, segs.findIndex((s) => elapsed >= s.start && elapsed < s.end));
  const seg = segs[segIdx] ?? { phase: "work" as Phase, round: rounds, start: 0, end: workSec };
  const remaining = done ? 0 : seg.end - elapsed;
  const segDur = seg.end - seg.start;
  const progress = done ? 0 : remaining / segDur;
  const color = done ? PHASE_COLOR.done : PHASE_COLOR[seg.phase];

  // tick
  useEffect(() => {
    if (!running || !started) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running, started]);

  // wake lock
  useEffect(() => {
    if (!running) return;
    let lock: { release?: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { if (cancelled) l.release?.(); else lock = l; }).catch(() => {});
    return () => { cancelled = true; lock?.release?.().catch(() => {}); };
  }, [running]);

  // sonidos + vibración por transiciones
  useEffect(() => {
    if (!started) return;
    if (done) {
      if (!doneRef.current) { doneRef.current = true; finalBell(); vibe([200, 100, 200, 100, 300]); setRunning(false); }
      return;
    }
    if (segIdx !== prevSeg.current) {
      const ph = segs[segIdx].phase;
      if (ph === "work") { bellStart(); vibe([120, 60, 120]); }
      else if (ph === "rest") { bellRest(); vibe(200); }
      else { prepDing(); }
      prevSeg.current = segIdx;
    }
    if (seg.phase === "work" && warnSec > 0 && remaining === warnSec && segDur > warnSec) { clack(); vibe(80); }
    if (remaining <= 3 && remaining >= 1) tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, started, done]);

  function start() {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ rounds, work: workSec, rest: restSec, prep: prepSec, warn: warnSec }));
    } catch { /* sin espacio: no es crítico */ }
    doneRef.current = false;
    prevSeg.current = -1;
    setElapsed(0);
    setStarted(true);
    setRunning(true);
  }
  function reset() {
    setRunning(false);
    setStarted(false);
    setElapsed(0);
    prevSeg.current = -1;
    doneRef.current = false;
  }
  function skip() {
    if (!done) setElapsed(segs[segIdx].end);
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setRounds(p.rounds); setWorkSec(p.work); setRestSec(p.rest);
  }

  if (!started) {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <div>
          <span className="t-eyebrow text-muted">Presets</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => applyPreset(p)}
                className={`badge ${rounds === p.rounds && workSec === p.work && restSec === p.rest ? "badge-neon" : ""}`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Rounds" value={rounds} set={setRounds} min={1} max={20} />
          <Stepper label="Preparación" value={prepSec} set={setPrepSec} min={0} max={30} step={5} fmt={fmtClock} />
          <Stepper label="Trabajo" value={workSec} set={setWorkSec} min={10} max={600} step={10} fmt={fmtClock} />
          <Stepper label="Descanso" value={restSec} set={setRestSec} min={0} max={300} step={5} fmt={fmtClock} />
        </div>
        <div className="glass flex items-center justify-between p-3">
          <span className="t-label text-muted">Aviso de fin de round</span>
          <div className="flex gap-1.5">
            {WARN_OPTS.map(([v, label]) => (
              <button key={v} type="button" onClick={() => setWarnSec(v)}
                className={`badge ${warnSec === v ? "badge-neon" : ""}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={start}>Empezar · {rounds} rounds</button>
      </div>
    );
  }

  return (
    <>
      {/* tinte inmersivo de pantalla según fase */}
      <div className="pointer-events-none fixed inset-0 transition-colors duration-500"
        style={{ zIndex: -5, background: `radial-gradient(90% 60% at 50% 35%, ${color}22, transparent 70%)` }} />

      <div className="flex flex-col items-center gap-6 pt-2">
        <Ring progress={progress} color={color}>
          <div className="flex flex-col items-center">
            <span className="t-eyebrow" style={{ color }}>{done ? "Completado" : PHASE_LABEL[seg.phase]}</span>
            <span className="stat mt-1 text-5xl text-ink tabular-nums">{done ? "00:00" : fmtClock(remaining)}</span>
            <span className="t-label mt-1 text-muted">{done ? `${rounds} rounds ✓` : `Round ${seg.round} / ${rounds}`}</span>
          </div>
        </Ring>

        {/* dots de rounds */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {Array.from({ length: rounds }).map((_, i) => {
            const rn = i + 1;
            const state = done || rn < seg.round ? "done" : rn === seg.round && seg.phase !== "prep" ? "active" : "idle";
            return (
              <span key={rn}
                className="h-2.5 w-2.5 rounded-full transition-colors"
                style={{
                  background: state === "active" ? PHASE_COLOR.work : state === "done" ? PHASE_COLOR.done : "rgba(150,190,255,0.18)",
                  boxShadow: state === "active" ? `0 0 8px ${PHASE_COLOR.work}` : undefined,
                }} />
            );
          })}
        </div>

        <div className="flex w-full gap-3">
          {!done && (
            !running
              ? <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>Reanudar</button>
              : <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>Pausar</button>
          )}
          {!done && <button className="btn btn-outline flex-1" onClick={skip}>Saltar</button>}
          <button className="btn btn-outline flex-1" onClick={reset}>{done ? "Nuevo" : "Salir"}</button>
        </div>
      </div>
    </>
  );
}

/* ----------------------------- cronómetro -------------------------------- */
function Stopwatch() {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - ms;
    const id = setInterval(() => setMs(Date.now() - startRef.current), 31);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <div className="flex flex-col items-center gap-6 pt-6">
      <div className="stat text-6xl neon-text tabular-nums">{fmtStopwatch(ms)}</div>
      <div className="flex w-full gap-3">
        {!running
          ? <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>{ms === 0 ? "Iniciar" : "Reanudar"}</button>
          : <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>Pausar</button>}
        {running
          ? <button className="btn btn-outline flex-1" onClick={() => setLaps((l) => [ms, ...l])}>Vuelta</button>
          : <button className="btn btn-outline flex-1" onClick={() => { setMs(0); setLaps([]); }}>Reset</button>}
      </div>
      {laps.length > 0 && (
        <div className="w-full">
          {laps.map((l, i) => (
            <div key={i} className="flex justify-between border-b border-[rgba(150,190,255,0.08)] py-2 last:border-0">
              <span className="t-label text-muted">Vuelta {laps.length - i}</span>
              <span className="stat text-ink">{fmtStopwatch(l)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- página ------------------------------------ */
export default function ToolsPage() {
  const [tab, setTab] = useState<"rounds" | "chrono">("rounds");
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Herramientas</h1>

      <div className="glass mt-4 grid grid-cols-2 gap-1 rounded-2xl p-1">
        {([["rounds", "Rounds"], ["chrono", "Cronómetro"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={tab === k
              ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
              : { background: "transparent", color: "var(--color-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "rounds" ? <RoundTimer /> : <Stopwatch />}
    </div>
  );
}
