"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { ProductsCard } from "@/components/menu/ProductsCard";
import { TastesCard } from "@/components/menu/TastesCard";
import { useMenu } from "@/lib/menu";

/* Ajustes del menú: agrupa lo que afecta a cómo se hacen los menús (cocina, IA, gustos, productos).
   Solo reúne pantallas y tarjetas que ya existían. */
export default function MenuSettingsPage() {
  const t = useTranslations("menuSettings");
  const state = useMenu(null);

  const rows = [
    { href: "/profile/kitchen", id: "kitchen" },
  ] as const;

  return (
    <div className="pt-4 pb-6">
      <Link href="/nutrition/menu" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      <div className="mt-4 flex flex-col gap-2">
        {rows.map(({ href, id }) => (
          <Link key={id} href={href} data-testid={`menu-settings-${id}`} className="glass flex items-center justify-between gap-3 p-4">
            <span className="min-w-0">
              <span className="t-title block text-sm text-ink">{t(`rows.${id}.title`)}</span>
              <span className="t-body block text-xs text-muted">{t(`rows.${id}.sub`)}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>

      {state.data ? <TastesCard tastes={state.data.tastes} /> : state.isError ? <p className="t-body mt-4 text-sm text-bad">{t("error")}</p> : <p className="t-body mt-4 text-sm text-muted">{t("loading")}</p>}
      <ProductsCard />
    </div>
  );
}
