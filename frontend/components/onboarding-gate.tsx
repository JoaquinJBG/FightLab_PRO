"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/hooks";

/**
 * Si el perfil del usuario está incompleto (sin fecha de nacimiento o altura),
 * lo manda a /onboarding antes de dejarle ver el shell. Así, tras verificar el
 * email e iniciar sesión, lo primero que ve es "info personal".
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: profile, isLoading, isError } = useProfile();
  const incomplete = !!profile && (!profile.date_of_birth || profile.height_cm == null);

  useEffect(() => {
    if (incomplete) router.replace("/onboarding");
  }, [incomplete, router]);

  if (isLoading || incomplete) {
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
