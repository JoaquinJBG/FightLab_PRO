"use client";

import { useTranslations } from "next-intl";
import { useUpdateProfile } from "@/lib/hooks";

/** P7: sin `equation_sex` no hay objetivos de calorías ni de macros (las ecuaciones solo existen
 * para dos sexos). Se explica y se deja elegirlo; el resto de la app sigue funcionando. */
export function EquationSexPrompt() {
  const t = useTranslations("nutrition.noSex");
  const update = useUpdateProfile();
  return (
    <section data-testid="equation-sex-prompt" className="glass neon-edge mt-4 p-4">
      <p className="t-label text-ink">{t("title")}</p>
      <p className="t-body mt-1.5 text-xs text-muted">{t("body")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["female", "male"] as const).map((sex) => (
          <button
            key={sex}
            data-testid={`equation-sex-${sex}`}
            disabled={update.isPending}
            onClick={() => update.mutate({ equation_sex: sex })}
            className="btn btn-tonal btn-sm disabled:opacity-60"
          >
            {t(sex)}
          </button>
        ))}
      </div>
      {update.isError && <p className="t-body mt-2 text-xs text-warn">{t("error")}</p>}
    </section>
  );
}
