"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ExercisePicker } from "@/components/exercises/ExercisePicker";
import { useExercises, type Exercise } from "@/lib/exercises";
import {
  linkWithNext,
  newSet,
  START_PATH,
  unlink,
  useDeleteRoutine,
  useDuplicateRoutine,
  useFolders,
  useSaveRoutine,
  type RoutineApiError,
  type RoutineDraft,
} from "@/lib/routines";
import { ExerciseBlock } from "./ExerciseBlock";
import { ReorderList } from "./ReorderList";

type DraftExercise = RoutineDraft["exercises"][number];
/** En el editor, cada ejercicio lleva un id local estable (para reordenar sin perder su estado). */
type EditorExercise = DraftExercise & { _uid: number };
type EditorDraft = Omit<RoutineDraft, "exercises"> & { exercises: EditorExercise[] };

let uidSeq = 0;
const withUid = (e: DraftExercise): EditorExercise => ({ ...e, _uid: ++uidSeq });
const stripUid = ({ _uid, ...e }: EditorExercise): DraftExercise => {
  void _uid;
  return e;
};

const EMPTY: RoutineDraft = { title: "", notes: "", folder: null, exercises: [] };

/** Descanso por defecto al añadir un ejercicio: 2 min en los multiarticulares con barra y 90 s
 * en el resto (convención de FightLab dentro de los 1,5-3 min de "Rest intervals for
 * hypertrophy"). */
export function defaultRest(ex: Pick<Exercise, "equipment" | "category">): number | null {
  if (ex.category !== "strength") return null;
  return ex.equipment.includes("barbell") ? 120 : 90;
}

function errorText(err: RoutineApiError | null, fallback: string): string | null {
  if (!err) return null;
  const data = err.data ?? {};
  if (typeof data.detail === "string") return data.detail;
  return fallback;
}

/** Editor de una rutina (nueva si `id` es null): título, notas, carpeta y ejercicios con sus
 * series, descanso y superseries. Guardar manda la rutina entera (PUT): el orden es el de la
 * lista. */
export function RoutineEditor({ id, initial, folderId }: { id: number | null; initial?: RoutineDraft; folderId?: number | null }) {
  const t = useTranslations("routines");
  const te = useTranslations("routines.editor");
  const locale = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<EditorDraft>(() => {
    const base = initial ?? { ...EMPTY, folder: folderId ?? null };
    return { ...base, exercises: base.exercises.map(withUid) };
  });
  const [dirty, setDirty] = useState(id === null);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const folders = useFolders();
  const catalog = useExercises(locale);
  const save = useSaveRoutine();
  const duplicate = useDuplicateRoutine();
  const remove = useDeleteRoutine();
  const byKey = useMemo(() => new Map((catalog.data ?? []).map((e) => [e.key, e])), [catalog.data]);

  const update = (next: Partial<EditorDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setDirty(true);
  };
  const setExercises = (exercises: EditorExercise[]) => update({ exercises });

  const labels = new Map<number, string>();
  for (const e of draft.exercises) {
    if (e.superset !== null && !labels.has(e.superset)) labels.set(e.superset, String.fromCharCode(65 + labels.size));
  }

  const doSave = (then?: (id: number) => void) => {
    if (!draft.title.trim()) {
      setTitleError(true);
      return;
    }
    save.mutate(
      { id, draft: { ...draft, title: draft.title.trim(), exercises: draft.exercises.map(stripUid) } },
      {
        onSuccess: (saved) => {
          setDirty(false);
          if (then) then(saved.id);
          else if (id === null) router.replace(`/training/routines/${saved.id}`);
        },
      },
    );
  };

  const addExercise = (ex: Exercise) => {
    setDraft((d) => ({
      ...d,
      exercises: [
        ...d.exercises,
        withUid({
          exercise_key: ex.key,
          name: ex.name,
          notes: "",
          rest_s: defaultRest(ex),
          superset: null,
          sets: [newSet(), newSet(), newSet()],
        }),
      ],
    }));
    setDirty(true);
  };

  return (
    <div className="pt-4 pb-40">
      <Link href="/training/routines" className="t-label text-muted">
        {t("programs.back")}
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{id === null ? te("newTitle") : te("editTitle")}</h1>

      <div className="glass mt-4 flex flex-col gap-3 p-3">
        <input
          data-testid="routine-title"
          className={`field px-3 py-2 text-base ${titleError ? "!border-[var(--color-bad)]" : ""}`}
          placeholder={te("titlePlaceholder")}
          aria-label={te("titlePlaceholder")}
          aria-invalid={titleError || undefined}
          maxLength={120}
          value={draft.title}
          onChange={(e) => {
            setTitleError(false);
            update({ title: e.target.value });
          }}
        />
        {titleError && (
          <p role="alert" className="t-body -mt-2 text-xs text-[var(--color-bad)]">
            {te("titleRequired")}
          </p>
        )}
        <textarea
          data-testid="routine-notes"
          className="field px-3 py-2 text-sm"
          rows={2}
          maxLength={4000}
          placeholder={te("routineNotes")}
          aria-label={te("routineNotes")}
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
        />
        <label className="t-label flex items-center justify-between gap-2 text-muted">
          {te("folder")}
          <select
            data-testid="routine-folder-select"
            className="field max-w-[60%] px-3 py-2 text-sm"
            value={draft.folder ?? ""}
            onChange={(e) => update({ folder: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">{t("folders.none")}</option>
            {(folders.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {draft.exercises.length === 0 ? (
        <p data-testid="routine-no-exercises" className="t-body mt-4 text-sm text-muted">
          {te("noExercises")}
        </p>
      ) : (
        <ReorderList
          testId="routine-exercises"
          className="mt-4 flex flex-col gap-3"
          items={draft.exercises}
          getKey={(x) => x._uid}
          label={(x) => x.name}
          onReorder={(next) => setExercises(next)}
          render={(x, i, c) => (
            <ExerciseBlock
              exercise={x}
              index={i}
              total={draft.exercises.length}
              catalog={x.exercise_key ? byKey.get(x.exercise_key) : undefined}
              supersetLabel={x.superset !== null ? labels.get(x.superset) ?? null : null}
              linkedWithNext={x.superset !== null && draft.exercises[i + 1]?.superset === x.superset}
              controls={c}
              onChange={(next) => setExercises(draft.exercises.map((e, j) => (j === i ? { ...next, _uid: e._uid } : e)))}
              onRemove={() => setExercises(unlink(draft.exercises, i).filter((_, j) => j !== i))}
              onLinkNext={() => setExercises(linkWithNext(draft.exercises, i))}
              onUnlink={() => setExercises(unlink(draft.exercises, i))}
            />
          )}
        />
      )}

      <button type="button" data-testid="exercise-add" className="btn btn-tonal btn-block mt-4" onClick={() => setPicking(true)}>
        {te("addExercise")}
      </button>

      {save.isError && (
        <p role="alert" data-testid="routine-save-error" className="t-body mt-3 text-sm text-warn">
          {errorText(save.error, t("saveError"))}
        </p>
      )}

      {id !== null && (
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate(id, { onSuccess: (copy) => router.push(`/training/routines/${copy.id}`) })}
          >
            {t("duplicate")}
          </button>
          {confirmDelete ? (
            <div role="alertdialog" aria-label={t("card.deleteConfirm", { name: draft.title })} className="flex flex-col gap-2">
              <p className="t-body text-xs text-warn">{t("card.deleteConfirm", { name: draft.title })}</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  data-testid="routine-delete-confirm"
                  className="btn btn-outline btn-sm flex-1 text-[var(--color-bad)]"
                  onClick={() => remove.mutate(id, { onSuccess: () => router.push("/training/routines") })}
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-outline btn-sm text-[var(--color-bad)]" onClick={() => setConfirmDelete(true)}>
              {t("delete")}
            </button>
          )}
        </div>
      )}

      {/* Barra fija: guardar y empezar. Va por encima de la barra de pestañas. */}
      <div className="fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 px-4">
        <div className="glass mx-auto flex max-w-lg gap-2 p-2">
          <button
            type="button"
            data-testid="routine-save"
            className="btn btn-tonal btn-sm flex-1"
            disabled={!dirty || save.isPending}
            onClick={() => doSave()}
          >
            {save.isPending ? te("saving") : dirty ? te("save") : te("saved")}
          </button>
          {id !== null && !dirty ? (
            <Link href={START_PATH(id)} data-testid="routine-start" className="btn btn-primary btn-sm flex-1">
              {t("start")}
            </Link>
          ) : (
            <button
              type="button"
              data-testid="routine-save-start"
              className="btn btn-primary btn-sm flex-1"
              disabled={save.isPending}
              onClick={() => doSave((savedId) => router.push(START_PATH(savedId)))}
            >
              {te("saveAndStart")}
            </button>
          )}
        </div>
      </div>

      {picking && <ExercisePicker multiple onSelect={addExercise} onClose={() => setPicking(false)} />}
    </div>
  );
}
