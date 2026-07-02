"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUpdateProfile } from "@/lib/hooks";
import { GloveIcon, PulseIcon, NutritionIcon, ChevronRight } from "@/components/icons";
import { DobInput, validateDob, dobToIso, type Dob } from "@/components/dob-input";

/* ----------------------------- opciones ---------------------------------- */

const GENDERS: [string, string][] = [
  ["MALE", "Hombre"],
  ["FEMALE", "Mujer"],
  ["OTHER", "Otro"],
];
const STANCES: [string, string][] = [
  ["ORTHODOX", "Ortodoxo"],
  ["SOUTHPAW", "Zurdo"],
  ["SWITCH", "Switch"],
];
const UNITS: [string, string][] = [
  ["METRIC", "Métrico (kg · cm)"],
  ["IMPERIAL", "Imperial (lb · in)"],
];
const DISCIPLINES = ["Boxeo", "Kickboxing", "Muay Thai", "BJJ", "Lucha", "Taekwondo", "Karate", "MMA"];
const EXPERIENCE: [string, string][] = [
  ["beginner", "Empiezo ahora"],
  ["intermediate", "Llevo un tiempo"],
  ["advanced", "Competido / avanzado"],
];
const GOALS: [string, string][] = [
  ["perform", "Rendir / competir"],
  ["lose", "Perder peso"],
  ["muscle", "Ganar músculo"],
  ["fit", "Mantenerme en forma"],
];
const FREQS: [number, string][] = [
  [2, "2 días"],
  [3, "3 días"],
  [4, "4 días"],
  [5, "5 días"],
  [6, "6+ días"],
];

const TOTAL_STEPS = 3; // pasos con formulario (el 0 es bienvenida)

/* ----------------------------- página ------------------------------------ */

export default function OnboardingPage() {
  const router = useRouter();
  const update = useUpdateProfile();

  const [step, setStep] = useState(0);

  // Paso 1 · físico (obligatorio: la base de tus métricas)
  const [dob, setDob] = useState<Dob>({ day: "", month: "", year: "" });
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);

  // Paso 2 · combate (skippable)
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [stance, setStance] = useState("");
  const [experience, setExperience] = useState("");

  // Paso 3 · objetivo (skippable)
  const [goal, setGoal] = useState("");
  const [freq, setFreq] = useState<number | null>(null);
  const [units, setUnits] = useState("METRIC");

  const selectCls = "field px-3 py-3 text-sm";

  function toggleDiscipline(d: string) {
    setDisciplines((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  }

  function next() {
    setStepError(null);
    if (step === 1) {
      const dobErr = validateDob(dob);
      if (dobErr) {
        setStepError(dobErr);
        return;
      }
      const h = Number(height);
      if (!height || !Number.isFinite(h) || h < 100 || h > 230) {
        setStepError("Introduce una altura válida en cm (100–230).");
        return;
      }
    }
    setStep((s) => s + 1);
  }

  async function finish() {
    if (update.isPending) return; // evita doble submit
    setStepError(null);
    try {
      await update.mutateAsync({
        date_of_birth: dobToIso(dob),
        gender: gender || null,
        height_cm: Number(height),
        dominant_stance: stance || null,
        preferred_units: units,
      });
      // Campos aún sin columna en el backend (llegan en la fase 2):
      // se guardan en local para personalizar copy/planes desde ya.
      try {
        localStorage.setItem(
          "flp_profile_extra",
          JSON.stringify({ disciplines, experience, goal, freq }),
        );
      } catch {
        /* sin localStorage no pasa nada: son opcionales */
      }
      router.replace("/dashboard");
    } catch {
      setStepError("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
    }
  }

  /* --------------------------- paso 0: bienvenida -------------------------- */
  if (step === 0) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
        <div className="glass glow mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
          <span className="font-display text-2xl font-bold neon-text">FL</span>
        </div>
        <h1 className="t-display text-3xl text-ink">
          Bienvenido a <span className="neon-text">FightLab</span>
        </h1>
        <p className="t-body mt-2 text-muted">Tu esquina, dentro y fuera del gym.</p>

        <ul className="mt-6 flex flex-col gap-4">
          <li className="flex items-start gap-3">
            <span className="text-neon mt-0.5"><PulseIcon className="h-5 w-5" /></span>
            <p className="t-body text-sm text-ink">
              <span className="font-medium">Sabrás cómo venir a entrenar</span>
              <span className="text-muted"> — tu estado diario con tus propias métricas de recuperación.</span>
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-neon mt-0.5"><GloveIcon className="h-5 w-5" /></span>
            <p className="t-body text-sm text-ink">
              <span className="font-medium">Entreno de combate de verdad</span>
              <span className="text-muted"> — MMA, gym y deportes con carga de entrenamiento y timer de rounds.</span>
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-neon mt-0.5"><NutritionIcon className="h-5 w-5" /></span>
            <p className="t-body text-sm text-ink">
              <span className="font-medium">Nutrición y peso bajo control</span>
              <span className="text-muted"> — macros a tu medida y el pesaje siempre a la vista.</span>
            </p>
          </li>
        </ul>

        <button onClick={() => setStep(1)} className="btn btn-primary mt-8 w-full">
          Configura tu perfil — 2 min <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  /* --------------------------- pasos 1-3: wizard --------------------------- */
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 safe-top safe-bottom">
      {/* progreso */}
      <div className="pt-6">
        <div className="flex items-center justify-between">
          <p className="t-label text-muted">Paso {step} de {TOTAL_STEPS}</p>
          {step > 1 && (
            <button onClick={() => setStep((s) => s - 1)} className="t-label text-muted">← Atrás</button>
          )}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[rgba(150,190,255,0.12)]">
          <div
            className="h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6">
        {step === 1 && (
          <>
            <h1 className="t-display text-2xl text-ink">Lo básico <span className="neon-text">sobre ti</span></h1>
            <p className="t-body mt-1 text-xs text-muted">
              Con esto calculamos tus zonas, tu gasto calórico y tus objetivos. Solo lo ves tú.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Fecha de nacimiento</span>
                <DobInput value={dob} onChange={setDob} />
                <p className="t-body text-[11px] text-muted">Tu edad ajusta las zonas de frecuencia cardíaca.</p>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Altura (cm)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="175"
                  className="field px-4 py-3 text-sm"
                />
                <p className="t-body text-[11px] text-muted">Con tu peso, calcula tus calorías y macros.</p>
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Sexo <span className="text-[10px]">(opcional)</span></span>
                <div className="flex gap-2">
                  {GENDERS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setGender(gender === v ? "" : v)}
                      className={`badge flex-1 justify-center py-2 ${gender === v ? "badge-neon" : ""}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="t-body text-[11px] text-muted">Afina el cálculo de tu metabolismo basal.</p>
              </div>
            </div>

            {stepError && <p className="mt-3 text-xs text-bad">{stepError}</p>}
            <button onClick={next} className="btn btn-primary mt-6 w-full">Continuar</button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="t-display text-2xl text-ink">Tu <span className="neon-text">combate</span></h1>
            <p className="t-body mt-1 text-xs text-muted">
              Personaliza tus entrenos y el análisis técnico. Puedes saltarlo y completarlo después.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">¿Qué practicas? <span className="text-[10px]">(elige las que quieras)</span></span>
                <div className="flex flex-wrap gap-2">
                  {DISCIPLINES.map((d) => (
                    <button key={d} type="button" onClick={() => toggleDiscipline(d)}
                      className={`badge ${disciplines.includes(d) ? "badge-neon" : ""}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Guardia</span>
                <div className="flex gap-2">
                  {STANCES.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setStance(stance === v ? "" : v)}
                      className={`badge flex-1 justify-center py-2 ${stance === v ? "badge-neon" : ""}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="t-body text-[11px] text-muted">Tu guardia personaliza el análisis técnico.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Experiencia</span>
                <div className="flex gap-2">
                  {EXPERIENCE.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setExperience(experience === v ? "" : v)}
                      className={`badge flex-1 justify-center py-2 text-center ${experience === v ? "badge-neon" : ""}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="t-body text-[11px] text-muted">Ajusta el volumen y las progresiones de tus planes.</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => setStep(3)} className="t-label px-2 text-muted">Saltar</button>
              <button onClick={next} className="btn btn-primary flex-1">Continuar</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="t-display text-2xl text-ink">Tu <span className="neon-text">objetivo</span></h1>
            <p className="t-body mt-1 text-xs text-muted">
              Marca el rumbo de tus planes y tu nutrición. También puedes saltarlo.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">¿Qué buscas ahora mismo?</span>
                <div className="grid grid-cols-2 gap-2">
                  {GOALS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setGoal(goal === v ? "" : v)}
                      className={`badge justify-center py-2.5 ${goal === v ? "badge-neon" : ""}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="t-label text-muted">¿Cuántos días entrenas por semana?</span>
                <div className="flex gap-2">
                  {FREQS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setFreq(freq === v ? null : v)}
                      className={`badge flex-1 justify-center py-2 ${freq === v ? "badge-neon" : ""}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="t-label text-muted">Unidades</span>
                <select value={units} onChange={(e) => setUnits(e.target.value)} className={selectCls}>
                  {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>

            {stepError && <p className="mt-3 text-xs text-bad">{stepError}</p>}
            <div className="mt-6 flex items-center gap-3">
              <button onClick={finish} disabled={update.isPending} className="t-label px-2 text-muted disabled:opacity-50">
                Saltar
              </button>
              <button onClick={finish} disabled={update.isPending} className="btn btn-primary flex-1 disabled:opacity-60">
                {update.isPending ? "Guardando…" : "Empezar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
