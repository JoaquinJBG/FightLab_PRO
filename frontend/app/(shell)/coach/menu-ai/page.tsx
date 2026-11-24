"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AiMenuCard } from "@/components/menu/AiMenuCard";
import { MEALS, useMenu, type MealKey } from "@/lib/menu";

/* «Menú con tu IA» vive en el Coach: la IA no ocupa pantallas de Nutrición. */
export default function CoachMenuAiPage() {
  const t = useTranslations("coachMenuAi");
  const router = useRouter();
  const state = useMenu(null);
  const [days, setDays] = useState(3);
  const [meals] = useState<MealKey[]>([...MEALS]);
  const maxDays = state.data?.max_days ?? 7;

  return (
    <div className="pt-4 pb-6">
      <Link href="/coach" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
        <label className="flex items-center gap-2">
          <span className="t-label text-muted">{t("days")}</span>
          <select data-testid="coach-menu-ai-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="field px-2 py-1.5 text-sm">
            {Array.from({ length: maxDays }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <AiMenuCard days={days} meals={meals} tupper={[]} onSaved={(id) => router.push(`/nutrition/menu?id=${id}`)} />
    </div>
  );
}
