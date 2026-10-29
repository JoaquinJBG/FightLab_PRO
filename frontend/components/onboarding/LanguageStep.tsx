"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useUpdateProfile } from "@/lib/hooks";
import type { Profile } from "@/lib/schemas";
import { Choice, Hint, Label, StepFooter, StepTitle, type StepProps } from "./ui";

const EMERGENCY_RE = /^\d{2,6}$/; // coach.profile.EMERGENCY_NUMBER
const PRESETS = ["112", "911", "999", "000"];

/** Paso 1 (setup/SKILL.md): idioma y región; sin región, el número de emergencias. */
export function LanguageStep({ profile, onNext }: StepProps & { profile: Profile }) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const uiLocale = useLocale();
  const update = useUpdateProfile();
  const [lang, setLang] = useState<"es" | "en">(profile.language);
  const [where, setWhere] = useState<"es" | "other" | null>(
    profile.region === "es" ? "es" : profile.emergency_number ? "other" : null,
  );
  const [number, setNumber] = useState(profile.emergency_number ?? "112");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!where) return setError(t("language.where"));
    if (where === "other" && !EMERGENCY_RE.test(number)) return setError(t("language.emergencyInvalid"));
    try {
      await update.mutateAsync({
        language: lang,
        region: where === "es" ? "es" : null,
        emergency_number: where === "other" ? number : null,
      });
      // El BFF ha guardado la cookie flp_lang: si la UI estaba en otro idioma (el del
      // navegador, antes de tener perfil), se recargan los catálogos del servidor.
      if (lang !== uiLocale) router.refresh();
      onNext();
    } catch {
      setError(t("saveError"));
    }
  }

  return (
    <>
      <StepTitle k="language.title" />
      <p className="t-body mt-1 text-xs text-muted">{t("language.intro")}</p>
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("language.languageLabel")}</Label>
          <div className="flex gap-2">
            <Choice selected={lang === "es"} onClick={() => setLang("es")} className="flex-1" testId="lang-es">
              Español
            </Choice>
            <Choice selected={lang === "en"} onClick={() => setLang("en")} className="flex-1" testId="lang-en">
              English
            </Choice>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("language.where")}</Label>
          <div className="flex gap-2">
            <Choice selected={where === "es"} onClick={() => setWhere("es")} className="flex-1" testId="region-es">
              {t("language.spain")}
            </Choice>
            <Choice selected={where === "other"} onClick={() => setWhere("other")} className="flex-1" testId="region-other">
              {t("language.other")}
            </Choice>
          </div>
          {where === "es" && <Hint>{t("language.spainEmergency")}</Hint>}
        </div>
        {where === "other" && (
          <div className="flex flex-col gap-1.5">
            <Hint>{t("language.otherNote")}</Hint>
            <Label>{t("language.emergencyLabel")}</Label>
            <div className="flex gap-2">
              {PRESETS.map((n) => (
                <Choice key={n} selected={number === n} onClick={() => setNumber(n)} className="flex-1">
                  {n}
                </Choice>
              ))}
            </div>
            <input
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value.trim())}
              className="field px-4 py-3 text-sm"
              aria-label={t("language.emergencyLabel")}
            />
            <Hint>{t("language.emergencyHint")}</Hint>
          </div>
        )}
      </div>
      <StepFooter error={error} onNext={save} pending={update.isPending} />
    </>
  );
}
