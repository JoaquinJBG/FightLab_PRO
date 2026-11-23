"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, useProfile, useScreening, useUpdateProfile } from "@/lib/hooks";
import { isOnboardingComplete } from "@/lib/onboarding";
import { LEGACY_GOAL_KEY, goalToMigrate } from "@/lib/goal";

/** Pasado este tiempo cargando, se enseña «Despertando el servidor…». */
export const SLOW_MS = 5_000;
/** Tiempo total (desde el primer intento) que se reintenta solo antes de enseñar el error. */
export const WAKE_DEADLINE_MS = 90_000;
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];

/** Espera antes del reintento nº `attempt` (0, 1, 2…): 2, 4, 8 y 15 s (y 15 s a partir de ahí). */
export function backoffDelay(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

/** Un fallo de red o del servidor (Render dormido: 502/503/504, timeout) merece reintento;
 *  un 4xx (sesión, datos) no: reintentar no lo arregla. */
export function isWakeRetryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500;
}

export type GateView = "children" | "skeleton" | "waking" | "error";

/** Decisión pura del gate (testeable sin React). `/training/*` (sesión de
 *  gimnasio, herramientas) nunca espera al perfil: registrar un entreno no
 *  puede depender de un backend lento. Fuera de ahí, esqueleto mientras carga;
 *  si tarda (`slow`) o falla de forma reintentable (`retrying`), «Despertando…»;
 *  el error con «Reintentar» solo cuando se acaba el margen o el fallo no es reintentable. */
export function gateView(args: {
  pathname: string | null;
  isLoading: boolean;
  isError: boolean;
  incomplete: boolean;
  slow: boolean;
  retrying: boolean;
}): GateView {
  const training = !!args.pathname && (args.pathname === "/training" || args.pathname.startsWith("/training/"));
  if (training) return "children";
  if (args.incomplete) return "skeleton"; // redirigiendo a /onboarding
  if (args.isError) return args.retrying ? "waking" : "error";
  if (args.isLoading) return args.slow ? "waking" : "skeleton";
  return "children";
}

/** Reintento automático con backoff mientras el perfil no llega. Devuelve `slow` (la
 *  primera carga se alarga) y `retrying` (falló de forma reintentable y aún hay margen). */
function useWakeRetry(args: {
  loading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
}) {
  const { loading, isError, isFetching, error, refetch } = args;
  const [slow, setSlow] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = loading || isError;
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  // Ventana de espera: arranca con el primer intento y termina al llegar el perfil.
  useEffect(() => {
    if (!active) {
      const reset = setTimeout(() => {
        setSlow(false);
        setGaveUp(false);
        setAttempt(0);
      }, 0);
      return () => clearTimeout(reset);
    }
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    const deadline = setTimeout(() => setGaveUp(true), WAKE_DEADLINE_MS);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(deadline);
    };
  }, [active]);

  const retryable = isError && isWakeRetryable(error) && !gaveUp;
  useEffect(() => {
    if (!retryable || isFetching) return;
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1);
      void refetchRef.current();
    }, backoffDelay(attempt));
    return () => clearTimeout(timer);
  }, [retryable, isFetching, attempt]);

  return { slow, retrying: retryable };
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
  const { data: profile, isLoading, isError, isFetching, error, refetch } = useProfile();
  const { data: screening, isLoading: screeningLoading } = useScreening();
  // Sin datos básicos, sin SCOFF o sin la pregunta de síntomas cardiacos, se vuelve al paso
  // del onboarding que falta (spec §8.1). El PAR-Q+ no bloquea: la Home lo recuerda.
  const incomplete = !!profile && !!screening && !isOnboardingComplete(profile, screening.values);
  const loading = isLoading || screeningLoading;
  const { slow, retrying } = useWakeRetry({ loading, isError, isFetching, error, refetch });

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

  const view = gateView({ pathname, isLoading: loading, isError, incomplete, slow, retrying });
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
  if (view === "waking") {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="glass pulse h-3 w-24 rounded-full" aria-hidden="true" />
        <p className="t-body font-medium">{tg("waking")}</p>
        <p className="t-body text-muted">{tg("wakingBody")}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="t-body text-muted">{tg("error")}</p>
      <button type="button" className="btn btn-primary" onClick={() => void refetch()}>
        {tg("retry")}
      </button>
    </div>
  );
}
