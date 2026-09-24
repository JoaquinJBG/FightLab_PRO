"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrainingIcon, CoachIcon, ChevronRight } from "@/components/icons";
import { GYM_LIVE_KEY, loadGymSessions, type GymSession, type LiveGym } from "@/lib/gym";
import { useUserState } from "@/lib/user-state";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FOCI = ["Descanso", "Full body", "Empuje", "Tirón", "Pierna", "Torso", "Pecho", "Espalda", "Hombro", "Brazo", "Cardio"];

const DEFAULT_WEEK = Array(7).fill("Descanso");

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? "Hoy"
    : d.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export default function GymPage() {
  const [view, setView] = useState<"cal" | "ia">("cal");
  const { value: week, setValue: setWeek } = useUserState<string[]>("gym_week", DEFAULT_WEEK);
  const [live, setLive] = useState<LiveGym | null>(null);
  const [recent, setRecent] = useState<GymSession[]>([]);

  useEffect(() => {
    try {
      const liveRaw = localStorage.getItem(GYM_LIVE_KEY);
      if (liveRaw) {
        const l: LiveGym = JSON.parse(liveRaw);
        // Lectura síncrona de localStorage tras montar. Pre-existente.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (l && Date.now() - l.savedAt < 12 * 3600_000) setLive(l);
        else localStorage.removeItem(GYM_LIVE_KEY);
      }
      setRecent(loadGymSessions().slice(0, 3));
    } catch { /* noop */ }
  }, []);

  const todayIdx = (new Date().getDay() + 6) % 7;
  const todayFocus = week[todayIdx];
  const startHref =
    todayFocus && todayFocus !== "Descanso" && todayFocus !== "Cardio"
      ? `/training/gym/session?focus=${encodeURIComponent(todayFocus)}`
      : "/training/gym/session";
  function setDay(i: number, v: string) {
    const n = [...week];
    n[i] = v;
    setWeek(n);
  }

  const selectCls = "field px-3 py-2.5 text-sm";

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Gimnasio</h1>
      </div>

      {/* sesión sin terminar */}
      {live && (
        <div className="glass neon-edge mt-4 flex items-center gap-3 p-4">
          <span className="text-warn"><TrainingIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="t-label text-ink">Entreno sin terminar</p>
            <p className="t-body text-xs text-muted">
              {live.focus ? `${live.focus} · ` : ""}{live.exercises.length} ejercicios
            </p>
          </div>
          <Link href="/training/gym/session" className="btn btn-tonal btn-sm shrink-0">Reanudar</Link>
          <button onClick={() => { localStorage.removeItem(GYM_LIVE_KEY); setLive(null); }} aria-label="Descartar" className="t-label shrink-0 text-muted">✕</button>
        </div>
      )}

      {/* empezar entreno */}
      {!live && (
        <Link href={startHref} className="btn btn-primary mt-4 w-full">
          ▶ Empezar entreno{todayFocus && todayFocus !== "Descanso" ? ` · ${todayFocus}` : ""}
        </Link>
      )}

      {/* toggle */}
      <div className="glass mt-4 grid grid-cols-2 gap-1 rounded-2xl p-1">
        {([["cal", "Calendario"], ["ia", "Crear rutina"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={view === k ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {view === "cal" ? (
        <div className="mt-4">
          <p className="t-eyebrow text-muted">Tu semana</p>
          <div className="mt-2 flex flex-col gap-2">
            {DAYS.map((d, i) => {
              const rest = week[i] === "Descanso";
              return (
                <div key={d} className="glass flex items-center gap-3 p-3">
                  <span className={`stat w-10 text-sm ${rest ? "text-muted" : "text-neon"}`}>{d}</span>
                  <select value={week[i]} onChange={(e) => setDay(i, e.target.value)} className={`${selectCls} flex-1`}>
                    {FOCI.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="t-body mt-3 text-xs text-muted">Apunta qué toca cada día. Se guarda solo en tu dispositivo (luego, en tu cuenta).</p>

          {/* últimos entrenos */}
          {recent.length > 0 && (
            <div className="mt-5">
              <p className="t-eyebrow text-muted">Últimos entrenos</p>
              <div className="mt-2 flex flex-col gap-2">
                {recent.map((s) => (
                  <div key={s.id} className="glass flex items-center gap-3 p-3.5">
                    <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]">
                      <TrainingIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-label text-ink">{s.focus ?? "Entreno"} <span className="text-muted">· {fmtDate(s.ts)}</span></p>
                      <p className="t-body text-[11px] text-muted">
                        {s.exercises.length} ejercicios · {s.exercises.reduce((a, x) => a + x.sets.length, 0)} series · {s.volume.toLocaleString("es")} kg
                        {s.load ? ` · ${s.load} AU` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="t-eyebrow text-muted">Crear rutina</p>
            <span className="badge">Próximamente</span>
          </div>
          {/* Beta honesta: aquí antes había un generador simulado (setTimeout +
              rutina hardcodeada) que se podía aplicar al calendario como si
              fuera real. Hasta que haya una IA real generando rutinas, se
              deshabilita en vez de fingir un resultado. */}
          <div className="glass neon-edge mt-3 flex flex-col items-center gap-3 p-6 text-center">
            <span className="text-neon glow flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <CoachIcon className="h-7 w-7" />
            </span>
            <p className="t-title text-ink">Generar rutina con IA</p>
            <p className="t-body text-sm text-muted">
              Todavía no está disponible. De momento, monta tu semana a mano en el calendario.
            </p>
            <button className="btn btn-primary mt-1 w-full" disabled aria-disabled="true">
              <CoachIcon className="h-4 w-4" /> Generar rutina con IA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
