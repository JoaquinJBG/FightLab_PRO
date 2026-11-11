"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useSafety } from "@/lib/hooks";
import type { Safety, SafetyReason } from "@/lib/schemas";

const SEVERITY_COLOR: Record<SafetyReason["severity"], string> = {
  stop: "#ff5a6e",
  refer: "#ffd25a",
  limit: "#45e9ff",
};

function ReasonItem({ reason }: { reason: SafetyReason }) {
  const t = useTranslations("safety");
  const color = SEVERITY_COLOR[reason.severity];
  return (
    <li data-testid="safety-reason" data-code={reason.code} className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <span className="t-label mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ color, border: `1px solid ${color}` }}>
          {t(`severity.${reason.severity}`)}
        </span>
        <p className="t-body text-sm text-ink first-letter:uppercase">{reason.text}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-1">
        {reason.professional && <span className="t-body text-[11px] text-muted">{t("professional", { name: reason.professional })}</span>}
        <EvidenceChip ruleKey={reason.rule_key} grade={reason.grade} />
      </div>
    </li>
  );
}

/** Los avisos de seguridad que calcula el motor en el servidor, con su regla y su fuente.
 * Termina con la línea de derivación literal si hay `refer_gp`, o con el aviso del coach. */
const FOLD_KEY = "flp_safety_folded";

/** Plegado de la tarjeta en Hoy (F23): se recuerda solo el día en que se plegó (`day`, AAAA-MM-DD). */
function useFoldedToday(day: string | undefined): [boolean, (v: boolean) => void] {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    if (!day) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFolded(localStorage.getItem(FOLD_KEY) === day);
    } catch { /* sin localStorage: desplegada */ }
  }, [day]);
  const set = (v: boolean) => {
    setFolded(v);
    try {
      if (v && day) localStorage.setItem(FOLD_KEY, day);
      else localStorage.removeItem(FOLD_KEY);
    } catch { /* noop */ }
  };
  return [folded, set];
}

export function SafetyPanel({ data, showEmpty = false, foldDay }: { data: Safety; showEmpty?: boolean; foldDay?: string }) {
  const t = useTranslations("safety");
  const tc = useTranslations("combat.head");
  const hasStop = data.reasons.some((r) => r.severity === "stop");
  const [folded, setFolded] = useFoldedToday(foldDay);
  if (!data.reasons.length && !data.parq_pending && !showEmpty) return null;
  const foldable = !!foldDay && data.reasons.length > 0;
  if (foldable && folded) {
    const worst = (["stop", "refer", "limit"] as const).find((sev) => data.reasons.some((r) => r.severity === sev))!;
    return (
      <section data-testid="safety-banner" data-folded="true" className="glass mt-4 flex items-center justify-between gap-3 px-4 py-3"
        style={hasStop ? { borderColor: SEVERITY_COLOR.stop } : undefined}>
        <p className="t-label min-w-0 text-ink">
          <span className="mr-2 rounded px-1.5 py-0.5 text-[10px]" style={{ color: SEVERITY_COLOR[worst], border: `1px solid ${SEVERITY_COLOR[worst]}` }}>
            {t(`severity.${worst}`)}
          </span>
          {t("folded", { count: data.reasons.length })}
        </p>
        <button type="button" onClick={() => setFolded(false)} aria-expanded={false} className="t-label shrink-0 text-neon">{t("unfold")}</button>
      </section>
    );
  }
  return (
    <section data-testid="safety-banner" data-folded={foldable ? "false" : undefined} className="glass mt-4 p-4" style={hasStop ? { borderColor: SEVERITY_COLOR.stop } : undefined}>
      <div className="flex items-center justify-between gap-3">
        <p className="t-eyebrow text-muted">{t("title")}</p>
        {foldable && (
          <button type="button" onClick={() => setFolded(true)} aria-expanded className="t-label shrink-0 text-neon">{t("fold")}</button>
        )}
      </div>
      {data.reasons.length ? (
        // En Hoy la lista tiene un alto máximo: la tarjeta no ocupa toda la primera pantalla (F23)
        <ul data-testid="safety-reasons" className={`mt-3 flex flex-col gap-3 ${foldable ? "max-h-[38dvh] overflow-y-auto overscroll-contain pr-1" : ""}`}>
          {data.reasons.map((r, i) => (
            <ReasonItem key={`${r.code}-${i}`} reason={r} />
          ))}
        </ul>
      ) : (
        !data.parq_pending && <p className="t-body mt-2 text-sm text-muted">{t("none")}</p>
      )}
      {data.parq_pending && (
        <p className="t-body mt-3 text-sm text-ink">
          {t("parqPending")}{" "}
          <Link href="/onboarding?step=parq" className="neon-text underline">
            {t("parqComplete")}
          </Link>
        </p>
      )}
      {data.crt6_url && data.reasons.some((r) => r.code.startsWith("head_blow")) && (
        <a href={data.crt6_url} target="_blank" rel="noopener noreferrer" data-testid="crt6-link" className="t-body mt-3 block text-xs text-neon underline">
          {tc("crt6")}
        </a>
      )}
      {hasStop && data.emergency_number && (
        <a href={`tel:${data.emergency_number}`} className="t-label mt-3 block" style={{ color: SEVERITY_COLOR.stop }}>
          {t("emergency", { number: data.emergency_number })}
        </a>
      )}
      <p data-testid="safety-footer" className="t-body mt-3 text-[11px] italic text-muted">
        {data.refer_gp && data.deferral_line ? data.deferral_line : data.disclaimer}
      </p>
    </section>
  );
}

/** Banner de la Home y del perfil: lee `/coach/safety`. Con `foldDay` (Hoy) se puede plegar. */
export function SafetyBanner({ showEmpty = false, foldDay }: { showEmpty?: boolean; foldDay?: string }) {
  const t = useTranslations("safety");
  const { data, isLoading, isError } = useSafety();
  if (isLoading) return <p className="t-body mt-4 text-xs text-muted">{t("loading")}</p>;
  if (isError || !data) return showEmpty ? <p className="t-body mt-4 text-xs text-bad">{t("error")}</p> : null;
  return <SafetyPanel data={data} showEmpty={showEmpty} foldDay={foldDay} />;
}
