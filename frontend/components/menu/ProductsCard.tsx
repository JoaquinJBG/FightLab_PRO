"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RatingBadge } from "@/components/catalogue/RatingBadge";
import { ScanFood } from "@/components/scanner/ScanFood";
import { useAddProduct, useCatalogue, useProductSearch, useRemoveProduct } from "@/lib/menu";

// Errores del proxy de Open Food Facts que se explican con su propio texto.
const OFF_CODES = ["off_not_configured", "off_rate_limited", "off_busy", "off_unavailable", "search_empty"];

/** Productos del súper desde Open Food Facts (por el proxy del servidor) y el catálogo propio.
 * Sin contacto configurado en el servidor, la búsqueda está apagada y se dice así. */
export function ProductsCard() {
  const t = useTranslations("menu.products");
  const [q, setQ] = useState("");
  const search = useProductSearch();
  const add = useAddProduct();
  const remove = useRemoveProduct();
  const catalogue = useCatalogue();
  const errorCode = search.error?.code ?? add.error?.code;
  const notConfigured = errorCode === "off_not_configured";

  return (
    <section data-testid="products-card" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) search.mutate(q.trim());
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")}
          className="field min-w-0 flex-1 px-3 py-2 text-sm" />
        <button type="submit" disabled={search.isPending || !q.trim()} className="btn btn-tonal btn-sm shrink-0 disabled:opacity-60">
          {search.isPending ? t("searching") : t("search")}
        </button>
      </form>
      <ScanFood mode="catalogue" />

      {notConfigured && (
        <p data-testid="off-not-configured" role="status" className="t-body mt-3 text-sm text-warn">{t("notConfigured")}</p>
      )}
      {errorCode && !notConfigured && (
        <p role="alert" className="t-body mt-3 text-xs text-bad">
          {OFF_CODES.includes(errorCode) ? t(`errors.${errorCode}`) : (search.error?.message || add.error?.message || t("errors.generic"))}
        </p>
      )}

      {search.data && (
        <ul data-testid="off-hits" className="mt-3 flex flex-col gap-2">
          {search.data.length === 0 && <li className="t-body text-xs text-muted">{t("none")}</li>}
          {search.data.map((p) => (
            <li key={p.barcode} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="t-body block text-sm text-ink">{p.name ?? p.barcode}{p.brand ? ` · ${p.brand}` : ""}</span>
                {p.rating && <span className="mt-0.5 block"><RatingBadge rating={p.rating.rating} check={p.rating.check} bare /></span>}
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="t-label text-neon underline">{t("unverified")}</a>
              </span>
              <button type="button" onClick={() => add.mutate({ barcode: p.barcode })} disabled={add.isPending} className="btn btn-outline btn-sm shrink-0">
                {t("add")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="t-label mt-4 text-muted">{t("catalogue")}</p>
      {catalogue.data && catalogue.data.length === 0 && <p className="t-body mt-1 text-xs text-muted">{t("empty")}</p>}
      <ul className="mt-1 flex flex-col gap-1.5">
        {(catalogue.data ?? []).map((p) => (
          <li key={p.barcode} data-testid="catalogue-product" className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="t-body block text-sm text-ink">{p.product_name}</span>
              {p.rating && <span className="mt-0.5 block"><RatingBadge rating={p.rating.rating} check={p.rating.check} ruleKey={p.rating.rule_key} /></span>}
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="t-label text-neon underline">{t("unverified")}</a>
              ) : (
                <span className="t-label text-muted">{t("manual")}</span>
              )}
            </span>
            <button type="button" onClick={() => remove.mutate(p.barcode)} aria-label={t("remove", { name: p.product_name })} className="t-label px-1 text-muted hover:text-bad">✕</button>
          </li>
        ))}
      </ul>
      <p className="t-body mt-3 text-[11px] text-muted">{t("attribution")}</p>
    </section>
  );
}
