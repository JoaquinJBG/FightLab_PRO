"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUpdateScreening } from "@/lib/hooks";
import { MENSTRUAL_STATES } from "@/lib/onboarding";
import type { Screening } from "@/lib/schemas";
import { Choice, Hint, Label, SafetyNote, StepFooter, StepTitle, type StepProps } from "./ui";

/** Tensión en reposo (setup/SKILL.md, paso 6). Con hipertensión y sin lectura no se guarda
 * nada: el motor aplica entonces la banda de "tensión desconocida". */
export function BpStep({ screening, onNext }: StepProps & { screening: Screening }) {
  const t = useTranslations("onboarding.bp");
  const tc = useTranslations("onboarding");
  const save = useUpdateScreening();
  const [sys, setSys] = useState(screening.values.bp_systolic?.toString() ?? "");
  const [dia, setDia] = useState(screening.values.bp_diastolic?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!sys && !dia) return onNext();
    const s = Number(sys);
    const d = Number(dia);
    const ok = (n: number) => Number.isInteger(n) && n > 20 && n < 300;
    if (!ok(s) || !ok(d)) return setError(t("invalid"));
    try {
      await save.mutateAsync({ bp_systolic: s, bp_diastolic: d });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  return (
    <>
      <StepTitle k="bp.title" />
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <div className="mt-5 flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <Label>{t("systolic")}</Label>
          <input inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value)} placeholder="120" className="field px-4 py-3 text-sm" />
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <Label>{t("diastolic")}</Label>
          <input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} placeholder="80" className="field px-4 py-3 text-sm" />
        </label>
      </div>
      <Hint>{t("unknown")}</Hint>
      <SafetyNote />
      <StepFooter error={error} onNext={submit} onSkip={onNext} pending={save.isPending} />
    </>
  );
}

/** Ciclo (setup/SKILL.md, paso 7). Los anticonceptivos hormonales no se guardan: solo el aviso. */
export function CycleStep({ screening, onNext }: StepProps & { screening: Screening }) {
  const t = useTranslations("onboarding.cycle");
  const tc = useTranslations("onboarding");
  const save = useUpdateScreening();
  const [state, setState] = useState<string | null>(screening.values.menstrual);
  const [contraception, setContraception] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!state) return setError(t("incomplete"));
    try {
      await save.mutateAsync({ menstrual: state });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  return (
    <>
      <StepTitle k="cycle.title" />
      <p className="t-body mt-3 text-sm text-ink">{t("question")}</p>
      <div className="mt-3 flex flex-col gap-2">
        {MENSTRUAL_STATES.map((s) => (
          <Choice key={s} selected={state === s} onClick={() => setState(s)} className="text-left" testId={`menstrual-${s}`}>
            {t(`states.${s}`)}
          </Choice>
        ))}
      </div>
      <p className="t-body mt-5 text-sm text-ink">{t("contraception")}</p>
      <div className="mt-2 flex gap-2">
        <Choice selected={contraception === true} onClick={() => setContraception(true)} className="flex-1">
          {tc("yes")}
        </Choice>
        <Choice selected={contraception === false} onClick={() => setContraception(false)} className="flex-1">
          {tc("no")}
        </Choice>
      </div>
      {contraception && <Hint>{t("contraceptionNote")}</Hint>}
      <SafetyNote />
      <StepFooter error={error} onNext={submit} pending={save.isPending} />
    </>
  );
}
