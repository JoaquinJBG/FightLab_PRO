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
function beep(freq = 880, dur = 0.18) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
    o.onended = () => ctx.close();
  } catch {
    /* sin audio, sin drama */
  }
}

type Seg = { phase: "work" | "rest"; round: number };
function buildSegments(rounds: number, workSec: number, restSec: number) {
  const segs: { phase: "work" | "rest"; round: number; start: number; end: number }[] = [];
  let t = 0;
  for (let r = 1; r <= rounds; r++) {
    segs.push({ phase: "work", round: r, start: t, end: t + workSec });
    t += workSec;
    if (r < rounds && restSec > 0) {
      segs.push({ phase: "rest", round: r, start: t, end: t + restSec });
      t += restSec;
    }
  }
  return { segs, total: t };
}

/* ----------------------------- stepper ----------------------------------- */
function Stepper({
  label,
  value,
  set,
  min,
  max,
  step = 1,
  fmt = (n: number) => String(n),
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  fmt?: (n: number) => string;
}) {
  return (
    <div className="glass flex flex-col items-center gap-2 p-3">
      <span className="t-label text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => set(Math.max(min, value - step))}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-lg text-ink active:scale-95"
        >
          −
        </button>
        <span className="stat w-16 text-center text-xl text-ink">{fmt(value)}</span>
        <button
          type="button"
          onClick={() => set(Math.min(max, value + step))}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-lg text-ink active:scale-95"
        >
          +
        </button>
      </div>
    </div>
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
    <div className="flex flex-col items-center gap-6 pt-4">
      <div className="stat text-6xl neon-text tabular-nums">{fmtStopwatch(ms)}</div>
      <div className="flex w-full gap-3">
        {!running ? (
          <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>
            {ms === 0 ? "Iniciar" : "Reanudar"}
          </button>
        ) : (
          <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>
            Pausar
          </button>
        )}
        {running ? (
          <button className="btn btn-outline flex-1" onClick={() => setLaps((l) => [ms, ...l])}>
            Vuelta
          </button>
        ) : (
          <button
            className="btn btn-outline flex-1"
            onClick={() => {
              setRunning(false);
              setMs(0);
              setLaps([]);
            }}
          >
            Reset
          </button>
        )}
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

/* ----------------------------- rounds ------------------------------------ */
function RoundTimer() {
  const [rounds, setRounds] = useState(5);
  const [workSec, setWorkSec] = useState(180);
  const [restSec, setRestSec] = useState(60);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const prevSeg = useRef(-1);

  const { segs, total } = buildSegments(rounds, workSec, restSec);
  const done = elapsed >= total;
  const segIdx = done ? -1 : segs.findIndex((s) => elapsed >= s.start && elapsed < s.end);
  const current: Seg & { remaining: number } =
    segIdx >= 0
      ? { phase: segs[segIdx].phase, round: segs[segIdx].round, remaining: segs[segIdx].end - elapsed }
      : { phase: "work", round: rounds, remaining: 0 };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // beep en cambios de fase / fin
  useEffect(() => {
    if (!started) return;
    if (done) {
      if (prevSeg.current !== -2) {
        beep(440, 0.5);
        prevSeg.current = -2;
        setRunning(false);
      }
      return;
    }
    if (segIdx !== prevSeg.current) {
      if (prevSeg.current !== -1) beep(current.phase === "work" ? 980 : 620);
      prevSeg.current = segIdx;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segIdx, done, started]);

  function reset() {
    setRunning(false);
    setStarted(false);
    setElapsed(0);
    prevSeg.current = -1;
  }

  const isWork = current.phase === "work";

  if (!started) {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <div className="grid grid-cols-3 gap-3">
          <Stepper label="Rounds" value={rounds} set={setRounds} min={1} max={20} />
          <Stepper label="Trabajo" value={workSec} set={setWorkSec} min={10} max={600} step={10} fmt={fmtClock} />
          <Stepper label="Descanso" value={restSec} set={setRestSec} min={0} max={300} step={5} fmt={fmtClock} />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setStarted(true);
            setRunning(true);
            prevSeg.current = 0;
            beep(980);
          }}
        >
          Empezar {rounds} rounds
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 pt-2">
      <div
        className="glass neon-edge flex w-full flex-col items-center gap-2 p-6"
        style={{ boxShadow: done ? undefined : isWork ? "0 0 40px -10px rgba(69,233,255,0.5)" : "0 0 40px -10px rgba(255,210,90,0.4)" }}
      >
        <span className={`t-eyebrow ${done ? "text-good" : isWork ? "text-neon" : "text-warn"}`}>
          {done ? "Completado" : isWork ? "Trabajo" : "Descanso"}
        </span>
        <span className="stat text-6xl text-ink tabular-nums">
          {done ? "00:00" : fmtClock(current.remaining)}
        </span>
        <span className="t-label text-muted">
          {done ? `${rounds} rounds hechos` : `Round ${current.round} / ${rounds}`}
        </span>
      </div>

      <div className="flex w-full gap-3">
        {!done &&
          (!running ? (
            <button className="btn btn-primary flex-1" onClick={() => setRunning(true)}>Reanudar</button>
          ) : (
            <button className="btn btn-tonal flex-1" onClick={() => setRunning(false)}>Pausar</button>
          ))}
        <button className="btn btn-outline flex-1" onClick={reset}>
          {done ? "Nuevo" : "Reset"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- página ------------------------------------ */
export default function ToolsPage() {
  const [tab, setTab] = useState<"chrono" | "rounds">("rounds");

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Herramientas</h1>

      {/* selector */}
      <div className="glass mt-4 flex gap-1 p-1">
        {([["rounds", "Rounds"], ["chrono", "Cronómetro"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
              tab === k ? "btn-primary" : "text-muted"
            }`}
            style={tab === k ? {} : { background: "transparent" }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rounds" ? <RoundTimer /> : <Stopwatch />}
    </div>
  );
}
