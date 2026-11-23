"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Panel inferior accesible: `role="dialog"`, titulado por su encabezado, con el foco dentro
 * (Tab da la vuelta), Escape o tocar fuera para cerrar, y el foco vuelve a quien lo abrió. */
export function BottomSheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  const t = useTranslations("today.sheet");
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, button:not([data-sheet-close])") ?? panel.current;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const a = items[0];
      const z = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === a || !panel.current.contains(active))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (active === z || !panel.current.contains(active))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" data-testid={testId}>
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="glass safe-bottom relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-b-none p-4 outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="t-label text-ink">{title}</h2>
          <button type="button" data-sheet-close onClick={onClose} className="btn btn-outline btn-sm">
            {t("close")}
          </button>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
