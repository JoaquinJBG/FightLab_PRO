"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUpdateProfile } from "@/lib/hooks";
import { CONDITION_TOKENS, MEDICATION_TOKENS, PREGNANCY_TOKENS, splitFreeText } from "@/lib/onboarding";
import type { Profile } from "@/lib/schemas";
import { Choice, Hint, Label, SafetyNote, StepFooter, StepTitle, type StepProps } from "./ui";

function toggle(list: string[], token: string) {
  return list.includes(token) ? list.filter((x) => x !== token) : [...list, token];
}

/** Paso 6 (setup/SKILL.md): medicación y diagnósticos con los tokens de `docs/safety.md`
 * (selector, sin texto libre que interpretar) y el resto como texto sin clasificar. */
export function MedicalStep({
  profile,
  female,
  knowBp,
  onKnowBp,
  onNext,
}: StepProps & { profile: Profile; female: boolean; knowBp: boolean; onKnowBp: (v: boolean) => void }) {
  const t = useTranslations("onboarding.medical");
  const tc = useTranslations("onboarding");
  const update = useUpdateProfile();
  const [medications, setMedications] = useState<string[]>(profile.medications);
  const [conditions, setConditions] = useState<string[]>(profile.conditions);
  const [medsOther, setMedsOther] = useState(profile.medications_other.join(", "));
  const [condOther, setCondOther] = useState(profile.conditions_other.join(", "));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({
        medications,
        medications_other: splitFreeText(medsOther),
        conditions: female ? conditions : conditions.filter((c) => !(PREGNANCY_TOKENS as readonly string[]).includes(c)),
        conditions_other: splitFreeText(condOther),
      });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  const tokenList = (tokens: readonly string[], value: string[], set: (v: string[]) => void) => (
    <div className="flex flex-col gap-2">
      {tokens.map((tok) => (
        <Choice key={tok} selected={value.includes(tok)} onClick={() => set(toggle(value, tok))} className="text-left" testId={`token-${tok}`}>
          {t(`tokens.${tok}`)}
        </Choice>
      ))}
    </div>
  );

  return (
    <>
      <StepTitle k="medical.title" />
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("medications")}</Label>
          {tokenList(MEDICATION_TOKENS, medications, setMedications)}
          <input
            value={medsOther}
            onChange={(e) => setMedsOther(e.target.value)}
            placeholder={t("otherMedications")}
            aria-label={t("otherMedications")}
            className="field px-4 py-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("conditions")}</Label>
          {tokenList(CONDITION_TOKENS, conditions, setConditions)}
          {female && (
            <>
              <Label>{t("pregnancy")}</Label>
              {tokenList(PREGNANCY_TOKENS, conditions, setConditions)}
            </>
          )}
          <input
            value={condOther}
            onChange={(e) => setCondOther(e.target.value)}
            placeholder={t("otherConditions")}
            aria-label={t("otherConditions")}
            className="field px-4 py-3 text-sm"
          />
          <Hint>{t("otherHint")}</Hint>
        </div>
        {!conditions.includes("hypertension") && (
          <Choice selected={knowBp} onClick={() => onKnowBp(!knowBp)} testId="know-bp">
            {t("knowBp")}
          </Choice>
        )}
      </div>
      <SafetyNote />
      <StepFooter error={error} onNext={save} pending={update.isPending} />
    </>
  );
}
