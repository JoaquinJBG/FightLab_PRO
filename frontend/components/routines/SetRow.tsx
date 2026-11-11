"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { parseNumber, SET_TYPES, type PlannedSet, type SetType } from "@/lib/routines";

export type EffortMode = "rir" | "rpe";

type Bounds = { min: number; max: number; step?: number; integer?: boolean };

const BOUNDS: Record<"reps" | "reps_max" | "weight_kg" | "rir" | "rpe", Bounds> = {
  reps: { min: 0, max: 1000, integer: true },
  reps_max: { min: 0, max: 1000, integer: true },
  weight_kg: { min: 0, max: 1000 },
  rir: { min: 0, max: 10, step: 0.5 },
  rpe: { min: 1, max: 10, step: 0.5 },
};

export function inBounds(value: number, b: Bounds): boolean {
  if (value < b.min || value > b.max) return false;
  if (b.integer && !Number.isInteger(value)) return false;
  if (b.step && Math.abs(value / b.step - Math.round(value / b.step)) > 1e-9) return false;
  return true;
}

/** Campo numérico que acepta coma o punto. Lo que no es válido no se guarda: se marca en rojo
 * con el motivo y se queda el texto para corregirlo. */
function NumField({
  value,
  onCommit,
  bounds,
  label,
  testId,
  className,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  bounds: Bounds;
  label: string;
  testId: string;
  className?: string;
}) {
  const t = useTranslations("routines.editor");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : String(value));
  const commit = () => {
    if (text === null) return;
    const parsed = parseNumber(text);
    if (parsed === undefined) {
      setError(t("invalidNumber"));
      return;
    }
    if (parsed !== null && !inBounds(parsed, bounds)) {
      setError(t("outOfRange", { min: bounds.min, max: bounds.max }));
      return;
    }
    setError(null);
    setText(null);
    onCommit(parsed);
  };
  return (
    <input
      data-testid={testId}
      inputMode={bounds.integer ? "numeric" : "decimal"}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      className={`field w-full px-1 py-1.5 text-center text-sm ${error ? "!border-[var(--color-bad)]" : ""} ${className ?? ""}`}
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        setError(null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Abreviatura de cada tipo de serie, como en Hevy: C calentamiento, D drop, F fallo; las
 * normales van numeradas. */
export function setBadge(type: SetType, normalIndex: number, t: (k: string) => string): string {
  return type === "normal" ? String(normalIndex) : t(`setTypeShort.${type}`);
}

type Props = {
  set: PlannedSet;
  index: number;
  normalIndex: number;
  effort: EffortMode;
  exerciseName: string;
  onChange: (next: PlannedSet) => void;
  onRemove: () => void;
};

export function SetRow({ set, index, normalIndex, effort, exerciseName, onChange, onRemove }: Props) {
  const t = useTranslations("routines.editor");
  const n = index + 1;
  const typeColor =
    set.set_type === "warmup" ? "text-warn" : set.set_type === "drop" ? "text-neon" : set.set_type === "failure" ? "text-[var(--color-bad)]" : "text-ink";
  return (
    <div data-testid="set-row" data-set-type={set.set_type} className="grid grid-cols-[2.6rem_1fr_1fr_1.2fr_1fr_1.6rem] items-center gap-1">
      {/* La insignia (C, 1, 2, D, F) es lo que se ve; encima, el select invisible que la cambia. */}
      <label className="relative block h-9">
        <span
          className={`field t-title pointer-events-none absolute inset-0 flex items-center justify-center text-sm ${typeColor}`}
          aria-hidden
        >
          {setBadge(set.set_type, normalIndex, t)}
        </span>
        <select
          data-testid="set-type"
          aria-label={t("setTypeFor", { n, name: exerciseName })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={set.set_type}
          onChange={(e) => onChange({ ...set, set_type: e.target.value as SetType })}
        >
          {SET_TYPES.map((st) => (
            <option key={st} value={st} className="text-ink">
              {t(`setType.${st}`)}
            </option>
          ))}
        </select>
      </label>
      <NumField
        testId="set-reps"
        label={t("repsFor", { n, name: exerciseName })}
        value={set.reps}
        bounds={BOUNDS.reps}
        onCommit={(v) => onChange({ ...set, reps: v, reps_max: v !== null && set.reps_max !== null && set.reps_max < v ? null : set.reps_max })}
      />
      <NumField
        testId="set-reps-max"
        label={t("repsMaxFor", { n, name: exerciseName })}
        value={set.reps_max}
        bounds={{ ...BOUNDS.reps_max, min: set.reps ?? 0 }}
        onCommit={(v) => onChange({ ...set, reps_max: v })}
      />
      <NumField
        testId="set-kg"
        label={t("kgFor", { n, name: exerciseName })}
        value={set.weight_kg}
        bounds={BOUNDS.weight_kg}
        onCommit={(v) => onChange({ ...set, weight_kg: v })}
      />
      {effort === "rir" ? (
        <NumField testId="set-rir" label={t("rirFor", { n, name: exerciseName })} value={set.rir} bounds={BOUNDS.rir} onCommit={(v) => onChange({ ...set, rir: v })} />
      ) : (
        <NumField testId="set-rpe" label={t("rpeFor", { n, name: exerciseName })} value={set.rpe} bounds={BOUNDS.rpe} onCommit={(v) => onChange({ ...set, rpe: v })} />
      )}
      <button
        type="button"
        data-testid="set-remove"
        className="flex h-8 items-center justify-center text-muted hover:text-[var(--color-bad)]"
        aria-label={t("removeSet", { n, name: exerciseName })}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

/** Pasa el esfuerzo de RIR a RPE o al revés con la escala de RPE basada en RIR (RPE 10 = 0 RIR). */
export function convertEffort(set: PlannedSet, to: EffortMode): PlannedSet {
  if (to === "rpe") {
    const rpe = set.rpe ?? (set.rir !== null ? Math.max(1, 10 - set.rir) : null);
    return { ...set, rpe, rir: null };
  }
  const rir = set.rir ?? (set.rpe !== null ? Math.max(0, 10 - set.rpe) : null);
  return { ...set, rir, rpe: null };
}
