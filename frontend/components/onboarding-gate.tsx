"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProfile, useScreening, useUpdateProfile } from "@/lib/hooks";
import { isOnboardingComplete } from "@/lib/onboarding";
import { LEGACY_GOAL_KEY, goalToMigrate } from "@/lib/goal";

const SLOW_MS = 10_000;

export type GateView = "children" | "skeleton" | "slow" | "error";

/** Decisión pura del gate (testeable sin React). `/training/*` (sesión de
 *  gimnasio, herramientas) nunca espera al perfil: registrar un entreno no
 *  puede depender de un backend lento. Fuera de ahí, esqueleto mientras
 *  carga y, si falla o tarda ≥ 10 s, un botón de reintento. */
export function gateView(args: {
  pathname: string | null;
  isLoading: boolean;
  isError: boolean;
  incomplete: boolean;
  slow: boolean;
}): GateView {
  const training = !!args.pathname && (args.pathname === "/training" || args.pathname.startsWith("/training/"));
  if (training) return "children";
  if (args.incomplete) return "skeleton"; // redirigiendo a /onboarding
  if (args.isError) return "error";
  if (args.isLoading) return args.slow ? "slow" : "skeleton";
  return "children";
}

/**
 * Si el perfil o el cribado están incompletos, manda a /onboarding antes de dejarle
 * ver el shell. Así, tras verificar el email e iniciar sesión, lo primero que ve es
 * el onboarding, que se reanuda en el paso que falta.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const tg = useTranslations("shell.gate");
  const router = useRouter();
  const pathname = usePathname();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const { data: screening, isLoading: screeningLoading } = useScreening();
  // Sin datos básicos, sin SCOFF o sin la pregunta de síntomas cardiacos, se vuelve al paso
  // del onboarding que falta (spec §8.1). El PAR-Q+ no bloquea: la Home lo recuerda.
  const incomplete = !!profile && !!screening && !isOnboardingComplete(profile, screening.values);
  const loading = isLoading || screeningLoading;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (incomplete) router.replace("/onboarding");
  }, [incomplete, router]);

  useEffect(() => {
    if (!loading) {
      const reset = setTimeout(() => setSlow(false), 0);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // Primera carga tras la fase 3: el objetivo de localStorage pasa al perfil (spec §6.2).
  const update = useUpdateProfile();
  const migrated = useRef(false);
  useEffect(() => {
    if (!profile || migrated.current) return;
    migrated.current = true;
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(LEGACY_GOAL_KEY);
    } catch {
      return;
    }
    const goal = goalToMigrate(profile.goal, legacy);
    if (goal) update.mutate({ goal }, { onSuccess: () => localStorage.removeItem(LEGACY_GOAL_KEY) });
    else if (legacy && profile.goal) localStorage.removeItem(LEGACY_GOAL_KEY);
  }, [profile, update]);

  const view = gateView({ pathname, isLoading: loading, isError, incomplete, slow });
  if (view === "children") return <>{children}</>;
  if (view === "skeleton") {
    return (
      <div className="flex min-h-[60dvh] flex-col gap-3 pt-6" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className="glass pulse h-8 w-2/3 rounded-xl" />
        <div className="glass pulse h-28 w-full rounded-2xl" />
        <div className="glass pulse h-28 w-full rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="t-body text-muted">{view === "slow" ? tg("slow") : tg("error")}</p>
      <button type="button" className="btn btn-primary" onClick={() => void refetch()}>
        {tg("retry")}
      </button>
    </div>
  );
}
