"use client";

import { useTranslations } from "next-intl";
import { coachToLegacyGoal, legacyToCoachGoal } from "@/lib/goal";
import { useProfile, useSafety, useTargets, useUpdateProfile } from "@/lib/hooks";
import { TargetsDetails } from "@/components/nutrition/TargetsDetails";
import type { Goal } from "@/lib/nutrition";
import type { CoachReason, SafetyReason, Targets } from "@/lib/schemas";

// Motivos que limitan lo que se calcula (déficit bloqueado, suelo calórico...). El resto de los
// avisos de seguridad no cambian la nutrición y no se repiten aquí.
const LIMIT_CODES = new Set([
  "under_18", "eating_disorder_screen", "glp1_prescriber", "glp1_low_intake", "pregnancy_no_deficit",
  "pregnancy_glp1", "menstrual_irregular", "menstrual_absent", "older_no_deficit", "floor_raised",
  "carbs_zero",
]);
const isLimit = (r: CoachReason): r is CoachReason & { severity: SafetyReason["severity"] } =>
  r.severity !== "info" && LIMIT_CODES.has(r.code);

/** El objetivo elegido y lo que lo limita, de los objetivos y los flags del servidor (spec §8.3). */
export function useNutritionGoal() {
  const { data: profile } = useProfile();
  const { data: safety } = useSafety();
  const targetsQuery = useTargets();
  const result = targetsQuery.data;
  const tg: Targets | null = result?.kind === "ok" ? result.data : null;
  const blocked = !!tg?.blocked;
  const chosen = coachToLegacyGoal(profile?.goal);
  const deficitBlocked = tg ? tg.deficit_blocked : !!safety && (safety.flags.no_deficit || safety.flags.hold_deficit || safety.flags.prescriber_owns_weight);
  const surplusBlocked = !!safety && (safety.flags.no_weight_targets || safety.flags.prescriber_owns_weight);
  const goal: Goal = (deficitBlocked && chosen === "perder") || (surplusBlocked && chosen === "ganar") ? "mantener" : chosen;
  // Sin objetivos (falta un dato), los motivos que bloquean el déficit salen igual de los flags.
  const limits: SafetyReason[] = tg ? tg.reasons.filter(isLimit) : (safety?.reasons ?? []).filter((r) => LIMIT_CODES.has(r.code));
  return { safety, targetsQuery, result, tg, blocked, goal, deficitBlocked, surplusBlocked, limits };
}

/** El bloque «Objetivo» (perder / mantener / ganar y cómo se calculan los números). */
export function GoalBlock() {
  const t = useTranslations("nutrition");
  const updateProfile = useUpdateProfile();
  const { tg, blocked, goal, deficitBlocked, surplusBlocked } = useNutritionGoal();

  function changeGoal(g: Goal) {
    if ((g === "perder" && deficitBlocked) || (g === "ganar" && surplusBlocked)) return;
    updateProfile.mutate({ goal: legacyToCoachGoal(g) });
  }

  if (blocked) return null;
  return (
    <div data-testid="goal-block">
      <p className="t-eyebrow text-muted">{t("goalTitle")}</p>
      <div className="glass mt-2 grid grid-cols-3 gap-1 rounded-2xl p-1">
        {(["perder", "mantener", "ganar"] as Goal[]).map((g) => {
          const off = (g === "perder" && deficitBlocked) || (g === "ganar" && surplusBlocked);
          return (
            <button key={g} type="button" onClick={() => changeGoal(g)} disabled={off} data-testid={`goal-${g}`} aria-pressed={goal === g}
              className="rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
              style={goal === g ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
              {t(`goal.${g}`)}
            </button>
          );
        })}
      </div>
      {tg && <p className="t-body mt-2 text-xs text-muted">{t("goalNote")}</p>}
      {tg && <TargetsDetails targets={tg} />}
    </div>
  );
}
