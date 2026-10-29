"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useProfile, useSafety, useTargets, useUpdateProfile, useWeighIn } from "@/lib/hooks";
import { coachToLegacyGoal, legacyToCoachGoal } from "@/lib/goal";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { EquationSexPrompt } from "@/components/nutrition/EquationSexPrompt";
import { TargetsDetails } from "@/components/nutrition/TargetsDetails";
import {
  MEALS,
  loadToday,
  removeItem,
  loadWater,
  saveWater,
  type Goal,
  type Item,
} from "@/lib/nutrition";
import type { CoachReason, RuleRef, SafetyReason, Targets } from "@/lib/schemas";
import { NutritionIcon, ScaleIcon, ChevronRight } from "@/components/icons";

// Motivos que limitan lo que se calcula (déficit bloqueado, suelo calórico...). El resto de los
// avisos de seguridad no cambian la nutrición y no se repiten aquí.
const LIMIT_CODES = new Set([
  "under_18", "eating_disorder_screen", "glp1_prescriber", "glp1_low_intake", "pregnancy_no_deficit",
  "pregnancy_glp1", "menstrual_irregular", "menstrual_absent", "older_no_deficit", "floor_raised",
  "carbs_zero",
]);
const isLimit = (r: CoachReason): r is CoachReason & { severity: SafetyReason["severity"] } =>
  r.severity !== "info" && LIMIT_CODES.has(r.code);

// Una falta de dato del motor (409) → qué decirle al usuario y a dónde llevarlo.
function missingKind(field: string): "equation_sex" | "weight" | "profile" {
  if (field === "equation_sex") return "equation_sex";
  if (field === "weight_kg") return "weight";
  return "profile";
}

function Bar({ label, val, target, color, rule }: { label: string; val: number; target: number | null; color: string; rule?: RuleRef }) {
  const pct = target && target > 0 ? Math.min(100, (val / target) * 100) : 0;
  const t = useTranslations("nutrition");
  return (
    <div>
      <div className="flex justify-between">
        <span className="t-label text-muted">{label}</span>
        <span className="t-body text-xs text-ink">{target == null ? t("gramsOnly", { value: val }) : t("gramsOf", { value: val, target })}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[rgba(150,190,255,0.12)]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      {rule && (
        <div className="mt-1">
          <EvidenceChip ruleKey={rule.key} grade={rule.grade} />
        </div>
      )}
    </div>
  );
}

function TargetsStatus({ result, loading, error }: { result: ReturnType<typeof useTargets>["data"]; loading: boolean; error: boolean }) {
  const t = useTranslations("nutrition.targets");
  if (loading) return <p className="t-body mt-4 text-xs text-muted">{t("loading")}</p>;
  if (error || !result) return <p data-testid="targets-error" className="t-body mt-4 text-xs text-bad">{t("error")}</p>;
  if (result.kind !== "incomplete") return null;
  const kind = missingKind(result.field);
  if (kind === "equation_sex") return <EquationSexPrompt />;
  return (
    <section data-testid="targets-missing" data-field={result.field} className="glass neon-edge mt-4 p-4">
      <p className="t-body text-sm text-ink">{kind === "weight" ? t("missingWeight") : t("missingProfile")}</p>
      <Link href={kind === "weight" ? "/biometrics/new" : "/onboarding"} className="btn btn-tonal btn-sm mt-3">
        {kind === "weight" ? t("missingWeightCta") : t("missingProfileCta")}
      </Link>
    </section>
  );
}

export default function NutritionPage() {
  const t = useTranslations("nutrition");
  const format = useFormatter();
  const { data: profile } = useProfile();
  const { data: safety } = useSafety();
  const targetsQuery = useTargets();
  const { data: weighIn } = useWeighIn();
  const updateProfile = useUpdateProfile();
  const [items, setItems] = useState<Item[]>([]);
  const [water, setWater] = useState(0);
  const [confirmItem, setConfirmItem] = useState<string | null>(null);

  useEffect(() => {
    setItems(loadToday());
    setWater(loadWater());
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
  const result = targetsQuery.data;
  const tg: Targets | null = result?.kind === "ok" ? result.data : null;
  const blocked = !!tg?.blocked;
  const macros = tg && !blocked ? tg.macros : null;
  const kcalTarget = tg && !blocked ? tg.kcal : null;
  const rules = tg?.rules ?? {};

  // "Perder" y "Ganar" los gobiernan los flags del servidor (spec §8.3).
  const chosen = coachToLegacyGoal(profile?.goal);
  const deficitBlocked = tg ? tg.deficit_blocked : !!safety && (safety.flags.no_deficit || safety.flags.hold_deficit || safety.flags.prescriber_owns_weight);
  const surplusBlocked = !!safety && (safety.flags.no_weight_targets || safety.flags.prescriber_owns_weight);
  const goal: Goal = (deficitBlocked && chosen === "perder") || (surplusBlocked && chosen === "ganar") ? "mantener" : chosen;
  const limits = tg ? tg.reasons.filter(isLimit) : [];

  const sum = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const remaining = kcalTarget != null ? kcalTarget - sum.kcal : null;
  const kcalPct = kcalTarget ? Math.min(100, (sum.kcal / kcalTarget) * 100) : 0;
  // La primera regla de las kcal es la de la ecuación de RMR usada (`energy_athletes`).
  const kcalRule = rules.kcal?.[0];

  function changeGoal(g: Goal) {
    if ((g === "perder" && deficitBlocked) || (g === "ganar" && surplusBlocked)) return;
    updateProfile.mutate({ goal: legacyToCoachGoal(g) });
  }

  const weighCurrent = weighIn?.current_kg ?? null;
  const showWeigh = !!weighIn && !weighIn.blocked;
  const weighLine = (() => {
    if (!weighIn || weighIn.goal_weight_kg == null) return t("weigh.setup");
    if (weighIn.deficit_blocked || weighCurrent == null) {
      return weighIn.days_left == null ? t("weigh.goalOnly", { target: weighIn.goal_weight_kg }) : t("weigh.countdown", { days: Math.max(0, weighIn.days_left) });
    }
    return t("weigh.goalLine", { target: format.number(weighIn.goal_weight_kg), current: format.number(weighCurrent) });
  })();
  const staleDays = tg?.weight?.stale_days ?? 0;
  const showStale = !!tg && !blocked && !!weighIn && !weighIn.blocked && staleDays >= 14;

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><NutritionIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>

      {/* Progreso de hoy */}
      <section className="glass neon-edge mt-4 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="t-eyebrow text-muted">{t("today")}</p>
            <p className="stat mt-1 text-4xl text-ink" data-testid="kcal-today">
              {sum.kcal}
              <span className="text-base text-muted"> {kcalTarget != null ? t("ofTarget", { target: kcalTarget }) : t("kcalUnit")}</span>
            </p>
            {kcalRule && kcalTarget != null && (
              <div className="mt-1.5" data-testid="kcal-rule">
                <EvidenceChip ruleKey={kcalRule.key} grade={kcalRule.grade} />
              </div>
            )}
          </div>
          {remaining != null && (
            <div className="text-right">
              <p className={`stat text-2xl ${remaining < 0 ? "text-bad" : "neon-text"}`}>{remaining}</p>
              <p className="t-label text-muted">{t("remaining")}</p>
            </div>
          )}
        </div>
        {kcalTarget != null && (
          <div className="mt-3 h-2.5 rounded-full bg-[rgba(150,190,255,0.12)]">
            <div className="h-2.5 rounded-full" style={{ width: `${kcalPct}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }} />
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3" data-testid="macros">
          <Bar label={t("protein")} val={sum.p} target={macros ? Math.round(macros.protein_g) : null} color="#45e9ff" rule={rules.protein_g?.[0]} />
          <Bar label={t("carbs")} val={sum.c} target={macros ? Math.round(macros.carbs_g) : null} color="#7b5cff" />
          <Bar label={t("fat")} val={sum.f} target={macros ? Math.round(macros.fat_g) : null} color="#ffd25a" rule={rules.fat_g?.[0]} />
        </div>
        {macros && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="t-body text-[11px] text-muted">{t("fibreLine", { grams: Math.round(macros.fibre_g) })}</span>
            {rules.fibre_g?.[0] && <EvidenceChip ruleKey={rules.fibre_g[0].key} grade={rules.fibre_g[0].grade} />}
          </div>
        )}
      </section>

      <TargetsStatus result={result} loading={targetsQuery.isLoading} error={targetsQuery.isError} />

      {/* Objetivo */}
      {!blocked && (
        <>
          <div className="glass mt-4 grid grid-cols-3 gap-1 rounded-2xl p-1">
            {(["perder", "mantener", "ganar"] as Goal[]).map((g) => {
              const off = (g === "perder" && deficitBlocked) || (g === "ganar" && surplusBlocked);
              return (
                <button key={g} onClick={() => changeGoal(g)} disabled={off} data-testid={`goal-${g}`}
                  className="rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
                  style={goal === g ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
                  {t(`goal.${g}`)}
                </button>
              );
            })}
          </div>
          <p className="t-body mt-2 text-xs text-muted">{t("goalNote")}</p>
        </>
      )}
      {safety && (blocked || limits.length > 0) && (
        <div data-testid={deficitBlocked ? "deficit-blocked" : "targets-limits"}>
          <SafetyPanel data={{ ...safety, reasons: limits, parq_pending: false }} />
        </div>
      )}
      {tg && !blocked && <TargetsDetails targets={tg} />}
      {showStale && (
        <p data-testid="stale-weight" className="t-body mt-3 text-xs text-muted">
          {t("staleWeight", { days: staleDays })}{" "}
          <Link href="/biometrics/new" className="neon-text underline">{t("staleWeightCta")}</Link>
        </p>
      )}

      {/* Agua del día */}
      <div className="glass mt-4 flex items-center justify-between p-4">
        <div>
          <p className="t-label text-ink">{t("water.title")}</p>
          <p className="t-body text-[11px] text-muted">{t("water.line", { liters: format.number(water * 0.25, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => changeWater(-1)} aria-label={t("water.remove")} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
          <span className="stat w-14 text-center text-xl text-ink">{water}<span className="text-xs text-muted">/8</span></span>
          <button onClick={() => changeWater(1)} aria-label={t("water.add")} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
        </div>
      </div>

      {/* Comidas */}
      <div className="mt-5 flex flex-col gap-3">
        {MEALS.map((meal) => {
          const its = items.filter((i) => i.meal === meal);
          const k = its.reduce((a, i) => a + i.kcal, 0);
          return (
            <div key={meal} className="glass p-4">
              <div className="flex items-center justify-between">
                <p className="t-title text-ink">{t(`meals.${meal}`)}</p>
                <div className="flex items-center gap-3">
                  <span className="t-label text-muted">{k} kcal</span>
                  <Link href={`/nutrition/add?meal=${encodeURIComponent(meal)}`} aria-label={t("addTo", { meal: t(`meals.${meal}`) })}
                    className="flex h-8 w-8 items-center justify-center rounded-full btn-neon" style={{ borderRadius: "9999px" }}>+</Link>
                </div>
              </div>
              {its.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.1)] pt-3">
                  {its.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="t-body min-w-0 flex-1 text-muted">{i.name}{i.grams ? ` · ${i.grams} g` : ""}</span>
                      <span className="shrink-0 text-ink">{i.kcal} kcal</span>
                      {confirmItem === i.id ? (
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

      {/* Pesaje: el servidor no devuelve nada de esto con `no_weight_targets` (spec §8.3) */}
      {showWeigh && (
        <Link href="/nutrition/weigh-in" data-testid="weigh-card" className="glass rise mt-5 flex items-center gap-3 p-4">
          <span className="text-neon"><ScaleIcon className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="t-label text-ink">{t("weigh.title")}</p>
            <p className="t-body text-xs text-muted">{weighLine}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted" />
        </Link>
      )}
    </div>
  );
}
