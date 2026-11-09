"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { KitchenForm } from "@/components/kitchen/KitchenForm";
import { useKitchen } from "@/lib/kitchen";

export default function KitchenPage() {
  const t = useTranslations("kitchen");
  const kitchen = useKitchen();
  return (
    <div className="pt-4 pb-6">
      <Link href="/profile" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>
      {kitchen.isLoading && <p className="t-body mt-4 text-muted">{t("loading")}</p>}
      {kitchen.isError && <p className="t-body mt-4 text-bad">{t("error")}</p>}
      {kitchen.data && <KitchenForm kitchen={kitchen.data} />}
    </div>
  );
}
