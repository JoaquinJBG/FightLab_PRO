"use client";

import { useEffect, useState } from "react";
import { useProfile, useUpdateProfile } from "@/lib/hooks";
import { DobInput, validateDob, dobToIso, type Dob } from "./dob-input";

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
const unitOpts: [string, string][] = [
  ["METRIC", "Métrico (kg · cm)"],
  ["IMPERIAL", "Imperial (lb · in)"],
];

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
  const [dob, setDob] = useState<Dob>({ day: "", month: "", year: "" });
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [stance, setStance] = useState("");
  const [units, setUnits] = useState("METRIC");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !loaded) {
      const [y = "", m = "", d = ""] = (profile.date_of_birth ?? "").split("-");
      setDob({ day: d, month: m, year: y });
      setGender(profile.gender ?? "");
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : "");
      setStance(profile.dominant_stance ?? "");
      setUnits(profile.preferred_units ?? "METRIC");
      setLoaded(true);
    }
  }, [profile, loaded]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    setFormError(null);

    const dobEmpty = !dob.day && !dob.month && !dob.year;
    if (!dobEmpty) {
      const err = validateDob(dob);
      if (err) {
        setFormError(err);
        return;
      }
    }

    const payload: Record<string, unknown> = {
      date_of_birth: dobEmpty ? null : dobToIso(dob),
      gender: gender || null,
      height_cm: heightCm ? Number(heightCm) : null,
      dominant_stance: stance || null,
      preferred_units: units,
    };
    try {
      await update.mutateAsync(payload);
      onSaved();
    } catch {
      /* error mostrado abajo via update.isError */
    }
  }

  const selectCls = "field appearance-none px-3 py-3 text-sm";

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Fecha de nacimiento</span>
        <DobInput value={dob} onChange={setDob} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Sexo</span>
        <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectCls}>
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
          value={heightCm}
          onChange={(e) => setHeightCm(e.target.value)}
          placeholder="0"
          className="field px-4 py-3 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Guardia (stance)</span>
        <select value={stance} onChange={(e) => setStance(e.target.value)} className={selectCls}>
          <option value="">Selecciona…</option>
          {stances.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Unidades</span>
        <select value={units} onChange={(e) => setUnits(e.target.value)} className={selectCls}>
          {unitOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      {formError && <p className="text-xs text-bad">{formError}</p>}
      {update.isError && !formError && <p className="text-xs text-bad">{(update.error as Error).message}</p>}
      {update.isSuccess && <p className="text-xs text-good">Guardado ✓</p>}
      <button type="submit" disabled={update.isPending} className="btn btn-primary mt-2 disabled:opacity-60">
        {update.isPending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
