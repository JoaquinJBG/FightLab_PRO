"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { intlLocale } from "@/lib/locale";
import { batchRuleName, type BatchSession, type Menu } from "@/lib/menu";

/** El chip de una regla del anexo de batch cooking, con el grado que trae el menú. */
export function BatchRuleChip({ menu, ruleKey }: { menu: Pick<Menu, "batch_rules">; ruleKey: string }) {
  const rule = menu.batch_rules.find((r) => r.key === ruleKey);
  return <EvidenceChip ruleKey={ruleKey} grade={rule?.grade ?? null} />;
}

export const KNOWN_APPLIANCES = ["pressure_cooker", "pot", "wok", "frying_pan", "air_fryer", "oven", "microwave", "hands"];

function SessionCard({ session, menu, index }: { session: BatchSession; menu: Menu; index: number }) {
  const t = useTranslations("menu.batch");
  const locale = intlLocale(useLocale());
  const day = new Date(`${session.date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <article data-testid="batch-session" data-date={session.date} className="mt-3 rounded-2xl border border-[rgba(150,190,255,0.12)] p-3">
      <p className="t-title text-ink first-letter:uppercase">{t("session", { date: day, minutes: session.total_min })}</p>
      <p className="t-body mt-1 text-xs text-muted">{session.dishes.map((d) => d.name).join(" · ")}</p>
      <p className="t-body mt-1 text-xs text-muted">
        {session.appliances.map((a) => (KNOWN_APPLIANCES.includes(a) ? t(`appliances.${a}`) : a)).join(" · ")}
      </p>
      {session.eve.length > 0 && <p className="t-body mt-1 text-xs text-ink">{t("eve", { list: session.eve.join("; ") })}</p>}
      {session.rebuilt && <p data-testid="batch-rebuilt" className="t-body mt-1 text-xs text-warn">{t("rebuilt")}</p>}
      {session.missing.map((m, i) => (
        <p key={`${m.step}-${i}`} data-testid="batch-missing" className="t-body mt-1 text-xs text-bad">{t("missing", { step: m.step })}</p>
      ))}
      {!session.checked && <p data-testid="batch-unchecked" className="t-body mt-1 text-xs text-muted">{t("unchecked")}</p>}
      <Link href={`/nutrition/menu/batch?menu=${menu.id}&session=${index}`} data-testid="batch-open" className="btn btn-primary btn-sm mt-3">
        {t("open")}
      </Link>
    </article>
  );
}

/** Las sesiones de batch del menú: qué se cocina, cuánto dura y con qué aparatos. */
export function BatchSessions({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.batch");
  if (menu.batch_sessions.length === 0) return null;
  const rules = menu.batch_sessions[0].rules;
  return (
    <section data-testid="batch-sessions" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      {menu.batch_sessions.map((s, i) => <SessionCard key={s.date} session={s} menu={menu} index={i} />)}
      <div className="mt-3 flex flex-col gap-1.5">
        {rules.map((key) => (
          <p key={key} className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{batchRuleName(key) ? t(`rules.${batchRuleName(key)}`) : key}</span>
            <BatchRuleChip menu={menu} ruleKey={key} />
          </p>
        ))}
        <p className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span>{t("conventionNote")}</span>
          <EvidenceChip ruleKey={null} />
        </p>
      </div>
    </section>
  );
}
