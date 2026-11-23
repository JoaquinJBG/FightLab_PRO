"use client";

import { useTranslations } from "next-intl";
import { useOnline, usePendingCount } from "@/lib/offline";

/** Aviso de «sin conexión» y de los cambios que esperan a la red (F5 de la prueba en móvil). */
export function OfflineNotice() {
  const t = useTranslations("shell.offline");
  const online = useOnline();
  const pending = usePendingCount();
  if (online && pending === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-notice"
      data-pending={pending}
      className="sticky top-0 z-30 mx-4 mt-3 rounded-2xl border border-[rgba(255,210,90,0.35)] bg-[rgba(30,24,8,0.92)] px-4 py-2 text-[12px] text-ink backdrop-blur"
    >
      {online ? (
        <p>{t("sending", { count: pending })}</p>
      ) : (
        <>
          <p className="t-label text-warn">{t("title")}</p>
          <p>{pending > 0 ? t("pending", { count: pending }) : t("idle")}</p>
        </>
      )}
    </div>
  );
}
