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
const unitOpts: [string, string][] = [
  ["METRIC", "Métrico (kg · cm)"],
  ["IMPERIAL", "Imperial (lb · in)"],
];

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1940 + 1 }, (_, i) => String(THIS_YEAR - i));

type Fields = {
  dob_y: string;
  dob_m: string;
  dob_d: string;
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
    dob_y: "",
    dob_m: "",
    dob_d: "",
    gender: "",
    height_cm: "",
    dominant_stance: "",
    preferred_units: "METRIC",
  });

  useEffect(() => {
    if (profile && !loaded) {
      const [y = "", m = "", d = ""] = (profile.date_of_birth ?? "").split("-");
      setF({
        dob_y: y,
        dob_m: m,
        dob_d: d,
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
    const dob =
      f.dob_y && f.dob_m && f.dob_d ? `${f.dob_y}-${f.dob_m}-${f.dob_d}` : null;
    const payload: Record<string, unknown> = {
      date_of_birth: dob,
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

  const selectCls = "field appearance-none px-3 py-3 text-sm";

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      {/* Fecha de nacimiento: día / mes / año */}
      <div className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Fecha de nacimiento</span>
        <div className="grid grid-cols-3 gap-2">
          <select value={f.dob_d} onChange={(e) => set("dob_d", e.target.value)} className={selectCls} aria-label="Día">
            <option value="">Día</option>
            {DAYS.map((d) => <option key={d} value={d}>{Number(d)}</option>)}
          </select>
          <select value={f.dob_m} onChange={(e) => set("dob_m", e.target.value)} className={selectCls} aria-label="Mes">
            <option value="">Mes</option>
            {MONTHS.map((label, i) => (
              <option key={label} value={String(i + 1).padStart(2, "0")}>{label}</option>
            ))}
          </select>
          <select value={f.dob_y} onChange={(e) => set("dob_y", e.target.value)} className={selectCls} aria-label="Año">
            <option value="">Año</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Sexo</span>
        <select value={f.gender} onChange={(e) => set("gender", e.target.value)} className={selectCls}>
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
        <select value={f.dominant_stance} onChange={(e) => set("dominant_stance", e.target.value)} className={selectCls}>
          <option value="">Selecciona…</option>
          {stances.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">Unidades</span>
        <select value={f.preferred_units} onChange={(e) => set("preferred_units", e.target.value)} className={selectCls}>
          {unitOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
