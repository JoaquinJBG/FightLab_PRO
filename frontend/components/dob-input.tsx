"use client";

import { useRef } from "react";

export type Dob = { day: string; month: string; year: string };

/**
 * Fecha de nacimiento como cajas DD / MM / AAAA con teclado numérico y
 * auto-avance (patrón fintech). Sin calendario nativo ni desplegables.
 */
export function DobInput({ value, onChange }: { value: Dob; onChange: (v: Dob) => void }) {
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  function set(field: keyof Dob, raw: string) {
    const max = field === "year" ? 4 : 2;
    const clean = raw.replace(/\D/g, "").slice(0, max);
    onChange({ ...value, [field]: clean });
    if (clean.length === max) {
      if (field === "day") monthRef.current?.focus();
      else if (field === "month") yearRef.current?.focus();
    }
  }

  function onKeyDown(field: keyof Dob, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && e.currentTarget.value === "") {
      if (field === "month") dayRef.current?.focus();
      else if (field === "year") monthRef.current?.focus();
    }
  }

  const cls = "field w-full px-0 py-3 text-center text-base tabular-nums";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <input
          ref={dayRef}
          value={value.day}
          onChange={(e) => set("day", e.target.value)}
          onKeyDown={(e) => onKeyDown("day", e)}
          inputMode="numeric"
          autoComplete="bday-day"
          placeholder="DD"
          aria-label="Día"
          className={cls}
        />
      </div>
      <span className="text-muted">/</span>
      <div className="flex-1">
        <input
          ref={monthRef}
          value={value.month}
          onChange={(e) => set("month", e.target.value)}
          onKeyDown={(e) => onKeyDown("month", e)}
          inputMode="numeric"
          autoComplete="bday-month"
          placeholder="MM"
          aria-label="Mes"
          className={cls}
        />
      </div>
      <span className="text-muted">/</span>
      <div className="flex-[1.4]">
        <input
          ref={yearRef}
          value={value.year}
          onChange={(e) => set("year", e.target.value)}
          onKeyDown={(e) => onKeyDown("year", e)}
          inputMode="numeric"
          autoComplete="bday-year"
          placeholder="AAAA"
          aria-label="Año"
          className={cls}
        />
      </div>
    </div>
  );
}

/** Valida la fecha; devuelve mensaje de error o null si es válida. */
export function validateDob(v: Dob): string | null {
  if (!v.day || !v.month || v.year.length !== 4) {
    return "Completa la fecha (día, mes y año de 4 cifras).";
  }
  const y = Number(v.year);
  const m = Number(v.month);
  const dd = Number(v.day);
  const d = new Date(y, m - 1, dd);
  const exists = d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === dd;
  if (!exists) return "Esa fecha no existe. Comprueba el día y el mes.";
  if (y < 1900) return "Revisa el año.";
  if (d >= new Date()) return "La fecha de nacimiento no puede ser futura.";
  return null;
}

/** Convierte a YYYY-MM-DD (formato de la API). Asume fecha ya validada. */
export function dobToIso(v: Dob): string {
  return `${v.year}-${v.month.padStart(2, "0")}-${v.day.padStart(2, "0")}`;
}
