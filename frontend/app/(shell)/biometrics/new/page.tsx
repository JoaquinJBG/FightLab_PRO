"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateBiometrics, useProfile, useUpdateProfile } from "@/lib/hooks";
import { InfoIcon, ChevronDown } from "@/components/icons";

const advanced = [
  {
    key: "body_fat_pct",
    label: "% Grasa corporal",
    step: "0.1",
    unit: "%",
    decimal: true,
    info: "Porcentaje de tu peso que es grasa. Si no lo sabes, déjalo en blanco. Se mide con básculas de bioimpedancia o un plicómetro.",
  },
  {
    key: "resting_heart_rate",
    label: "FC en reposo",
    step: "1",
    unit: "bpm",
    decimal: false,
    info: "Pulsaciones por minuto en reposo total, mejor al despertar y tumbado. Cuanto más baja, normalmente mejor forma cardiovascular.",
  },
  {
    key: "hrv_ms",
    label: "HRV",
    step: "1",
    unit: "ms",
    decimal: false,
    info: "Variabilidad de la frecuencia cardíaca: cuánto varía el tiempo entre latidos. Más alta = mejor recuperación y menos estrés. La miden relojes y bandas (Garmin, Whoop, Oura).",
  },
] as const;

export default function NewBiometricsPage() {
  const router = useRouter();
  const { data: profile } = useProfile();
  const create = useCreateBiometrics();
  const updateProfile = useUpdateProfile();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showAdv, setShowAdv] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Precarga la altura actual del perfil (si no la has tocado).
  useEffect(() => {
    if (profile?.height_cm != null) {
      setVals((s) => ("height" in s ? s : { ...s, height: String(profile.height_cm) }));
    }
  }, [profile]);

  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const bio: Record<string, unknown> = {};
    if (vals.weight_kg) bio.weight_kg = vals.weight_kg; // decimal -> string
    for (const f of advanced) {
      const v = vals[f.key];
      if (v !== undefined && v !== "") bio[f.key] = f.decimal ? v : Number(v);
    }

    const tasks: Promise<unknown>[] = [];
    const h = vals.height ? Number(vals.height) : null;
    if (h && h > 0 && h !== profile?.height_cm) {
      tasks.push(updateProfile.mutateAsync({ height_cm: h }));
    }
    if (Object.keys(bio).length > 0) tasks.push(create.mutateAsync(bio));

    if (tasks.length === 0) {
      setFormError("Introduce al menos el peso o la altura.");
      return;
    }
    try {
      await Promise.all(tasks);
      router.push("/dashboard");
    } catch {
      /* el error se muestra abajo */
    }
  }

  const pending = create.isPending || updateProfile.isPending;
  const err = formError || (create.error as Error)?.message || (updateProfile.error as Error)?.message;

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">
        Nueva <span className="neon-text">medición</span>
      </h1>
      <p className="t-body mt-1 text-muted">Con el peso basta. El resto es opcional.</p>

      <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Típicas */}
        <div className="flex flex-col gap-2">
          <span className="t-eyebrow text-muted">Medidas típicas</span>
          <label className="glass neon-edge flex items-center justify-between gap-3 p-4">
            <span className="t-label text-ink">Peso</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                autoFocus
                value={vals.weight_kg ?? ""}
                onChange={(e) => set("weight_kg", e.target.value)}
                placeholder="0.0"
                className="field w-28 px-3 py-2.5 text-right text-lg"
              />
              <span className="t-label w-8 text-muted">kg</span>
            </span>
          </label>
          <label className="glass flex items-center justify-between gap-3 p-4">
            <span className="t-label text-ink">Altura</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                step="1"
                inputMode="numeric"
                value={vals.height ?? ""}
                onChange={(e) => set("height", e.target.value)}
                placeholder="0"
                className="field w-28 px-3 py-2.5 text-right text-lg"
              />
              <span className="t-label w-8 text-muted">cm</span>
            </span>
          </label>
        </div>

        {/* Avanzadas (plegable) */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAdv((v) => !v)}
            className="flex items-center justify-between rounded-xl px-1 py-1 text-left"
          >
            <span className="t-eyebrow text-muted">Medidas avanzadas · opcional</span>
            <ChevronDown
              className={`h-4 w-4 text-muted transition-transform ${showAdv ? "rotate-180" : ""}`}
            />
          </button>

          {showAdv &&
            advanced.map((f) => (
              <div key={f.key} className="glass p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-label flex items-center gap-1.5 text-ink">
                    {f.label}
                    <button
                      type="button"
                      aria-label={`Qué es ${f.label}`}
                      onClick={() => setOpenInfo((k) => (k === f.key ? null : f.key))}
                      className={`transition-colors ${openInfo === f.key ? "text-neon" : "text-muted hover:text-neon"}`}
                    >
                      <InfoIcon className="h-4 w-4" />
                    </button>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      step={f.step}
                      inputMode="decimal"
                      value={vals[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder="—"
                      className="field w-24 px-3 py-2 text-right text-sm"
                    />
                    <span className="t-label w-8 text-muted">{f.unit}</span>
                  </span>
                </div>
                {openInfo === f.key && (
                  <p className="t-body mt-2.5 border-t border-[rgba(150,190,255,0.12)] pt-2.5 text-xs text-[#cdd9ef]">
                    {f.info}
                  </p>
                )}
              </div>
            ))}
        </div>

        {err && <p className="text-xs text-bad">{err}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary mt-1 disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </form>
    </div>
  );
}
