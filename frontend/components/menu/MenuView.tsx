"use client";

import { roundGrams } from "@/lib/nutrition";
import { useTargets } from "@/lib/hooks";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { intlLocale } from "@/lib/locale";
import { BatchRuleChip, BatchSessions } from "./BatchSessions";
import { ShoppingList } from "./ShoppingList";
import { TicketsCard } from "./TicketsCard";
import {
  BATCH_RULES,
  RATINGS,
  downloadMenuPdf,
  MenuError,
  useRateDish,
  type DayCheck,
  type Menu,
  type MenuDay,
  type MenuDish,
  type MenuItem,
  type MenuMeal,
  type Rating,
} from "@/lib/menu";

const CHECK_KEYS = ["kcal", "protein_g", "fat_g", "fibre_g"] as const;
type CheckKey = (typeof CHECK_KEYS)[number];
const STATUS_COLOR: Record<string, string> = {
  ok: "var(--color-good)",
  under: "var(--color-warn)",
  over: "var(--color-warn)",
  missing: "var(--color-muted)",
};

function useFormat() {
  const locale = intlLocale(useLocale());
  return {
    n: (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits }),
    date: (iso: string) =>
      new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
  };
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{title}</p>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** El primer chip de las reglas de un objetivo (kcal, proteína, grasa o fibra). */
function RuleChip({ menu, name }: { menu: Menu; name: string }) {
  const rule = menu.rules[name]?.[0];
  return <EvidenceChip ruleKey={rule?.key ?? null} grade={rule?.grade ?? null} />;
}

function Amount({ item }: { item: MenuItem }) {
  const t = useTranslations("menu");
  const f = useFormat();
  return <>{t(`amount.${item.unit}`, { n: f.n(item.amount) })}</>;
}

function Targets({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.targets");
  const f = useFormat();
  const tg = menu.targets;
  // F24: el menú guarda los objetivos con los que se preparó; si los de hoy han cambiado (otro
  // peso, por ejemplo), se dice, en vez de enseñar dos cifras distintas sin explicación.
  const { data: current } = useTargets();
  const now = current?.kind === "ok" && current.data.macros ? current.data.macros : null;
  const proteinNow = now ? roundGrams(now.protein_g) : null;
  // Un menú importado sin objetivos de kcal en el perfil no trae los objetivos con que comprobarlo.
  if (tg.kcal == null || tg.protein_g == null || tg.fat_min_g == null || tg.fibre_g == null) return null;
  const row = (key: string, text: string, rule: string | null) => (
    <p key={key} data-testid="menu-target" data-key={key} className="t-body flex flex-wrap items-center gap-2 text-sm text-ink">
      <span>{text}</span>
      {rule ? <RuleChip menu={menu} name={rule} /> : <EvidenceChip ruleKey={null} />}
    </p>
  );
  return (
    <Section title={t("title")} testId="menu-targets">
      {row("kcal", t("kcal", { kcal: f.n(tg.kcal) }), "kcal")}
      {row("protein_g", t("protein", { g: f.n(roundGrams(tg.protein_g)) }), "protein_g")}
      {row("fat_g", t("fat", { g: f.n(roundGrams(tg.fat_min_g)) }), "fat_g")}
      {row("fibre_g", t("fibre", { g: f.n(roundGrams(tg.fibre_g)) }), "fibre_g")}
      {proteinNow !== null && proteinNow !== roundGrams(tg.protein_g) && (
        <p data-testid="menu-targets-changed" className="t-body text-xs text-muted">{t("changed", { g: f.n(proteinNow) })}</p>
      )}
      {row("margin", t("margin", { pct: f.n(menu.conventions.kcal_margin * 100) }), null)}
      {row("repeat", t("noRepeat", { days: menu.conventions.no_repeat_days }), null)}
    </Section>
  );
}

function CheckLine({ check, menu }: { check: DayCheck; menu: Menu }) {
  const t = useTranslations("menu");
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
      {CHECK_KEYS.map((k: CheckKey) => (
        <li key={k} data-testid="menu-check" data-key={k} data-status={check[k]} className="inline-flex items-center gap-1.5">
          <span className="t-label" style={{ color: STATUS_COLOR[check[k]] }}>
            {t(`checkLabels.${k}`)}: {t(`status.${check[k]}`)}
          </span>
          <RuleChip menu={menu} name={k} />
        </li>
      ))}
    </ul>
  );
}

function RateButtons({ dish }: { dish: string }) {
  const t = useTranslations("menu.rate");
  const rate = useRateDish();
  const [done, setDone] = useState<Rating | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="menu-rate">
      <span className="t-label text-muted">{t("label")}</span>
      {RATINGS.map((r) => (
        <button key={r} type="button" disabled={rate.isPending} aria-pressed={done === r}
          onClick={() => rate.mutate({ dish, rating: r }, { onSuccess: () => setDone(r) })}
          className={`badge ${done === r ? "badge-neon" : ""}`}>
          {t(r)}
        </button>
      ))}
      {done && <span role="status" className="t-label text-good">{t("saved")}</span>}
    </div>
  );
}

function Dish({ dish }: { dish: MenuDish }) {
  const t = useTranslations("menu.day");
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="menu-dish" data-dish={dish.dish} className="mt-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="t-body text-left text-sm text-ink underline-offset-2 hover:underline">
        {dish.dish}
      </button>
      <ul className="t-body mt-0.5 text-[11px] text-muted">
        {dish.items.map((i, n) => (
          <li key={`${i.name}-${n}`} data-testid="menu-item">
            {i.name} · <Amount item={i} />
            {i.product && i.url && (
              <> · <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-neon underline">{t("offProduct")}</a></>
            )}
          </li>
        ))}
      </ul>
      {dish.seasoning.length > 0 && <p className="t-body mt-0.5 text-[11px] text-muted">{t("seasoning", { list: dish.seasoning.join(", ") })}</p>}
      {dish.source && (
        <a href={dish.source} target="_blank" rel="noopener noreferrer" className="t-label text-neon underline">{t("source")}</a>
      )}
      {open && <RateButtons dish={dish.dish} />}
    </div>
  );
}

/** De la nevera o del congelador, con su regla; y si no congela bien, el aviso. */
function Storage({ meal, menu }: { meal: MenuMeal; menu: Menu }) {
  const t = useTranslations("menu.day");
  const st = meal.storage;
  if (!st) return null;
  const rule = st.where === "freezer" ? BATCH_RULES.defrost : BATCH_RULES.fridge;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span data-testid="meal-storage" data-where={st.where} className="badge">{t(`storage.${st.where}`)}</span>
      <BatchRuleChip menu={menu} ruleKey={rule} />
      {st.no_freeze && st.no_freeze.length > 0 && (
        <span data-testid="meal-no-freeze" className="t-label text-warn">{t("noFreeze", { list: st.no_freeze.join(", ") })}</span>
      )}
    </span>
  );
}

function mealName(t: ReturnType<typeof useTranslations>, meal: MenuMeal): string {
  if (meal.label) return meal.label;
  return t.has(`meals.${meal.meal}`) ? t(`meals.${meal.meal}`) : meal.meal;
}

function Day({ day, menu }: { day: MenuDay; menu: Menu }) {
  const t = useTranslations("menu");
  const f = useFormat();
  const tot = day.check?.totals;
  const fileTotals = day.totals;
  return (
    <article data-testid="menu-day" data-date={day.date} data-ok={day.check?.ok ? "true" : "false"} className="glass mt-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="t-title text-ink first-letter:uppercase">{f.date(day.date)}</p>
        {day.check?.ok && <span className="badge badge-neon">{t("day.ok")}</span>}
      </div>
      {day.eve.length > 0 && (
        <ul data-testid="day-eve" className="mt-2 flex flex-col gap-0.5">
          {day.eve.map((task, i) => (
            <li key={i} className="t-body flex flex-wrap items-center gap-1.5 text-xs text-ink">
              <span className="text-muted">{t("day.eve")}</span>
              <span>{task.text ?? t("day.defrost", { dish: task.dish ?? "" })}</span>
              {task.rule_key && <BatchRuleChip menu={menu} ruleKey={task.rule_key} />}
            </li>
          ))}
        </ul>
      )}
      {day.meals.map((meal, i) => (
        <div key={`${meal.meal}-${i}`} data-testid="menu-meal" data-meal={meal.meal} className="mt-3">
          <div className="t-label flex flex-wrap items-center gap-2 text-muted">
            <span>{mealName(t, meal)}</span>
            {meal.tupper && <span className="badge">{t("day.tupper")}</span>}
            <Storage meal={meal} menu={menu} />
          </div>
          {meal.free && (
            <p data-testid="meal-free" className="t-body mt-1 text-sm text-ink">
              {meal.free_budget_kcal ? t("day.freeBudget", { kcal: f.n(meal.free_budget_kcal) }) : t("day.free")}
            </p>
          )}
          {meal.prep.length > 0 && <p className="t-body mt-0.5 text-[11px] text-ink">{t("day.prep", { list: meal.prep.join("; ") })}</p>}
          {meal.dishes.map((d) => <Dish key={d.dish} dish={d} />)}
        </div>
      ))}
      {!day.check && fileTotals && fileTotals.kcal != null && (
        <p data-testid="menu-file-totals" className="stat mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2 text-sm text-ink">
          {t("day.fileTotals", { kcal: f.n(fileTotals.kcal ?? 0), p: f.n(fileTotals.protein_g ?? 0) })}
        </p>
      )}
      {tot && day.check && (
        <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2">
          <p data-testid="menu-totals" className="stat text-sm text-ink">
            {t("day.totals", { kcal: f.n(tot.kcal), p: f.n(tot.protein_g), f: f.n(tot.fat_g), c: f.n(tot.carbs_g), fib: f.n(tot.fibre_g) })}
          </p>
          <CheckLine check={day.check.check} menu={menu} />
        </div>
      )}
    </article>
  );
}

function Rejected({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.rejected");
  const tm = useTranslations("menu");
  const tk = useTranslations("menu.flags.kinds");
  const f = useFormat();
  if (menu.rejected.length === 0) return null;
  return (
    <Section title={t("title")} testId="menu-rejected">
      {menu.rejected.map((r) => {
        const why: string[] = [];
        if (r.empty) why.push(t("empty"));
        if (r.check) {
          for (const k of CHECK_KEYS) if (r.check[k] !== "ok") why.push(`${tm(`checkLabels.${k}`)}: ${tm(`status.${r.check[k]}`)}`);
        }
        if (r.repeats) why.push(t("repeats"));
        for (const b of r.blocking) why.push(t("blocking", { kind: tk.has(b.kind) ? tk(b.kind) : b.kind, entry: b.entry }));
        if (r.unknown.length) why.push(t("unknown", { list: r.unknown.join(", ") }));
        for (const m of r.missing) why.push(t("missing", { meal: tm.has(`meals.${m}`) ? tm(`meals.${m}`) : m }));
        return (
          <p key={r.date} data-testid="menu-rejected-day" data-date={r.date} className="t-body text-sm text-ink">
            <span className="first-letter:uppercase">{f.date(r.date)}</span>: <span className="text-warn">{why.join(" · ")}</span>
          </p>
        );
      })}
    </Section>
  );
}

function TasteFlags({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.flags");
  if (menu.taste_flags.length === 0) return null;
  return (
    <Section title={t("title")} testId="menu-taste-flags">
      {menu.taste_flags.map((fl, i) => (
        <p key={`${fl.date}-${fl.dish}-${i}`} className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
          <span>{t("line", { dish: fl.dish, kind: t.has(`kinds.${fl.kind}`) ? t(`kinds.${fl.kind}`) : fl.kind, entry: fl.entry })}</span>
          <EvidenceChip ruleKey={null} />
        </p>
      ))}
      <p className="t-body text-[11px] text-muted">{t("net")}</p>
    </Section>
  );
}

function Shopping({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.shopping");
  const f = useFormat();
  const s = menu.shopping;
  return (
    <Section title={t("title")} testId="shopping-list">
      {s.chains.map((c) => (
        <div key={c.chain} data-testid="shopping-chain" data-chain={c.chain}>
          <p className="t-label text-muted">{c.chain === "any" ? t("any") : c.chain}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {c.items.map((i) => (
              <li key={i.name} data-testid="shopping-item" className="t-body flex justify-between gap-2 text-sm text-ink">
                <span>{i.name}</span>
                <span className="text-muted">{i.ml != null ? t("ml", { n: f.n(i.ml) }) : t("g", { n: f.n(i.grams ?? 0) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {s.pantry_skipped.length > 0 && <p className="t-body text-xs text-muted">{t("pantry", { list: s.pantry_skipped.join(", ") })}</p>}
      {s.unknown.length > 0 && <p className="t-body text-xs text-warn">{t("unknown", { list: s.unknown.join(", ") })}</p>}
      <p className="t-body text-[11px] text-muted">{t("note")}</p>
    </Section>
  );
}

/** Descarga el menú en PDF (lo hace el servidor en memoria). */
function PdfButton({ id }: { id: number }) {
  const t = useTranslations("menu.pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      await downloadMenuPdf(id);
    } catch (e) {
      const code = e instanceof MenuError ? e.code : "";
      setError(code === "no_calorie_targets" ? t("no_calorie_targets") : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="glass mt-4 p-4">
      <button type="button" data-testid="menu-pdf" onClick={download} disabled={busy} className="btn btn-tonal w-full disabled:opacity-60">
        {busy ? t("downloading") : t("download")}
      </button>
      <p className="t-body mt-2 text-[11px] text-muted">{t("hint")}</p>
      {error && <p role="alert" className="t-body mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}

function Header({ menu }: { menu: Menu }) {
  const t = useTranslations("menu.header");
  const f = useFormat();
  const last = menu.end_date ?? menu.days[menu.days.length - 1]?.date ?? menu.start_date;
  return (
    <section data-testid="menu-header" data-source={menu.source} className="glass mt-4 p-4">
      {menu.title && <p className="t-title text-ink">{menu.title}</p>}
      <p className="t-body text-xs text-muted first-letter:uppercase">{t("range", { start: f.date(menu.start_date), end: f.date(last) })}</p>
      <p className="t-label mt-1 text-muted">{t(`source.${menu.source}`)}</p>
      {menu.notes.length > 0 && (
        <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-4">
          {menu.notes.map((n, i) => <li key={i} className="t-body text-xs text-ink">{n}</li>)}
        </ul>
      )}
      {!menu.kitchen_filled && menu.batch_sessions.length > 0 && (
        <p data-testid="menu-kitchen-hint" className="t-body mt-2 text-xs text-warn">{t("kitchenHint")}</p>
      )}
    </section>
  );
}

/** El menú guardado: objetivos, días comprobados por el motor, sesiones de batch, rechazos, avisos,
 * la compra y los tickets. */
export function MenuView({ menu }: { menu: Menu }) {
  const t = useTranslations("menu");
  return (
    <div data-testid="menu" data-provider={menu.provider} data-menu-id={menu.id}>
      <Header menu={menu} />
      {menu.provider === "fake" && <p data-testid="menu-simulated" className="t-body mt-3 text-[11px] text-muted">{t("simulated")}</p>}
      <Targets menu={menu} />
      <BatchSessions menu={menu} />
      {menu.days.map((d) => <Day key={d.date} day={d} menu={menu} />)}
      <p className="t-body mt-2 text-[11px] text-muted">{t("rateHint")}</p>
      <Rejected menu={menu} />
      <TasteFlags menu={menu} />
      {menu.shopping_list ? <ShoppingList list={menu.shopping_list} menuId={menu.id} /> : <Shopping menu={menu} />}
      <TicketsCard planId={menu.id} />
      <PdfButton id={menu.id} />
      <p className="t-label mt-3 text-muted">{t("engine", { sha: menu.engine_sha })}</p>
    </div>
  );
}
