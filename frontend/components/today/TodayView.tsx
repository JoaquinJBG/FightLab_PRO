"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { capitalizeFirst, formatDate } from "@/lib/locale";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { InfoLine } from "@/components/common/InfoLine";
import { SafetyBanner } from "@/components/safety/SafetyBanner";
import { useBlockedWhy } from "@/components/safety/SafetyStateCard";
import { BottomSheet } from "@/components/today/BottomSheet";
import { canSayReady, useTodaySafety } from "@/lib/safety-state";
import { useBiometrics, useCheckin, useDisciplines, useMe } from "@/lib/hooks";
import { computeRecovery } from "@/lib/recovery";
import { HEAD_BLOW_RULES } from "@/lib/coach-rules";
import { SAFETY_RULES } from "@/lib/safety-rules";
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

const card = "glass rise mt-3 p-3";

function mealName(t: ReturnType<typeof useTranslations>, key: string) {
  return t.has(`meals.${key}`) ? t(`meals.${key}`) : key;
}

/* ------------------------------------ estado ------------------------------------- */

/** El chip de estado de hoy. El aviso completo (SafetyBanner) solo se pinta cuando hay algo que
 * avisar: en verde no ocupa sitio. */
function StatusChip() {
  const t = useTranslations("today.status");
  const td = useTranslations("dashboard");
  const ts = useTranslations("safetyState");
  const safety = useTodaySafety();
  const { data: logs = [] } = useBiometrics();
  if (!safety) return null;
  const recovery = computeRecovery(logs);
  let label: string;
  let color: string;
  if (safety.noTraining) {
    label = t("noTraining");
    color = "#ff5a6e";
  } else if (safety.level === "stop") {
    label = ts("stop");
    color = "#ff5a6e";
  } else if (safety.level === "caution") {
    label = ts("caution");
    color = "#ffd25a";
  } else if (recovery) {
    label = td(`recovery.${recovery.state === "listo" && !canSayReady(safety) ? "normal" : recovery.state}.label`);
    color = recovery.color;
  } else {
    label = t("ok");
    color = "#43e8a0";
  }
  return (
    <p data-testid="today-status" className="badge mt-2" style={{ color, borderColor: color }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
    </p>
  );
}

/* ---------------------------------- entreno de hoy ---------------------------------- */

function Pill({ id, label, on, onClick, pending = false }: { id: string; label: string; on: boolean; onClick: () => void; pending?: boolean }) {
  const t = useTranslations("today.done");
  return (
    <button
      type="button"
      data-testid={id}
      aria-pressed={on}
      onClick={onClick}
      className={`btn btn-sm flex-1 ${on ? "btn-primary" : "btn-outline"}`}
    >
      {on ? `✓ ${label}` : label}
      {pending && <span data-testid={`${id}-pending`} className="text-[10px]">{t("pending")}</span>}
    </button>
  );
}

function TodayTraining({ state }: { state: TodayState }) {
  const t = useTranslations("today");
  const tp = useTranslations("today.plan");
  const save = useSaveDay();
  const { gym: showGym } = useDisciplines();
  // R4-6: lo marcado sin red se ve al momento, con «pendiente de enviar» hasta que sale
  const pending = save.isPaused && save.variables ? Object.keys(save.variables) : [];
  const plan = state.plan;
  return (
    <section data-testid="day-plan" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-label text-ink">{t("training.title")}</h2>
        <div role="radiogroup" aria-label={t("dayType.title")} className="flex gap-1">
          {DAY_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              data-testid={`day-type-${type}`}
              aria-checked={state.day_type === type}
              onClick={() => save.mutate({ day_type: type })}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                state.day_type === type ? "border-[rgba(53,230,255,0.6)] bg-[rgba(53,230,255,0.1)] text-neon" : "border-white/10 text-muted"
              }`}
            >
              {t(`dayType.${type}`)}
            </button>
          ))}
        </div>
      </div>

      {!plan ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="t-body text-sm text-muted">{state.day_type === null ? t("dayType.unknown") : tp("none")}</p>
          <Link href="/training/plan" className="btn btn-tonal btn-sm shrink-0">{tp("makePlan")}</Link>
        </div>
      ) : (
        <>
          {plan.no_contact && (
            <InfoLine testId="plan-head-blow" className="t-body mt-1.5 text-sm" style={{ color: "#ff5a6e" }} text={tp("headBlow")} detail={tp("headBlowDetail")} title={tp("headBlowTitle")}>
              {HEAD_BLOW_RULES.map((r) => <span key={r.key}> <EvidenceChip ruleKey={r.key} grade={r.grade} /></span>)}
            </InfoLine>
          )}
          {plan.entries.length === 0 && <p className="t-body mt-1.5 text-sm text-muted">{tp("rest")}</p>}
          <ul className="mt-1.5 space-y-1.5">
            {plan.entries.map((e, i) => (
              <li key={i} className="t-body flex items-center justify-between gap-2 text-sm text-ink">
                <span className="min-w-0">
                  <span className="block truncate">
                    {e.kind === "gym" ? tp("gym", { session: e.session ?? "?" }) : e.kind === "cardio" ? tp("cardio", { minutes: e.minutes ?? 0 }) : tp("mma")}
                    {e.time ? ` · ${tp("at", { time: e.time })}` : ""}
                  </span>
                  {e.kind === "gym" && e.exercises && e.exercises.length > 0 && (
                    <span className="block truncate text-xs text-muted">{e.exercises.join(" · ")}</span>
                  )}
                  {e.kind === "gym" && e.paused && e.paused.length > 0 && (
                    <InfoLine as="span" testId="plan-paused" className="block text-xs text-ink" text={tp("paused", { exercises: e.paused.join(" · ") })} detail={tp("pausedDetail")} title={tp("pausedTitle")}>
                      {" "}<EvidenceChip ruleKey={SAFETY_RULES.newPain.key} grade={SAFETY_RULES.newPain.grade} />
                    </InfoLine>
                  )}
                  {e.kind === "mma" && e.contact_blocked && (
                    <InfoLine as="span" testId="plan-contact-blocked" className="block text-xs text-ink" text={tp("contactBlocked")} detail={tp("contactBlockedDetail")} title={tp("contactBlockedTitle")} />
                  )}
                </span>
                {e.kind === "gym" && e.session && showGym && (
                  <Link href={`/training/gym?plan=${encodeURIComponent(e.session)}`} className="btn btn-primary btn-sm shrink-0">
                    {tp("openSession", { session: e.session })}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-2.5 flex gap-2">
        <Pill id="toggle-trained" label={t("done.trained")} on={state.trained === true} onClick={() => save.mutate({ trained: state.trained !== true })} pending={pending.includes("trained")} />
        <Pill id="toggle-mobility" label={t("done.mobility")} on={state.mobility === true} onClick={() => save.mutate({ mobility: state.mobility !== true })} pending={pending.includes("mobility")} />
      </div>
      {state.day_type_set && plan && (
        <button type="button" className="t-body mt-1.5 text-[11px] text-neon underline" onClick={() => save.mutate({ day_type: null })}>
          {t("dayType.reset")}
        </button>
      )}
      {save.isError && <p role="alert" className="t-body mt-2 text-xs text-warn">{t("saveError")}</p>}
    </section>
  );
}

/* --------------------------------- próxima comida --------------------------------- */

/* Todas las comidas del menú con su marca (hecha / no hecha / cambiada / quitar). Se abre en un
   panel desde «Ver el día» para que Hoy quepa en una pantalla sin perder ninguna acción. */
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
    <li data-testid={`day-meal-${meal.meal}`} className="border-b border-[rgba(150,190,255,0.08)] py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label text-ink">{mealName(tMenu, meal.meal)}</span>
        {meal.tupper && <span className="badge">{t("tupper")}</span>}
      </div>
      <p className="t-body text-sm text-muted">{meal.free ? t("free") : meal.dishes.join(", ")}</p>
      {meal.previous_mark && (
        <p className="t-body text-[11px] text-muted">
          {t("previousMark", { state: t(`states.${meal.previous_mark.state}`), dish: meal.previous_mark.dish })}
        </p>
      )}
      {meal.eve.length > 0 && <p className="t-body text-[11px] text-neon">{t("eve", { task: meal.eve.join("; ") })}</p>}
      {meal.prep.length > 0 && <p className="t-body text-[11px] text-ink">{t("prep", { list: meal.prep.join("; ") })}</p>}
      <div className="mt-2 flex gap-2" role="group" aria-label={mealName(tMenu, meal.meal)}>
        {MEAL_STATES.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`day-meal-${meal.meal}-${s}`}
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
      {state === "done" && meal.totals && (
        <p className="t-body mt-1 text-xs text-good">{t("inDiary", { kcal: meal.totals.kcal })}</p>
      )}
      {state === "changed" && !changing && (
        <Link href="/nutrition" className="t-label mt-1 block text-xs text-neon underline">
          {t("logInstead")}
        </Link>
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
              data-testid={`day-meal-${meal.meal}-change`}
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
        <button
          type="button"
          data-testid={`day-meal-${meal.meal}-clear`}
          className="t-label mt-1 text-muted underline"
          onClick={() => mark.mutate({ meal: meal.meal, state: null })}
        >
          {t("clear")}
        </button>
      )}
    </li>
  );
}

function DayMeals({ state }: { state: TodayState }) {
  const t = useTranslations("today.meals");
  const meals = state.menu?.meals ?? [];
  return meals.length === 0 ? (
    <p className="t-body text-sm text-muted">{t("none")}</p>
  ) : (
    <ul data-testid="day-meals">
      {meals.map((m) => (
        <MealRow key={m.meal} meal={m} />
      ))}
    </ul>
  );
}

function NextMeal({ state, onSeeDay }: { state: TodayState; onSeeDay: () => void }) {
  const t = useTranslations("today.next");
  const tm = useTranslations("today.meals");
  const tn = useTranslations("today.tonight");
  const tMenu = useTranslations("menu");
  const mark = useMarkMeal();
  const next = state.next_meal;
  const current = next && !next.all_done ? state.menu?.meals.find((m) => m.meal === next.meal) : undefined;
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState("");
  const tasks = state.tonight?.tasks ?? [];

  return (
    <section id="next-meal" data-testid="next-meal" tabIndex={-1} className="glass neon-edge rise mt-3 scroll-mt-4 p-3 outline-none">
      <div className="flex items-center justify-between gap-2">
        <p className="t-eyebrow text-muted">{t("title")}</p>
        {state.menu && state.menu.meals.length > 0 ? (
          <button type="button" data-testid="next-meal-see-day" onClick={onSeeDay} className="t-label text-xs text-neon">
            {t("seeDay")}
          </button>
        ) : (
          <Link href="/nutrition" className="t-label text-xs text-neon">{t("seeDay")}</Link>
        )}
      </div>
      {next === null ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="t-body text-sm text-muted">{t("noMenu")}</p>
          <Link href="/nutrition/menu" className="btn btn-tonal btn-sm shrink-0">{t("makeMenu")}</Link>
        </div>
      ) : next.all_done ? (
        <p className="t-title mt-1 text-good">{t("allDone")}</p>
      ) : (
        <>
          <p className="t-title mt-1 truncate text-ink" title={`${mealName(tMenu, next.meal)}: ${next.free ? t("free") : next.dishes.join(", ")}`}>
            {mealName(tMenu, next.meal)}: {next.free ? t("free") : next.dishes.join(", ")}
          </p>
          {current?.previous_mark && (
            <p data-testid={`meal-${next.meal}-previous`} className="t-body mt-1 text-[11px] text-muted">
              {tm("previousMark", { state: tm(`states.${current.previous_mark.state}`), dish: current.previous_mark.dish })}
            </p>
          )}
          <div className="mt-2 flex gap-2" role="group" aria-label={mealName(tMenu, next.meal)}>
            <button
              type="button"
              data-testid={`meal-${next.meal}-done`}
              aria-pressed={current?.mark?.state === "done"}
              onClick={() => { setChanging(false); mark.mutate({ meal: next.meal, state: "done" }); }}
              className="btn btn-primary btn-sm flex-1"
            >
              {tm("states.done")}
            </button>
            <button
              type="button"
              data-testid={`meal-${next.meal}-skipped`}
              aria-pressed={current?.mark?.state === "skipped"}
              onClick={() => { setChanging(false); mark.mutate({ meal: next.meal, state: "skipped" }); }}
              className="btn btn-outline btn-sm flex-1"
            >
              {tm("states.skipped")}
            </button>
            <button
              type="button"
              data-testid={`meal-${next.meal}-changed`}
              aria-pressed={changing}
              aria-expanded={changing}
              onClick={() => setChanging(true)}
              className={`btn btn-sm flex-1 ${changing ? "btn-primary" : "btn-outline"}`}
            >
              {t("change")}
            </button>
          </div>
          {changing && (
            <form
              className="mt-2 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                mark.mutate({ meal: next.meal, state: "changed", change }, { onSuccess: () => { setChanging(false); setChange(""); } });
              }}
            >
              <label className="flex flex-1 flex-col gap-1">
                <span className="t-body text-xs text-muted">{tm("changeLabel")}</span>
                <input
                  data-testid={`meal-${next.meal}-change`}
                  value={change}
                  maxLength={300}
                  onChange={(e) => setChange(e.target.value)}
                  placeholder={tm("changePlaceholder")}
                  className="field px-3 py-2 text-sm"
                />
              </label>
              <button type="submit" className="btn btn-primary btn-sm">{tm("changeSave")}</button>
            </form>
          )}
          {changing && (
            <Link href="/nutrition" data-testid={`meal-${next.meal}-log`} className="t-label mt-1 block text-xs text-neon underline">
              {tm("logInstead")}
            </Link>
          )}
        </>
      )}
      {tasks.length > 0 && (
        <div data-testid="today-tonight" className="mt-2 flex items-start gap-2 border-t border-[rgba(150,190,255,0.1)] pt-2">
          <p className="t-label shrink-0 text-xs text-muted">{tn("title")}</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {tasks.map((task, i) => (
              <li key={i} data-testid="tonight-task" data-kind={task.kind} className="t-body flex flex-wrap items-center gap-2 text-xs text-ink">
                <span>{task.kind === "defrost" ? tn("defrost", { dish: task.dish ?? "" }) : task.text}</span>
                {task.kind === "defrost" && <EvidenceChip ruleKey={task.rule_key ?? null} />}
                {task.kind === "batch" && <span className="badge">{tn("batch")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
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
      <div id="weight" data-testid="weight">
        <p className="t-body text-sm text-muted">{t("blocked")}</p>
      </div>
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
    <div id="weight" data-testid="weight">
      {state.weight_kg !== null && (
        <p data-testid="weight-saved" className="t-body text-sm text-good">
          {t("saved", { kg: format.number(state.weight_kg, { maximumFractionDigits: 2 }) })}
        </p>
      )}
      {state.day_weight && state.day_weight.count > 1 && (
        <p data-testid="weight-day-mean" className="t-body mt-1 text-xs text-muted">
          {t("dayMean", { count: state.day_weight.count, kg: format.number(state.day_weight.kg, { maximumFractionDigits: 2 }) })}
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
    </div>
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
  // Spec §8.2: lo ya hecho se apunta siempre. Con lo vigoroso bloqueado hoy (la regla del plan,
  // `lib/safety-state`), «Vigorosa» se deja marcar y se avisa del motivo, como el aviso de sesión
  // vigorosa; lo que se propone (plan, Deportes, Mi rutina) no la ofrece.
  const safeToday = useTodaySafety();
  const vigorousWarn = !!safeToday && !safeToday.vigorousAllowed && intensity === "vigorous";
  const blockedWhy = useBlockedWhy();
  const tState = useTranslations("safetyState");
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
    <div data-testid="cardio">
      <div>
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
        {vigorousWarn && safeToday && (
          <p data-testid="cardio-vigorous-warning" role="status" className="t-body mt-1 text-[11px]" style={{ color: "#ffd25a" }}>
            {tState("vigorousLogged", { why: blockedWhy(safeToday.vigorousBlockedBy) })}
          </p>
        )}
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
    </div>
  );
}

/* ---------------------------------- apuntar rápido ---------------------------------- */

const tile = "glass flex flex-col items-start gap-0.5 rounded-2xl p-3 text-left";

function QuickRow({ state, onOpen }: { state: TodayState; onOpen: (s: "weight" | "cardio") => void }) {
  const t = useTranslations("today.quick");
  const format = useFormatter();
  const { data: checkin } = useCheckin();
  const { week } = state.cardio;
  return (
    <section aria-labelledby="today-quick" className="rise mt-3">
      <h2 id="today-quick" className="t-eyebrow text-muted">{t("title")}</h2>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <Link href="/checkin" data-testid="quick-checkin" className={tile}>
          <span className="t-label text-ink">{t("checkin")}</span>
          <span className="t-body text-[11px] text-muted">{checkin?.checkin ? t("checkinDone") : t("checkinTodo")}</span>
        </Link>
        <button type="button" data-testid="quick-weight" onClick={() => onOpen("weight")} className={tile}>
          <span className="t-label text-ink">{t("weight")}</span>
          <span className="t-body text-[11px] text-muted">
            {state.weight_kg !== null ? t("kg", { kg: format.number(state.weight_kg, { maximumFractionDigits: 2 }) }) : t("log")}
          </span>
        </button>
        <button type="button" data-testid="quick-cardio" onClick={() => onOpen("cardio")} className={tile}>
          <span className="t-label text-ink">{t("cardio")}</span>
          <span className="t-body text-[11px] text-muted">{t("min", { equivalent: week.equivalent, goal: week.goal })}</span>
        </button>
      </div>
    </section>
  );
}

/* --------------------------------------- vista --------------------------------------- */

export function TodayView({ state }: { state: TodayState }) {
  const t = useTranslations("today");
  // La fecha es la del perfil (la decide el servidor): se pinta tal cual, sin la zona del móvil.
  const locale = useLocale();
  const { data: me } = useMe();
  // Los accesos directos del manifiesto: /today#weight abre el panel del peso y /today#next-meal
  // lleva a la próxima comida.
  const [sheet, setSheet] = useState<"weight" | "cardio" | "meals" | null>(() =>
    typeof window !== "undefined" && window.location.hash === "#weight" ? "weight" : null,
  );
  useEffect(() => {
    const focusMeal = () => {
      const el = document.getElementById("next-meal");
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    };
    if (window.location.hash === "#next-meal") focusMeal();
    const onHash = () => {
      if (window.location.hash === "#weight") setSheet("weight");
      else if (window.location.hash === "#next-meal") focusMeal();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const initial = me?.email ? me.email[0].toUpperCase() : "?";
  return (
    <div className="pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
          {/* F11: «Lunes, 9 de noviembre», con mayúscula solo al empezar (no «9 De Noviembre») */}
          <p className="t-body text-sm text-muted" data-testid="today-date">{capitalizeFirst(formatDate(locale, state.date, "weekday"), locale)}</p>
        </div>
        <Link
          href="/profile"
          data-testid="today-avatar"
          aria-label={t("profileAria")}
          className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm text-neon"
        >
          {initial}
        </Link>
      </header>
      <StatusChip />
      {/* Hoy es la pantalla de inicio: los avisos de seguridad del motor van arriba. En verde no hay nada. */}
      <SafetyBanner foldDay={state.date} />
      <TodayTraining state={state} />
      <NextMeal state={state} onSeeDay={() => setSheet("meals")} />
      <QuickRow state={state} onOpen={setSheet} />
      {sheet === "weight" && (
        <BottomSheet title={t("weight.title")} onClose={() => setSheet(null)} testId="sheet-weight">
          <Weight state={state} />
        </BottomSheet>
      )}
      {sheet === "cardio" && (
        <BottomSheet title={t("cardio.title")} onClose={() => setSheet(null)} testId="sheet-cardio">
          <Cardio state={state} />
        </BottomSheet>
      )}
      {sheet === "meals" && (
        <BottomSheet title={t("meals.title")} onClose={() => setSheet(null)} testId="sheet-meals">
          <DayMeals state={state} />
        </BottomSheet>
      )}
    </div>
  );
}
