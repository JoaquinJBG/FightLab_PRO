"use client";

import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { isRating, RATING_KEY } from "@/lib/chain-catalogue";

// Colores de cada valoración (los mismos tokens que el resto de la app).
const COLOR: Record<string, string> = {
  good: "var(--color-good)",
  fair: "var(--color-warn)",
  avoid: "var(--color-bad)",
  noData: "var(--color-muted)",
  notFood: "var(--color-muted)",
};

type Props = {
  rating: string | null | undefined;
  check?: string | null;
  ruleKey?: string | null;
  grades?: Record<string, string>;
  /** Sin chip de evidencia (listas largas): el chip va una vez en la cabecera. */
  bare?: boolean;
};

/** La valoración de un producto (bueno, regular, evitar, sin datos, no aplica), la marca de
 * "revisar" si las kcal no cuadran y el chip de evidencia de la regla que la explica. */
export function RatingBadge({ rating, check, ruleKey, grades, bare }: Props) {
  const t = useTranslations("chainCatalogue.rating");
  if (!isRating(rating)) return null;
  const key = RATING_KEY[rating];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        data-testid="rating-badge"
        data-rating={rating}
        className="t-label inline-flex items-center rounded-full border px-2.5 py-0.5"
        style={{ color: COLOR[key], borderColor: COLOR[key] }}
      >
        {t(key)}
      </span>
      {check === "revisar" && (
        <span data-testid="rating-review" className="t-label rounded-full border border-warn px-2 py-0.5 text-warn">
          {t("review")}
        </span>
      )}
      {!bare && ruleKey && <EvidenceChip ruleKey={ruleKey} grade={grades?.[ruleKey] ?? null} />}
    </span>
  );
}
