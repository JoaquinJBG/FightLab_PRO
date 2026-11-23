"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSafety, useUpdateScreening } from "@/lib/hooks";
import { SCOFF_CONTROL, SCOFF_ITEMS, needsFollowUp, scoffOutcome, type ScoffAnswer } from "@/lib/onboarding";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { Choice, Hint, SafetyNote, StepFooter, StepTitle, type StepProps } from "./ui";

/** Paso 2 (setup/SKILL.md): las cinco preguntas del coach sobre la comida, antes del peso.
 * Se guardan solo los resultados (`scoff_yes_count`, `scoff_positive`); el punto de corte
 * lo aplica el motor. */
export function ScoffStep({ onNext }: StepProps) {
  const t = useTranslations("onboarding");
  const save = useUpdateScreening();
  const [answers, setAnswers] = useState<(ScoffAnswer | undefined)[]>(SCOFF_ITEMS.map(() => undefined));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ count: number } | null>(null);
  const safety = useSafety(saved !== null);

  function set(i: number, a: ScoffAnswer) {
    setAnswers((prev) => prev.map((x, j) => (j === i ? a : x)));
  }

  async function submit() {
    setError(null);
    const done = answers.every((a, i) => a && (!needsFollowUp(i, a) || a.followUp !== undefined));
    if (!done) return setError(t("scoff.incomplete"));
    const outcome = scoffOutcome(answers as ScoffAnswer[]);
    try {
      await save.mutateAsync(outcome);
      setSaved({ count: outcome.scoff_yes_count });
    } catch {
      setError(t("saveError"));
    }
  }

  if (saved) {
    const data = safety.data;
    const positive = !!data?.reasons.some((r) => r.code === "eating_disorder_screen");
    const own = data && { ...data, reasons: data.reasons.filter((r) => r.code === "eating_disorder_screen"), parq_pending: false };
    return (
      <>
        <StepTitle k="scoff.title" />
        <div data-testid="scoff-outcome" className="mt-4">
          {!data ? (
            <p className="t-body text-sm text-muted">{t("saving")}</p>
          ) : positive && own ? (
            <>
              <p className="t-body text-sm text-ink">{t("scoff.positive")}</p>
              <SafetyPanel data={own} />
              <Hint>{t("scoff.redoNote")}</Hint>
            </>
          ) : (
            <>
              <p className="t-body text-sm text-ink">{saved.count === 1 ? t("scoff.single") : t("scoff.clear")}</p>
              <SafetyNote />
            </>
          )}
        </div>
        <StepFooter onNext={onNext} pending={!data} />
      </>
    );
  }

  return (
    <>
      <StepTitle k="scoff.title" />
      <p className="t-body mt-1 text-xs text-muted">{t("scoff.intro")}</p>
      <p className="t-label mt-4 text-ink">{t("scoff.question")}</p>
      <ol className="mt-3 flex flex-col gap-4">
        {SCOFF_ITEMS.map((item, i) => {
          const a = answers[i];
          return (
            <li key={item} data-testid={`scoff-${item}`} className="flex flex-col gap-2">
              <p className="t-body text-sm text-ink">{t(`scoff.items.${item}`)}</p>
              <div className="flex gap-2">
                <Choice selected={a?.answer === "yes"} onClick={() => set(i, { answer: "yes" })} className="flex-1" testId="yes">
                  {t("yes")}
                </Choice>
                <Choice selected={a?.answer === "no"} onClick={() => set(i, { answer: "no" })} className="flex-1" testId="no">
                  {t("no")}
                </Choice>
                <Choice selected={a?.answer === "partial"} onClick={() => set(i, { answer: "partial" })} className="flex-1" testId="partial">
                  {t("scoff.partial")}
                </Choice>
              </div>
              {needsFollowUp(i, a) && a && (
                <div className="flex flex-col gap-2 pl-3" data-testid="scoff-follow-up">
                  <p className="t-body text-xs text-muted">
                    {i === SCOFF_CONTROL ? t("scoff.followUpControl") : t("scoff.followUp")}
                  </p>
                  <div className="flex gap-2">
                    <Choice selected={a.followUp === true} onClick={() => set(i, { ...a, followUp: true })} className="flex-1" testId="follow-yes">
                      {t("yes")}
                    </Choice>
                    <Choice selected={a.followUp === false} onClick={() => set(i, { ...a, followUp: false })} className="flex-1" testId="follow-no">
                      {t("no")}
                    </Choice>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <SafetyNote />
      <StepFooter error={error} onNext={submit} pending={save.isPending} />
    </>
  );
}
