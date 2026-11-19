"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TASTE_LISTS, splitWords, useUpdateTastes, type TasteList, type Tastes } from "@/lib/menu";

/** Gustos para los menús (`coach.tastes`): alergias e intolerancias bloquean un plato; lo demás
 * solo avisa. Un campo sin tocar sigue "sin contestar"; guardarlo vacío es "nada". */
export function TastesCard({ tastes }: { tastes: Tastes }) {
  const t = useTranslations("menu.tastes");
  const update = useUpdateTastes();
  const [draft, setDraft] = useState<Partial<Record<TasteList, string>>>({});
  const value = (k: TasteList) => draft[k] ?? (tastes[k] ?? []).join(", ");

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, splitWords(v ?? "")]));
    update.mutate(body, { onSuccess: () => setDraft({}) });
  }

  return (
    <form data-testid="tastes-form" onSubmit={save} className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <div className="mt-3 flex flex-col gap-3">
        {TASTE_LISTS.map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="t-label text-ink">
              {t(k)}
              {tastes[k] === null && draft[k] === undefined && <span className="ml-2 text-muted">· {t("notAsked")}</span>}
            </span>
            <input
              name={k}
              value={value(k)}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              placeholder={t("hint")}
              className="field px-3 py-2 text-sm"
            />
          </label>
        ))}
      </div>
      <button type="submit" disabled={update.isPending || Object.keys(draft).length === 0} className="btn btn-tonal btn-sm mt-3 w-full disabled:opacity-60">
        {t("save")}
      </button>
      {update.isSuccess && <p role="status" className="t-body mt-2 text-xs text-good">{t("saved")}</p>}
      {update.error && <p role="alert" className="t-body mt-2 text-xs text-bad">{update.error.message || t("error")}</p>}
    </form>
  );
}
