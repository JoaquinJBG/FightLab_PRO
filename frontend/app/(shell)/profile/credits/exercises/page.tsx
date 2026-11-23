"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { ExerciseCredits } from "@/components/exercises/ExerciseDetail";
import { exerciseHref, useExercises } from "@/lib/exercises";

/** Perfil → Créditos → Ejercicios: autor, fuente y licencia de cada imagen y texto de terceros. */
export default function ExerciseCreditsPage() {
  const t = useTranslations("credits.exercises");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, isLoading, isError } = useExercises(locale);
  const credited = (data ?? []).filter(
    (ex) => !ex.custom && (ex.images.length > 0 || (ex.text_credit && ex.text_credit.source !== "fightlab")),
  );

  return (
    <div className="pt-4 pb-6">
      <Link href="/profile/credits" className="t-label text-muted">← {tc("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("pageTitle")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("intro")}</p>

      {isLoading && <p className="t-body py-6 text-center text-sm text-muted">{t("loading")}</p>}
      {isError && <p className="t-body py-6 text-center text-sm text-muted">{t("error")}</p>}
      {data && (
        <>
          <p className="t-label mt-4 text-muted">{t("count", { n: credited.length })}</p>
          <ul className="mt-2 flex flex-col gap-2" data-testid="exercise-credits">
            {credited.map((ex) => (
              <li key={ex.key} className="glass p-3">
                <Link href={exerciseHref(ex.key) ?? "/training/exercises"} className="flex items-center gap-3">
                  <ExerciseThumb exercise={ex} size={36} />
                  <span className="t-body text-sm text-ink underline-offset-2 hover:underline">{ex.name}</span>
                </Link>
                <div className="-mt-2">
                  <ExerciseCredits exercise={ex} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
