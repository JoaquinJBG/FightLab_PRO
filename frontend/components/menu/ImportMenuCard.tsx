"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MENU_ACCEPT, useImportMenu, type ImportResponse } from "@/lib/menu";

/** Chip «Importar» de la cabecera del menú (sin tarjeta ni texto). Importa un menú completo: el JSON `schema: 1` de la app o un `menus/<fecha>.yaml` del coach.
 * Si ya hay uno con el mismo `id`, lo sustituye y conserva lo tachado de la lista; si otro menú
 * empieza el mismo día, pide confirmación. */
export function ImportMenuCard({ onImported }: { onImported?: (id: number) => void }) {
  const t = useTranslations("menu.import");
  const importMenu = useImportMenu();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const code = importMenu.error?.code;

  function send(file: File, replaceStart = false) {
    setDone(null);
    importMenu.mutate({ file, replaceStart }, {
      onSuccess: (res) => {
        setPending(null);
        setDone(res);
        onImported?.(res.menu.id);
      },
      onError: (e) => setPending(e.code === "start_taken" ? file : null),
    });
  }

  return (
    <div data-testid="menu-import" className="contents">
      <button type="button" data-testid="menu-import-chip" title={t("title")} className="btn btn-tonal btn-sm" disabled={importMenu.isPending} onClick={() => input.current?.click()}>
        {importMenu.isPending ? t("importing") : t("choose")}
      </button>
      <input ref={input} data-testid="menu-import-input" type="file" accept={MENU_ACCEPT} hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
      {code === "start_taken" && pending && (
        <div data-testid="menu-import-confirm" className="w-full">
          <p role="alert" className="t-body text-xs text-warn">{t("startTaken")}</p>
          <button type="button" className="btn btn-primary btn-sm mt-2" onClick={() => send(pending, true)}>{t("replace")}</button>
          <button type="button" data-testid="menu-import-cancel" className="btn btn-tonal btn-sm ml-2 mt-2" onClick={() => { setPending(null); importMenu.reset(); }}>{t("cancel")}</button>
        </div>
      )}
      {code && code !== "start_taken" && (
        <p role="alert" className="t-body w-full text-xs text-bad">
          {t.has(`errors.${code}`) ? t(`errors.${code}`) : importMenu.error?.message || t("errors.generic")}
        </p>
      )}
      {done && (
        <p role="status" data-testid="menu-import-done" data-replaced={done.replaced ? "true" : "false"} className="t-body w-full text-sm text-good">
          {t(done.replaced ? "replaced" : "imported", {
            title: done.summary.title || done.summary.menu_id,
            days: done.summary.days,
            sessions: done.summary.batch_sessions,
            items: done.summary.shopping_items,
            kept: done.kept_checks,
          })}
        </p>
      )}
    </div>
  );
}
