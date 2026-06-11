"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrainingIcon, CoachIcon } from "@/components/icons";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FOCI = ["Descanso", "Full body", "Empuje", "Tirón", "Pierna", "Torso", "Pecho", "Espalda", "Hombro", "Brazo", "Cardio"];

const EXERCISES: Record<string, string[]> = {
  "Full body": ["Sentadilla", "Press banca", "Remo", "Press militar"],
  Empuje: ["Press banca", "Press militar", "Fondos", "Extensión tríceps"],
  Tirón: ["Dominadas", "Remo con barra", "Curl bíceps", "Face pull"],
  Pierna: ["Sentadilla", "Peso muerto rumano", "Prensa", "Gemelos"],
  Torso: ["Press banca", "Remo", "Press militar", "Dominadas"],
  Pecho: ["Press banca", "Press inclinado", "Aperturas", "Fondos"],
  Espalda: ["Dominadas", "Remo", "Jalón al pecho", "Peso muerto"],
  Hombro: ["Press militar", "Elevaciones laterales", "Pájaros", "Face pull"],
  Brazo: ["Curl bíceps", "Extensión tríceps", "Curl martillo", "Fondos"],
};
const SPLITS: Record<string, string[]> = {
  "Full body": ["Full body"],
  "Torso / Pierna": ["Torso", "Pierna"],
  "PPL (Empuje/Tirón/Pierna)": ["Empuje", "Tirón", "Pierna"],
  "Dividida (Weider)": ["Pecho", "Espalda", "Pierna", "Hombro", "Brazo"],
};
const REPS: Record<string, string> = {
  Fuerza: "4-6 reps · descansos largos",
  Hipertrofia: "8-12 reps",
  "Pérdida de grasa": "12-15 reps + cardio",
  Mantenimiento: "8-10 reps",
};

const WEEK_KEY = "flp_gym_week";
type RoutineDay = { day: number; focus: string; exercises: string[] };

export default function GymPage() {
  const [view, setView] = useState<"cal" | "ia">("cal");
  const [week, setWeek] = useState<string[]>(() => Array(7).fill("Descanso"));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WEEK_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length === 7) setWeek(arr); }
    } catch { /* noop */ }
  }, []);
  function setDay(i: number, v: string) {
    setWeek((w) => { const n = [...w]; n[i] = v; localStorage.setItem(WEEK_KEY, JSON.stringify(n)); return n; });
  }

  // wizard IA
  const [nivel, setNivel] = useState("Intermedio");
  const [dias, setDias] = useState(4);
  const [tipo, setTipo] = useState("PPL (Empuje/Tirón/Pierna)");
  const [objetivo, setObjetivo] = useState("Hipertrofia");
  const [generating, setGenerating] = useState(false);
  const [routine, setRoutine] = useState<RoutineDay[] | null>(null);

  function generate() {
    setGenerating(true);
    setRoutine(null);
    const seq = SPLITS[tipo];
    setTimeout(() => {
      const r: RoutineDay[] = Array.from({ length: dias }, (_, i) => {
        const focus = seq[i % seq.length];
        return { day: i + 1, focus, exercises: EXERCISES[focus] ?? [] };
      });
      setRoutine(r);
      setGenerating(false);
    }, 1000);
  }
  function applyToCalendar() {
    if (!routine) return;
    const n = Array(7).fill("Descanso");
    routine.forEach((d, i) => { if (i < 7) n[i] = d.focus; });
    setWeek(n);
    localStorage.setItem(WEEK_KEY, JSON.stringify(n));
    setView("cal");
  }

  const selectCls = "field px-3 py-2.5 text-sm";

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Gimnasio</h1>
      </div>

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
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="t-eyebrow text-muted">Crear rutina</p>
            <span className="badge badge-neon">IA simulada</span>
          </div>
          <p className="t-body mt-1 text-xs text-muted">Responde unas preguntas y la IA te arma la rutina.</p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="t-label text-muted">Nivel</span>
              <select value={nivel} onChange={(e) => setNivel(e.target.value)} className={selectCls}>
                {["Principiante", "Intermedio", "Avanzado"].map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="t-label text-muted">Días/semana</span>
              <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={selectCls}>
                {[2, 3, 4, 5, 6].map((o) => <option key={o} value={o}>{o} días</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1.5">
              <span className="t-label text-muted">Tipo de rutina</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}>
                {Object.keys(SPLITS).map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1.5">
              <span className="t-label text-muted">Objetivo</span>
              <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)} className={selectCls}>
                {Object.keys(REPS).map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          </div>

          <button className="btn btn-primary mt-4 w-full" onClick={generate} disabled={generating}>
            <CoachIcon className="h-4 w-4" /> {generating ? "Generando…" : "Generar rutina con IA"}
          </button>

          {generating && (
            <div className="glass mt-4 p-4"><span className="pulse t-body text-sm text-muted">La IA está diseñando tu rutina ({nivel}, {dias} días, {objetivo.toLowerCase()})…</span></div>
          )}

          {routine && (
            <div className="mt-4">
              <p className="t-eyebrow text-neon">Rutina propuesta · {REPS[objetivo]}</p>
              <div className="mt-2 flex flex-col gap-2">
                {routine.map((d) => (
                  <div key={d.day} className="glass p-3.5">
                    <p className="t-label text-ink">Día {d.day} · <span className="text-neon">{d.focus}</span></p>
                    <p className="t-body mt-1 text-xs text-muted">{d.exercises.join(" · ")}</p>
                  </div>
                ))}
              </div>
              <button className="btn btn-tonal mt-3 w-full" onClick={applyToCalendar}>Aplicar al calendario</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
