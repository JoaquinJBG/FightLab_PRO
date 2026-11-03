"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckinResultView } from "@/components/checkin/CheckinResultView";
import { SignsSection, WeeklySection, WellnessSection } from "@/components/checkin/Sections";
import { UrgentScreen } from "@/components/checkin/UrgentScreen";
import { ChevronDown } from "@/components/icons";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { buildPayload, EMPTY_FORM, recordedItems, type CheckinForm } from "@/lib/checkin";
import { CheckinError, useCheckin, useSaveCheckin } from "@/lib/hooks";
import type { CheckinResult } from "@/lib/schemas";

type Done = { result: CheckinResult; recorded: string[]; gaveWeight: boolean };

function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  step = "0.1",
  hint,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="glass flex flex-col gap-1 p-3.5">
      <span className="flex items-center justify-between gap-3">
        <span className="t-label text-ink">{label}</span>
        <span className="flex items-center gap-2">
          <input
            data-testid={id}
            type="number"
            step={step}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            className="field w-24 px-3 py-2 text-right text-sm"
          />
          <span className="t-label w-8 text-muted">{unit}</span>
        </span>
      </span>
      {hint && <span className="t-body text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export default function CheckinPage() {
  const t = useTranslations("checkin");
  const { data: state, isLoading } = useCheckin();
  const save = useSaveCheckin();
  const [form, setForm] = useState<CheckinForm>(EMPTY_FORM);
  const [done, setDone] = useState<Done | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const patch = (change: Partial<CheckinForm>) => setForm((f) => ({ ...f, ...change }));

  if (isLoading || !state) {
    return <div className="glass mt-6 h-48 animate-pulse rounded-3xl" aria-label={t("loading")} />;
  }

  if (done) {
    if (done.result.alerts.some((a) => a.urgent)) return <UrgentScreen result={done.result} />;
    return (
      <CheckinResultView
        result={done.result}
        recorded={done.recorded}
        gaveWeight={done.gaveWeight}
        onAgain={() => {
          setForm(EMPTY_FORM);
          setDone(null);
        }}
      />
    );
  }

  const blocked = state.weight_blocked;
  const weekly = {
    menstrual: state.weekly_questions.some((q) => q.code === "menstrual"),
    bp: state.weekly_questions.some((q) => q.code === "bp"),
  };
  const injuryIncomplete = form.signs.injury && !form.injury.area.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload(form, { blocked, weekly });
    try {
      const result = await save.mutateAsync(payload);
      setDone({ result, recorded: recordedItems(payload), gaveWeight: "weight_kg" in payload });
    } catch {
      /* el error se pinta abajo */
    }
  }

  const error = save.error instanceof CheckinError ? save.error : null;
  const errorText = !save.isError
    ? null
    : error?.code === "weight_targets_blocked"
      ? t("errors.blocked")
      : error?.status === 400
        ? t("errors.invalid", { fields: Object.keys(error.errors).join(", ") })
        : t("errors.generic");

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">
        {t.rich("title", { hl: (chunks) => <span className="neon-text">{chunks}</span> })}
      </h1>
      <p className="t-body mt-1 text-muted">{t("subtitle")}</p>
      {state.checkin && (
        <p data-testid="checkin-already" className="t-body mt-3 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">
          {t("alreadyDone")}
        </p>
      )}

      <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
        <WellnessSection form={form} patch={patch} ruleKey={state.readiness.rule_key} grade={state.readiness.grade} />

        <section className="flex flex-col gap-2">
          <p className="t-eyebrow text-muted">{t("data.title")}</p>
          {blocked ? (
            <p data-testid="checkin-blocked" className="t-body glass p-3.5 text-xs text-muted">{t("data.blocked")}</p>
          ) : (
            <>
              <NumberField id="weight" label={t("data.weight")} unit="kg" value={form.weight} onChange={(v) => patch({ weight: v })} hint={t("data.weightHint")} />
              <NumberField id="waist" label={t("data.waist")} unit="cm" value={form.waist} onChange={(v) => patch({ waist: v })} hint={t("data.waistHint")} />
              <NumberField id="intake" label={t("data.intake")} unit="kcal" step="10" value={form.intake} onChange={(v) => patch({ intake: v })} />
            </>
          )}
          <NumberField id="sleep-hours" label={t("data.sleepHours")} unit="h" value={form.sleepHours} onChange={(v) => patch({ sleepHours: v })} />
          <p className="t-body text-[11px] text-muted">{t("data.missedDays")}</p>

          <button type="button" onClick={() => setShowOptional((v) => !v)} className="flex items-center justify-between rounded-xl px-1 py-1 text-left">
            <span className="t-eyebrow text-muted">{t("data.optionalToggle")}</span>
            <ChevronDown className={`h-4 w-4 text-muted transition-transform ${showOptional ? "rotate-180" : ""}`} />
          </button>
          {showOptional && (
            <>
              <NumberField id="rhr" label={t("data.rhr")} unit="bpm" step="1" value={form.rhr} onChange={(v) => patch({ rhr: v })} />
              <NumberField id="hrv" label={t("data.hrv")} unit="ms" step="1" value={form.hrv} onChange={(v) => patch({ hrv: v })} />
              <p className="t-body text-[11px] text-muted">
                {t("data.hrvNote")} <EvidenceChip ruleKey={state.readiness.hrv_rule_key} grade={state.readiness.hrv_grade} />
              </p>
            </>
          )}
        </section>

        <SignsSection form={form} patch={patch} />
        <WeeklySection form={form} patch={patch} questions={state.weekly_questions} />

        <label className="glass flex flex-col gap-2 p-4">
          <span className="t-eyebrow text-muted">{t("notes.label")}</span>
          <textarea
            data-testid="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder={t("notes.placeholder")}
            className="field px-3 py-2 text-sm"
          />
        </label>

        {errorText && <p data-testid="checkin-error" className="text-xs text-bad">{errorText}</p>}
        <button type="submit" disabled={save.isPending || injuryIncomplete} className="btn btn-primary disabled:opacity-60">
          {save.isPending ? t("saving") : t("submit")}
        </button>
      </form>
    </div>
  );
}
