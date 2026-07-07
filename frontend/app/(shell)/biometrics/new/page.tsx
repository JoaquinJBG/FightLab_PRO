"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateBiometrics } from "@/lib/hooks";
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

// Perímetros con cinta métrica (decimales en cm)
const girths = [
  { key: "waist_cm", label: "Cintura" },
  { key: "hip_cm", label: "Cadera" },
  { key: "chest_cm", label: "Pecho" },
  { key: "arm_cm", label: "Brazo" },
  { key: "thigh_cm", label: "Muslo" },
  { key: "neck_cm", label: "Cuello" },
] as const;

export default function NewBiometricsPage() {
  const router = useRouter();
  const create = useCreateBiometrics();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showAdv, setShowAdv] = useState(false);
  const [showGirths, setShowGirths] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload: Record<string, unknown> = {};
    if (vals.weight_kg) payload.weight_kg = vals.weight_kg; // decimal -> string
    for (const f of advanced) {
      const v = vals[f.key];
      if (v !== undefined && v !== "") payload[f.key] = f.decimal ? v : Number(v);
    }
    for (const g of girths) {
      const v = vals[g.key];
      if (v !== undefined && v !== "") payload[g.key] = v; // decimal -> string
    }
    if (Object.keys(payload).length === 0) {
      setFormError("Introduce al menos una medida.");
      return;
    }
    try {
      await create.mutateAsync(payload);
      router.push("/biometrics"); // a ver el punto nuevo en tu tendencia
    } catch {
      /* error abajo */
    }
  }

  const err = formError || (create.error as Error)?.message;

  return (
    <div className="pt-4">
      <Link href="/biometrics" className="t-label text-muted">← Biometría</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">
        Nueva <span className="neon-text">medición</span>
      </h1>
      <p className="t-body mt-1 text-muted">Con el peso basta. El resto es opcional.</p>

      <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Típica */}
        <div className="flex flex-col gap-2">
          <span className="t-eyebrow text-muted">Medida típica</span>
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

        {/* Perímetros (plegable) */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowGirths((v) => !v)}
            className="flex items-center justify-between rounded-xl px-1 py-1 text-left"
          >
            <span className="t-eyebrow text-muted">Perímetros (cinta métrica) · opcional</span>
            <ChevronDown
              className={`h-4 w-4 text-muted transition-transform ${showGirths ? "rotate-180" : ""}`}
            />
          </button>

          {showGirths && (
            <div className="grid grid-cols-2 gap-2">
              {girths.map((g) => (
                <label key={g.key} className="glass flex items-center justify-between gap-2 p-3">
                  <span className="t-label text-ink">{g.label}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.5"
                      inputMode="decimal"
                      value={vals[g.key] ?? ""}
                      onChange={(e) => set(g.key, e.target.value)}
                      placeholder="—"
                      className="field w-16 px-2 py-1.5 text-right text-sm"
                    />
                    <span className="t-label text-muted">cm</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {showGirths && (
            <p className="t-body text-[11px] text-muted">
              La cintura es el más útil para ver progreso que la báscula no enseña.
            </p>
          )}
        </div>

        {err && <p className="text-xs text-bad">{err}</p>}
        <button type="submit" disabled={create.isPending} className="btn btn-primary mt-1 disabled:opacity-60">
          {create.isPending ? "Guardando…" : "Guardar"}
        </button>
      </form>
    </div>
  );
}
