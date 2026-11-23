"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { useDisciplines } from "@/lib/hooks";

/** Agrupa las tres importaciones: el historial de otra app, los entrenos de Hevy y el catálogo
 * del súper. Cada una sigue en su pantalla de siempre. */
export default function ImportHubPage() {
  const t = useTranslations("importHub");
  const { gym } = useDisciplines();
  const rows = [
    { href: "/profile/import", key: "history", testId: "history-import-link" },
    { href: "/training/gym/import", key: "hevy", testId: "hevy-import-link" },
    { href: "/profile/import/catalogue", key: "catalogue", testId: "catalogue-hub-link" },
  ] as const;
  const shown = rows.filter((r) => gym || r.key !== "hevy");
  return (
    <div className="pt-4">
      <Link href="/profile" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("subtitle")}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {shown.map((r) => (
          <li key={r.key}>
            <Link href={r.href} data-testid={r.testId} className="glass flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="t-label block text-ink">{t(`${r.key}.title`)}</span>
                <span className="t-body block text-[11px] text-muted">{t(`${r.key}.hint`)}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
