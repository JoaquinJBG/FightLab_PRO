"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MENU_ACCEPT, useImportMenu, type ImportResponse } from "@/lib/menu";

/** Importa un menú completo: el JSON `schema: 1` de la app o un `menus/<fecha>.yaml` del coach.
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
    <section data-testid="menu-import" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <button type="button" className="btn btn-tonal btn-sm mt-3" disabled={importMenu.isPending} onClick={() => input.current?.click()}>
        {importMenu.isPending ? t("importing") : t("choose")}
      </button>
      <input ref={input} data-testid="menu-import-input" type="file" accept={MENU_ACCEPT} hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
      {code === "start_taken" && pending && (
        <div data-testid="menu-import-confirm" className="mt-3">
          <p role="alert" className="t-body text-xs text-warn">{t("startTaken")}</p>
          <button type="button" className="btn btn-primary btn-sm mt-2" onClick={() => send(pending, true)}>{t("replace")}</button>
        </div>
      )}
      {code && code !== "start_taken" && (
        <p role="alert" className="t-body mt-2 text-xs text-bad">
          {t.has(`errors.${code}`) ? t(`errors.${code}`) : importMenu.error?.message || t("errors.generic")}
        </p>
      )}
      {done && (
        <p role="status" data-testid="menu-import-done" data-replaced={done.replaced ? "true" : "false"} className="t-body mt-3 text-sm text-good">
          {t(done.replaced ? "replaced" : "imported", {
            title: done.summary.title || done.summary.menu_id,
            days: done.summary.days,
            sessions: done.summary.batch_sessions,
            items: done.summary.shopping_items,
            kept: done.kept_checks,
          })}
        </p>
      )}
    </section>
  );
}
