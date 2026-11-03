"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { NutritionIcon } from "@/components/icons";
import { ReasonLine } from "@/components/plan/PlanView";
import { MenuView } from "@/components/menu/MenuView";
import { ProductsCard } from "@/components/menu/ProductsCard";
import { TastesCard } from "@/components/menu/TastesCard";
import { MEALS, useGenerateMenu, useMenu, type MealKey } from "@/lib/menu";

const DEFAULT_DAYS = 3;

export default function MenuPage() {
  const t = useTranslations("menu");
  const state = useMenu();
  const generate = useGenerateMenu();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [meals, setMeals] = useState<MealKey[]>([...MEALS]);
  const [tupper, setTupper] = useState<MealKey[]>([]);

  const header = (
    <>
      <Link href="/nutrition" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><NutritionIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
    </>
  );

  if (state.isLoading) return <div className="pt-4">{header}<p className="t-body mt-4 text-muted">{t("loading")}</p></div>;
  if (state.isError || !state.data) return <div className="pt-4">{header}<p className="t-body mt-4 text-bad">{t("error")}</p></div>;

  const { blocked, missing, menu, tastes, max_days: maxDays } = state.data;
  if (blocked) {
    return (
      <div className="pt-4">
        {header}
        <section data-testid="menu-blocked" className="glass mt-4 p-4" style={{ borderColor: "#ff5a6e" }}>
          <p className="t-title text-ink">{t("blocked.title")}</p>
          <p className="t-body mt-1 text-sm text-muted">{t("blocked.body")}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {blocked.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}
          </ul>
        </section>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="pt-4">
        {header}
        <section data-testid="menu-missing" data-field={missing} className="glass neon-edge mt-4 p-4">
          <p className="t-body text-sm text-ink">{t("missing.body")}</p>
          <Link href={missing === "weight_kg" ? "/biometrics/new" : "/nutrition"} className="btn btn-tonal btn-sm mt-3">
            {missing === "weight_kg" ? t("missing.weight") : t("missing.cta")}
          </Link>
        </section>
      </div>
    );
  }

  const toggle = (list: MealKey[], m: MealKey) => (list.includes(m) ? list.filter((x) => x !== m) : MEALS.filter((x) => x === m || list.includes(x)));
  const errorCode = generate.error?.code;

  return (
    <div className="pt-4 pb-6">
      {header}
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      <form
        data-testid="menu-form"
        className="glass mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          generate.mutate({ start_date: state.data.today, days, meals, tupper_meals: tupper.filter((m) => meals.includes(m)) });
        }}
      >
        <label className="flex items-center justify-between gap-3">
          <span className="t-label text-ink">{t("form.days")}</span>
          <select name="days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="field px-3 py-2 text-sm">
            {Array.from({ length: maxDays }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t("form.dayCount", { n })}</option>)}
          </select>
        </label>
        <fieldset className="mt-3">
          <legend className="t-label text-ink">{t("form.meals")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MEALS.map((m) => (
              <label key={m} className="t-body flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={meals.includes(m)} onChange={() => setMeals((l) => toggle(l, m))} />
                {t(`meals.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-3">
          <legend className="t-label text-ink">{t("form.tupper")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MEALS.filter((m) => meals.includes(m)).map((m) => (
              <label key={m} className="t-body flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={tupper.includes(m)} onChange={() => setTupper((l) => toggle(l, m))} />
                {t(`meals.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={generate.isPending || meals.length === 0} className="btn btn-primary mt-4 w-full disabled:opacity-60">
          {generate.isPending ? t("form.generating") : menu ? t("form.regenerate") : t("form.generate")}
        </button>
        {errorCode && (
          <p role="alert" className="t-body mt-2 text-xs text-bad">
            {t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : (generate.error?.message || t("errors.generic"))}
          </p>
        )}
      </form>

      {menu && <MenuView menu={menu} />}
      <TastesCard tastes={tastes} />
      <ProductsCard />
    </div>
  );
}
