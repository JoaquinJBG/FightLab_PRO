"use client";

import { useTranslations } from "next-intl";
import { useEngine } from "@/lib/hooks";
import { ENGINE_SHA, EVIDENCE_DATE } from "@/lib/credits";

/** Versión del motor y fecha de la evidencia, leídas de `GET /coach/engine`. */
export function EngineLine() {
  const t = useTranslations("credits");
  const { data } = useEngine();
  const sha = data?.sha ?? ENGINE_SHA;
  const date = data?.knowledge_checked_on ?? EVIDENCE_DATE;
  return <p className="t-label mt-3 text-muted">{t("engine", { sha, date })}</p>;
}
