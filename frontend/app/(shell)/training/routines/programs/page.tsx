"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useLoadProgram, usePrograms } from "@/lib/routines";

/* Programas clásicos (F17 R): cada uno se copia como rutinas tuyas en una carpeta. */
export default function ProgramsPage() {
  const t = useTranslations("routines");
  const router = useRouter();
  const { data, isLoading, isError } = usePrograms();
  const load = useLoadProgram();
  const [loading, setLoading] = useState<string | null>(null);

  return (
    <div className="pt-4 pb-6">
      <Link href="/training/routines" className="t-label text-muted">
        {t("programs.back")}
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("programs.title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("programs.intro")}</p>

      {isLoading && <p className="t-body mt-6 text-sm text-muted">{t("loading")}</p>}
      {isError && (
        <p role="alert" className="t-body mt-6 text-sm text-warn">
          {t("loadError")}
        </p>
      )}
      {load.isError && (
        <p role="alert" className="t-body mt-4 text-sm text-warn">
          {t("saveError")}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {data?.map((p) => (
          <article key={p.slug} data-testid="program-card" data-slug={p.slug} className="glass p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="t-title text-base text-ink">{p.title}</h2>
              <span className="t-label shrink-0 text-neon">{t("programs.days", { n: p.days_per_week })}</span>
            </div>
            <p className="t-label mt-1 text-muted">{t(`programs.level.${p.level}`)}</p>
            <p className="t-body mt-2 text-xs text-muted">{p.description}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {p.routines.map((r) => (
                <li key={r.key} className="t-label rounded-full border border-white/15 px-2 py-0.5 text-ink">
                  {r.title}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="program-evidence">
              {p.convention && <EvidenceChip ruleKey={null} />}
              {p.rules.map((r) => (
                <EvidenceChip key={r.key} ruleKey={r.key} grade={r.grade} />
              ))}
            </div>
            {p.source_note && <p className="t-body mt-2 text-[11px] text-muted">{p.source_note}</p>}
            <button
              type="button"
              data-testid="program-load"
              className="btn btn-primary btn-sm btn-block mt-3"
              disabled={load.isPending}
              onClick={() => {
                setLoading(p.slug);
                load.mutate(p.slug, {
                  onSuccess: () => router.push("/training/routines"),
                  onSettled: () => setLoading(null),
                });
              }}
            >
              {loading === p.slug ? t("programs.loading") : t("programs.load")}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
