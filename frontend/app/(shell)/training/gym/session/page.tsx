"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TrainingIcon, InfoIcon } from "@/components/icons";
import {
  LIBRARY,
  FOCUS_EXERCISES,
  GYM_LIVE_KEY,
  GYM_REST_KEY,
  exerciseStats,
  pushGymSession,
  type ExerciseEntry,
  type LiveGym,
} from "@/lib/gym";
import { enqueueActivity } from "@/lib/activities";

const RPE_INFO =
  "RPE = Esfuerzo Percibido de TODA la sesión (1-10). Con él calculamos tu carga (min × RPE).";

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function beep(freq: number, dur: number, gain = 0.3) {
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
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
    o.onended = () => ctx.close();
  } catch { /* sin audio */ }
}

const REST_OPTS = [60, 90, 120];

function SessionInner() {
  const router = useRouter();
  const focusParam = useSearchParams().get("focus");

  const [focus, setFocus] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [phase, setPhase] = useState<"live" | "summary">("live");
  const [rpe, setRpe] = useState<number | null>(null);
  const [rpeInfo, setRpeInfo] = useState(false);

  // descanso entre series
  const [restDur, setRestDur] = useState(90);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const restDone = useRef(false);

  // búsqueda de ejercicios
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  /* ---------- arranque: reanudar sesión viva o empezar nueva ---------- */
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(GYM_LIVE_KEY);
      if (raw) {
        const live: LiveGym = JSON.parse(raw);
        if (live && Array.isArray(live.exercises) && Date.now() - live.savedAt < 12 * 3600_000) {
          setFocus(live.focus);
          setExercises(live.exercises);
          setStartedAt(live.startedAt);
          restored = true;
        }
      }
      const rd = Number(localStorage.getItem(GYM_REST_KEY));
      if (REST_OPTS.includes(rd)) setRestDur(rd);
    } catch { /* sesión corrupta */ }

    if (!restored) {
      const f = focusParam && FOCUS_EXERCISES[focusParam] ? focusParam : null;
      setFocus(f);
      setExercises(
        (f ? FOCUS_EXERCISES[f] : []).map((name) => ({
          name,
          sets: [{ kg: "", reps: "", done: false }],
        })),
      );
      setStartedAt(Date.now());
    }
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- reloj de sesión (wall-clock) ---------- */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  /* ---------- persistencia de la sesión viva ---------- */
  useEffect(() => {
    if (phase !== "live" || startedAt === null) return;
    try {
      localStorage.setItem(
        GYM_LIVE_KEY,
        JSON.stringify({ startedAt, focus, exercises, savedAt: Date.now() } satisfies LiveGym),
      );
    } catch { /* sin espacio */ }
  }, [exercises, focus, startedAt, phase]);

  /* ---------- wake lock ---------- */
  useEffect(() => {
    if (phase !== "live") return;
    let lock: { release?: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { if (cancelled) l.release?.(); else lock = l; }).catch(() => {});
    return () => { cancelled = true; lock?.release?.().catch(() => {}); };
  }, [phase]);

  /* ---------- descanso ---------- */
  const restLeft = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : null;
  useEffect(() => {
    if (restUntil === null) return;
    if (restLeft !== null && restLeft <= 0 && !restDone.current) {
      restDone.current = true;
      beep(880, 0.15);
      setTimeout(() => beep(880, 0.2), 180);
      try { navigator.vibrate?.([150, 80, 150]); } catch { /* noop */ }
      setRestUntil(null);
    }
  }, [restLeft, restUntil]);

  function startRest() {
    restDone.current = false;
    setRestUntil(Date.now() + restDur * 1000);
  }
  function changeRest(v: number) {
    setRestDur(v);
    try { localStorage.setItem(GYM_REST_KEY, String(v)); } catch { /* noop */ }
  }

  /* ---------- edición de ejercicios/series ---------- */
  function updateSet(ei: number, si: number, field: "kg" | "reps", value: string) {
    setExercises((xs) =>
      xs.map((x, i) =>
        i !== ei ? x : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, [field]: value.replace(/[^\d.,]/g, "").slice(0, 6) })) },
      ),
    );
  }
  function toggleDone(ei: number, si: number) {
    // se decide ANTES del setState (updater puro: seguro en StrictMode y con clics rápidos)
    const willStart = !exercises[ei]?.sets[si]?.done;
    setExercises((xs) =>
      xs.map((x, i) =>
        i !== ei
          ? x
          : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, done: !s.done })) },
      ),
    );
    if (willStart) startRest(); // al COMPLETAR una serie arranca el descanso
  }
  function addSet(ei: number) {
    setExercises((xs) =>
      xs.map((x, i) => {
        if (i !== ei) return x;
        const prev = x.sets[x.sets.length - 1];
        return { ...x, sets: [...x.sets, { kg: prev?.kg ?? "", reps: prev?.reps ?? "", done: false }] };
      }),
    );
  }
  function removeExercise(ei: number) {
    setExercises((xs) => xs.filter((_, i) => i !== ei));
  }
  function addExercise(name: string) {
    setExercises((xs) =>
      xs.some((x) => x.name === name) ? xs : [...xs, { name, sets: [{ kg: "", reps: "", done: false }] }],
    );
    setAdding(false);
    setQ("");
  }

  /* ---------- terminar y guardar ---------- */
  const parsedExercises = exercises
    .map((x) => ({
      name: x.name,
      sets: x.sets
        .map((s) => ({ kg: parseFloat(s.kg.replace(",", ".")), reps: parseInt(s.reps, 10) }))
        .filter((s) => Number.isFinite(s.kg) && Number.isFinite(s.reps) && s.reps > 0),
    }))
    .filter((x) => x.sets.length > 0);
  const totalSets = parsedExercises.reduce((a, x) => a + x.sets.length, 0);
  const volume = Math.round(parsedExercises.reduce((a, x) => a + x.sets.reduce((b, s) => b + s.kg * s.reps, 0), 0));

  function save() {
    // tope de 4 h: una sesión restaurada horas después no debe inflar la carga
    const capped = Math.min(elapsed, 4 * 3600);
    const minutes = capped / 60;
    const ts = Date.now();
    const clientId = crypto.randomUUID();
    pushGymSession({
      id: `${ts}`,
      client_id: clientId,
      ts,
      focus,
      durationSec: capped,
      rpe,
      load: rpe ? Math.round(minutes * rpe) : null,
      volume,
      exercises: parsedExercises,
    });
    let detail: Record<string, unknown> = { focus, volume_kg: volume, exercises: parsedExercises };
    try {
      // tope del backend: si el desglose no cabe, se queda el resumen
      if (JSON.stringify(detail).length > 8000) detail = { focus, volume_kg: volume };
    } catch { detail = { focus }; }
    enqueueActivity({
      client_id: clientId,
      kind: "GYM",
      title: focus ?? "Gimnasio",
      started_at: new Date(ts - capped * 1000).toISOString(),
      duration_sec: Math.max(1, Math.round(capped)),
      rpe,
      detail,
    });
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push("/training/gym");
  }
  function discard() {
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push("/training/gym");
  }

  const results = q.trim().length > 0
    ? LIBRARY.flatMap((g) => g.items.filter((i) => i.toLowerCase().includes(q.toLowerCase())).map((i) => ({ group: g.group, name: i })))
    : LIBRARY.flatMap((g) => g.items.map((i) => ({ group: g.group, name: i })));

  /* ============================ RESUMEN ============================ */
  if (phase === "summary") {
    return (
      <div className="pt-4">
        <h1 className="t-display text-2xl text-ink">¿Cómo ha ido?</h1>
        <div className="glass neon-edge mt-4 p-5">
          <p className="t-title text-ink">{focus ? `Entreno · ${focus}` : "Entreno de gimnasio"}</p>
          <div className="mt-3 flex justify-between text-center">
            <div><p className="stat text-xl text-ink">{fmtClock(elapsed)}</p><p className="t-label text-muted">duración</p></div>
            <div><p className="stat text-xl text-ink">{totalSets}</p><p className="t-label text-muted">series</p></div>
            <div><p className="stat text-xl neon-text">{volume.toLocaleString("es")}</p><p className="t-label text-muted">kg totales</p></div>
          </div>
          {parsedExercises.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-3">
              {parsedExercises.map((x) => (
                <li key={x.name} className="t-body flex justify-between text-xs text-muted">
                  <span>{x.name}</span>
                  <span className="text-ink">{x.sets.length} series</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass mt-4 p-4">
          <div className="flex items-center gap-1.5">
            <p className="t-label text-ink">Esfuerzo de la sesión (RPE)</p>
            <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label="Qué es RPE"
              className={rpeInfo ? "text-neon" : "text-muted hover:text-neon"}>
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          {rpeInfo && <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{RPE_INFO}</p>}
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
              Carga: <span className="text-neon">{Math.round((elapsed / 60) * rpe)} AU</span> (min × RPE)
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <button onClick={() => setPhase("live")} className="btn btn-outline flex-1">Volver</button>
          <button onClick={save} disabled={totalSets === 0} className="btn btn-primary flex-1 disabled:opacity-60">Guardar</button>
        </div>
        {totalSets === 0 && <p className="t-body mt-2 text-center text-[11px] text-muted">Completa al menos una serie con kg y reps para guardar.</p>}
        <button onClick={discard} className="t-label mt-3 w-full text-center text-muted">Descartar entreno</button>
      </div>
    );
  }

  /* ============================ EN VIVO ============================ */
  return (
    <div className="pt-4 pb-24">
      <div className="flex items-center justify-between">
        <Link href="/training/gym" className="t-label text-muted">← Gimnasio</Link>
        <span className="stat text-lg text-neon tabular-nums">{fmtClock(elapsed)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{focus ? `Entreno · ${focus}` : "Entreno"}</h1>
      </div>

      {/* descanso entre series */}
      <div className="glass mt-3 flex items-center justify-between p-3">
        <span className="t-label text-muted">Descanso entre series</span>
        <div className="flex gap-1.5">
          {REST_OPTS.map((v) => (
            <button key={v} type="button" onClick={() => changeRest(v)} className={`badge ${restDur === v ? "badge-neon" : ""}`}>
              {v}s
            </button>
          ))}
        </div>
      </div>

      {/* ejercicios */}
      <div className="mt-4 flex flex-col gap-3">
        {exercises.map((x, ei) => {
          const stats = exerciseStats(x.name);
          return (
            <div key={x.name} className="glass p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="t-title text-ink">{x.name}</p>
                  <p className="t-body text-[11px] text-muted">
                    {stats.last ? `Última vez: ${stats.last}` : "Primera vez — a estrenar"}
                    {stats.prKg !== null ? ` · PR ${stats.prKg} kg` : ""}
                  </p>
                </div>
                <button onClick={() => removeExercise(ei)} aria-label="Quitar ejercicio" className="t-label shrink-0 px-1 text-muted hover:text-bad">✕</button>
              </div>

              <div className="mt-3 grid grid-cols-[2rem_1fr_1fr_2.5rem] items-center gap-2 px-1">
                <span className="t-label text-muted">#</span>
                <span className="t-label text-muted">kg</span>
                <span className="t-label text-muted">reps</span>
                <span />
                {x.sets.map((s, si) => (
                  <SetRow key={si} index={si} set={s}
                    onKg={(v) => updateSet(ei, si, "kg", v)}
                    onReps={(v) => updateSet(ei, si, "reps", v)}
                    onDone={() => toggleDone(ei, si)} />
                ))}
              </div>
              <button onClick={() => addSet(ei)} className="btn btn-tonal btn-sm mt-3 w-full">+ Serie</button>
            </div>
          );
        })}
      </div>

      {/* añadir ejercicio */}
      <div className="mt-4">
        {adding ? (
          <div className="glass p-4">
            <div className="flex items-center justify-between">
              <p className="t-label text-ink">Añadir ejercicio</p>
              <button onClick={() => { setAdding(false); setQ(""); }} className="t-label text-muted">Cerrar ✕</button>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: press, remo, sentadilla…" autoFocus
              className="field mt-2 w-full px-4 py-3 text-sm" />
            <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {results.map((r) => (
                <button key={r.name} onClick={() => addExercise(r.name)} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[rgba(255,255,255,0.05)]">
                  <span className="t-body text-sm text-ink">{r.name}</span>
                  <span className="t-body text-[11px] text-muted">{r.group}</span>
                </button>
              ))}
              {results.length === 0 && <p className="t-body py-3 text-center text-xs text-muted">Sin resultados.</p>}
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn btn-tonal w-full">+ Añadir ejercicio</button>
        )}
      </div>

      <button onClick={() => setPhase("summary")} className="btn btn-primary mt-4 w-full">Terminar entreno</button>

      {/* chip flotante de descanso */}
      {restLeft !== null && restLeft > 0 && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <div className="glass glow flex items-center gap-3 rounded-full px-4 py-2.5">
            <span className="t-label text-muted">Descanso</span>
            <span className="stat text-xl neon-text tabular-nums">{restLeft}s</span>
            <button
              onClick={() => {
                restDone.current = false;
                setRestUntil((u) => (u !== null ? u + 30_000 : Date.now() + 30_000));
              }}
              className="badge"
            >
              +30s
            </button>
            <button onClick={() => setRestUntil(null)} className="badge">Saltar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SetRow({ index, set, onKg, onReps, onDone }: {
  index: number;
  set: { kg: string; reps: string; done: boolean };
  onKg: (v: string) => void;
  onReps: (v: string) => void;
  onDone: () => void;
}) {
  return (
    <>
      <span className="t-body text-sm text-muted">{index + 1}</span>
      <input value={set.kg} onChange={(e) => onKg(e.target.value)} inputMode="decimal" placeholder="—"
        className={`field px-2 py-2 text-center text-sm ${set.done ? "opacity-60" : ""}`} />
      <input value={set.reps} onChange={(e) => onReps(e.target.value)} inputMode="numeric" placeholder="—"
        className={`field px-2 py-2 text-center text-sm ${set.done ? "opacity-60" : ""}`} />
      <button type="button" onClick={onDone} aria-label="Serie hecha"
        className="flex h-9 w-9 items-center justify-center rounded-full border text-sm transition-colors"
        style={set.done
          ? { background: "#43e8a0", borderColor: "transparent", color: "#03101c" }
          : { borderColor: "rgba(150,190,255,0.25)", color: "var(--color-muted)" }}>
        ✓
      </button>
    </>
  );
}

export default function GymSessionPage() {
  return (
    <Suspense fallback={<div className="pt-6 text-center"><p className="t-body text-muted">Cargando…</p></div>}>
      <SessionInner />
    </Suspense>
  );
}
