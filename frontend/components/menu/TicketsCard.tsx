"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { MenuError } from "@/lib/menu";
import { ticketUrl, useDeleteTicket, useTickets, useUploadTicket } from "@/lib/tickets";

/** Fotos de los tickets de la compra de un menú. Se guardan en R2 a través del servidor y cada
 * foto se abre con una URL firmada que caduca; sin R2 configurado, se explica y no se sube nada. */
export function TicketsCard({ planId }: { planId: number }) {
  const t = useTranslations("menu.tickets");
  const locale = intlLocale(useLocale());
  const list = useTickets(planId);
  const upload = useUploadTicket(planId);
  const remove = useDeleteTicket();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<{ id: number; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (e: unknown) => {
    const code = e instanceof MenuError ? e.code : "";
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic");
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    upload.mutate({ file }, { onError: (e) => setError(message(e)) });
  }

  async function open(id: number) {
    setError(null);
    try {
      setShown({ id, url: await ticketUrl(id) });
    } catch (e) {
      setError(message(e));
    }
  }

  const data = list.data;
  return (
    <section data-testid="tickets" data-enabled={data?.enabled ? "true" : "false"} className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      {list.isLoading && <p className="t-body mt-2 text-xs text-muted">{t("loading")}</p>}
      {data && !data.enabled && <p data-testid="tickets-off" className="t-body mt-2 text-sm text-muted">{t("off")}</p>}
      {data?.enabled && (
        <>
          <p className="t-body mt-1 text-[11px] text-muted">{t("privacy")}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-tonal btn-sm" disabled={upload.isPending} onClick={() => camera.current?.click()}>
              {t("camera")}
            </button>
            <button type="button" className="btn btn-tonal btn-sm" disabled={upload.isPending} onClick={() => gallery.current?.click()}>
              {t("gallery")}
            </button>
          </div>
          <input ref={camera} data-testid="tickets-camera" type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={gallery} data-testid="tickets-input" type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          {upload.isPending && <p role="status" className="t-body mt-2 text-xs text-muted">{t("uploading")}</p>}
          <ul className="mt-3 flex flex-col gap-1.5">
            {data.tickets.map((tk) => (
              <li key={tk.id} data-testid="ticket" className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => open(tk.id)} className="t-body text-left text-sm text-ink underline-offset-2 hover:underline">
                  {t("line", {
                    date: new Date(`${tk.taken_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" }),
                    kb: Math.round(tk.size / 1024),
                  })}
                  {tk.note && <span className="text-muted"> · {tk.note}</span>}
                </button>
                <button type="button" className="t-label text-bad" disabled={remove.isPending}
                  onClick={() => { if (window.confirm(t("confirmDelete"))) remove.mutate(tk.id); }}>
                  {t("delete")}
                </button>
              </li>
            ))}
            {data.tickets.length === 0 && <li className="t-body text-xs text-muted">{t("empty")}</li>}
          </ul>
        </>
      )}
      {error && <p role="alert" className="t-body mt-2 text-xs text-bad">{error}</p>}
      {shown && (
        <div role="dialog" aria-modal="true" aria-label={t("title")} data-testid="ticket-view"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de R2 que caduca: no pasa por next/image */}
          <img src={shown.url} alt={t("photoAlt")} className="max-h-[80dvh] max-w-full rounded-xl object-contain" />
          <button type="button" className="btn btn-tonal" onClick={() => setShown(null)}>{t("close")}</button>
        </div>
      )}
    </section>
  );
}
