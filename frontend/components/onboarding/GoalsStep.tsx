"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAddInjury, useDeleteInjury, useInjuries, useUpdateProfile } from "@/lib/hooks";
import { COACH_GOALS } from "@/lib/goal";
import { splitFreeText } from "@/lib/onboarding";
import type { Profile } from "@/lib/schemas";
import { Choice, Hint, Label, StepFooter, StepTitle, type StepProps } from "./ui";

const EXPERIENCE = ["novice", "intermediate", "advanced"] as const;
const ACTIVITY = ["desk", "desk_training", "active"] as const;
const DISCIPLINES = ["Boxeo", "Kickboxing", "Muay Thai", "BJJ", "Lucha", "Taekwondo", "Karate", "MMA"];
const FREQS = [2, 3, 4, 5, 6];
const STANCES = ["ORTHODOX", "SOUTHPAW", "SWITCH"] as const;
const UNITS = ["METRIC", "IMPERIAL"] as const;

function Injuries() {
  const t = useTranslations("onboarding.goals");
  const { data: injuries = [] } = useInjuries();
  const add = useAddInjury();
  const remove = useDeleteInjury();
  const [area, setArea] = useState("");
  const [since, setSince] = useState("");
  const [professional, setProfessional] = useState("");
  const [exercises, setExercises] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!area.trim()) return setError(t("injuryAreaMissing"));
    try {
      await add.mutateAsync({
        area: area.trim(),
        since: since || null,
        professional: professional.trim() || null,
        exercises: splitFreeText(exercises),
        origin: "onboarding",
      });
      setArea("");
      setSince("");
      setProfessional("");
      setExercises("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="injuries">
      <Label>{t("injuries")}</Label>
      {injuries
        .filter((i) => i.status === "active")
        .map((i) => (
          <div key={i.id} className="glass flex items-center justify-between px-3 py-2">
            <span className="t-body text-sm text-ink">
              {i.area}
              {i.exercises.length ? ` · ${i.exercises.join(", ")}` : ""}
            </span>
            <button type="button" onClick={() => remove.mutate(i.id)} className="t-label text-muted">
              {t("injuryRemove")}
            </button>
          </div>
        ))}
      <input value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("injuryArea")} aria-label={t("injuryArea")} className="field px-4 py-2.5 text-sm" />
      <label className="flex items-center gap-2">
        <span className="t-label text-muted">{t("injurySince")}</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="field flex-1 px-3 py-2 text-sm" />
      </label>
      <input value={professional} onChange={(e) => setProfessional(e.target.value)} placeholder={t("injuryProfessional")} aria-label={t("injuryProfessional")} className="field px-4 py-2.5 text-sm" />
      <input value={exercises} onChange={(e) => setExercises(e.target.value)} placeholder={t("injuryExercises")} aria-label={t("injuryExercises")} className="field px-4 py-2.5 text-sm" />
      {error && <p className="text-xs text-bad">{error}</p>}
      <button type="button" onClick={submit} disabled={add.isPending} className="badge justify-center py-2">
        {t("injuryAdd")}
      </button>
    </div>
  );
}

/** Paso 8 (setup/SKILL.md): objetivo, experiencia (convención de los 12 meses), nivel de
 * actividad, lesiones y lo propio de FightLab (disciplinas, frecuencia, guardia, unidades). */
export function GoalsStep({ profile, onNext }: StepProps & { profile: Profile }) {
  const t = useTranslations("onboarding.goals");
  const tc = useTranslations("onboarding");
  const update = useUpdateProfile();
  const [goal, setGoal] = useState(profile.goal ?? "");
  const [experience, setExperience] = useState(profile.experience ?? "");
  const [activity, setActivity] = useState(profile.activity_level ?? "");
  const [disciplines, setDisciplines] = useState<string[]>(profile.disciplines);
  const [freq, setFreq] = useState<number | null>(profile.training_frequency);
  const [stance, setStance] = useState(profile.dominant_stance ?? "");
  const [units, setUnits] = useState(profile.preferred_units);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({
        goal: goal || null,
        experience: experience || null,
        activity_level: activity || null,
        disciplines,
        training_frequency: freq,
        dominant_stance: stance || null,
        preferred_units: units,
      });
      onNext();
    } catch {
      setError(tc("saveError"));
    }
  }

  const options = (values: readonly string[], value: string, set: (v: string) => void, ns: string, col = false) => (
    <div className={col ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"}>
      {values.map((v) => (
        <Choice key={v} selected={value === v} onClick={() => set(value === v ? "" : v)} className={col ? "text-left" : ""} testId={`${ns}-${v}`}>
          {t(`${ns}.${v}`)}
        </Choice>
      ))}
    </div>
  );

  return (
    <>
      <StepTitle k="goals.title" />
      <div className="mt-5 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label>{t("goal")}</Label>
          {options(COACH_GOALS, goal, setGoal, "goals")}
          {goal === "recomposition" && <Hint>{t("recompositionHint")}</Hint>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("experience")}</Label>
          {options(EXPERIENCE, experience, setExperience, "experiences", true)}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("activity")}</Label>
          {options(ACTIVITY, activity, setActivity, "activities", true)}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("disciplines")} <span className="text-[10px]">{t("disciplinesHint")}</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {DISCIPLINES.map((d) => (
              <Choice
                key={d}
                selected={disciplines.includes(d)}
                onClick={() => setDisciplines((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))}
              >
                {t(`disciplineNames.${d}`)}
              </Choice>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("frequency")}</Label>
          <div className="flex gap-2">
            {FREQS.map((n) => (
              <Choice key={n} selected={freq === n} onClick={() => setFreq(freq === n ? null : n)} className="flex-1">
                {n === 6 ? t("daysPlus", { n }) : t("days", { n })}
              </Choice>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("stance")}</Label>
          <div className="flex gap-2">
            {STANCES.map((s) => (
              <Choice key={s} selected={stance === s} onClick={() => setStance(stance === s ? "" : s)} className="flex-1">
                {t(`stances.${s}`)}
              </Choice>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>{t("units")}</Label>
          <select value={units} onChange={(e) => setUnits(e.target.value)} className="field px-3 py-3 text-sm">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`unitsOptions.${u}`)}
              </option>
            ))}
          </select>
        </label>
        <Injuries />
      </div>
      <StepFooter error={error} onNext={save} onSkip={onNext} pending={update.isPending} />
    </>
  );
}
