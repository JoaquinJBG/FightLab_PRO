"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateBiometrics } from "@/lib/hooks";

const fields = [
  { key: "weight_kg", label: "Peso (kg)", step: "0.1", unit: "kg" },
  { key: "body_fat_pct", label: "% Grasa", step: "0.1", unit: "%" },
  { key: "resting_heart_rate", label: "FC reposo", step: "1", unit: "bpm" },
  { key: "sleep_quality_score", label: "Sueño (1-10)", step: "1", unit: "/10" },
  { key: "hrv_ms", label: "HRV", step: "1", unit: "ms" },
] as const;

export default function NewBiometricsPage() {
  const router = useRouter();
  const create = useCreateBiometrics();
  const [vals, setVals] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const v = vals[f.key];
      if (v !== undefined && v !== "") {
        payload[f.key] =
          f.key === "weight_kg" || f.key === "body_fat_pct" ? v : Number(v);
      }
    }
    try {
      await create.mutateAsync(payload);
      router.push("/dashboard");
    } catch {
      /* el error se muestra abajo vía create.isError */
    }
  }

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">
        Nueva <span className="neon-text">medición</span>
      </h1>
      <p className="t-body mt-1 text-muted">Rellena solo lo que quieras registrar hoy.</p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
        {fields.map((f) => (
          <label key={f.key} className="glass flex items-center justify-between gap-3 p-3.5">
            <span className="t-label text-ink">{f.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                step={f.step}
                inputMode="decimal"
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                className="field w-24 px-3 py-2 text-right text-sm"
              />
              <span className="t-label w-8 text-muted">{f.unit}</span>
            </span>
          </label>
        ))}
        {create.isError && (
          <p className="text-xs text-bad">{(create.error as Error).message}</p>
        )}
        <button type="submit" disabled={create.isPending} className="btn btn-primary mt-2 disabled:opacity-60">
          {create.isPending ? "Guardando…" : "Guardar medición"}
        </button>
      </form>
    </div>
  );
}
