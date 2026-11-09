"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProfile, useScreening } from "@/lib/hooks";
import { ageOn, firstMissingStep, stepProgress, steps, type Step } from "@/lib/onboarding";
import { GloveIcon, PulseIcon, NutritionIcon, ChevronRight } from "@/components/icons";
import { LanguageStep } from "@/components/onboarding/LanguageStep";
import { ScoffStep } from "@/components/onboarding/ScoffStep";
import { BasicsStep } from "@/components/onboarding/BasicsStep";
import { ParqStep } from "@/components/onboarding/ParqStep";
import { CardiacStep } from "@/components/onboarding/CardiacStep";
import { MedicalStep } from "@/components/onboarding/MedicalStep";
import { BpStep, CycleStep } from "@/components/onboarding/BpCycleSteps";
import { GoalsStep } from "@/components/onboarding/GoalsStep";
import { SafetyBanner } from "@/components/safety/SafetyBanner";
import { StepTitle } from "@/components/onboarding/ui";

/** Onboarding con cribado (Task 3.6), con los pasos de `setup/SKILL.md` integrados en el
 * asistente del plan v1. Guarda cada paso al terminarlo; si se deja a medias, se reanuda en
 * el primer paso obligatorio que falta. `?step=parq` abre un solo paso (p. ej. desde el aviso
 * de PAR-Q+ pendiente) y `?redo=1` repite el cribado entero. */
function Onboarding() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const params = useSearchParams();
  const { data: profile } = useProfile();
  const { data: screening } = useScreening();
  const [knowBp, setKnowBp] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [basicsWeight, setBasicsWeight] = useState(false);
  const onBasicsPhase = useCallback((p: "form" | "weight") => setBasicsWeight(p === "weight"), []);
  const single = params.get("step") as Step | null;
  // Primer onboarding (no un paso suelto ni un cribado repetido): termina con una primera acción.
  const firstRun = !single && !params.get("redo");

  const female = profile?.gender === "FEMALE" || profile?.equation_sex === "female";
  const hypertension = !!profile?.conditions.includes("hypertension") || knowBp || screening?.values.bp_systolic != null;
  const flow = useMemo(() => steps({ female, hypertension }), [female, hypertension]);

  // Paso inicial, una sola vez al llegar los datos: el pedido por la URL, el que falta o la
  // bienvenida. (Se fija durante el render, el patrón de React para derivar estado.)
  if (step === null && profile && screening) {
    const missing = firstMissingStep(profile, screening.values);
    const started = !!profile.date_of_birth || screening.values.scoff_yes_count != null || !!profile.region;
    setStep(
      single && flow.includes(single)
        ? single
        : params.get("redo")
          ? "scoff"
          : missing && started
            ? missing
            : "welcome",
    );
  }

  if (!profile || !screening || !step) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="t-body pulse text-muted">{t("saving")}</p>
      </div>
    );
  }

  const index = flow.indexOf(step);
  const next = () => setStep(single ? "done" : (flow[index + 1] ?? "done"));
  const back = () => setStep(flow[Math.max(1, index - 1)]);
  const finish = () => router.replace("/today");
  const { n, total } = stepProgress(flow, step, basicsWeight);

  if (step === "welcome") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
        <div className="glass glow mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
          <span className="font-display text-2xl font-bold neon-text">FL</span>
        </div>
        <h1 className="t-display text-3xl text-ink">
          {t.rich("welcome.title", { neon: (c) => <span className="neon-text">{c}</span> })}
        </h1>
        <p className="t-body mt-2 text-muted">{t("welcome.subtitle")}</p>
        <ul className="mt-6 flex flex-col gap-4">
          {(
            [
              [PulseIcon, "f1"],
              [GloveIcon, "f2"],
              [NutritionIcon, "f3"],
            ] as const
          ).map(([Icon, k]) => (
            <li key={k} className="flex items-start gap-3">
              <span className="text-neon mt-0.5">
                <Icon className="h-5 w-5" />
              </span>
              <p className="t-body text-sm text-ink">
                <span className="font-medium">{t(`welcome.${k}Title`)}</span>
                <span className="text-muted">{t(`welcome.${k}Body`)}</span>
              </p>
            </li>
          ))}
        </ul>
        <button onClick={() => setStep("language")} data-testid="onboarding-start" className="btn btn-primary mt-8 w-full">
          {t("welcome.start")} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 safe-top safe-bottom">
      {step !== "done" && (
        <div className="pt-6">
          <div className="flex items-center justify-between">
            <p className="t-label text-muted" data-testid="onboarding-progress">
              {t("step", { n, total })}
            </p>
            {index > 1 && !single && (
              <button type="button" onClick={back} className="t-label text-muted">
                {t("back")}
              </button>
            )}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[rgba(150,190,255,0.12)]">
            <div
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(n / total) * 100}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col justify-center py-6" data-testid={`onboarding-step-${step}`}>
        {step === "language" && <LanguageStep profile={profile} onNext={next} />}
        {step === "scoff" && <ScoffStep onNext={next} />}
        {step === "basics" && <BasicsStep profile={profile} onNext={next} onPhase={onBasicsPhase} />}
        {step === "parq" && (
          <ParqStep screening={screening} age={ageOn(profile.date_of_birth, new Date())} onNext={next} />
        )}
        {step === "cardiac" && <CardiacStep onNext={next} onExit={finish} />}
        {step === "medical" && (
          <MedicalStep profile={profile} female={female} knowBp={knowBp} onKnowBp={setKnowBp} onNext={next} />
        )}
        {step === "bp" && <BpStep screening={screening} onNext={next} />}
        {step === "cycle" && <CycleStep screening={screening} onNext={next} />}
        {step === "goals" && <GoalsStep profile={profile} onNext={next} />}
        {step === "done" && (
          <>
            <StepTitle k="done.title" />
            <p className="t-body mt-1 text-xs text-muted">{t("done.intro")}</p>
            <SafetyBanner showEmpty />
            {firstRun ? (
              <>
                <p className="t-body mt-6 text-sm text-muted">{t("done.firstActionIntro")}</p>
                <Link href="/training" data-testid="onboarding-first-action" className="btn btn-primary mt-3 w-full">
                  {t("done.firstAction")} <ChevronRight className="h-4 w-4" />
                </Link>
                <button onClick={finish} data-testid="onboarding-finish" className="t-label mt-4 w-full text-center text-muted">
                  {t("done.goHome")}
                </button>
              </>
            ) : (
              <button onClick={finish} data-testid="onboarding-finish" className="btn btn-primary mt-6 w-full">
                {t("done.start")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
