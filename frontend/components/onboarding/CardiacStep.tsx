"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSafety, useUpdateScreening } from "@/lib/hooks";
import { Choice, Hint, SafetyNote, StepFooter, StepTitle, type StepProps } from "./ui";

type Phase = "ask" | "again" | "now" | "stop" | "unsureStored";

/** Paso 5 (setup/SKILL.md): síntomas de alarma cardiaca. Con algún síntoma ahora o en
 * reposo se para el flujo y se muestra el número de emergencias. "No lo tengo claro" se
 * describe una vez más; si sigue sin estar claro, se guarda `false` con el aviso. */
export function CardiacStep({ onNext, onExit }: StepProps & { onExit: () => void }) {
  const t = useTranslations("onboarding.cardiac");
  const tc = useTranslations("onboarding");
  const save = useUpdateScreening();
  const [phase, setPhase] = useState<Phase>("ask");
  const [error, setError] = useState<string | null>(null);
  const safety = useSafety(phase === "stop");
  const symptoms = t.raw("symptoms") as string[];

  async function store(value: boolean, next: () => void) {
    setError(null);
    try {
      await save.mutateAsync({ cardiac_symptoms: value });
      next();
    } catch {
      setError(tc("saveError"));
    }
  }

  if (phase === "stop") {
    const number = safety.data?.emergency_number;
    return (
      <div data-testid="cardiac-stop">
        <h1 className="t-display text-2xl text-bad">{t("stopTitle")}</h1>
        <p className="t-body mt-3 text-sm text-ink">{t("stopBody")}</p>
        {number && (
          <a href={`tel:${number}`} data-testid="emergency-call" className="btn btn-primary mt-5 w-full">
            {t("call", { number })}
          </a>
        )}
        <SafetyNote full />
        <button type="button" onClick={onExit} className="t-label mt-6 w-full text-center text-muted">
          {t("exit")}
        </button>
      </div>
    );
  }

  const list = (
    <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">
      {symptoms.map((s) => (
        <li key={s} className="t-body text-sm text-ink">
          {s}
        </li>
      ))}
    </ul>
  );

  if (phase === "unsureStored") {
    return (
      <>
        <StepTitle k="cardiac.title" />
        <p className="t-body mt-4 text-sm text-ink">{t("unsureStored")}</p>
        <SafetyNote />
        <StepFooter onNext={onNext} />
      </>
    );
  }

  if (phase === "now") {
    return (
      <>
        <StepTitle k="cardiac.title" />
        <p className="t-body mt-4 text-sm text-ink">{t("now")}</p>
        <div className="mt-3 flex gap-2">
          <Choice selected={false} onClick={() => store(true, () => setPhase("stop"))} className="flex-1" testId="now-yes">
            {tc("yes")}
          </Choice>
          <Choice selected={false} onClick={() => store(true, onNext)} className="flex-1" testId="now-no">
            {tc("no")}
          </Choice>
        </div>
        <SafetyNote />
        {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
      </>
    );
  }

  return (
    <>
      <StepTitle k="cardiac.title" />
      <p className="t-body mt-3 text-sm text-ink">{phase === "again" ? t("unsureAgain") : t("question")}</p>
      {list}
      <div className="mt-4 flex flex-col gap-2">
        <Choice selected={false} onClick={() => store(false, onNext)} testId="cardiac-none">
          {t("none")}
        </Choice>
        <Choice selected={false} onClick={() => setPhase("now")} testId="cardiac-some">
          {t("some")}
        </Choice>
        {phase === "ask" ? (
          <Choice selected={false} onClick={() => setPhase("again")} testId="cardiac-unsure">
            {t("unsure")}
          </Choice>
        ) : (
          <Choice selected={false} onClick={() => store(false, () => setPhase("unsureStored"))} testId="cardiac-still-unsure">
            {t("stillUnsure")}
          </Choice>
        )}
      </div>
      {save.isPending && <Hint>{tc("saving")}</Hint>}
      <SafetyNote />
      {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
    </>
  );
}
