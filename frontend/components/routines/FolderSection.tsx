"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useDeleteFolder,
  useRenameFolder,
  useReorderRoutines,
  type Folder,
  type RoutineSummary,
} from "@/lib/routines";
import { ReorderList, type ReorderControls } from "./ReorderList";
import { RoutineCard } from "./RoutineCard";

type Props = {
  /** `null`: las rutinas sin carpeta. */
  folder: Folder | null;
  routines: RoutineSummary[];
  folders: Folder[];
  controls?: ReorderControls;
};

/** Una carpeta con sus rutinas (reordenables) y su menú: renombrar, mover y borrar. */
export function FolderSection({ folder, routines, folders, controls }: Props) {
  const t = useTranslations("routines");
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(folder?.name ?? "");
  const [confirm, setConfirm] = useState(false);
  const reorder = useReorderRoutines();
  const rename = useRenameFolder();
  const remove = useDeleteFolder();
  const title = folder ? folder.name : t("folders.none");

  return (
    <section data-testid="routine-folder" data-folder-id={folder?.id ?? "none"} className="mt-5">
      <div className="flex items-center gap-2">
        {controls?.handle}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ›
          </span>
          <span className="t-eyebrow min-w-0 break-words text-ink">{title}</span>
          <span className="t-label text-muted">{routines.length}</span>
          {folder?.kind === "plan" && <span className="t-label rounded-full border border-white/20 px-2 text-neon">{t("folders.plan")}</span>}
          {folder?.kind === "program" && <span className="t-label rounded-full border border-white/20 px-2 text-muted">{t("folders.program")}</span>}
        </button>
        {folder && (
          <button
            type="button"
            className="btn btn-outline btn-sm !px-3"
            aria-expanded={menu}
            aria-label={t("folders.menu", { name: folder.name })}
            onClick={() => setMenu((m) => !m)}
          >
            ⋯
          </button>
        )}
      </div>

      {folder && menu && (
        <div data-testid="folder-menu" className="glass mt-2 flex flex-col gap-2 p-3">
          {controls && (
            <div className="flex items-center justify-between gap-2">
              <span className="t-label text-muted">{t("reorder.label")}</span>
              {controls.buttons}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) rename.mutate({ id: folder.id, name: name.trim() }, { onSuccess: () => setMenu(false) });
            }}
          >
            <input
              className="field min-w-0 flex-1 px-3 py-2 text-sm"
              aria-label={t("folders.rename")}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-tonal btn-sm">
              {t("folders.rename")}
            </button>
          </form>
          {confirm ? (
            <div role="alertdialog" aria-label={t("folders.deleteTitle", { name: folder.name })} className="flex flex-col gap-2">
              <p className="t-body text-xs text-warn">{t("folders.deleteTitle", { name: folder.name })}</p>
              <button
                type="button"
                data-testid="folder-delete-keep"
                className="btn btn-outline btn-sm"
                onClick={() => remove.mutate({ id: folder.id, withRoutines: false })}
              >
                {t("folders.deleteKeep")}
              </button>
              <button
                type="button"
                data-testid="folder-delete-all"
                className="btn btn-outline btn-sm text-[var(--color-bad)]"
                onClick={() => remove.mutate({ id: folder.id, withRoutines: true })}
              >
                {t("folders.deleteAll", { n: routines.length })}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirm(false)}>
                {t("cancel")}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline btn-sm text-[var(--color-bad)]" onClick={() => setConfirm(true)}>
              {t("folders.delete")}
            </button>
          )}
        </div>
      )}

      {open &&
        (routines.length === 0 ? (
          <p className="t-body mt-2 text-xs text-muted">{t("folders.empty")}</p>
        ) : (
          <ReorderList
            className="mt-2 flex flex-col gap-3"
            items={routines}
            getKey={(r) => r.id}
            label={(r) => r.title}
            onReorder={(next) => reorder.mutate({ folder: folder?.id ?? null, ids: next.map((r) => r.id) })}
            render={(r, _i, c) => <RoutineCard routine={r} folders={folders} controls={c} />}
          />
        ))}
    </section>
  );
}
