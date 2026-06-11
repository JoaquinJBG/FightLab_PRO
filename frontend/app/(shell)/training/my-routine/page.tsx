"use client";

import { useState } from "react";
import Link from "next/link";
import { TrainingIcon, GloveIcon, MoonIcon, ChevronRight } from "@/components/icons";

const COACH = { name: "Carlos Méndez", role: "Tu entrenador", updated: "hace 2 días" };

type Day = { day: string; type: "gym" | "mma" | "rest"; focus: string; items: string[] };
const PLAN: Day[] = [
  { day: "Lunes", type: "gym", focus: "Empuje", items: ["Press banca 4×8", "Press militar 3×10", "Fondos 3×12", "Extensión tríceps 3×15"] },
  { day: "Martes", type: "mma", focus: "Boxeo · Técnica", items: ["Calentamiento 10'", "Sombra 3×3'", "Saco técnico 5×3'", "Estiramientos"] },
  { day: "Miércoles", type: "gym", focus: "Tirón", items: ["Dominadas 4×8", "Remo con barra 4×10", "Curl bíceps 3×12", "Face pull 3×15"] },
  { day: "Jueves", type: "mma", focus: "Muay Thai · Intensidad", items: ["Calentamiento", "Manoplas 5×3'", "Clinch 4×2'", "Acondicionamiento"] },
  { day: "Viernes", type: "gym", focus: "Pierna", items: ["Sentadilla 5×5", "Peso muerto rumano 4×8", "Prensa 3×12", "Gemelos 4×15"] },
  { day: "Sábado", type: "mma", focus: "Sparring", items: ["Calentamiento", "Sparring 5×3'", "Vuelta a la calma"] },
  { day: "Domingo", type: "rest", focus: "Descanso", items: ["Movilidad y descanso activo"] },
];

const ICONS = { gym: TrainingIcon, mma: GloveIcon, rest: MoonIcon } as const;
const TYPE_LABEL = { gym: "Gimnasio", mma: "MMA", rest: "Descanso" } as const;

export default function MyRoutinePage() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const trainingDays = PLAN.filter((d) => d.type !== "rest").length;

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Mi rutina</h1>

      {/* Coach */}
      <div className="glass neon-edge mt-4 flex items-center gap-3 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full glass font-display text-neon">
          {COACH.name.split(" ").map((p) => p[0]).join("")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-title text-ink">{COACH.name}</p>
          <p className="t-body text-xs text-muted">{COACH.role} · actualizada {COACH.updated}</p>
        </div>
        <span className="badge badge-neon">{trainingDays} días</span>
      </div>

      {/* Días */}
      <div className="mt-4 flex flex-col gap-2.5">
        {PLAN.map((d, i) => {
          const Icon = ICONS[d.type];
          const isDone = done.has(i);
          const rest = d.type === "rest";
          return (
            <div key={d.day} className={`glass p-4 ${isDone ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${rest ? "text-muted bg-[rgba(150,190,255,0.06)]" : "text-neon bg-[rgba(69,233,255,0.07)]"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="t-title text-ink">{d.day}</p>
                  <p className="t-body text-xs text-muted">
                    <span className={rest ? "" : "text-neon"}>{TYPE_LABEL[d.type]}</span> · {d.focus}
                  </p>
                </div>
                {!rest && (
                  <button onClick={() => toggle(i)} aria-label="Marcar como hecho"
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors ${isDone ? "border-transparent bg-good text-[#03101c]" : "border-[rgba(150,190,255,0.25)] text-muted"}`}>
                    ✓
                  </button>
                )}
              </div>
              {!rest && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-3">
                  {d.items.map((it) => (
                    <li key={it} className="t-body flex items-center gap-2 text-sm text-muted">
                      <ChevronRight className="h-3 w-3 shrink-0 text-neon" /> {it}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="t-body mt-4 text-center text-xs text-muted">
        Esta rutina la asigna y edita tu entrenador. El panel del coach llegará más adelante.
      </p>
    </div>
  );
}
