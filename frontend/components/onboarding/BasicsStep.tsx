"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DobInput, dobErrorCode, dobToIso, type Dob, type DobLabels } from "@/components/dob-input";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { useCreateBiometrics, useSafety, useUpdateProfile } from "@/lib/hooks";
import type { Profile } from "@/lib/schemas";
import { Choice, Hint, Label, StepFooter, StepTitle, type StepProps } from "./ui";

const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

function dobFromIso(iso: string | null): Dob {
  if (!iso) return { day: "", month: "", year: "" };
  const [year, month, day] = iso.split("-");
  return { day, month, year };
}

/** Paso 3 (setup/SKILL.md): datos básicos y, después, el peso. `equation_sex` solo si
 * `gender` es OTHER o nulo. El peso se pide según los flags del servidor: menor de 18, no;
 * tras un cribado positivo, un peso aproximado y opcional, sin pedir que se pese. */
export function BasicsStep({ profile, onNext }: StepProps & { profile: Profile }) {
  const t = useTranslations("onboarding.basics");
  const tc = useTranslations("onboarding");
  const update = useUpdateProfile();
  const createLog = useCreateBiometrics();
  const [phase, setPhase] = useState<"form" | "weight">("form");
  const [dob, setDob] = useState<Dob>(dobFromIso(profile.date_of_birth));
  const [height, setHeight] = useState(profile.height_cm ? String(profile.height_cm) : "");
  const [gender, setGender] = useState(profile.gender ?? "");
  const [equationSex, setEquationSex] = useState<string>(profile.equation_sex ?? "none");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const safety = useSafety(phase === "weight");

  const needsEquationSex = gender !== "MALE" && gender !== "FEMALE";
  const labels: DobLabels = {
    day: t("dobLabels.day"),
    month: t("dobLabels.month"),
    year: t("dobLabels.year"),
    dd: t("dobLabels.dd"),
    mm: t("dobLabels.mm"),
    yyyy: t("dobLabels.yyyy"),
  };

  async function saveForm() {
    setError(null);
    const dobErr = dobErrorCode(dob);
    if (dobErr) return setError(t(`dobErrors.${dobErr}`));
    const h = Number(height);
    if (!height || !Number.isFinite(h) || h < 100 || h > 230) return setError(t("heightInvalid"));
    try {
      await update.mutateAsync({
        date_of_birth: dobToIso(dob),
        height_cm: h,
        gender: gender || null,
        equation_sex: needsEquationSex && equationSex !== "none" ? equationSex : null,
      });
      setPhase("weight");
    } catch {
      setError(tc("saveError"));
    }
  }

  async function saveWeight() {
    setError(null);
    if (!weight) return onNext();
    const w = Number(weight.replace(",", "."));
    if (!Number.isFinite(w) || w < 30 || w > 250) return setError(t("weightInvalid"));
    try {
      await createLog.mutateAsync({ weight_kg: w.toFixed(2) });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  if (phase === "weight") {
    const data = safety.data;
    if (!data) return <p className="t-body text-sm text-muted">{tc("saving")}</p>;
    if (data.flags.no_calorie_targets) {
      const own = { ...data, reasons: data.reasons.filter((r) => r.code === "under_18"), parq_pending: false };
      return (
        <>
          <StepTitle k="basics.weightTitle" />
          <p className="t-body mt-2 text-sm text-ink">{t("under18")}</p>
          <SafetyPanel data={own} />
          <StepFooter onNext={onNext} />
        </>
      );
    }
    return (
      <>
        <StepTitle k="basics.weightTitle" />
        <p className="t-body mt-1 text-xs text-muted">{data.flags.no_weight_targets ? t("weightGentle") : t("weightHint")}</p>
        <label className="mt-5 flex flex-col gap-1.5">
          <Label>{t("weight")}</Label>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="75"
            data-testid="weight-input"
            className="field px-4 py-3 text-sm"
          />
        </label>
        <StepFooter error={error} onNext={saveWeight} onSkip={onNext} pending={createLog.isPending} />
      </>
    );
  }

  return (
    <>
      <StepTitle k="basics.title" />
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("dob")}</Label>
          <DobInput value={dob} onChange={setDob} labels={labels} />
          <Hint>{t("dobHint")}</Hint>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>{t("height")}</Label>
          <input
            type="number"
            inputMode="numeric"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="175"
            data-testid="height-input"
            className="field px-4 py-3 text-sm"
          />
          <Hint>{t("heightHint")}</Hint>
        </label>
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("gender")} <span className="text-[10px]">{t("optional")}</span>
          </Label>
          <div className="flex gap-2">
            {GENDERS.map((g) => (
              <Choice key={g} selected={gender === g} onClick={() => setGender(gender === g ? "" : g)} className="flex-1" testId={`gender-${g}`}>
                {t(`genders.${g}`)}
              </Choice>
            ))}
          </div>
          <Hint>{t("genderHint")}</Hint>
        </div>
        {needsEquationSex && (
          <div className="flex flex-col gap-1.5" data-testid="equation-sex">
            <p className="t-body text-sm text-ink">{t("equationSex")}</p>
            <div className="flex gap-2">
              {(["female", "male", "none"] as const).map((v) => (
                <Choice key={v} selected={equationSex === v} onClick={() => setEquationSex(v)} className="flex-1">
                  {t(`equationSexes.${v}`)}
                </Choice>
              ))}
            </div>
            <Hint>{t("equationSexHint")}</Hint>
          </div>
        )}
      </div>
      <StepFooter error={error} onNext={saveForm} pending={update.isPending} />
    </>
  );
}
