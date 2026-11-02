"use client";

import { useEffect, useState } from "react";
import { useProfile, useUpdateProfile } from "@/lib/hooks";
import { useTranslations } from "next-intl";
import { DobInput, dobErrorCode, dobToIso, type Dob, type DobLabels } from "./dob-input";

const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
const STANCES = ["ORTHODOX", "SOUTHPAW", "SWITCH"] as const;
const UNITS = ["METRIC", "IMPERIAL"] as const;

export function ProfileForm({
  submitLabel,
  onSaved,
}: {
  submitLabel: string;
  onSaved: () => void;
}) {
  const t = useTranslations("profile");
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const [loaded, setLoaded] = useState(false);
  const [dob, setDob] = useState<Dob>({ day: "", month: "", year: "" });
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [stance, setStance] = useState("");
  const [units, setUnits] = useState("METRIC");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !loaded) {
      const [y = "", m = "", d = ""] = (profile.date_of_birth ?? "").split("-");
      setDob({ day: d, month: m, year: y });
      setGender(profile.gender ?? "");
      setHeightCm(profile.height_cm != null ? String(profile.height_cm) : "");
      setStance(profile.dominant_stance ?? "");
      setUnits(profile.preferred_units ?? "METRIC");
      setLoaded(true);
    }
  }, [profile, loaded]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    setFormError(null);

    const dobEmpty = !dob.day && !dob.month && !dob.year;
    if (!dobEmpty) {
      const code = dobErrorCode(dob);
      if (code) {
        setFormError(t(`form.dobErrors.${code}`));
        return;
      }
    }

    const payload: Record<string, unknown> = {
      date_of_birth: dobEmpty ? null : dobToIso(dob),
      gender: gender || null,
      height_cm: heightCm ? Number(heightCm) : null,
      dominant_stance: stance || null,
      preferred_units: units,
    };
    try {
      await update.mutateAsync(payload);
      onSaved();
    } catch {
      /* error mostrado abajo via update.isError */
    }
  }

  const selectCls = "field appearance-none px-3 py-3 text-sm";
  const dobLabels: DobLabels = {
    day: t("form.day"), month: t("form.month"), year: t("form.year"),
    dd: t("form.dd"), mm: t("form.mm"), yyyy: t("form.yyyy"),
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("form.dob")}</span>
        <DobInput value={dob} onChange={setDob} labels={dobLabels} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("form.gender")}</span>
        <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectCls}>
          <option value="">{t("form.select")}</option>
          {GENDERS.map((v) => <option key={v} value={v}>{t(`options.gender.${v}`)}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("form.height")}</span>
        <input
          type="number"
          inputMode="numeric"
          step="1"
          value={heightCm}
          onChange={(e) => setHeightCm(e.target.value)}
          placeholder="0"
          className="field px-4 py-3 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("form.stance")}</span>
        <select value={stance} onChange={(e) => setStance(e.target.value)} className={selectCls}>
          <option value="">{t("form.select")}</option>
          {STANCES.map((v) => <option key={v} value={v}>{t(`options.stance.${v}`)}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("form.units")}</span>
        <select value={units} onChange={(e) => setUnits(e.target.value)} className={selectCls}>
          {UNITS.map((v) => <option key={v} value={v}>{v === "METRIC" ? t("form.unitsMetric") : t("form.unitsImperial")}</option>)}
        </select>
      </label>

      {formError && <p className="text-xs text-bad">{formError}</p>}
      {update.isError && !formError && <p className="text-xs text-bad">{(update.error as Error).message}</p>}
      {update.isSuccess && <p className="text-xs text-good">{t("form.saved")}</p>}
      <button type="submit" disabled={update.isPending} className="btn btn-primary mt-2 disabled:opacity-60">
        {update.isPending ? t("form.saving") : submitLabel}
      </button>
    </form>
  );
}
