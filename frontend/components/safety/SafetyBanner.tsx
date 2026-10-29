"use client";

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
export function SafetyPanel({ data, showEmpty = false }: { data: Safety; showEmpty?: boolean }) {
  const t = useTranslations("safety");
  const hasStop = data.reasons.some((r) => r.severity === "stop");
  if (!data.reasons.length && !data.parq_pending && !showEmpty) return null;
  return (
    <section data-testid="safety-banner" className="glass mt-4 p-4" style={hasStop ? { borderColor: SEVERITY_COLOR.stop } : undefined}>
      <p className="t-eyebrow text-muted">{t("title")}</p>
      {data.reasons.length ? (
        <ul className="mt-3 flex flex-col gap-3">
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

/** Banner de la Home y del perfil: lee `/coach/safety`. */
export function SafetyBanner({ showEmpty = false }: { showEmpty?: boolean }) {
  const t = useTranslations("safety");
  const { data, isLoading, isError } = useSafety();
  if (isLoading) return <p className="t-body mt-4 text-xs text-muted">{t("loading")}</p>;
  if (isError || !data) return showEmpty ? <p className="t-body mt-4 text-xs text-bad">{t("error")}</p> : null;
  return <SafetyPanel data={data} showEmpty={showEmpty} />;
}
