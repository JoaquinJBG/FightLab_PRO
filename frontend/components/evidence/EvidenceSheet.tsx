"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRule } from "@/lib/hooks";
import { asGrade, GRADE_COLOR, pickRuleText } from "@/lib/evidence";
import type { EvidenceSource } from "@/lib/schemas";

function sourceHref(s: EvidenceSource): string | null {
  if (s.doi) return `https://doi.org/${s.doi}`;
  return s.url || null;
}

/** Hoja inferior con la regla, a quién se aplica, dónde no está claro y sus fuentes. */
export function EvidenceSheet({ ruleKey, onClose }: { ruleKey: string; onClose: () => void }) {
  const t = useTranslations("evidence");
  const locale = useLocale();
  const { data: rule, isLoading, isError } = useRule(ruleKey);
  const text = rule ? pickRuleText(rule, locale) : null;
  const grade = asGrade(rule?.grade);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        data-testid="evidence-sheet"
        className="glass max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="t-label text-muted">{t("title")}</h2>
          <button type="button" onClick={onClose} className="t-label text-neon">
            {t("close")}
          </button>
        </div>

        {isLoading && <p className="t-body mt-3 text-muted">{t("loading")}</p>}
        {isError && <p className="t-body mt-3 text-bad">{t("error")}</p>}

        {rule && text && (
          <div className="mt-3">
            <h3 className="t-display text-lg text-ink">{text.heading}</h3>
            <p className="t-label mt-1" style={{ color: grade ? GRADE_COLOR[grade] : undefined }}>
              {grade ? t(`grade.${grade}`) : t("grade.none")}
            </p>
            {text.label && (
              <p data-testid="translation-label" className="t-label mt-1 text-warn">
                {t(`label.${text.label}`)}
              </p>
            )}
            <p className="t-body mt-3 whitespace-pre-line text-ink">{text.rule_text}</p>

            {text.applies_to && (
              <section className="mt-4">
                <h4 className="t-label text-muted">{t("appliesTo")}</h4>
                <p className="t-body mt-1 whitespace-pre-line text-ink">{text.applies_to}</p>
              </section>
            )}
            {text.conflicts && (
              <section className="mt-4">
                <h4 className="t-label text-muted">{t("unclear")}</h4>
                <p className="t-body mt-1 whitespace-pre-line text-ink">{text.conflicts}</p>
              </section>
            )}

            <section className="mt-4">
              <h4 className="t-label text-muted">{t("sources")}</h4>
              <ul className="t-body mt-1 space-y-2 text-ink">
                {rule.sources.map((s) => {
                  const href = sourceHref(s);
                  return (
                    <li key={s.sid}>
                      <span className="text-muted">{s.sid}</span> {s.citation}{" "}
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neon underline"
                        >
                          {s.doi ? `DOI ${s.doi}` : t("link")}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
