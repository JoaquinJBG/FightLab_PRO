"use client";

import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import type { ImportedReview } from "@/lib/review";

// Las revisiones del coach importadas en Perfil → Importar historial (fase 10). No tienen
// adherencia ni tendencia: solo el TDEE, el objetivo que se aceptó y el texto de la revisión.
export function ImportedReviews({ reviews }: { reviews: ImportedReview[] }) {
  const t = useTranslations("historyImport.review");
  const locale = intlLocale(useLocale());
  if (reviews.length === 0) return null;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const kcal = (n: number) => Math.round(n).toLocaleString(locale);
  return (
    <section data-testid="imported-reviews" className="glass mt-4 p-4">
      <p className="t-title text-ink">{t("title")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {reviews.map((r) => (
          <li key={r.id} data-testid="imported-review" className="border-t border-[rgba(150,190,255,0.08)] pt-2 first:border-0 first:pt-0">
            <details>
              <summary className="t-label cursor-pointer text-ink">
                {t("weekEnd", { date: day(r.week_end) })}
                <span className="t-body block text-[11px] text-muted">
                  {[
                    r.tdee_kcal != null && t("tdee", { kcal: kcal(r.tdee_kcal) }),
                    r.target_kcal != null && t("target", { kcal: kcal(r.target_kcal) }),
                    r.in_deficit != null && (r.in_deficit ? t("deficit") : t("noDeficit")),
                  ].filter(Boolean).join(" · ")}
                </span>
              </summary>
              {r.text && <p className="t-body mt-2 whitespace-pre-line text-xs text-muted">{r.text}</p>}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
