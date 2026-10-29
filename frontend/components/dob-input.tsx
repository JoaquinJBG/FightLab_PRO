"use client";

import { useRef } from "react";

export type Dob = { day: string; month: string; year: string };

/** Etiquetas y marcadores (por defecto en español; el onboarding pasa las de su idioma). */
export type DobLabels = { day: string; month: string; year: string; dd: string; mm: string; yyyy: string };
const DEFAULT_LABELS: DobLabels = { day: "Día", month: "Mes", year: "Año", dd: "DD", mm: "MM", yyyy: "AAAA" };

/**
 * Fecha de nacimiento como cajas DD / MM / AAAA con teclado numérico y
 * auto-avance (patrón fintech). Sin calendario nativo ni desplegables.
 */
export function DobInput({
  value,
  onChange,
  labels = DEFAULT_LABELS,
}: {
  value: Dob;
  onChange: (v: Dob) => void;
  labels?: DobLabels;
}) {
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
          placeholder={labels.dd}
          aria-label={labels.day}
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
          placeholder={labels.mm}
          aria-label={labels.month}
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
          placeholder={labels.yyyy}
          aria-label={labels.year}
          className={cls}
        />
      </div>
    </div>
  );
}

export type DobError = "incomplete" | "invalid" | "year" | "future";

/** Valida la fecha; devuelve el código del error o null si es válida. */
export function dobErrorCode(v: Dob): DobError | null {
  if (!v.day || !v.month || v.year.length !== 4) return "incomplete";
  const y = Number(v.year);
  const m = Number(v.month);
  const dd = Number(v.day);
  const d = new Date(y, m - 1, dd);
  const exists = d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === dd;
  if (!exists) return "invalid";
  if (y < 1900) return "year";
  if (d >= new Date()) return "future";
  return null;
}

const DOB_ERRORS_ES: Record<DobError, string> = {
  incomplete: "Completa la fecha (día, mes y año de 4 cifras).",
  invalid: "Esa fecha no existe. Comprueba el día y el mes.",
  year: "Revisa el año.",
  future: "La fecha de nacimiento no puede ser futura.",
};

/** Valida la fecha; devuelve mensaje de error (en español) o null si es válida. */
export function validateDob(v: Dob): string | null {
  const code = dobErrorCode(v);
  return code ? DOB_ERRORS_ES[code] : null;
}

/** Convierte a YYYY-MM-DD (formato de la API). Asume fecha ya validada. */
export function dobToIso(v: Dob): string {
  return `${v.year}-${v.month.padStart(2, "0")}-${v.day.padStart(2, "0")}`;
}
