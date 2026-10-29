"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { asGrade, GRADE_COLOR } from "@/lib/evidence";
import { EvidenceSheet } from "./EvidenceSheet";

type Props = {
  /** Clave de la regla (`nutrition/…`). Sin ella, el dato es una convención de FightLab. */
  ruleKey?: string | null;
  grade?: string | null;
};

const base = "t-label inline-flex items-center rounded-full border px-2.5 py-0.5 align-middle";

/** Chip de evidencia junto a un número o recomendación. Al tocarlo abre la hoja con la
 * regla y sus fuentes. Lo que no tiene regla se etiqueta como convención, sin disfrazarlo
 * de evidencia. */
export function EvidenceChip({ ruleKey, grade }: Props) {
  const t = useTranslations("evidence");
  const [open, setOpen] = useState(false);

  if (!ruleKey) {
    return (
      <span
        data-testid="evidence-chip"
        data-variant="convention"
        className={`${base} border-white/20 text-muted`}
      >
        {t("convention")}
      </span>
    );
  }

  const g = asGrade(grade);
  const color = g ? GRADE_COLOR[g] : "var(--color-muted)";
  return (
    <>
      <button
        type="button"
        data-testid="evidence-chip"
        data-variant="evidence"
        data-grade={g ?? "none"}
        onClick={() => setOpen(true)}
        className={base}
        style={{ color, borderColor: color }}
      >
        {g ? t(`grade.${g}`) : t("grade.none")}
      </button>
      {open && <EvidenceSheet ruleKey={ruleKey} onClose={() => setOpen(false)} />}
    </>
  );
}
