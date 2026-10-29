"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProfile, useScreening, useUpdateProfile } from "@/lib/hooks";
import { isOnboardingComplete } from "@/lib/onboarding";
import { LEGACY_GOAL_KEY, goalToMigrate } from "@/lib/goal";

/**
 * Si el perfil o el cribado están incompletos, manda a /onboarding antes de dejarle
 * ver el shell. Así, tras verificar el email e iniciar sesión, lo primero que ve es
 * el onboarding, que se reanuda en el paso que falta.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: profile, isLoading, isError } = useProfile();
  const { data: screening, isLoading: screeningLoading } = useScreening();
  // Sin datos básicos, sin SCOFF o sin la pregunta de síntomas cardiacos, se vuelve al paso
  // del onboarding que falta (spec §8.1). El PAR-Q+ no bloquea: la Home lo recuerda.
  const incomplete = !!profile && !!screening && !isOnboardingComplete(profile, screening.values);

  useEffect(() => {
    if (incomplete) router.replace("/onboarding");
  }, [incomplete, router]);

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

  if (isLoading || screeningLoading || incomplete) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <p className="t-body pulse text-muted">Cargando…</p>
      </div>
    );
  }
  // isError (p. ej. sesión caída) → deja pasar; el middleware ya gobierna el login.
  void isError;
  return <>{children}</>;
}
