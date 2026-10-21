"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/hooks";

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
 * Si el perfil del usuario está incompleto (sin fecha de nacimiento o altura),
 * lo manda a /onboarding antes de dejarle ver el shell. Así, tras verificar el
 * email e iniciar sesión, lo primero que ve es "info personal".
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const incomplete = !!profile && (!profile.date_of_birth || profile.height_cm == null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (incomplete) router.replace("/onboarding");
  }, [incomplete, router]);

  useEffect(() => {
    if (!isLoading) {
      const reset = setTimeout(() => setSlow(false), 0);
      return () => clearTimeout(reset);
    }
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  const view = gateView({ pathname, isLoading, isError, incomplete, slow });
  if (view === "children") return <>{children}</>;
  if (view === "skeleton") {
    return (
      <div className="flex min-h-[60dvh] flex-col gap-3 pt-6" aria-busy="true" aria-label="Cargando">
        <div className="glass pulse h-8 w-2/3 rounded-xl" />
        <div className="glass pulse h-28 w-full rounded-2xl" />
        <div className="glass pulse h-28 w-full rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="t-body text-muted">
        {view === "slow" ? "El servidor tarda en responder." : "No se pudo cargar tu perfil."}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void refetch()}>
        Reintentar
      </button>
    </div>
  );
}
