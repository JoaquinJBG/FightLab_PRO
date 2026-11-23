"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { FolderSection } from "@/components/routines/FolderSection";
import { ReorderList } from "@/components/routines/ReorderList";
import { useCreateFolder, useFolders, useReorderFolders, useRoutines } from "@/lib/routines";

/* Rutinas (F17 R): carpetas con sus rutinas, sin límite de número, como Hevy Pro. */
export default function RoutinesPage() {
  const t = useTranslations("routines");
  const routines = useRoutines();
  const folders = useFolders();
  const createFolder = useCreateFolder();
  const reorderFolders = useReorderFolders();
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const list = routines.data ?? [];
  const folderList = folders.data ?? [];
  const loading = routines.isLoading || folders.isLoading;
  const failed = routines.isError || folders.isError;
  const unfiled = list.filter((r) => r.folder === null);

  return (
    <div className="pt-4 pb-6">
      <Link href="/training" className="t-label text-muted">
        {t("back")}
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("subtitle")}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href="/training/routines/new" data-testid="routine-new" className="btn btn-primary btn-sm">
          {t("new")}
        </Link>
        <button type="button" data-testid="folder-new" className="btn btn-tonal btn-sm" onClick={() => setNewFolder("")}>
          {t("folders.new")}
        </button>
      </div>
      <Link
        href="/training/routines/programs"
        data-testid="programs-link"
        className="glass neon-edge mt-3 flex items-center justify-between gap-3 p-3"
      >
        <span>
          <span className="t-title block text-sm text-ink">{t("programs.title")}</span>
          <span className="t-body block text-xs text-muted">{t("programs.sub")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-neon" />
      </Link>

      {newFolder !== null && (
        <form
          className="glass mt-3 flex gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFolder.trim()) createFolder.mutate(newFolder.trim(), { onSuccess: () => setNewFolder(null) });
          }}
        >
          <input
            autoFocus
            data-testid="folder-name"
            className="field min-w-0 flex-1 px-3 py-2 text-sm"
            placeholder={t("folders.namePlaceholder")}
            aria-label={t("folders.namePlaceholder")}
            maxLength={80}
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!newFolder.trim() || createFolder.isPending}>
            {t("create")}
          </button>
          <button type="button" className="btn btn-outline btn-sm !px-3" aria-label={t("cancel")} onClick={() => setNewFolder(null)}>
            ✕
          </button>
        </form>
      )}

      {loading && <p className="t-body mt-6 text-sm text-muted">{t("loading")}</p>}
      {failed && (
        <p role="alert" className="t-body mt-6 text-sm text-warn">
          {t("loadError")}
        </p>
      )}

      {!loading && !failed && list.length === 0 && folderList.length === 0 && (
        <div data-testid="routines-empty" className="glass mt-6 p-4">
          <p className="t-title text-sm text-ink">{t("empty.title")}</p>
          <p className="t-body mt-1 text-xs text-muted">{t("empty.body")}</p>
        </div>
      )}

      {!loading && !failed && (
        <>
          <ReorderList
            className="flex flex-col"
            items={folderList}
            getKey={(f) => f.id}
            label={(f) => f.name}
            onReorder={(next) => reorderFolders.mutate(next.map((f) => f.id))}
            render={(f, _i, c) => (
              <FolderSection folder={f} routines={list.filter((r) => r.folder === f.id)} folders={folderList} controls={c} />
            )}
          />
          {(unfiled.length > 0 || folderList.length === 0) && list.length > 0 && (
            <FolderSection folder={null} routines={unfiled} folders={folderList} />
          )}
        </>
      )}
    </div>
  );
}
