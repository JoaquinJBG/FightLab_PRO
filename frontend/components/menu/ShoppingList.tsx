"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { intlLocale } from "@/lib/locale";
import { filterByWeek, hasWeeks, useShoppingCheck, type ShoppingLine, type ShoppingList as List } from "@/lib/menu";

const RATING_COLOR: Record<string, string> = {
  bueno: "var(--color-good)",
  regular: "var(--color-warn)",
  evitar: "var(--color-bad)",
  sin_datos: "var(--color-muted)",
  no_aplica: "var(--color-muted)",
};

function weekTag(when: number[]): string {
  if (when.length > 1) return "both";
  return when.length === 1 ? String(when[0]) : "";
}

function Line({ line, menuId, week }: { line: ShoppingLine; menuId: number; week: number }) {
  const t = useTranslations("menu.shopping");
  const locale = intlLocale(useLocale());
  const check = useShoppingCheck(menuId);
  const [checked, setChecked] = useState(line.checked);
  const n = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 0 });
  const euros = (v: number) => v.toLocaleString(locale, { style: "currency", currency: "EUR" });
  // Con una semana elegida, lo de esa semana (si el motor lo ha podido repartir).
  const weekAmount = week && line.by_week ? line.by_week[String(week)] : null;
  const shown = weekAmount ?? line.amount;
  const amount = shown != null ? t(line.unit, { n: n(shown) }) : "";
  const tag = weekTag(line.when);
  const product = line.product;
  return (
    <li data-testid="shopping-item" data-key={line.key} data-checked={checked ? "true" : "false"} className="flex items-start gap-2 py-1">
      <input
        type="checkbox"
        aria-label={line.name}
        checked={checked}
        disabled={check.isPending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          check.mutate({ item: line.name, checked: next }, { onError: () => setChecked(!next) });
        }}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <p className={`t-body flex flex-wrap items-center gap-x-2 text-sm ${checked ? "text-muted line-through" : "text-ink"}`}>
          <span>{line.pack || line.name}</span>
          {tag && <span data-testid="shopping-week" className="badge">{t(`weekTag.${tag}`)}</span>}
        </p>
        {line.pack && <p className="t-body text-[11px] text-muted">{line.name}</p>}
        {product?.product && (
          <div data-testid="shopping-product" data-rating={product.rating ?? ""} className="t-body text-[11px] text-muted">
            <p>
              {t("product", { chain: product.chain ?? "", product: product.product })}
              {product.packs ? <> · {t("packs", { n: product.packs, pack: product.pack ?? "" })}</> : null}
              {product.price != null && <> · {t("price", { price: euros(product.price) })}</>}
            </p>
            {product.rating && (
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span data-testid="shopping-rating" style={{ color: RATING_COLOR[product.rating] }}>{t(`rating.${product.rating}`)}</span>
                {/* La valoración es de la F13 (Nutri-Score de OFF y semáforo FSA); sin regla en la respuesta, convención. */}
                <EvidenceChip ruleKey={null} />
              </p>
            )}
            {product.review && <p data-testid="shopping-review" className="text-warn">{t("review")}</p>}
          </div>
        )}
      </div>
      <div className="text-right">
        <p className="t-body text-sm text-muted">{amount}</p>
        {line.amount_two != null && weekAmount == null && (
          <p className="t-body text-[11px] text-muted">{t("forTwo", { amount: t(line.unit, { n: n(line.amount_two) }) })}</p>
        )}
      </div>
    </li>
  );
}

/** La lista de la compra por sección del súper, con formato, semana y casillas (fase 12). */
export function ShoppingList({ list, menuId }: { list: List; menuId: number }) {
  const t = useTranslations("menu.shopping");
  const [week, setWeek] = useState(0);
  const sections = filterByWeek(list, week);
  return (
    <section data-testid="shopping-list" data-source={list.source} className="glass mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="t-eyebrow text-muted">{t("title")}</p>
        <span data-testid="shopping-progress" className="t-label text-muted">{t("progress", { checked: list.checked, total: list.total })}</span>
      </div>
      {hasWeeks(list) && (
        <div role="tablist" className="mt-3 flex gap-1.5">
          {[0, ...list.weeks].map((w) => (
            <button key={w} type="button" role="tab" aria-selected={week === w} data-testid="shopping-week-tab"
              onClick={() => setWeek(w)} className={`badge ${week === w ? "badge-neon" : ""}`}>
              {t(`week.${w}`)}
            </button>
          ))}
        </div>
      )}
      {list.note && <p className="t-body mt-2 text-[11px] text-muted">{list.note}</p>}
      {sections.map((s) => (
        <div key={s.section || "_"} data-testid="shopping-section" data-section={s.section} className="mt-3">
          <p className="t-label text-muted">{s.section || t("other")}</p>
          <ul className="mt-1 flex flex-col divide-y divide-[rgba(150,190,255,0.08)]">
            {s.items.map((line) => <Line key={line.key} line={line} menuId={menuId} week={week} />)}
          </ul>
        </div>
      ))}
      {list.pantry_skipped.length > 0 && <p className="t-body mt-2 text-xs text-muted">{t("pantry", { list: list.pantry_skipped.join(", ") })}</p>}
      {list.unknown.length > 0 && <p className="t-body mt-2 text-xs text-warn">{t("unknown", { list: list.unknown.join(", ") })}</p>}
      {list.batches.length > 0 && (
        <div className="mt-3">
          <p className="t-label text-muted">{t("batches")}</p>
          <ul className="mt-1">
            {list.batches.map((b) => (
              <li key={b.dish} className="t-body text-xs text-ink">
                {t("batchLine", { dish: b.dish, servings: b.servings, left: b.left_over })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="t-body mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{list.source === "menu" ? t("fromMenu") : t("fromEngine")}</span>
        <EvidenceChip ruleKey={null} />
      </p>
      <p className="t-body mt-1 text-[11px] text-muted">{t("note")}</p>
    </section>
  );
}
