"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import type { CheckinResult } from "@/lib/schemas";

const FALLBACK_NUMBER = "112"; // el de Europa, como `checkin/SKILL.md`: solo si no hay otro guardado

/** "Urgencia ahora": la pantalla que sustituye al resultado cuando una señal pide llamar a
 * emergencias o ir a urgencias. Una sola cosa que hacer, sin nada más alrededor. */
export function UrgentScreen({ result }: { result: CheckinResult }) {
  const t = useTranslations("checkin.urgent");
  const levelT = useTranslations("checkin.alertLevel");
  const urgent = result.alerts.filter((a) => a.urgent);
  const number = result.safety.emergency_number ?? FALLBACK_NUMBER;
  return (
    <div data-testid="urgent-screen" role="alert" className="pt-4">
      <section className="glass p-5" style={{ borderColor: "#ff5a6e" }}>
        <p className="t-eyebrow" style={{ color: "#ff5a6e" }}>{t("eyebrow")}</p>
        <ul className="mt-3 flex flex-col gap-4">
          {urgent.map((a) => (
            <li key={a.code} data-testid="urgent-alert" data-code={a.code} className="flex flex-col gap-2">
              <p className="t-title text-ink">{a.text}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-label rounded px-1.5 py-0.5 text-[10px]" style={{ color: "#ff5a6e", border: "1px solid #ff5a6e" }}>
                  {levelT(a.level)}
                </span>
                <EvidenceChip ruleKey={a.rule_key} grade={a.grade} />
              </div>
            </li>
          ))}
        </ul>
        <a
          href={`tel:${number}`}
          data-testid="urgent-call"
          className="btn btn-primary mt-5 w-full"
          style={{ background: "#ff5a6e", color: "#03101c" }}
        >
          {t("call", { number })}
        </a>
        {result.safety.flags.no_training && <p className="t-body mt-3 text-sm text-ink">{t("stopTraining")}</p>}
        {result.safety.refer_gp && result.safety.deferral_line && (
          <p className="t-body mt-3 text-[11px] italic text-muted">{result.safety.deferral_line}</p>
        )}
      </section>
      <Link href="/dashboard" className="btn btn-tonal mt-4 w-full">
        {t("understood")}
      </Link>
    </div>
  );
}
