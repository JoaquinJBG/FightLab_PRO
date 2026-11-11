"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RatingBadge } from "@/components/catalogue/RatingBadge";
import { parseDecimal, portionGrams, useBarcodeLookup, type PortionUnit, type ScannedProduct } from "@/lib/barcode";
import { useAddProduct } from "@/lib/menu";
import { ManualProductForm } from "./ManualProductForm";

/** Lo que se añade al diario: nombre, gramos (o ml) y lo que suman. */
export type ScannedEntry = { name: string; grams: number; kcal: number; p: number; c: number; f: number };

type Props = {
  code: string;
  /** `diary`: elegir cantidad y añadir a la comida. `catalogue` (menús): guardarlo en mis productos. */
  mode: "diary" | "catalogue";
  /** El texto del botón de añadir en modo diario («Añadir a Comida»). */
  addLabel?: string;
  onAdd?: (entry: ScannedEntry) => void;
  onRescan: () => void;
  onClose: () => void;
};

const round = (n: number) => Math.round(n);

/** Gramos de una cantidad → lo que suma, con los valores por 100. Un macro sin dato cuenta 0. */
export function entryFor(product: ScannedProduct, grams: number): ScannedEntry | null {
  if (product.kcal == null) return null;
  const k = grams / 100;
  return {
    name: product.name ?? product.barcode,
    grams,
    kcal: round(product.kcal * k),
    p: round((product.protein_g ?? 0) * k),
    c: round((product.carbs_g ?? 0) * k),
    f: round((product.fat_g ?? 0) * k),
  };
}

/** El producto de un código escaneado: de dónde sale, su valoración (motor de la fase 13), la
 * cantidad en gramos, raciones o envases y el botón de añadir. Si nadie lo tiene, crearlo a mano. */
export function ScanResult({ code, mode, addLabel, onAdd, onRescan, onClose }: Props) {
  const t = useTranslations("scanner.result");
  const tm = useTranslations("scanner.manual");
  const lookup = useBarcodeLookup(code);
  const addProduct = useAddProduct();
  const [creating, setCreating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unit, setUnit] = useState<PortionUnit | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);

  const header = (
    <div className="flex items-center justify-between gap-2">
      <p className="t-label text-muted" data-testid="scan-code">{t("code", { code })}</p>
      <div className="flex shrink-0 gap-1">
        <button type="button" onClick={onRescan} data-testid="scan-again" className="btn btn-tonal btn-sm">{t("rescan")}</button>
        <button type="button" onClick={onClose} aria-label={t("cancel")} className="t-label px-2 text-muted hover:text-bad">✕</button>
      </div>
    </div>
  );

  if (lookup.isPending) {
    return (
      <section data-testid="scan-result" data-state="loading" className="glass mt-3 p-4">
        {header}
        <p className="pulse t-body mt-3 text-sm text-muted">{t("searching", { code })}</p>
      </section>
    );
  }
  if (lookup.isError) {
    return (
      <section data-testid="scan-result" data-state="error" className="glass mt-3 p-4">
        {header}
        <p role="alert" className="t-body mt-3 text-sm text-bad">{t("lookupFailed")}</p>
      </section>
    );
  }

  const result = lookup.data;
  const saved = (w: string[]) => {
    setWarnings(w);
    setCreating(false);
  };

  if (result.status === "notFound" || creating) {
    const why = result.status === "notFound" ? (result.off ?? "none") : null;
    const known = ["none", "off_not_configured", "off_rate_limited", "off_busy", "off_unavailable"];
    return (
      <section data-testid="scan-result" data-state="not-found" className="glass mt-3 p-4">
        {header}
        {why && (
          <p data-testid="scan-not-found" data-off={why} className="t-body mt-3 text-sm text-warn">
            {t(`notFound.${known.includes(why) ? why : "off_unavailable"}`)}
          </p>
        )}
        {creating ? (
          <ManualProductForm code={code} prefill={result.status === "found" ? result.product : null}
            onSaved={saved} onCancel={() => setCreating(false)} />
        ) : (
          <button type="button" onClick={() => setCreating(true)} data-testid="scan-create"
            className="btn btn-primary mt-3 w-full">{t("create")}</button>
        )}
      </section>
    );
  }

  const { source, product } = result;
  const unitLabel = product.per === "100 ml" ? "ml" : "g";
  const units: PortionUnit[] = ["g", ...(product.serving_g ? (["serving"] as const) : []), ...(product.pack_g ? (["pack"] as const) : [])];
  const current: PortionUnit = unit && units.includes(unit) ? unit : product.serving_g ? "serving" : "g";
  const defaultAmount = current === "g" ? "100" : "1";
  const amount = parseDecimal(amountText ?? defaultAmount);
  const grams = amount == null ? null : portionGrams(product, current, amount);
  const entry = grams ? entryFor(product, grams) : null;
  const step = current === "g" ? 10 : 0.5;
  const bump = (dir: 1 | -1) => {
    const base = amount ?? 0;
    const next = Math.max(step, Math.round((base + dir * step) * 10) / 10);
    setAmountText(String(next).replace(".", ","));
  };
  const sourceText = source === "chain" ? t("sources.chain", { chain: product.chain ?? "" }) : t(`sources.${source}`);
  const inCatalogue = source !== "off";

  return (
    <section data-testid="scan-result" data-state="found" data-source={source} className="glass mt-3 p-4">
      {header}
      <p data-testid="scan-name" className="t-title mt-2 text-ink first-letter:uppercase">
        {product.name ?? t("noName")}{product.brand ? <span className="t-body text-sm text-muted"> · {product.brand}</span> : null}
      </p>
      <p className="t-body mt-0.5 text-[11px] text-muted" data-testid="scan-source">
        {source === "off" && product.url ? (
          <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-neon underline">{sourceText}</a>
        ) : sourceText}
        {product.pack ? ` · ${product.pack}` : ""}
      </p>
      <div className="mt-2">
        <RatingBadge rating={product.rating.rating} check={product.rating.check} ruleKey={product.rating.rule_key} />
      </div>
      <p className="t-body mt-2 text-xs text-muted" data-testid="scan-per100">
        {product.kcal == null
          ? t("noKcal")
          : t("per", {
            per: product.per, kcal: round(product.kcal), p: round(product.protein_g ?? 0),
            c: round(product.carbs_g ?? 0), f: round(product.fat_g ?? 0),
          })}
      </p>
      {warnings.map((w) => (
        <p key={w} role="status" className="t-body mt-1 text-xs text-warn">{tm.has(`warnings.${w}`) ? tm(`warnings.${w}`) : w}</p>
      ))}

      {product.kcal == null && (
        <button type="button" onClick={() => setCreating(true)} data-testid="scan-complete" className="btn btn-outline btn-sm mt-3 w-full">
          {t("complete")}
        </button>
      )}

      {mode === "diary" && product.kcal != null && (
        <>
          <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label={t("amount")}>
            {units.map((u) => (
              <button key={u} type="button" data-testid={`scan-unit-${u}`} aria-pressed={current === u}
                onClick={() => { setUnit(u); setAmountText(null); }}
                className={`btn btn-sm ${current === u ? "btn-primary" : "btn-outline"}`}>
                {u === "g" ? t(`units.${unitLabel}`) : t(`units.${u}`, { grams: round((u === "serving" ? product.serving_g : product.pack_g) ?? 0), unit: unitLabel })}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="t-label text-muted">{t("amount")}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => bump(-1)} aria-label={t("less")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
              <input value={amountText ?? defaultAmount} inputMode="decimal" data-testid="scan-amount" aria-label={t("amount")}
                onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))}
                className="field w-16 px-2 py-2 text-center text-sm" />
              <button type="button" onClick={() => bump(1)} aria-label={t("more")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
            </div>
          </div>
          {current !== "g" && grams != null && (
            <p className="t-body mt-1 text-right text-[11px] text-muted" data-testid="scan-grams">{t("total", { grams, unit: unitLabel })}</p>
          )}
          {entry ? (
            <p className="t-body mt-2 text-center text-sm text-neon" data-testid="scan-macros">
              {t("macros", { kcal: entry.kcal, p: entry.p, c: entry.c, f: entry.f })}
            </p>
          ) : (
            <p role="alert" className="t-body mt-2 text-xs text-bad">{t("amountInvalid")}</p>
          )}
          <button type="button" disabled={!entry} data-testid="scan-add" onClick={() => entry && onAdd?.(entry)}
            className="btn btn-primary mt-3 w-full disabled:opacity-60">
            {addLabel}
          </button>
        </>
      )}

      {mode === "catalogue" && (
        inCatalogue ? (
          <p className="t-body mt-3 text-xs text-good" data-testid="scan-in-catalogue">{t("inCatalogue")}</p>
        ) : addProduct.isSuccess ? (
          <p className="t-body mt-3 text-xs text-good" data-testid="scan-saved">{t("saved")}</p>
        ) : (
          <button type="button" disabled={addProduct.isPending} data-testid="scan-save"
            onClick={() => addProduct.mutate({ barcode: product.barcode })}
            className="btn btn-primary mt-3 w-full disabled:opacity-60">{t("saveProduct")}</button>
        )
      )}
      {mode === "catalogue" && addProduct.error && (
        <p role="alert" className="t-body mt-2 text-xs text-bad">{addProduct.error.message || addProduct.error.code}</p>
      )}

      {source === "off" && <p className="t-body mt-3 text-[11px] text-muted">{t("attribution")}</p>}
    </section>
  );
}
