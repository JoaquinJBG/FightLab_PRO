"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Título con la parte `<neon>` resaltada (los catálogos la marcan así). */
export function StepTitle({ k }: { k: string }) {
  const t = useTranslations("onboarding");
  return (
    <h1 className="t-display text-2xl text-ink">
      {t.rich(k, { neon: (c) => <span className="neon-text">{c}</span> })}
    </h1>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="t-body text-[11px] text-muted">{children}</p>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="t-label text-muted">{children}</span>;
}

/** Botón de opción (sí / no / no lo sé, tokens…). */
export function Choice({
  selected,
  onClick,
  children,
  className = "",
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`badge justify-center py-2 text-center ${selected ? "badge-neon" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** Pie del paso: error, botón principal y, si se puede, saltar. */
export function StepFooter({
  error,
  onNext,
  onSkip,
  pending,
  label,
}: {
  error?: string | null;
  onNext: () => void;
  onSkip?: () => void;
  pending?: boolean;
  label?: string;
}) {
  const t = useTranslations("onboarding");
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-xs text-bad">
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        {onSkip && (
          <button type="button" onClick={onSkip} disabled={pending} data-testid="onboarding-skip" className="t-label px-2 text-muted disabled:opacity-50">
            {t("skip")}
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={pending}
          data-testid="onboarding-next"
          className="btn btn-primary flex-1 disabled:opacity-60"
        >
          {pending ? t("saving") : (label ?? t("continue"))}
        </button>
      </div>
    </>
  );
}

/** El aviso del coach ("no es consejo médico", docs/safety.md) bajo un texto de seguridad. */
export function SafetyNote({ full = false }: { full?: boolean }) {
  const t = useTranslations("safety");
  return (
    <p data-testid="safety-disclaimer" className="t-body mt-4 text-[11px] italic text-muted">
      {full ? t("deferralLine") : t("disclaimer")}
    </p>
  );
}

export type StepProps = { onNext: () => void };
