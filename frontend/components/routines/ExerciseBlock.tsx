"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Exercise } from "@/lib/exercises";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { newSet, type PlannedSet, type RoutineDraft } from "@/lib/routines";
import type { ReorderControls } from "./ReorderList";
import { convertEffort, SetRow, type EffortMode } from "./SetRow";

type DraftExercise = RoutineDraft["exercises"][number];

// Descansos que se ofrecen (s). 0 = sin temporizador.
export const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

export function fmtRest(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function initialEffort(sets: PlannedSet[]): EffortMode {
  return sets.some((s) => s.rpe !== null) && sets.every((s) => s.rir === null) ? "rpe" : "rir";
}

type Props = {
  exercise: DraftExercise;
  index: number;
  total: number;
  catalog?: Exercise;
  /** Letra de la superserie (A, B…) o nada. */
  supersetLabel: string | null;
  linkedWithNext: boolean;
  controls: ReorderControls;
  onChange: (next: DraftExercise) => void;
  onRemove: () => void;
  onLinkNext: () => void;
  onUnlink: () => void;
};

/** Un ejercicio de la rutina: notas, descanso, superserie y sus series planificadas. */
export function ExerciseBlock(props: Props) {
  const { exercise, index, total, catalog, supersetLabel, linkedWithNext, controls, onChange, onRemove, onLinkNext, onUnlink } = props;
  const t = useTranslations("routines.editor");
  const [effort, setEffort] = useState<EffortMode>(() => initialEffort(exercise.sets));
  const setSets = (sets: PlannedSet[]) => onChange({ ...exercise, sets });
  // Número de cada serie normal (las de calentamiento, drop y fallo llevan su letra).
  const normalIndex = exercise.sets.map((_, i) => exercise.sets.slice(0, i + 1).filter((x) => x.set_type === "normal").length);

  return (
    <article
      data-testid="routine-exercise"
      data-exercise-key={exercise.exercise_key ?? ""}
      data-superset={exercise.superset ?? ""}
      className={`glass p-3 ${supersetLabel ? "border-l-2 !border-l-[var(--color-neon)]" : ""} ${controls.dragging ? "neon-edge" : ""}`}
    >
      <div className="flex items-center gap-2">
        {controls.handle}
        {catalog ? <ExerciseThumb exercise={catalog} size={36} /> : null}
        <div className="min-w-0 flex-1">
          <p className="t-title truncate text-sm text-ink">{exercise.name}</p>
          {supersetLabel && (
            <p data-testid="superset-label" className="t-label text-neon">
              {t("supersetLabel", { label: supersetLabel })}
            </p>
          )}
        </div>
        {controls.buttons}
      </div>

      <textarea
        data-testid="exercise-notes"
        className="field mt-2 w-full px-3 py-2 text-xs"
        rows={1}
        maxLength={2000}
        placeholder={t("notesPlaceholder")}
        aria-label={t("notesFor", { name: exercise.name })}
        value={exercise.notes}
        onChange={(e) => onChange({ ...exercise, notes: e.target.value })}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="t-label flex min-w-0 items-center gap-2 text-muted">
          {t("rest")}
          <select
            data-testid="exercise-rest"
            className="field w-24 min-w-0 px-2 py-1.5 text-sm"
            value={exercise.rest_s ?? 0}
            onChange={(e) => onChange({ ...exercise, rest_s: Number(e.target.value) || null })}
          >
            {REST_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? t("restOff") : fmtRest(s)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="effort-toggle"
          className="btn btn-outline btn-sm shrink-0 whitespace-nowrap !px-3"
          aria-label={t("effortToggle", { mode: effort === "rir" ? "RPE" : "RIR" })}
          onClick={() => {
            const to = effort === "rir" ? "rpe" : "rir";
            setEffort(to);
            setSets(exercise.sets.map((s) => convertEffort(s, to)));
          }}
        >
          {t("effortUse", { mode: effort === "rir" ? "RPE" : "RIR" })}
        </button>
      </div>

      {exercise.sets.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="t-label grid grid-cols-[2.6rem_1fr_1fr_1.2fr_1fr_1.6rem] gap-1 text-center text-muted" aria-hidden>
            <span>{t("col.set")}</span>
            <span>{t("col.reps")}</span>
            <span>{t("col.max")}</span>
            <span>kg</span>
            <span>{effort === "rir" ? "RIR" : "RPE"}</span>
            <span />
          </div>
          {exercise.sets.map((s, i) => (
              <SetRow
                key={i}
                set={s}
                index={i}
                normalIndex={normalIndex[i]}
                effort={effort}
                exerciseName={exercise.name}
                onChange={(next) => setSets(exercise.sets.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setSets(exercise.sets.filter((_, j) => j !== i))}
              />
          ))}
        </div>
      )}

      <button
        type="button"
        data-testid="set-add"
        className="btn btn-tonal btn-sm btn-block mt-2"
        onClick={() => setSets([...exercise.sets, newSet(exercise.sets.at(-1))])}
      >
        {t("addSet")}
      </button>

      <div className="mt-2 flex flex-wrap gap-2">
        {supersetLabel ? (
          <button type="button" data-testid="superset-unlink" className="btn btn-outline btn-sm flex-1" onClick={onUnlink}>
            {t("supersetRemove")}
          </button>
        ) : null}
        {index < total - 1 && !linkedWithNext ? (
          <button type="button" data-testid="superset-link" className="btn btn-outline btn-sm flex-1" onClick={onLinkNext}>
            {t("supersetWithNext")}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="exercise-remove"
          className="btn btn-outline btn-sm flex-1 text-[var(--color-bad)]"
          aria-label={t("removeExercise", { name: exercise.name })}
          onClick={onRemove}
        >
          {t("remove")}
        </button>
      </div>
    </article>
  );
}
