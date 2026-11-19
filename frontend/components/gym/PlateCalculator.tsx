"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { DEFAULT_PLATES, loadPlateSettings, platesFor, sanitizeDecimal, savePlateSettings, type PlateSettings } from "@/lib/gym-log";

const ALL_PLATES = [50, 25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5];

/** Calculadora de discos (F17): qué discos van en cada lado de la barra para un peso. La barra
    (20 kg por defecto) y los discos que hay en el gimnasio se guardan en este dispositivo. */
export function PlateCalculator({ initialKg, onClose, onUse }: {
  initialKg: number | null;
  onClose: () => void;
  onUse?: (kg: number) => void;
}) {
  const t = useTranslations("training.gymSession.plates");
  const locale = intlLocale(useLocale());
  const [settings, setSettings] = useState<PlateSettings>({ bar: 20, plates: DEFAULT_PLATES });
  const [target, setTarget] = useState(initialKg !== null ? String(initialKg).replace(".", ",") : "");
  const [bar, setBar] = useState("20");
  useEffect(() => {
    const s = loadPlateSettings();
    // Lectura de localStorage tras montar (no existe en el servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(s);
    setBar(String(s.bar).replace(".", ","));
  }, []);
  function update(next: PlateSettings) {
    setSettings(next);
    savePlateSettings(next);
  }
  const kg = Number(target.replace(",", "."));
  const barKg = Number(bar.replace(",", "."));
  const result = target && Number.isFinite(kg) && Number.isFinite(barKg) ? platesFor(kg, barKg, settings.plates) : null;
  const n = (v: number) => v.toLocaleString(locale);
  const loaded = result ? barKg + 2 * result.perSide.reduce((a, b) => a + b, 0) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t("title")} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-2 sm:items-center">
      <div className="glass w-full max-w-md p-4">
        <div className="flex items-center justify-between">
          <p className="t-title text-ink">{t("title")}</p>
          <button type="button" onClick={onClose} className="t-label min-h-11 px-2 text-muted">{t("close")}</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="t-label text-muted">
            {t("target")}
            <input value={target} onChange={(e) => setTarget(sanitizeDecimal(e.target.value))} inputMode="decimal"
              onFocus={(e) => e.currentTarget.select()} className="field mt-1 min-h-11 w-full px-3 text-base" />
          </label>
          <label className="t-label text-muted">
            {t("bar")}
            <input value={bar} inputMode="decimal" onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const v = sanitizeDecimal(e.target.value);
                setBar(v);
                const b = Number(v.replace(",", "."));
                if (v && Number.isFinite(b)) update({ ...settings, bar: b });
              }}
              className="field mt-1 min-h-11 w-full px-3 text-base" />
          </label>
        </div>
        <p className="t-label mt-3 text-muted">{t("available")}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ALL_PLATES.map((p) => {
            const on = settings.plates.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on}
                onClick={() => update({ ...settings, plates: on ? settings.plates.filter((x) => x !== p) : [...settings.plates, p].sort((a, b) => b - a) })}
                className={`badge min-h-11 min-w-11 justify-center ${on ? "badge-neon" : ""}`}>
                {n(p)}
              </button>
            );
          })}
        </div>
        <div data-testid="plates-result" role="status" className="mt-4 rounded-xl border border-[rgba(150,190,255,0.12)] p-3">
          {!target ? (
            <p className="t-body text-xs text-muted">{t("empty")}</p>
          ) : result === null ? (
            <p className="t-body text-xs text-[#ffd08a]">{t("belowBar", { bar: n(barKg) })}</p>
          ) : (
            <>
              <p className="t-label text-ink">{t("perSide")}</p>
              <p className="stat mt-1 text-lg text-neon">
                {result.perSide.length ? result.perSide.map(n).join(" + ") : t("barOnly")}
              </p>
              {result.remainder > 0 && (
                <p className="t-body mt-1 text-xs text-[#ffd08a]">{t("remainder", { kg: n(result.remainder), loaded: n(loaded ?? 0) })}</p>
              )}
            </>
          )}
        </div>
        {onUse && result && loaded !== null && (
          <button type="button" onClick={() => { onUse(loaded); onClose(); }} className="btn btn-primary mt-3 min-h-11 w-full">
            {t("use", { kg: n(loaded) })}
          </button>
        )}
      </div>
    </div>
  );
}
