"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { CustomExerciseForm } from "@/components/exercises/CustomExerciseForm";
import { EQUIPMENT, MUSCLES, exerciseHref, filterExercises, useExercises } from "@/lib/exercises";

/** Biblioteca de ejercicios (Entreno → Ejercicios): buscar, filtrar, abrir la ficha y crear propios. */
export default function ExercisesLibraryPage() {
  const t = useTranslations("exercises");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useExercises(locale);
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equipment, setEquipment] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => filterExercises(data ?? [], { q, muscle, equipment }), [data, q, muscle, equipment]);

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← {tc("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("library.title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("library.sub")}</p>

      {creating ? (
        <section className="glass mt-4 p-4">
          <h2 className="t-title mb-3 text-base text-ink">{t("form.titleNew")}</h2>
          <CustomExerciseForm submitLabel={t("form.createOnly")} onCancel={() => setCreating(false)}
            onSaved={(ex) => { setCreating(false); const href = exerciseHref(ex.key); if (href) router.push(href); }} />
        </section>
      ) : (
        <>
          <div className="mt-4">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("picker.search")}
              aria-label={t("picker.searchAria")} className="field w-full px-4 py-3 text-base" />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select value={muscle} onChange={(e) => setMuscle(e.target.value)} aria-label={t("picker.muscleFilter")}
                className="field min-h-11 w-full min-w-0 px-3 py-2 text-sm">
                <option value="">{t("picker.allMuscles")}</option>
                {MUSCLES.map((m) => <option key={m} value={m}>{t(`muscles.${m}`)}</option>)}
              </select>
              <select value={equipment} onChange={(e) => setEquipment(e.target.value)} aria-label={t("picker.equipmentFilter")}
                className="field min-h-11 w-full min-w-0 px-3 py-2 text-sm">
                <option value="">{t("picker.allEquipment")}</option>
                {EQUIPMENT.map((x) => <option key={x} value={x}>{t(`equipment.${x}`)}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setCreating(true)} className="btn btn-tonal btn-sm mt-2 min-h-11 w-full">
              + {t("picker.create")}
            </button>
          </div>

          {isLoading && <p className="t-body py-6 text-center text-sm text-muted">{t("picker.loading")}</p>}
          {isError && (
            <div className="py-6 text-center">
              <p className="t-body text-sm text-muted">{t("picker.error")}</p>
              <button type="button" onClick={() => refetch()} className="btn btn-tonal btn-sm mt-3 min-h-11">{t("picker.retry")}</button>
            </div>
          )}
          {data && (
            <>
              <p className="t-label mt-4 text-muted">{t("library.count", { n: list.length })}</p>
              <ul className="mt-2 flex flex-col gap-1" data-testid="exercise-library">
                {list.map((ex) => (
                  <li key={ex.key}>
                    <Link href={exerciseHref(ex.key) ?? "/training/exercises"}
                      className="glass flex min-h-14 items-center gap-3 px-3 py-2">
                      <ExerciseThumb exercise={ex} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="t-body block truncate text-sm text-ink">{ex.name}</span>
                        <span className="t-body block truncate text-[11px] text-muted">
                          {ex.primary_muscles.map((m) => t(`muscles.${m}`)).join(", ")}
                          {ex.custom && <span className="badge badge-neon ml-2 px-1.5 py-0 text-[9px]">{t("picker.custom")}</span>}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              {list.length === 0 && <p className="t-body py-6 text-center text-sm text-muted">{t("picker.noResults")}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
