"use client";

import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useSessionCheck, type SessionCheckParams } from "@/lib/session-check";

const REFER = "#ffd25a";

/** Aviso al registrar una sesión vigorosa con `review_before_vigorous`, `cap_moderate` o
 * `no_training` (spec §8.2). Lo decide el servidor; no bloquea guardar lo ya hecho. */
export function VigorousWarning({ params }: { params: SessionCheckParams | null }) {
  const t = useTranslations("sessionCheck");
  const tp = useTranslations("weeklyPlan");
  const { data } = useSessionCheck(params);
  if (!data?.warn) return null;
  const vigorous = data.modalities.filter((m) => m.blocked_by.length > 0 && m.intensity !== "light" && m.intensity !== "moderate");
  return (
    <section data-testid="vigorous-warning" role="status" className="mt-3 rounded-xl p-3" style={{ border: `1px solid ${REFER}` }}>
      <p className="t-eyebrow" style={{ color: REFER }}>{t("title")}</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {vigorous.map((m) => (
          <li key={m.key} className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
            <span>{t("modality", { modality: tp(`modalities.${m.key}`), intensity: t(`intensity.${m.intensity}`) })}</span>
            <EvidenceChip ruleKey={m.rule_key} grade={m.grade} />
            {m.rule_key && m.convention === "fightlab" && <EvidenceChip ruleKey={null} />}
          </li>
        ))}
      </ul>
      {data.rpe_basis && (
        <p className="t-body mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span>{t("rpeBasis", { n: data.rpe_basis.threshold })}</span>
          <EvidenceChip ruleKey={data.rpe_basis.rule_key} grade={data.rpe_basis.grade} />
          {data.rpe_basis.convention === "fightlab" && <EvidenceChip ruleKey={null} />}
        </p>
      )}
      <p className="t-body mt-2 text-xs text-ink">
        {t("because", { flags: data.flags.map((f) => tp(`blockedBy.${f}`)).join(" · ") })}
      </p>
      {data.reasons.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {data.reasons.map((r) => (
            <li key={r.code} data-testid="vigorous-reason" data-code={r.code} className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="first-letter:uppercase">{r.text}</span>
              <EvidenceChip ruleKey={r.rule_key} grade={r.grade} />
            </li>
          ))}
        </ul>
      )}
      <p className="t-body mt-2 text-[11px] text-muted">{t("canSave")}</p>
    </section>
  );
}
