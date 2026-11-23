"use client";

import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { SIGN_KEYS, type CheckinForm, type ScoreKey } from "@/lib/checkin";
import { SCORE_KEYS, SORENESS_ZONES } from "@/lib/schemas";

type Patch = (change: Partial<CheckinForm>) => void;
type Props = { form: CheckinForm; patch: Patch };

const chip = (on: boolean) =>
  on
    ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c", borderColor: "transparent" }
    : { background: "transparent", color: "var(--color-muted)" };

/** Bienestar (plan v1 §8): cinco puntuaciones de 1 a 5 donde 5 es lo mejor, y las zonas con agujetas. */
export function WellnessSection({
  form,
  patch,
  ruleKey,
  grade,
}: Props & { ruleKey?: string | null; grade?: string | null }) {
  const t = useTranslations("checkin.wellness");
  return (
    <section data-testid="wellness-section" className="glass p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="t-eyebrow text-muted">{t("title")}</p>
        {ruleKey && <EvidenceChip ruleKey={ruleKey} grade={grade} />}
      </div>
      <p className="t-body mt-1 text-xs text-muted">{t("hint")}</p>
      <div className="mt-3 flex flex-col gap-4">
        {SCORE_KEYS.map((key: ScoreKey) => {
          const name = t(`scores.${key}.label`);
          return (
            <div key={key} data-testid={`score-${key}`}>
              <div className="flex items-baseline justify-between">
                <span className="t-label text-ink">{name}</span>
                <span className="t-body text-[10px] text-muted">
                  1 {t(`scores.${key}.low`)} · 5 {t(`scores.${key}.high`)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-5 gap-1.5" role="group" aria-label={name}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = form.scores[key] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={on}
                      aria-label={t("scoreAria", { name, n })}
                      onClick={() => {
                        const next = { ...form.scores };
                        if (on) delete next[key]; // tocar de nuevo lo quita: no responder es válido
                        else next[key] = n;
                        patch({ scores: next });
                      }}
                      className="rounded-xl border border-[rgba(150,190,255,0.18)] py-2 text-sm font-medium"
                      style={chip(on)}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="t-label mt-4 text-ink">{t("zonesLabel")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {SORENESS_ZONES.map((zone) => {
          const on = form.zones.includes(zone);
          return (
            <button
              key={zone}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ zones: on ? form.zones.filter((z) => z !== zone) : [...form.zones, zone] })}
              className="rounded-full border border-[rgba(150,190,255,0.18)] px-3 py-1 text-xs"
              style={chip(on)}
            >
              {t(`zones.${zone}`)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Check({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 text-left">
      <input
        id={id}
        data-testid={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <span className="t-body text-sm text-ink">{children}</span>
    </label>
  );
}

/** Señales de alarma, estructuradas: lo que se marca va al cribado o a las lesiones; nada se
 * guarda como texto. Lo que no se marca es "no". */
export function SignsSection({ form, patch }: Props) {
  const t = useTranslations("checkin.signs");
  const setSign = (key: (typeof SIGN_KEYS)[number], on: boolean) =>
    patch({ signs: { ...form.signs, [key]: on } });
  return (
    <section data-testid="signs-section" className="glass p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      <div className="mt-3 flex flex-col gap-3">
        <Check id="sign-cardiac" checked={form.signs.cardiac} onChange={(v) => setSign("cardiac", v)}>
          {t("cardiac")}
        </Check>
        {form.signs.cardiac && (
          <div className="ml-7">
            <Check id="sign-cardiac-emergency" checked={form.cardiacEmergency} onChange={(v) => patch({ cardiacEmergency: v })}>
              {t("cardiacEmergency")}
            </Check>
          </div>
        )}
        <Check id="sign-systemic_illness" checked={form.signs.systemic_illness} onChange={(v) => setSign("systemic_illness", v)}>
          {t("systemic_illness")}
        </Check>
        <Check id="sign-head_cold" checked={form.signs.head_cold} onChange={(v) => setSign("head_cold", v)}>
          {t("head_cold")}
        </Check>
        <Check id="sign-disordered_eating" checked={form.signs.disordered_eating} onChange={(v) => setSign("disordered_eating", v)}>
          {t("disordered_eating")}
        </Check>
        {form.signs.disordered_eating && (
          <div className="ml-7">
            <Check id="sign-disordered-urgent" checked={form.disorderedUrgent} onChange={(v) => patch({ disorderedUrgent: v })}>
              {t("disorderedUrgent")}
            </Check>
          </div>
        )}
        <Check id="sign-rhabdo" checked={form.signs.rhabdo} onChange={(v) => setSign("rhabdo", v)}>
          {t("rhabdo")}
        </Check>
        <Check id="sign-injury" checked={form.signs.injury} onChange={(v) => setSign("injury", v)}>
          {t("injury")}
        </Check>
        {form.signs.injury && (
          <div className="ml-7 flex flex-col gap-2">
            <input
              data-testid="injury-area"
              aria-label={t("injuryArea")}
              placeholder={t("injuryArea")}
              value={form.injury.area}
              onChange={(e) => patch({ injury: { ...form.injury, area: e.target.value } })}
              className="field px-3 py-2 text-sm"
            />
            <input
              data-testid="injury-exercises"
              aria-label={t("injuryExercises")}
              placeholder={t("injuryExercises")}
              value={form.injury.exercises}
              onChange={(e) => patch({ injury: { ...form.injury, exercises: e.target.value } })}
              className="field px-3 py-2 text-sm"
            />
            <input
              data-testid="injury-professional"
              aria-label={t("injuryProfessional")}
              placeholder={t("injuryProfessional")}
              value={form.injury.professional}
              onChange={(e) => patch({ injury: { ...form.injury, professional: e.target.value } })}
              className="field px-3 py-2 text-sm"
            />
            <Check id="injury-severe" checked={form.injury.severe} onChange={(v) => patch({ injury: { ...form.injury, severe: v } })}>
              {t("injurySevere")}
            </Check>
          </div>
        )}
      </div>
    </section>
  );
}

/** Preguntas de la semana (ciclo y tensión): el servidor dice cuáles toca hoy. */
export function WeeklySection({
  form,
  patch,
  questions,
}: Props & { questions: { code: "menstrual" | "bp"; ask_contraception?: boolean }[] }) {
  const t = useTranslations("checkin.weekly");
  if (!questions.length) return null;
  const menstrual = questions.find((q) => q.code === "menstrual");
  const bp = questions.find((q) => q.code === "bp");
  return (
    <section data-testid="weekly-section" className="glass p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      {menstrual && (
        <div data-testid="weekly-menstrual" className="mt-3">
          <p className="t-label text-ink">{t("menstrual.question")}</p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {(["normal", "irregular_new", "absent"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                data-testid={`period-${opt}`}
                aria-pressed={form.period === opt}
                onClick={() => patch({ period: form.period === opt ? null : opt })}
                className="rounded-xl border border-[rgba(150,190,255,0.18)] px-3 py-2 text-left text-sm"
                style={chip(form.period === opt)}
              >
                {t(`menstrual.${opt}`)}
              </button>
            ))}
          </div>
          {menstrual.ask_contraception && (
            <div className="mt-2">
              <Check id="contraception" checked={form.contraception} onChange={(v) => patch({ contraception: v })}>
                {t("menstrual.contraception")}
              </Check>
            </div>
          )}
        </div>
      )}
      {bp && (
        <div data-testid="weekly-bp" className="mt-4">
          <p className="t-label text-ink">{t("bp.question")}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-body text-[11px] text-muted">{t("bp.systolic")}</span>
              <input
                data-testid="bp-systolic"
                type="number"
                inputMode="numeric"
                value={form.bpSystolic}
                onChange={(e) => patch({ bpSystolic: e.target.value })}
                className="field px-3 py-2 text-right text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-body text-[11px] text-muted">{t("bp.diastolic")}</span>
              <input
                data-testid="bp-diastolic"
                type="number"
                inputMode="numeric"
                value={form.bpDiastolic}
                onChange={(e) => patch({ bpDiastolic: e.target.value })}
                className="field px-3 py-2 text-right text-sm"
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
