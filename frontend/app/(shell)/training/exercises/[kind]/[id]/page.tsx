"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ExerciseDetail } from "@/components/exercises/ExerciseDetail";

/** Ficha de un ejercicio: /training/exercises/cat/<slug> o /training/exercises/custom/<id>. */
export default function ExercisePage() {
  const t = useTranslations("exercises");
  const router = useRouter();
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const valid = (kind === "cat" || kind === "custom") && /^[A-Za-z0-9._~-]+$/.test(id ?? "");

  return (
    <div className="pt-4 pb-6">
      <Link href="/training/exercises" className="t-label text-muted">← {t("library.title")}</Link>
      <div className="mt-3">
        {valid ? (
          <ExerciseDetail exerciseKey={`${kind}:${id}`} onDeleted={() => router.push("/training/exercises")} />
        ) : (
          <p className="t-body py-6 text-center text-sm text-muted">{t("detail.notFound")}</p>
        )}
      </div>
    </div>
  );
}
