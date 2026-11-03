"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUpdateScreening } from "@/lib/hooks";
import { askVigorousReview, triToBool, type Tri } from "@/lib/onboarding";
import type { Screening } from "@/lib/schemas";
import { Choice, Hint, SafetyNote, StepFooter, StepTitle, type StepProps } from "./ui";

function TriChoice({ value, onChange, name }: { value: Tri | null; onChange: (v: Tri) => void; name: string }) {
  const t = useTranslations("onboarding");
  return (
    <div className="flex flex-col gap-2" data-testid={name}>
      <div className="flex gap-2">
        <Choice selected={value === "yes"} onClick={() => onChange("yes")} className="flex-1" testId="yes">
          {t("yes")}
        </Choice>
        <Choice selected={value === "no"} onClick={() => onChange("no")} className="flex-1" testId="no">
          {t("no")}
        </Choice>
      </div>
      <Choice selected={value === "unsure"} onClick={() => onChange("unsure")} testId="unsure">
        {t("parq.unsure")}
      </Choice>
    </div>
  );
}

function toTri(v: boolean | null): Tri | null {
  return v === true ? "yes" : v === false ? "no" : null;
}

/** PAR-Q+ guiado (spec §8.1): el formulario oficial se abre en eparmedx.com (URL de la
 * configuración del backend, en el idioma del usuario) y aquí solo se hacen las dos preguntas
 * del coach. Nunca se copia ni se incrusta el formulario: `parq_native_form` sigue en false. */
export function ParqStep({ screening, age, onNext }: StepProps & { screening: Screening; age: number | null }) {
  const t = useTranslations("onboarding.parq");
  const tc = useTranslations("onboarding");
  const save = useUpdateScreening();
  const v = screening.values;
  const [anyYes, setAnyYes] = useState<Tri | null>(toTri(v.parq_any_yes));
  const [followup, setFollowup] = useState<Tri | null>(toTri(v.parq_followup_yes));
  const [reviewed, setReviewed] = useState<boolean | null>(v.vigorous_reviewed);
  const [error, setError] = useState<string | null>(null);

  const any = anyYes ? triToBool(anyYes) : null;
  // Las preguntas de seguimiento solo se alcanzan con un SÍ en las 7 generales.
  const follow = any === true && followup ? triToBool(followup) : any === false ? false : null;
  const askReview = anyYes !== null && (any !== true || followup !== null) && askVigorousReview(any, follow, age);

  async function submit() {
    setError(null);
    if (anyYes === null || (any === true && followup === null) || (askReview && reviewed === null)) {
      return setError(t("incomplete"));
    }
    try {
      await save.mutateAsync({
        parq_any_yes: any,
        parq_followup_yes: follow,
        // Solo un sí claro cuenta como revisado (setup/SKILL.md, paso 4).
        vigorous_reviewed: askReview ? reviewed : null,
      });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  return (
    <>
      <StepTitle k="parq.title" />
      <p className="t-body mt-1 text-sm text-ink">{t("intro")}</p>
      <a
        href={screening.parq_url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="parq-official-link"
        className="btn btn-primary mt-4 w-full"
      >
        {t("open")} ↗
      </a>
      <Hint>{t("openNote")}</Hint>

      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="t-body text-sm text-ink">{t("anyYes")}</p>
          <TriChoice name="parq-any-yes" value={anyYes} onChange={setAnyYes} />
        </div>
        {any === true && (
          <div className="flex flex-col gap-2">
            <p className="t-body text-sm text-ink">{t("followupYes")}</p>
            <TriChoice name="parq-followup-yes" value={followup} onChange={setFollowup} />
          </div>
        )}
        {(anyYes === "unsure" || followup === "unsure") && <Hint>{t("unsureNote")}</Hint>}
        {askReview && (
          <div className="flex flex-col gap-2" data-testid="parq-vigorous">
            <p className="t-body text-sm text-ink">{t("vigorous")}</p>
            <div className="flex gap-2">
              <Choice selected={reviewed === true} onClick={() => setReviewed(true)} className="flex-1" testId="yes">
                {tc("yes")}
              </Choice>
              <Choice selected={reviewed === false} onClick={() => setReviewed(false)} className="flex-1" testId="no">
                {tc("no")}
              </Choice>
            </div>
          </div>
        )}
      </div>
      <SafetyNote />
      <StepFooter error={error} onNext={submit} pending={save.isPending} />
    </>
  );
}
