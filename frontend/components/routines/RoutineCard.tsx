"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  START_PATH,
  useDeleteRoutine,
  useDuplicateRoutine,
  usePatchRoutine,
  type Folder,
  type RoutineSummary,
} from "@/lib/routines";
import type { ReorderControls } from "./ReorderList";

type Props = {
  routine: RoutineSummary;
  folders: Folder[];
  controls?: ReorderControls;
};

/** Una rutina en la lista: empezar, editar y el menú (duplicar, mover de carpeta, borrar). */
export function RoutineCard({ routine, folders, controls }: Props) {
  const t = useTranslations("routines");
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const duplicate = useDuplicateRoutine();
  const remove = useDeleteRoutine();
  const patch = usePatchRoutine();
  const preview = routine.exercise_names.slice(0, 4).join(", ") + (routine.exercise_names.length > 4 ? "…" : "");

  return (
    <article
      data-testid="routine-card"
      data-routine-id={routine.id}
      className={`glass p-3 ${controls?.dragging ? "neon-edge" : ""}`}
    >
      <div className="flex items-start gap-2">
        {controls?.handle}
        <div className="min-w-0 flex-1">
          <p className="t-title truncate text-base text-ink">{routine.title}</p>
          <p className="t-body mt-0.5 line-clamp-2 text-xs text-muted">
            {routine.exercise_count === 0 ? t("card.empty") : preview}
          </p>
          <p className="t-label mt-1 text-muted">
            {t("card.counts", { exercises: routine.exercise_count, sets: routine.set_count })}
            {routine.edited ? <span className="ml-2 text-warn">{t("card.edited")}</span> : null}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm !px-3"
          aria-expanded={menu}
          aria-label={t("card.menu", { name: routine.title })}
          onClick={() => setMenu((m) => !m)}
        >
          ⋯
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <Link href={START_PATH(routine.id)} data-testid="routine-start" className="btn btn-primary btn-sm flex-1">
          {t("start")}
        </Link>
        <Link href={`/training/routines/${routine.id}`} data-testid="routine-edit" className="btn btn-tonal btn-sm flex-1">
          {t("edit")}
        </Link>
      </div>

      {menu && (
        <div data-testid="routine-menu" className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
          {controls && (
            <div className="flex items-center justify-between gap-2">
              <span className="t-label text-muted">{t("reorder.label")}</span>
              {controls.buttons}
            </div>
          )}
          <label className="t-label flex items-center justify-between gap-2 text-muted">
            {t("card.moveTo")}
            <select
              className="field max-w-[60%] px-3 py-2 text-sm"
              value={routine.folder ?? ""}
              onChange={(e) => {
                const value = e.target.value === "" ? null : Number(e.target.value);
                patch.mutate({ id: routine.id, patch: { folder: value } });
              }}
            >
              <option value="">{t("folders.none")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate(routine.id, { onSuccess: () => setMenu(false) })}
          >
            {t("duplicate")}
          </button>
          {confirmDelete ? (
            <div className="flex flex-col gap-2" role="alertdialog" aria-label={t("card.deleteConfirm", { name: routine.title })}>
              <p className="t-body text-xs text-warn">{t("card.deleteConfirm", { name: routine.title })}</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  data-testid="routine-delete-confirm"
                  className="btn btn-sm flex-1 border-[var(--color-bad)] text-[var(--color-bad)]"
                  onClick={() => remove.mutate(routine.id)}
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
    </article>
  );
}
