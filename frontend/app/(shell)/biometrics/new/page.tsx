"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCreateBiometrics, useWeighIn } from "@/lib/hooks";
import { InfoIcon, ChevronDown } from "@/components/icons";

// label/info: claves advanced.<key>.label|info
const advanced = [
  {
    key: "body_fat_pct",
    step: "0.1",
    unit: "%",
    decimal: true,
  },
  {
    key: "resting_heart_rate",
    step: "1",
    unit: "bpm",
    decimal: false,
  },
  {
    key: "hrv_ms",
    step: "1",
    unit: "ms",
    decimal: false,
  },
] as const;

// Cómo se midió la grasa corporal (U04): solo los cuatro primeros valen para la ecuación de
// Cunningham, que usa la masa magra; con los otros el coach no la usa. El orden es el del servidor.
const BODY_FAT_METHODS = ["dxa", "bodpod", "bia_lab", "skinfolds", "smart_scale", "other"] as const;

// Perímetros con cinta métrica (decimales en cm)
const girths = [
  { key: "waist_cm" },
  { key: "hip_cm" },
  { key: "chest_cm" },
  { key: "arm_cm" },
  { key: "thigh_cm" },
  { key: "neck_cm" },
] as const;

export default function NewBiometricsPage() {
  const t = useTranslations("biometrics.new");
  const tFat = useTranslations("bodyFat");
  const router = useRouter();
  const create = useCreateBiometrics();
  // `no_weight_targets`: ni peso, ni grasa, ni perímetros (spec §8.3); la FC y la HRV sí.
  const { data: weighIn } = useWeighIn();
  const blocked = !!weighIn?.blocked;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showAdv, setShowAdv] = useState(false);
  const [showGirths, setShowGirths] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload: Record<string, unknown> = {};
    if (!blocked && vals.weight_kg) payload.weight_kg = vals.weight_kg; // decimal -> string
    for (const f of advanced) {
      if (blocked && f.key === "body_fat_pct") continue;
      const v = vals[f.key];
      if (v !== undefined && v !== "") payload[f.key] = f.decimal ? v : Number(v);
    }
    if (!blocked && payload.body_fat_pct !== undefined && vals.body_fat_method) {
      payload.body_fat_method = vals.body_fat_method;
    }
    for (const g of blocked ? [] : girths) {
      const v = vals[g.key];
      if (v !== undefined && v !== "") payload[g.key] = v; // decimal -> string
    }
    if (Object.keys(payload).length === 0) {
      setFormError(t("errorEmpty"));
      return;
    }
    try {
      await create.mutateAsync(payload);
      router.push("/biometrics"); // a ver el punto nuevo en tu tendencia
    } catch {
      /* error abajo */
    }
  }

  const err = formError || (create.error as Error)?.message;

  return (
    <div className="pt-4">
      <Link href="/biometrics" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">
        {t.rich("title", { hl: (chunks) => <span className="neon-text">{chunks}</span> })}
      </h1>
      <p className="t-body mt-1 text-muted">{t("subtitle")}</p>

      <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
        {blocked && <p data-testid="body-blocked" className="t-body glass p-3.5 text-xs text-muted">{tFat("blocked")}</p>}

        {/* Típica */}
        {!blocked && <div className="flex flex-col gap-2">
          <span className="t-eyebrow text-muted">{t("typical")}</span>
          <label className="glass neon-edge flex items-center justify-between gap-3 p-4">
            <span className="t-label text-ink">{t("weight")}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                autoFocus
                value={vals.weight_kg ?? ""}
                onChange={(e) => set("weight_kg", e.target.value)}
                placeholder="0.0"
                className="field w-28 px-3 py-2.5 text-right text-lg"
              />
              <span className="t-label w-8 text-muted">kg</span>
            </span>
          </label>
        </div>}

        {/* Avanzadas (plegable) */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAdv((v) => !v)}
            className="flex items-center justify-between rounded-xl px-1 py-1 text-left"
          >
            <span className="t-eyebrow text-muted">{t("advancedToggle")}</span>
            <ChevronDown
              className={`h-4 w-4 text-muted transition-transform ${showAdv ? "rotate-180" : ""}`}
            />
          </button>

          {showAdv &&
            advanced.filter((f) => !(blocked && f.key === "body_fat_pct")).map((f) => (
              <div key={f.key} className="glass p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-label flex items-center gap-1.5 text-ink">
                    {t(`advanced.${f.key}.label`)}
                    <button
                      type="button"
                      aria-label={t("whatIs", { name: t(`advanced.${f.key}.label`) })}
                      onClick={() => setOpenInfo((k) => (k === f.key ? null : f.key))}
                      className={`transition-colors ${openInfo === f.key ? "text-neon" : "text-muted hover:text-neon"}`}
                    >
                      <InfoIcon className="h-4 w-4" />
                    </button>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      step={f.step}
                      inputMode="decimal"
                      value={vals[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder="—"
                      className="field w-24 px-3 py-2 text-right text-sm"
                    />
                    <span className="t-label w-8 text-muted">{f.unit}</span>
                  </span>
                </div>
                {openInfo === f.key && (
                  <p className="t-body mt-2.5 border-t border-[rgba(150,190,255,0.12)] pt-2.5 text-xs text-[#cdd9ef]">
                    {t(`advanced.${f.key}.info`)}
                  </p>
                )}
                {f.key === "body_fat_pct" && (vals.body_fat_pct ?? "") !== "" && (
                  <div data-testid="body-fat-method" className="mt-2.5 border-t border-[rgba(150,190,255,0.12)] pt-2.5">
                    <label className="flex items-center justify-between gap-3">
                      <span className="t-label text-ink">{tFat("method")}</span>
                      <select
                        data-testid="body-fat-method-select"
                        value={vals.body_fat_method ?? ""}
                        onChange={(e) => set("body_fat_method", e.target.value)}
                        className="field max-w-[60%] px-2 py-2 text-sm"
                      >
                        <option value="">{tFat("unknown")}</option>
                        {BODY_FAT_METHODS.map((m) => (
                          <option key={m} value={m}>{tFat(`methods.${m}`)}</option>
                        ))}
                      </select>
                    </label>
                    <p className="t-body mt-2 text-[11px] text-muted">{tFat("hint")}</p>
                  </div>
                )}
              </div>
            ))}
        </div>

        {/* Perímetros (plegable) */}
        {!blocked && <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowGirths((v) => !v)}
            className="flex items-center justify-between rounded-xl px-1 py-1 text-left"
          >
            <span className="t-eyebrow text-muted">{t("girthsToggle")}</span>
            <ChevronDown
              className={`h-4 w-4 text-muted transition-transform ${showGirths ? "rotate-180" : ""}`}
            />
          </button>

          {showGirths && (
            <div className="grid grid-cols-2 gap-2">
              {girths.map((g) => (
                <label key={g.key} className="glass flex items-center justify-between gap-2 p-3">
                  <span className="t-label text-ink">{t(`girths.${g.key}`)}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.5"
                      inputMode="decimal"
                      value={vals[g.key] ?? ""}
                      onChange={(e) => set(g.key, e.target.value)}
                      placeholder="—"
                      className="field w-16 px-2 py-1.5 text-right text-sm"
                    />
                    <span className="t-label text-muted">cm</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {showGirths && (
            <p className="t-body text-[11px] text-muted">
              {t("girthsHint")}
            </p>
          )}
        </div>}

        {err && <p className="text-xs text-bad">{err}</p>}
        <button type="submit" disabled={create.isPending} className="btn btn-primary mt-1 disabled:opacity-60">
          {create.isPending ? t("saving") : t("save")}
        </button>
      </form>
    </div>
  );
}
