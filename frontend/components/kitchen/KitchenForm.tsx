"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import {
  EQUIPMENT_COUNTS,
  EQUIPMENT_FLAGS,
  MAX_DINERS,
  cleanDiners,
  useSaveKitchen,
  type Diner,
  type Equipment,
  type KitchenState,
  type Restriction,
} from "@/lib/kitchen";
import { MEALS, splitWords } from "@/lib/menu";

type DraftRestriction = { meals: Restriction["meals"]; exclude: string; allow: string };
type DraftDiner = { name: string; restrictions: DraftRestriction[] };

function toDraft(diners: Diner[]): DraftDiner[] {
  return diners.map((d) => ({
    name: d.name,
    restrictions: d.restrictions.map((r) => ({ meals: r.meals, exclude: r.exclude.join(", "), allow: r.allow.join(", ") })),
  }));
}

function fromDraft(diners: DraftDiner[]): Diner[] {
  return cleanDiners(diners.map((d) => ({
    name: d.name,
    restrictions: d.restrictions.map((r) => ({ meals: r.meals, exclude: splitWords(r.exclude), allow: splitWords(r.allow) })),
  })));
}

/** El menaje y los comensales del usuario. Nada de esto va en el código: lo rellena él. */
export function KitchenForm({ kitchen }: { kitchen: KitchenState }) {
  const t = useTranslations("kitchen");
  const tm = useTranslations("menu.meals");
  const save = useSaveKitchen();
  const [equipment, setEquipment] = useState<Equipment>(kitchen.equipment);
  const [diners, setDiners] = useState<DraftDiner[]>(toDraft(kitchen.diners));
  const [saved, setSaved] = useState(false);

  const limit = (name: string) => kitchen.limits[name]?.[1] ?? 10;
  const setDiner = (i: number, d: DraftDiner) => setDiners((list) => list.map((x, n) => (n === i ? d : x)));
  const setRule = (i: number, j: number, r: DraftRestriction) =>
    setDiner(i, { ...diners[i], restrictions: diners[i].restrictions.map((x, n) => (n === j ? r : x)) });

  return (
    <form
      data-testid="kitchen-form"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate({ equipment, diners: fromDraft(diners) }, { onSuccess: () => setSaved(true) });
      }}
    >
      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{t("equipment.title")}</p>
        <p className="t-body mt-1 text-xs text-muted">{t("equipment.intro")}</p>
        <div className="mt-3 flex flex-col gap-2">
          {EQUIPMENT_COUNTS.map((name) => (
            <label key={name} className="flex items-center justify-between gap-3">
              <span className="t-body text-sm text-ink">{t(`equipment.${name}`)}</span>
              <input type="number" inputMode="numeric" min={0} max={limit(name)} name={name} data-testid={`kitchen-${name}`}
                value={equipment[name] ?? 0}
                onChange={(e) => setEquipment((q) => ({ ...q, [name]: Math.max(0, Math.min(limit(name), Number(e.target.value) || 0)) }))}
                className="field w-20 px-3 py-2 text-right text-sm" />
            </label>
          ))}
          {EQUIPMENT_FLAGS.map((name) => (
            <label key={name} className="t-body flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name={name} data-testid={`kitchen-${name}`} checked={!!equipment[name]}
                onChange={(e) => setEquipment((q) => ({ ...q, [name]: e.target.checked }))} />
              {t(`equipment.${name}`)}
            </label>
          ))}
          {equipment.air_fryer && (
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("equipment.air_fryer_model")}</span>
              <input type="text" maxLength={80} value={equipment.air_fryer_model ?? ""} data-testid="kitchen-air_fryer_model"
                onChange={(e) => setEquipment((q) => ({ ...q, air_fryer_model: e.target.value }))} className="field px-3 py-2 text-sm" />
            </label>
          )}
        </div>
      </section>

      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{t("diners.title")}</p>
        <p className="t-body mt-1 text-xs text-muted">{t("diners.intro")}</p>
        {diners.map((d, i) => (
          <div key={i} data-testid="kitchen-diner" className="mt-3 rounded-2xl border border-[rgba(150,190,255,0.12)] p-3">
            <div className="flex items-center gap-2">
              <input type="text" maxLength={60} placeholder={t("diners.name")} aria-label={t("diners.name")} value={d.name}
                data-testid="kitchen-diner-name" onChange={(e) => setDiner(i, { ...d, name: e.target.value })} className="field flex-1 px-3 py-2 text-sm" />
              <button type="button" className="t-label text-bad" onClick={() => setDiners((l) => l.filter((_, n) => n !== i))}>{t("diners.remove")}</button>
            </div>
            {d.restrictions.map((r, j) => (
              <fieldset key={j} data-testid="kitchen-restriction" className="mt-3">
                <legend className="t-label text-muted">{t("diners.meals")}</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {MEALS.map((m) => (
                    <label key={m} className="t-body flex items-center gap-1 text-xs text-ink">
                      <input type="checkbox" checked={r.meals.includes(m)}
                        onChange={() => setRule(i, j, { ...r, meals: r.meals.includes(m) ? r.meals.filter((x) => x !== m) : MEALS.filter((x) => x === m || r.meals.includes(x)) })} />
                      {tm(m)}
                    </label>
                  ))}
                </div>
                <label className="mt-2 flex flex-col gap-1">
                  <span className="t-label text-muted">{t("diners.exclude")}</span>
                  <input type="text" value={r.exclude} placeholder={t("diners.excludeHint")} data-testid="kitchen-exclude"
                    onChange={(e) => setRule(i, j, { ...r, exclude: e.target.value })} className="field px-3 py-2 text-sm" />
                </label>
                <label className="mt-2 flex flex-col gap-1">
                  <span className="t-label text-muted">{t("diners.allow")}</span>
                  <input type="text" value={r.allow} placeholder={t("diners.allowHint")} data-testid="kitchen-allow"
                    onChange={(e) => setRule(i, j, { ...r, allow: e.target.value })} className="field px-3 py-2 text-sm" />
                </label>
              </fieldset>
            ))}
            <button type="button" className="btn btn-tonal btn-sm mt-3" data-testid="kitchen-add-restriction"
              onClick={() => setDiner(i, { ...d, restrictions: [...d.restrictions, { meals: [], exclude: "", allow: "" }] })}>
              {t("diners.addRestriction")}
            </button>
          </div>
        ))}
        {diners.length < MAX_DINERS && (
          <button type="button" className="btn btn-tonal btn-sm mt-3" data-testid="kitchen-add-diner"
            onClick={() => setDiners((l) => [...l, { name: "", restrictions: [{ meals: [], exclude: "", allow: "" }] }])}>
            {t("diners.add")}
          </button>
        )}
        <p className="t-body mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span>{t("diners.categories", { list: kitchen.categories.join(", ") })}</span>
          <EvidenceChip ruleKey={null} />
        </p>
      </section>

      <button type="submit" data-testid="kitchen-save" disabled={save.isPending} className="btn btn-primary mt-4 w-full disabled:opacity-60">
        {save.isPending ? t("saving") : t("save")}
      </button>
      {saved && <p role="status" data-testid="kitchen-saved" className="t-body mt-2 text-xs text-good">{t("saved")}</p>}
      {save.error && <p role="alert" className="t-body mt-2 text-xs text-bad">{t("error")}</p>}
    </form>
  );
}
