"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { parseDecimal, useCreateManualProduct, type ManualProduct, type ScannedProduct } from "@/lib/barcode";

type Props = {
  code: string;
  /** Para completar una ficha de Open Food Facts a la que le faltan datos. */
  prefill?: ScannedProduct | null;
  onSaved: (warnings: string[]) => void;
  onCancel: () => void;
};

const MAIN = [["kcal", "kcal"], ["protein_g", "protein"], ["carbs_g", "carbs"], ["fat_g", "fat"]] as const;
const EXTRA = [["fibre_g", "fibre"], ["sugars_g", "sugars"], ["saturates_g", "saturates"], ["salt_g", "salt"]] as const;
type Field = (typeof MAIN)[number][0] | (typeof EXTRA)[number][0];

const text = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** Crear a mano el alimento de un código que nadie tiene, con los valores de la etiqueta. */
export function ManualProductForm({ code, prefill, onSaved, onCancel }: Props) {
  const t = useTranslations("scanner.manual");
  const tr = useTranslations("scanner.result");
  const create = useCreateManualProduct(code);
  const [name, setName] = useState(prefill?.name ?? "");
  const [brand, setBrand] = useState(prefill?.brand ?? "");
  const [per, setPer] = useState<"100 g" | "100 ml">(prefill?.per === "100 ml" ? "100 ml" : "100 g");
  const [values, setValues] = useState<Record<Field, string>>({
    kcal: text(prefill?.kcal), protein_g: text(prefill?.protein_g), carbs_g: text(prefill?.carbs_g),
    fat_g: text(prefill?.fat_g), fibre_g: text(prefill?.fibre_g), sugars_g: "", saturates_g: "", salt_g: "",
  });
  const [invalid, setInvalid] = useState(false);

  function read(field: Field): number | null | undefined {
    const raw = values[field].trim();
    if (!raw) return null;
    const n = parseDecimal(raw);
    if (n == null) return undefined;
    return n <= (field === "kcal" ? 900 : 100) ? n : undefined;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Object.fromEntries([...MAIN, ...EXTRA].map(([f]) => [f, read(f)])) as Record<Field, number | null | undefined>;
    if (!name.trim() || parsed.kcal == null || Object.values(parsed).some((v) => v === undefined)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const body: ManualProduct = {
      name: name.trim(), brand: brand.trim(), per,
      kcal: parsed.kcal as number,
      protein_g: parsed.protein_g ?? null, carbs_g: parsed.carbs_g ?? null, fat_g: parsed.fat_g ?? null,
      fibre_g: parsed.fibre_g ?? null, sugars_g: parsed.sugars_g ?? null, saturates_g: parsed.saturates_g ?? null,
      salt_g: parsed.salt_g ?? null,
    };
    create.mutate(body, { onSuccess: (r) => onSaved(r.warnings) });
  }

  const input = (field: Field, label: string) => (
    <label key={field} className="flex flex-col gap-1">
      <span className="t-label text-muted">{label}</span>
      <input value={values[field]} inputMode="decimal" data-testid={`manual-${field}`} aria-label={label}
        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) }))}
        className="field min-w-0 px-3 py-2 text-sm" />
    </label>
  );
  const errorCode = create.error?.code;
  const known = errorCode === "name_taken" || errorCode === "barcode_taken";

  return (
    <form onSubmit={submit} data-testid="manual-form" className="mt-3 flex flex-col gap-3">
      <div>
        <p className="t-label text-ink">{t("title", { code })}</p>
        <p className="t-body mt-1 text-[11px] text-muted">{t("intro")}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="t-label text-muted">{t("name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 200))} data-testid="manual-name"
          aria-label={t("name")} className="field px-3 py-2.5 text-sm" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-label text-muted">{t("brand")}</span>
        <input value={brand} onChange={(e) => setBrand(e.target.value.slice(0, 200))} aria-label={t("brand")}
          className="field px-3 py-2.5 text-sm" />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="t-label text-muted">{t("per")}</span>
        <div className="flex gap-1" role="group" aria-label={t("per")}>
          {(["100 g", "100 ml"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPer(p)} aria-pressed={per === p}
              className={`btn btn-sm ${per === p ? "btn-primary" : "btn-outline"}`}>{p}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">{MAIN.map(([f, k]) => input(f, t(k)))}</div>
      <details>
        <summary className="t-label cursor-pointer text-muted">{t("more")}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">{EXTRA.map(([f, k]) => input(f, t(k)))}</div>
      </details>
      {invalid && <p role="alert" className="t-body text-xs text-bad">{t("invalid")}</p>}
      {errorCode && (
        <p role="alert" data-testid="manual-error" className="t-body text-xs text-bad">
          {known ? t(`errors.${errorCode}`) : errorCode === "invalid" ? t("errors.invalid") : t("errors.generic")}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn btn-outline btn-sm flex-1">{tr("cancel")}</button>
        <button type="submit" disabled={create.isPending} data-testid="manual-save"
          className="btn btn-primary btn-sm flex-[3] disabled:opacity-60">
          {create.isPending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
