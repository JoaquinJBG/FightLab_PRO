"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RoutineEditor } from "@/components/routines/RoutineEditor";
import { toDraft, useRoutine } from "@/lib/routines";

/* Crear (`/training/routines/new`) o editar una rutina. */
export default function RoutineEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <RoutineEditInner id={id} />
    </Suspense>
  );
}

function RoutineEditInner({ id }: { id: string }) {
  const search = useSearchParams();
  const t = useTranslations("routines");
  const numeric = id === "new" ? null : Number(id);
  const valid = numeric === null || (Number.isInteger(numeric) && numeric > 0);
  const { data, isLoading, isError } = useRoutine(valid ? numeric : null);

  if (!valid || isError) {
    return (
      <div className="pt-4">
        <Link href="/training/routines" className="t-label text-muted">
          {t("programs.back")}
        </Link>
        <p role="alert" className="t-body mt-6 text-sm text-warn">
          {t("notFound")}
        </p>
      </div>
    );
  }
  if (numeric === null) {
    const folder = Number(search.get("folder"));
    return <RoutineEditor id={null} folderId={Number.isInteger(folder) && folder > 0 ? folder : null} />;
  }
  if (isLoading || !data) return <p className="t-body pt-8 text-sm text-muted">{t("loading")}</p>;
  // `key`: al guardar o duplicar, el editor arranca con los datos nuevos.
  return <RoutineEditor key={`${data.id}-${data.updated_at}`} id={data.id} initial={toDraft(data)} />;
}
