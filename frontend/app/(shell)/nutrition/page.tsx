"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/locale";
import { useWeighIn } from "@/lib/hooks";
import { useNutritionGoal } from "@/components/nutrition/GoalBlock";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { EquationSexPrompt } from "@/components/nutrition/EquationSexPrompt";
import {
  MEALS,
  loadToday,
  removeItem,
  loadWater,
  saveWater,
  hydrateRecentNutritionDays,
  itemSource,
  roundGrams,
  type Item,
} from "@/lib/nutrition";
import { NutritionIcon, ScaleIcon } from "@/components/icons";
import { WeightPrompt } from "@/components/weight-prompt";

// Una falta de dato del motor (409) → qué decirle al usuario y a dónde llevarlo.
function missingKind(field: string): "equation_sex" | "weight" | "profile" {
  if (field === "equation_sex") return "equation_sex";
  if (field === "weight_kg") return "weight";
  return "profile";
}

function Bar({ label, val, target, color }: { label: string; val: number; target: number | null; color: string }) {
  const pct = target && target > 0 ? Math.min(100, (val / target) * 100) : 0;
  const t = useTranslations("nutrition");
  const locale = useLocale();
  const g = (v: number) => formatNumber(locale, v, { max: 1 });
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-1">
        <span className="t-label text-muted">{label}</span>
        <span className="t-body whitespace-nowrap text-xs text-ink">{target == null ? t("gramsOnly", { value: g(val) }) : t("gramsOf", { value: g(val), target: g(target) })}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[rgba(150,190,255,0.12)]">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function TargetsStatus({ result, loading, error, noWeight }: { result: ReturnType<typeof useNutritionGoal>["result"]; loading: boolean; error: boolean; noWeight: boolean }) {
  const t = useTranslations("nutrition.targets");
  if (loading) return <p className="t-body mt-4 text-xs text-muted">{t("loading")}</p>;
  if (error || !result) return <p data-testid="targets-error" className="t-body mt-4 text-xs text-bad">{t("error")}</p>;
  if (result.kind !== "incomplete") return null;
  const kind = missingKind(result.field);
  if (kind === "equation_sex") return <EquationSexPrompt />;
  if (kind === "weight") {
    // Falta el peso: se pide aquí mismo (nada de un peso inventado) y queda el
    // acceso a la medición completa. Con `no_weight_targets` no se pide peso.
    if (noWeight) return null;
    return (
      <div data-testid="targets-missing" data-field={result.field}>
        <WeightPrompt what={t("weightFor")} />
        <Link href="/biometrics/new" className="t-body mt-2 inline-block text-xs text-muted underline">
          {t("fullMeasurement")}
        </Link>
      </div>
    );
  }
  return (
    <section data-testid="targets-missing" data-field={result.field} className="glass neon-edge mt-4 p-4">
      <p className="t-body text-sm text-ink">{t("missingProfile")}</p>
      <Link href="/onboarding" className="btn btn-tonal btn-sm mt-3">
        {t("missingProfileCta")}
      </Link>
    </section>
  );
}

export default function NutritionPage() {
  const t = useTranslations("nutrition");
  const format = useFormatter();
  const goalState = useNutritionGoal();
  const { safety, targetsQuery, result } = goalState;
  const { data: weighIn } = useWeighIn();
  const [items, setItems] = useState<Item[]>([]);
  const [water, setWater] = useState(0);
  const [confirmItem, setConfirmItem] = useState<string | null>(null);
  const [openMeals, setOpenMeals] = useState<string[]>([]);

  useEffect(() => {
    // Lectura síncrona de localStorage tras montar: hace falta un efecto
    // porque en el servidor no existe localStorage (evita el desajuste de
    // hidratación).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(loadToday());
    setWater(loadWater());
  }, []);

  // Copia de seguridad en el servidor (lib/user-state): trae el diario y el agua
  // de otros dispositivos (si es más nuevo) y refresca la vista. No bloquea nada
  // si el backend no responde. El objetivo (perder/mantener/ganar) ya vive en el
  // perfil del servidor, así que no se hidrata aparte.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await hydrateRecentNutritionDays();
      if (!alive) return;
      setItems(loadToday());
      setWater(loadWater());
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Recarga al volver a la app: si pasó la medianoche, el diario y el agua
  // deben ser los del día NUEVO (evita escribir el agua de ayer en hoy).
  useEffect(() => {
    const reload = () => {
      setItems(loadToday());
      setWater(loadWater());
      setConfirmItem(null);
    };
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  function changeWater(delta: number) {
    setWater((w) => {
      const n = Math.max(0, Math.min(30, w + delta));
      saveWater(n);
      return n;
    });
  }

  function onDeleteItem(id: string) {
    if (confirmItem !== id) {
      setConfirmItem(id);
      // si no se confirma, la confirmación se desarma sola
      setTimeout(() => setConfirmItem((cur) => (cur === id ? null : cur)), 3500);
      return;
    }
    setConfirmItem(null);
    removeItem(id);
    setItems(loadToday());
  }

  // Los objetivos los calcula el servidor con el motor del coach (spec §8.1): aquí no hay cuentas.
  const { tg, blocked, deficitBlocked, limits } = goalState;
  const macros = tg && !blocked ? tg.macros : null;
  const kcalTarget = tg && !blocked ? tg.kcal : null;
  const rules = tg?.rules ?? {};

  const sum = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const remaining = kcalTarget != null ? kcalTarget - sum.kcal : null;
  const kcalPct = kcalTarget ? Math.min(100, (sum.kcal / kcalTarget) * 100) : 0;
  // La primera regla de las kcal es la de la ecuación de RMR usada (`energy_athletes`).
  const kcalRule = rules.kcal?.[0];

  const weighCurrent = weighIn?.current_kg ?? null;
  const showWeigh = !!weighIn && !weighIn.blocked;
  const weighLine = (() => {
    if (!showWeigh) return t("weigh.goalsLine");
    if (!weighIn || weighIn.goal_weight_kg == null) return t("weigh.setup");
    if (weighIn.deficit_blocked || weighCurrent == null) {
      return weighIn.days_left == null ? t("weigh.goalOnly", { target: weighIn.goal_weight_kg }) : t("weigh.countdown", { days: Math.max(0, weighIn.days_left) });
    }
    return t("weigh.goalLine", { target: format.number(weighIn.goal_weight_kg), current: format.number(weighCurrent) });
  })();
  const staleDays = tg?.weight?.stale_days ?? 0;
  const showStale = !!tg && !blocked && !!weighIn && !weighIn.blocked && staleDays >= 14;

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2">
        <span className="text-neon"><NutritionIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>

      {/* Progreso de hoy: kcal y macros en una tarjeta */}
      <section className="glass neon-edge mt-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="t-eyebrow text-muted">{t("today")}</p>
          {kcalRule && kcalTarget != null && (
            <span data-testid="kcal-rule"><EvidenceChip ruleKey={kcalRule.key} grade={kcalRule.grade} /></span>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <p className="stat text-3xl text-ink" data-testid="kcal-today">
            {sum.kcal}
            <span className="text-base text-muted"> {kcalTarget != null ? t("ofTarget", { target: kcalTarget }) : t("kcalUnit")}</span>
          </p>
          {remaining != null && (
            <p className="whitespace-nowrap text-right">
              <span className={`stat text-xl ${remaining < 0 ? "text-bad" : "neon-text"}`}>{remaining}</span>{" "}
              <span className="t-label text-muted">{t("remaining")}</span>
            </p>
          )}
        </div>
        {kcalTarget != null && (
          <div className="mt-1.5 h-2 rounded-full bg-[rgba(150,190,255,0.12)]">
            <div className="h-2 rounded-full" style={{ width: `${kcalPct}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }} />
          </div>
        )}
        {result?.kind === "incomplete" && (
          <p data-testid="no-targets-note" className="t-body mt-2 text-xs text-muted">{t("noTargetsNote")}</p>
        )}
        <div className="mt-2.5 grid grid-cols-3 gap-3" data-testid="macros">
          <Bar label={t("protein")} val={sum.p} target={macros ? roundGrams(macros.protein_g) : null} color="#45e9ff" />
          <Bar label={t("carbs")} val={sum.c} target={macros ? roundGrams(macros.carbs_g) : null} color="#7b5cff" />
          <Bar label={t("fat")} val={sum.f} target={macros ? roundGrams(macros.fat_g) : null} color="#ffd25a" />
        </div>
        {macros && <p className="t-body mt-1.5 text-[11px] text-muted">{t("fibreLine", { grams: roundGrams(macros.fibre_g) })}</p>}
      </section>

      <TargetsStatus result={result} loading={targetsQuery.isLoading} error={targetsQuery.isError} noWeight={!!safety?.flags.no_weight_targets} />

      {/* Solo cuando aplica: lo que limita lo que se calcula */}
      {safety && (blocked || limits.length > 0) && (
        <div data-testid={deficitBlocked ? "deficit-blocked" : "targets-limits"}>
          <SafetyPanel data={{ ...safety, reasons: limits, parq_pending: false }} />
        </div>
      )}
      {showStale && (
        <p data-testid="stale-weight" className="t-body mt-2 text-xs text-muted">
          {t("staleWeight", { days: staleDays })}{" "}
          <Link href="/biometrics/new" className="neon-text underline">{t("staleWeightCta")}</Link>
        </p>
      )}

      {/* Comidas: filas compactas con + */}
      <div className="glass mt-2 divide-y divide-[rgba(150,190,255,0.1)] px-3">
        {MEALS.map((meal) => {
          const its = items.filter((i) => i.meal === meal);
          const k = its.reduce((a, i) => a + i.kcal, 0);
          const open = openMeals.includes(meal);
          return (
            <div key={meal} data-testid={`meal-${meal}`}>
              <div className="flex min-h-9 items-center justify-between gap-2 py-1">
                <button
                  type="button"
                  disabled={its.length === 0}
                  aria-expanded={its.length > 0 ? open : undefined}
                  onClick={() => setOpenMeals((l) => (l.includes(meal) ? l.filter((m) => m !== meal) : [...l, meal]))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                >
                  <span className="t-title text-ink">{t(`meals.${meal}`)}</span>
                  {its.length > 0 && <span className="t-body text-[11px] text-muted">{open ? "▴" : `▾ ${its.length}`}</span>}
                </button>
                <span className="t-label shrink-0 text-muted">{k} kcal</span>
                <Link href={`/nutrition/add?meal=${encodeURIComponent(meal)}`} aria-label={t("addTo", { meal: t(`meals.${meal}`) })}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full btn-neon" style={{ borderRadius: "9999px" }}>+</Link>
              </div>
              {open && its.length > 0 && (
                <ul className="flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.1)] py-2.5">
                  {its.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="t-body min-w-0 flex-1 text-muted">
                        {i.name}{i.grams ? ` · ${i.grams} g` : ""}
                        <span data-testid="diary-source" data-source={itemSource(i)} className="block text-[10px] text-muted/80">
                          {t(`source.${itemSource(i)}`)}
                        </span>
                      </span>
                      <span className="shrink-0 text-ink">{i.kcal} kcal</span>
                      {itemSource(i) === "menu" ? (
                        // La entrada del menú va ligada a la marca de Hoy: se quita desmarcando la comida allí
                        <Link href="/today" aria-label={t("menuUnmark", { name: i.name })}
                          className="t-label shrink-0 px-1 text-[11px] text-neon">{t("menuUnmarkShort")}</Link>
                      ) : confirmItem === i.id ? (
                        <button onClick={() => onDeleteItem(i.id)}
                          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#03101c]"
                          style={{ background: "#ff5d80" }}>
                          {t("confirmDelete")}
                        </button>
                      ) : (
                        <button onClick={() => onDeleteItem(i.id)} aria-label={t("delete", { name: i.name })}
                          className="t-label shrink-0 px-1 text-muted hover:text-bad">✕</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Agua del día: una fila */}
      <div className="glass mt-2 flex items-center justify-between gap-2 px-4 py-1">
        <div className="min-w-0">
          <p className="t-label text-ink">{t("water.title")}</p>
          <p className="t-body text-[11px] text-muted">{t("water.line", { liters: format.number(water * 0.25, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => changeWater(-1)} aria-label={t("water.remove")} className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
          <span className="stat w-12 text-center text-xl text-ink">{water}<span className="text-xs text-muted">/8</span></span>
          <button type="button" onClick={() => changeWater(1)} aria-label={t("water.add")} className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
        </div>
      </div>

      {/* Dos accesos: menú de varios días y compra · objetivo y pesaje */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link href="/nutrition/menu" data-testid="menu-card" className="glass flex items-center gap-2 p-2.5">
          <span className="text-neon shrink-0"><NutritionIcon className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="t-label block leading-tight text-ink">{t("menuCard.title")}</span>
            <span className="t-body block truncate text-[11px] text-muted">{t("menuCard.body")}</span>
          </span>
        </Link>
        <Link href="/nutrition/weigh-in" data-testid="weigh-card" className="glass flex items-center gap-2 p-2.5">
          <span className="text-neon shrink-0"><ScaleIcon className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="t-label block leading-tight text-ink">{t("weigh.title")}</span>
            <span className="t-body block truncate text-[11px] text-muted">{weighLine}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
