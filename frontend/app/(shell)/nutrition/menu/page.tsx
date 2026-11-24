"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NutritionIcon } from "@/components/icons";
import { ReasonLine } from "@/components/plan/PlanView";
import { MenuView, type MenuPart } from "@/components/menu/MenuView";
import { ImportMenuCard } from "@/components/menu/ImportMenuCard";
import { BottomSheet } from "@/components/today/BottomSheet";
import { MEALS, useGenerateMenu, useMenu, type MealKey } from "@/lib/menu";

const DEFAULT_DAYS = 3;
const TABS = ["menu", "shopping", "batch"] as const satisfies readonly MenuPart[];
type Tab = (typeof TABS)[number];

export default function MenuPage() {
  return (
    <Suspense fallback={null}>
      <MenuScreen />
    </Suspense>
  );
}

function MenuScreen() {
  const t = useTranslations("menu");
  const router = useRouter();
  const params = useSearchParams();
  const raw = Number(params.get("id"));
  const selected = Number.isInteger(raw) && raw > 0 ? raw : null;
  const state = useMenu(selected);
  const generate = useGenerateMenu();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [meals, setMeals] = useState<MealKey[]>([...MEALS]);
  const [tupper, setTupper] = useState<MealKey[]>([]);
  const [batch, setBatch] = useState(false);
  const [sheet, setSheet] = useState(false);
  const rawTab = params.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.find((x) => x === rawTab) ?? "menu");
  const missingOrBlocked = !!(state.data && (state.data.blocked || state.data.missing));
  const pick = (id: number | null) => router.replace(id ? `/nutrition/menu?id=${id}` : "/nutrition/menu");

  const header = (canPrepare = false) => (
    <>
      <Link href="/nutrition" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="mr-auto flex items-center gap-2">
          <span className="text-neon"><NutritionIcon className="h-6 w-6" /></span>
          <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
        </div>
        <div className="contents">
          {canPrepare && (
            <button type="button" data-testid="menu-prepare" onClick={() => setSheet(true)} className="btn btn-tonal btn-sm">{t("prepare")}</button>
          )}
          {(canPrepare || missingOrBlocked) && <ImportMenuCard onImported={pick} />}
          <Link href="/nutrition/menu/settings" data-testid="menu-settings-link" aria-label={t("settings")} title={t("settings")} className="btn btn-tonal btn-sm">⚙</Link>
        </div>
      </div>
    </>
  );

  if (state.isLoading) return <div className="pt-4">{header()}<p className="t-body mt-4 text-muted">{t("loading")}</p></div>;
  if (state.isError || !state.data) return <div className="pt-4">{header()}<p className="t-body mt-4 text-bad">{t("error")}</p></div>;

  const { blocked, missing, menu, menus, max_days: maxDays } = state.data;
  const picker = menus.length > 1 && menu && (
    <label className="glass mt-4 flex items-center justify-between gap-3 p-4">
      <span className="t-label text-ink">{t("header.others")}</span>
      <select data-testid="menu-picker" value={menu.id} onChange={(e) => pick(Number(e.target.value))} className="field max-w-[60%] px-3 py-2 text-sm">
        {menus.map((m) => (
          <option key={m.id} value={m.id}>{m.title || t("header.option", { start: m.start_date })}</option>
        ))}
      </select>
    </label>
  );
  // Un menú importado se ve y se usa aunque falten los objetivos para generar uno nuevo.
  const imported = menu && menu.source !== "generated" ? <>{picker}<MenuView menu={menu} /></> : null;
  if (blocked) {
    return (
      <div className="pt-4">
        {header()}
        <section data-testid="menu-blocked" className="glass mt-4 p-4" style={{ borderColor: "#ff5a6e" }}>
          <p className="t-title text-ink">{t("blocked.title")}</p>
          <p className="t-body mt-1 text-sm text-muted">{t("blocked.body")}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {blocked.reasons.map((r, i) => <ReasonLine key={`${r.code}-${i}`} reason={r} />)}
          </ul>
        </section>
        {imported}
      </div>
    );
  }
  if (missing) {
    return (
      <div className="pt-4">
        {header()}
        <section data-testid="menu-missing" data-field={missing} className="glass neon-edge mt-4 p-4">
          <p className="t-body text-sm text-ink">{t("missing.body")}</p>
          <Link href={missing === "weight_kg" ? "/biometrics/new" : "/nutrition"} className="btn btn-tonal btn-sm mt-3">
            {missing === "weight_kg" ? t("missing.weight") : t("missing.cta")}
          </Link>
        </section>
        {imported}
      </div>
    );
  }

  const toggle = (list: MealKey[], m: MealKey) => (list.includes(m) ? list.filter((x) => x !== m) : MEALS.filter((x) => x === m || list.includes(x)));
  const errorCode = generate.error?.code;

  return (
    <div className="pt-4 pb-6">
      {header(true)}
      <div role="tablist" aria-label={t("title")} className="glass mt-3 grid grid-cols-3 gap-1 rounded-2xl p-1">
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            id={`menu-tab-${x}`}
            aria-selected={tab === x}
            aria-controls="menu-tabpanel"
            data-testid={`menu-tab-${x}`}
            onClick={() => setTab(x)}
            className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={tab === x ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}
          >
            {t(`tabs.${x}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="menu-tabpanel" aria-labelledby={`menu-tab-${tab}`}>
      {tab === "menu" && <>

      {picker}
      {menu ? <MenuView menu={menu} part="menu" /> : (
        <section data-testid="menu-empty" className="glass mt-4 p-4 text-center">
          <p className="t-body text-sm text-muted">{t("empty")}</p>
          <button type="button" data-testid="menu-empty-prepare" onClick={() => setSheet(true)} className="btn btn-primary mt-3 w-full">{t("prepare")}</button>
        </section>
      )}
      </>}
      {tab !== "menu" && (
        <>
          {picker}
          {menu ? <MenuView menu={menu} part={tab} /> : <p data-testid="menu-tab-empty" className="t-body mt-4 text-sm text-muted">{t("noMenuYet")}</p>}
        </>
      )}
      </div>
      {sheet && (
        <BottomSheet title={t("prepare")} onClose={() => setSheet(false)} testId="menu-sheet">
        <form
          data-testid="menu-form"
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const tupperMeals = tupper.filter((m) => meals.includes(m));
            generate.mutate(
              { start_date: state.data.today, days, meals, tupper_meals: tupperMeals, ...(batch && tupperMeals.length > 0 ? { batch: true } : {}) },
              // R4-2: se enseña el menú recién creado (por su id), no el que empieza más tarde
              { onSuccess: (created) => { setSheet(false); pick(created.id); } },
            );
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
          <label className="t-body mt-3 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" data-testid="menu-batch" checked={batch} disabled={tupper.length === 0} onChange={(e) => setBatch(e.target.checked)} />
            {t("form.batch")}
          </label>
          <button type="submit" disabled={generate.isPending || meals.length === 0} className="btn btn-primary mt-4 w-full disabled:opacity-60">
            {generate.isPending ? t("form.generating") : menu ? t("form.regenerate") : t("form.generate")}
          </button>
          {errorCode && (
            <p role="alert" className="t-body mt-2 text-xs text-bad">
              {t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : (generate.error?.message || t("errors.generic"))}
            </p>
          )}
        </form>
        </BottomSheet>
      )}
    </div>
  );
}
