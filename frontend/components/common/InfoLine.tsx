"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InfoIcon } from "@/components/icons";
import { BottomSheet } from "@/components/today/BottomSheet";

/** Una línea corta + ⓘ que abre el detalle en un panel inferior (docs/ux/simplificar.md, regla 2).
 * Los avisos de seguridad se quedan visibles en una línea; la explicación larga va detrás del toque. */
export function InfoLine({ text, detail, title, testId, className, style, children, as: Tag = "p" }: {
  text: ReactNode;
  detail: ReactNode;
  title: string;
  testId?: string;
  className?: string;
  style?: CSSProperties;
  /** Se pinta tras el texto, antes del ⓘ (p. ej. los chips de evidencia). */
  children?: ReactNode;
  as?: "p" | "span";
}) {
  const t = useTranslations("today.sheet");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tag data-testid={testId} className={className} style={style}>
        {text}
        {children}{" "}
        <button type="button" onClick={() => setOpen(true)} aria-label={t("more")} data-testid={testId ? `${testId}-info` : undefined} className="inline-flex h-6 w-6 translate-y-1 items-center justify-center align-baseline text-muted">
          <InfoIcon className="h-4 w-4" />
        </button>
      </Tag>
      {open && (
        <BottomSheet title={title} onClose={() => setOpen(false)}>
          <p className="t-body mt-2 text-sm text-ink">{detail}</p>
        </BottomSheet>
      )}
    </>
  );
}
