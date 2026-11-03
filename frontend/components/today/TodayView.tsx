"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { SafetyBanner } from "@/components/safety/SafetyBanner";
import { ChevronRight } from "@/components/icons";
import { parseNum } from "@/lib/checkin";
import {
  DAY_TYPES,
  INTENSITIES,
  MEAL_STATES,
  useAddCardio,
  useDeleteCardio,
  useMarkMeal,
  useSaveDay,
  weekProgress,
  type Intensity,
  type MealState,
  type TodayMeal,
  type TodayState,
} from "@/lib/today";

const section = "glass rise mt-4 p-4";

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="t-label text-ink">{children}</h2>
      {aside}
    </div>
  );
}

function Toggle({ id, label, value, onChange }: { id: string; label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  const t = useTranslations("today.done");
  const on = value === true;
  return (
    <button
      type="button"
      data-testid={id}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`flex flex-1 flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors ${
        on ? "border-[rgba(53,230,255,0.6)] bg-[rgba(53,230,255,0.08)]" : "border-white/10"
      }`}
    >
      <span className="t-label text-ink">{label}</span>
      <span className={`t-body text-xs ${on ? "text-neon" : "text-muted"}`}>{on ? `✓ ${t("yes")}` : t("notYet")}</span>
    </button>
  );
}

function mealName(t: ReturnType<typeof useTranslations>, key: string) {
  return t.has(`meals.${key}`) ? t(`meals.${key}`) : key;
}

/* --------------------------------- próxima comida --------------------------------- */

function NextMeal({ state }: { state: TodayState }) {
  const t = useTranslations("today.next");
  const tMenu = useTranslations("menu");
  const next = state.next_meal;
  return (
    <section id="next-meal" data-testid="next-meal" className="glass neon-edge rise mt-4 scroll-mt-4 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      {next === null ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="t-body text-sm text-muted">{t("noMenu")}</p>
          <Link href="/nutrition/menu" className="btn btn-tonal btn-sm">{t("makeMenu")}</Link>
        </div>
      ) : next.all_done ? (
        <p className="t-title mt-1 text-good">{t("allDone")}</p>
      ) : (
        <p className="t-title mt-1 text-ink">
          {mealName(tMenu, next.meal)}: {next.free ? t("free") : next.dishes.join(", ")}
        </p>
      )}
    </section>
  );
}

/* ----------------------------------- plan del día ---------------------------------- */

function DayPlan({ state }: { state: TodayState }) {
  const t = useTranslations("today.plan");
  const plan = state.plan;
  if (!plan) {
    return (
      <section data-testid="day-plan" className={section}>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="t-body mt-1 text-sm text-muted">{t("none")}</p>
        <Link href="/training/plan" className="btn btn-tonal btn-sm mt-2">{t("makePlan")}</Link>
      </section>
    );
  }
  return (
    <section data-testid="day-plan" className={section}>
      <SectionTitle>{t("title")}</SectionTitle>
      {plan.entries.length === 0 && <p className="t-body mt-1 text-sm text-muted">{t("rest")}</p>}
      <ul className="mt-1 space-y-2">
        {plan.entries.map((e, i) => (
          <li key={i} className="t-body text-sm text-ink">
            <span>
              {e.kind === "gym" ? t("gym", { session: e.session ?? "?" }) : e.kind === "cardio" ? t("cardio", { minutes: e.minutes ?? 0 }) : t("mma")}
              {e.time ? ` · ${t("at", { time: e.time })}` : ""}
            </span>
            {e.kind === "gym" && e.exercises && e.exercises.length > 0 && (
              <span className="block text-xs text-muted">{e.exercises.join(" · ")}</span>
            )}
            {e.kind === "gym" && e.session && (
              <Link href={`/training/gym?plan=${encodeURIComponent(e.session)}`} className="t-label mt-1 inline-flex items-center gap-1 text-neon">
                {t("openSession", { session: e.session })} <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------- tipo de día y hecho hoy ---------------------------- */

function DayStatus({ state }: { state: TodayState }) {
  const t = useTranslations("today");
  const save = useSaveDay();
  return (
    <section className={section}>
      <SectionTitle>{t("dayType.title")}</SectionTitle>
      <div role="radiogroup" aria-label={t("dayType.title")} className="mt-2 flex gap-2">
        {DAY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            data-testid={`day-type-${type}`}
            aria-checked={state.day_type === type}
            onClick={() => save.mutate({ day_type: type })}
            className={`btn btn-sm flex-1 ${state.day_type === type ? "btn-primary" : "btn-outline"}`}
          >
            {t(`dayType.${type}`)}
          </button>
        ))}
      </div>
      <p className="t-body mt-2 text-[11px] text-muted">
        {state.day_type === null ? t("dayType.unknown") : state.day_type_set ? t("dayType.changed") : t("dayType.fromPlan")}
        {state.day_type_set && state.plan && (
          <button type="button" className="ml-2 text-neon underline" onClick={() => save.mutate({ day_type: null })}>
            {t("dayType.reset")}
          </button>
        )}
      </p>

      <h2 className="t-label mt-4 text-ink">{t("done.title")}</h2>
      <div className="mt-2 flex gap-2">
        <Toggle id="toggle-trained" label={t("done.trained")} value={state.trained} onChange={(v) => save.mutate({ trained: v })} />
        <Toggle id="toggle-mobility" label={t("done.mobility")} value={state.mobility} onChange={(v) => save.mutate({ mobility: v })} />
      </div>
      {save.isError && <p role="alert" className="t-body mt-2 text-xs text-warn">{t("saveError")}</p>}
    </section>
  );
}

/* --------------------------------------- peso --------------------------------------- */

function Weight({ state }: { state: TodayState }) {
  const t = useTranslations("today.weight");
  const format = useFormatter();
  const save = useSaveDay();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  if (state.weight_blocked) {
    return (
      <section id="weight" data-testid="weight" className={`${section} scroll-mt-4`}>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="t-body mt-1 text-sm text-muted">{t("blocked")}</p>
      </section>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const kg = parseNum(text);
    if (kg === null || kg < 25 || kg > 400) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({ weight_kg: kg }, { onSuccess: () => setText("") });
  };

  return (
    <section id="weight" data-testid="weight" className={`${section} scroll-mt-4`}>
      <SectionTitle>{t("title")}</SectionTitle>
      {state.weight_kg !== null && (
        <p data-testid="weight-saved" className="t-body mt-1 text-sm text-good">
          {t("saved", { kg: format.number(state.weight_kg, { maximumFractionDigits: 2 }) })}
        </p>
      )}
      <form onSubmit={submit} className="mt-2 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="t-body text-xs text-muted">{t("label")}</span>
          <input
            data-testid="weight-input"
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={state.weight_kg !== null ? format.number(state.weight_kg) : "—"}
            className="field px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim() || save.isPending}>
          {t("save")}
        </button>
      </form>
      <p className={`t-body mt-1 text-[11px] ${invalid ? "text-warn" : "text-muted"}`} role={invalid ? "alert" : undefined}>
        {invalid ? t("invalid") : t("hint")}
      </p>
    </section>
  );
}

/* ------------------------------------- comidas ------------------------------------- */

function MealRow({ meal }: { meal: TodayMeal }) {
  const t = useTranslations("today.meals");
  const tMenu = useTranslations("menu");
  const mark = useMarkMeal();
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState(meal.mark?.change ?? "");
  const state = meal.mark?.state ?? null;

  const choose = (s: MealState) => {
    if (s === "changed") {
      setChanging(true);
      return;
    }
    setChanging(false);
    mark.mutate({ meal: meal.meal, state: s });
  };

  return (
    <li data-testid={`meal-${meal.meal}`} className="border-b border-[rgba(150,190,255,0.08)] py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label text-ink">{mealName(tMenu, meal.meal)}</span>
        {meal.tupper && <span className="badge">{t("tupper")}</span>}
      </div>
      <p className="t-body text-sm text-muted">{meal.free ? t("free") : meal.dishes.join(", ")}</p>
      {meal.eve && <p className="t-body text-[11px] text-neon">{t("eve", { task: meal.eve })}</p>}
      <div className="mt-2 flex gap-2" role="group" aria-label={mealName(tMenu, meal.meal)}>
        {MEAL_STATES.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`meal-${meal.meal}-${s}`}
            aria-pressed={state === s || (s === "changed" && changing)}
            onClick={() => choose(s)}
            className={`btn btn-sm flex-1 ${state === s ? "btn-primary" : "btn-outline"}`}
          >
            {t(`states.${s}`)}
          </button>
        ))}
      </div>
      {state === "changed" && meal.mark?.change && !changing && (
        <p className="t-body mt-1 text-xs text-muted">{t("changedTo", { what: meal.mark.change })}</p>
      )}
      {changing && (
        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            mark.mutate({ meal: meal.meal, state: "changed", change }, { onSuccess: () => setChanging(false) });
          }}
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="t-body text-xs text-muted">{t("changeLabel")}</span>
            <input
              data-testid={`meal-${meal.meal}-change`}
              value={change}
              maxLength={300}
              onChange={(e) => setChange(e.target.value)}
              placeholder={t("changePlaceholder")}
              className="field px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">{t("changeSave")}</button>
        </form>
      )}
      {state && !changing && (
        <button type="button" className="t-label mt-1 text-muted underline" onClick={() => mark.mutate({ meal: meal.meal, state: null })}>
          {t("clear")}
        </button>
      )}
    </li>
  );
}

function Meals({ state }: { state: TodayState }) {
  const t = useTranslations("today.meals");
  if (!state.menu) return null;
  return (
    <section data-testid="meals" className={section}>
      <SectionTitle>{t("title")}</SectionTitle>
      {state.menu.meals.length === 0 ? (
        <p className="t-body mt-1 text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="mt-1">
          {state.menu.meals.map((m) => (
            <MealRow key={m.meal} meal={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------- cardio -------------------------------------- */

function Cardio({ state }: { state: TodayState }) {
  const t = useTranslations("today.cardio");
  const add = useAddCardio();
  const del = useDeleteCardio();
  const { sessions, week, types } = state.cardio;
  const [type, setType] = useState(types[0]?.key ?? "walk");
  const [minutes, setMinutes] = useState("");
  const [intensity, setIntensity] = useState<Intensity>(types[0]?.vigorous ? "vigorous" : "moderate");
  const [invalid, setInvalid] = useState(false);
  const typeName = (key: string) => (t.has(`types.${key}`) ? t(`types.${key}`) : key);
  const pct = weekProgress(week.equivalent, week.goal);

  const pick = (key: string) => {
    setType(key);
    setIntensity(types.find((x) => x.key === key)?.vigorous ? "vigorous" : "moderate");
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 1 || n > 600) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    add.mutate({ type, minutes: n, intensity }, { onSuccess: () => setMinutes("") });
  };

  return (
    <section data-testid="cardio" className={section}>
      <SectionTitle>{t("title")}</SectionTitle>

      <div className="mt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="cardio-week" className="t-body text-sm text-ink">
            {t("week", { equivalent: week.equivalent, goal: week.goal })}
          </p>
          <EvidenceChip ruleKey={week.rule_key} grade={week.grade} />
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={week.goal}
          aria-valuenow={Math.min(week.equivalent, week.goal)}
          aria-label={t("week", { equivalent: week.equivalent, goal: week.goal })}
        >
          <div className="h-full rounded-full bg-[#35e6ff]" style={{ width: `${pct}%` }} />
        </div>
        <p className="t-body mt-1 text-[11px] text-muted">
          {week.equivalent >= week.goal ? `${t("weekDone")} ` : ""}
          {t("weekDetail", { minutes: week.minutes })}
        </p>
        {week.mma_minutes > 0 && (
          <p className="t-body mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {t("weekMma", { minutes: week.mma_minutes })} <EvidenceChip />
          </p>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="t-body mt-3 text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="mt-3">
          {sessions.map((s) => (
            <li key={s.id} data-testid="cardio-session" className="flex items-center justify-between gap-2 py-1.5">
              <span className="t-body text-sm text-ink">
                {typeName(s.type)}{" "}
                <span className="text-muted">
                  {t("session", { minutes: s.minutes, intensity: s.vigorous ? t("vigorous") : t("moderate") })}
                </span>
              </span>
              {s.deletable ? (
                <button
                  type="button"
                  className="t-label text-muted underline"
                  aria-label={t("deleteAria", { type: typeName(s.type), minutes: s.minutes })}
                  onClick={() => del.mutate(s.id)}
                >
                  {t("delete")}
                </button>
              ) : (
                <span className="t-body text-[11px] text-muted">{t("fromSports")}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} noValidate className="mt-3 border-t border-[rgba(150,190,255,0.08)] pt-3">
        <p className="t-label text-ink">{t("add")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {types.map((x) => (
            <button
              key={x.key}
              type="button"
              data-testid={`cardio-type-${x.key}`}
              aria-pressed={type === x.key}
              onClick={() => pick(x.key)}
              className={`btn btn-sm ${type === x.key ? "btn-primary" : "btn-outline"}`}
            >
              {typeName(x.key)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex w-24 flex-col gap-1">
            <span className="t-body text-xs text-muted">{t("minutes")}</span>
            <input
              data-testid="cardio-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="field px-3 py-2 text-sm"
            />
          </label>
          <div role="radiogroup" aria-label={t("intensity")} className="flex flex-1 gap-2">
            {INTENSITIES.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                data-testid={`cardio-intensity-${i}`}
                aria-checked={intensity === i}
                onClick={() => setIntensity(i)}
                className={`btn btn-sm flex-1 ${intensity === i ? "btn-primary" : "btn-outline"}`}
              >
                {t(i)}
              </button>
            ))}
          </div>
        </div>
        <p className={`t-body mt-1 flex flex-wrap items-center gap-2 text-[11px] ${invalid ? "text-warn" : "text-muted"}`}>
          {invalid ? (
            <span role="alert">{t("invalidMinutes")}</span>
          ) : (
            <>
              <span>{t("vigorousHint")}</span>
              <EvidenceChip ruleKey={week.rule_key} grade={week.grade} />
            </>
          )}
        </p>
        <button type="submit" data-testid="cardio-save" className="btn btn-primary btn-sm mt-2 w-full" disabled={!minutes || add.isPending}>
          {t("save")}
        </button>
      </form>
    </section>
  );
}

/* --------------------------------------- vista --------------------------------------- */

export function TodayView({ state }: { state: TodayState }) {
  const t = useTranslations("today");
  const format = useFormatter();
  // La fecha es la del perfil (la decide el servidor): se pinta tal cual, sin la zona del móvil.
  const date = new Date(`${state.date}T12:00:00Z`);
  return (
    <div className="pt-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
          <p className="t-body text-sm capitalize text-muted">{format.dateTime(date, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</p>
        </div>
        <Link href="/dashboard" aria-label={t("summaryAria")} className="btn btn-outline btn-sm">
          {t("summaryLink")}
        </Link>
      </header>
      {/* Hoy es la pantalla de inicio: los avisos de seguridad del motor van arriba, como en el resumen. */}
      <SafetyBanner />
      <NextMeal state={state} />
      <DayPlan state={state} />
      <DayStatus state={state} />
      <Weight state={state} />
      <Meals state={state} />
      <Cardio state={state} />
      <Link href="/checkin" className="btn btn-tonal mt-4 w-full">
        {t("fullCheckin")}
      </Link>
    </div>
  );
}
