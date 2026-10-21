"use client";

import { useState } from "react";
import { useCreateBiometrics } from "@/lib/hooks";

export function parseWeightKg(raw: string): number | null {
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
}

/** Pide un dato que falta (peso) en vez de calcular con un valor inventado. */
export function WeightPrompt({ what, missing }: { what: string; missing?: string }) {
  const create = useCreateBiometrics();
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const kg = parseWeightKg(val);
    if (kg == null) {
      setErr("Introduce un peso válido en kg (30–300).");
      return;
    }
    setErr(null);
    try {
      await create.mutateAsync({ weight_kg: kg.toFixed(1) });
      setVal("");
    } catch {
      setErr("No se pudo guardar. Inténtalo de nuevo.");
    }
  }

  return (
    <form onSubmit={save} className="glass mt-4 p-4">
      <p className="t-label text-ink">Pon tu peso para calcular {what}</p>
      {missing && <p className="t-body mt-1 text-xs text-muted">{missing}</p>}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Peso (kg)"
          aria-label="Peso en kg"
          className="field flex-1 px-3.5 py-2.5 text-sm"
        />
        <button type="submit" disabled={create.isPending} className="btn btn-primary btn-sm shrink-0 disabled:opacity-60">
          {create.isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </form>
  );
}
