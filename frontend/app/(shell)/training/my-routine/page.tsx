"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { PlanView } from "@/components/plan/PlanView";
import { PlanRoutines } from "@/components/routines/PlanRoutines";
import { intlLocale } from "@/lib/locale";
import { useWeeklyPlan } from "@/lib/plan";
import { START_PATH, usePlanRoutines } from "@/lib/routines";

/* Mi rutina (F17): la carpeta de rutinas que genera el plan del coach, editables como cualquier
   rutina, y debajo el plan con sus reglas. Sin plan aplicado, la página lleva a prepararlo. */
export default function MyRoutinePage() {
  const t = useTranslations("training.myRoutine");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const { data } = useWeeklyPlan();
  const plan = data?.active;
  const { data: generated } = usePlanRoutines(!!plan);

  // Sesión del plan → su rutina generada (`plan:<id>:<sesión>`), si ya está al día.
  const routineFor = (key: string) =>
    plan && generated?.in_sync
      ? generated.routines.find((r) => r.source === "plan" && r.source_ref === `plan:${plan.id}:${key}`)
      : undefined;

  return (
    <div className="pt-4 pb-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>

      {plan ? (
        <div data-testid="routine-active-plan">
          <div className="glass neon-edge mt-4 flex items-center justify-between gap-3 p-4">
            <p className="t-title text-sm text-ink">
              {tp("routineActive", {
                date: new Date(`${plan.week_start}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" }),
              })}
            </p>
            <Link href="/training/plan" className="t-label shrink-0 text-neon">{tp("routineEdit")}</Link>
          </div>
          <PlanRoutines planId={plan.id} />
          <PlanView
            plan={plan}
            sessionAction={(s) => {
              const r = routineFor(s.key);
              return (
                <Link
                  href={r ? START_PATH(r.id) : `/training/gym/session?plan=${s.key}`}
                  className="btn btn-tonal btn-sm mt-3 w-full"
                >
                  {tp("startSession", { key: s.key })}
                </Link>
              );
            }}
          />
        </div>
      ) : (
        <Link href="/training/plan" data-testid="routine-plan-cta" className="glass neon-edge mt-4 flex items-center justify-between gap-3 p-4">
          <span className="t-title text-sm text-ink">{tp("routineCta")}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-neon" />
        </Link>
      )}
    </div>
  );
}
