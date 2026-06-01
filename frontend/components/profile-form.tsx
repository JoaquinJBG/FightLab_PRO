"use client";

import { useEffect, useState } from "react";
import { useProfile, useUpdateProfile } from "@/lib/hooks";

const genders: [string, string][] = [
  ["MALE", "Hombre"],
  ["FEMALE", "Mujer"],
  ["OTHER", "Otro"],
];
const stances: [string, string][] = [
  ["ORTHODOX", "Ortodoxo"],
  ["SOUTHPAW", "Zurdo"],
  ["SWITCH", "Switch"],
];
const units: [string, string][] = [
  ["METRIC", "Métrico (kg · cm)"],
  ["IMPERIAL", "Imperial (lb · in)"],
];

type Fields = {
  date_of_birth: string;
  gender: string;
  height_cm: string;
  dominant_stance: string;
  preferred_units: string;
};

export function ProfileForm({
  submitLabel,
  onSaved,
}: {
  submitLabel: string;
  onSaved: () => void;
}) {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<Fields>({
    date_of_birth: "",
    gender: "",
    height_cm: "",
    dominant_stance: "",
    preferred_units: "METRIC",
  });

  useEffect(() => {
    if (profile && !loaded) {
      setF({
        date_of_birth: profile.date_of_birth ?? "",
        gender: profile.gender ?? "",
        height_cm: profile.height_cm != null ? String(profile.height_cm) : "",
        dominant_stance: profile.dominant_stance ?? "",
        preferred_units: profile.preferred_units ?? "METRIC",
      });
      setLoaded(true);
    }
  }, [profile, loaded]);

  const set = (k: keyof Fields, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      date_of_birth: f.date_of_birth || null,
      gender: f.gender || null,
      height_cm: f.height_cm ? Number(f.height_cm) : null,
      dominant_stance: f.dominant_stance || null,
      preferred_units: f.preferred_units,
    };
    try {
      await update.mutateAsync(payload);
      onSaved();
    } catch {
      /* error abajo */
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Fecha de nacimiento</span>
        <input
          type="date"
          value={f.date_of_birth}
          onChange={(e) => set("date_of_birth", e.target.value)}
          className="field px-4 py-3 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Sexo</span>
        <select value={f.gender} onChange={(e) => set("gender", e.target.value)} className="field px-4 py-3 text-sm">
          <option value="">Selecciona…</option>
          {genders.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Altura (cm)</span>
        <input
          type="number"
          inputMode="numeric"
          step="1"
          value={f.height_cm}
          onChange={(e) => set("height_cm", e.target.value)}
          placeholder="0"
          className="field px-4 py-3 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Guardia (stance)</span>
        <select value={f.dominant_stance} onChange={(e) => set("dominant_stance", e.target.value)} className="field px-4 py-3 text-sm">
          <option value="">Selecciona…</option>
          {stances.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Unidades</span>
        <select value={f.preferred_units} onChange={(e) => set("preferred_units", e.target.value)} className="field px-4 py-3 text-sm">
          {units.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      {update.isError && <p className="text-xs text-bad">{(update.error as Error).message}</p>}
      {update.isSuccess && <p className="text-xs text-good">Guardado ✓</p>}
      <button type="submit" disabled={update.isPending} className="btn btn-primary mt-2 disabled:opacity-60">
        {update.isPending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
