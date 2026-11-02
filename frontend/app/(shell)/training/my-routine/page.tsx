"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { TrainingIcon, GloveIcon, MoonIcon, ChevronRight } from "@/components/icons";
import { PlanView } from "@/components/plan/PlanView";
import { intlLocale } from "@/lib/locale";
import { useWeeklyPlan } from "@/lib/plan";

const COACH = { name: "Carlos Méndez", updatedDays: 2 };

/* Plan de ejemplo (el panel del coach llegará más adelante). Los ejercicios de
   gimnasio llevan clave de `training.gym.exercises`; el resto, clave de este
   namespace en `plan.<día>.items.<n>`. */
type Item = { ex: string; scheme: string } | { text: number };
type Day = { day: string; type: "gym" | "mma" | "rest"; items: Item[] };
const PLAN: Day[] = [
  { day: "mon", type: "gym", items: [{ ex: "benchPress", scheme: "4×8" }, { ex: "overheadPress", scheme: "3×10" }, { ex: "dips", scheme: "3×12" }, { ex: "tricepsExtensionShort", scheme: "3×15" }] },
  { day: "tue", type: "mma", items: [{ text: 0 }, { text: 1 }, { text: 2 }, { text: 3 }] },
  { day: "wed", type: "gym", items: [{ ex: "pullUps", scheme: "4×8" }, { ex: "barbellRow", scheme: "4×10" }, { ex: "bicepsCurl", scheme: "3×12" }, { ex: "facePull", scheme: "3×15" }] },
  { day: "thu", type: "mma", items: [{ text: 0 }, { text: 1 }, { text: 2 }, { text: 3 }] },
  { day: "fri", type: "gym", items: [{ ex: "squat", scheme: "5×5" }, { ex: "romanianDeadlift", scheme: "4×8" }, { ex: "legPress", scheme: "3×12" }, { ex: "calfRaises", scheme: "4×15" }] },
  { day: "sat", type: "mma", items: [{ text: 0 }, { text: 1 }, { text: 2 }] },
  { day: "sun", type: "rest", items: [{ text: 0 }] },
];

const ICONS = { gym: TrainingIcon, mma: GloveIcon, rest: MoonIcon } as const;

/** El plan del coach que se aplicó desde "Plan de la semana" (fase 6). */
function ActivePlan() {
  const t = useTranslations("training.myRoutine");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const { data } = useWeeklyPlan();
  const plan = data?.active;
  if (!plan) {
    return (
      <Link href="/training/plan" data-testid="routine-plan-cta" className="glass neon-edge mt-4 flex items-center justify-between gap-3 p-4">
        <span className="t-title text-sm text-ink">{tp("routineCta")}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-neon" />
      </Link>
    );
  }
  const date = new Date(`${plan.week_start}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" });
  return (
    <div data-testid="routine-active-plan" className="pb-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <div className="glass neon-edge mt-4 flex items-center justify-between gap-3 p-4">
        <p className="t-title text-sm text-ink">{tp("routineActive", { date })}</p>
        <Link href="/training/plan" className="t-label shrink-0 text-neon">{tp("routineEdit")}</Link>
      </div>
      <PlanView
        plan={plan}
        sessionAction={(s) => (
          <Link href={`/training/gym/session?plan=${s.key}`} className="btn btn-tonal btn-sm mt-3 w-full">
            {tp("startSession", { key: s.key })}
          </Link>
        )}
      />
    </div>
  );
}

export default function MyRoutinePage() {
  const { data } = useWeeklyPlan();
  if (data?.active) return <div className="pt-4"><ActivePlan /></div>;
  return <ExampleRoutine />;
}

/** La rutina de ejemplo de antes (sin plan aplicado), con el acceso al plan del coach. */
function ExampleRoutine() {
  const t = useTranslations("training.myRoutine");
  const tg = useTranslations("training.gym");
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const trainingDays = PLAN.filter((d) => d.type !== "rest").length;

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>

      <ActivePlan />

      {/* Coach */}
      <div className="glass neon-edge mt-4 flex items-center gap-3 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full glass font-display text-neon">
          {COACH.name.split(" ").map((p) => p[0]).join("")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-title text-ink">{COACH.name}</p>
          <p className="t-body text-xs text-muted">{t("coachLine", { days: COACH.updatedDays })}</p>
        </div>
        <span className="badge badge-neon">{t("daysBadge", { n: trainingDays })}</span>
      </div>

      {/* Días */}
      <div className="mt-4 flex flex-col gap-2.5">
        {PLAN.map((d, i) => {
          const Icon = ICONS[d.type];
          const isDone = done.has(i);
          const rest = d.type === "rest";
          return (
            <div key={d.day} className={`glass p-4 ${isDone ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${rest ? "text-muted bg-[rgba(150,190,255,0.06)]" : "text-neon bg-[rgba(69,233,255,0.07)]"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="t-title text-ink">{t(`days.${d.day}`)}</p>
                  <p className="t-body text-xs text-muted">
                    <span className={rest ? "" : "text-neon"}>{t(`types.${d.type}`)}</span> · {t(`plan.${d.day}.focus`)}
                  </p>
                </div>
                {!rest && (
                  <button onClick={() => toggle(i)} aria-label={t("markDone")}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors ${isDone ? "border-transparent bg-good text-[#03101c]" : "border-[rgba(150,190,255,0.25)] text-muted"}`}>
                    ✓
                  </button>
                )}
              </div>
              {!rest && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-3">
                  {d.items.map((it, n) => (
                    <li key={n} className="t-body flex items-center gap-2 text-sm text-muted">
                      <ChevronRight className="h-3 w-3 shrink-0 text-neon" /> {"ex" in it ? t("exerciseItem", { name: tg(`exercises.${it.ex}`), scheme: it.scheme }) : t(`plan.${d.day}.items.${it.text}`)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="t-body mt-4 text-center text-xs text-muted">
        {t("footer")}
      </p>
    </div>
  );
}
