"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  EQUIPMENT,
  MUSCLES,
  filterExercises,
  loadRecentKeys,
  pushRecentKeys,
  useExercises,
  type Exercise,
} from "@/lib/exercises";
import { InfoIcon } from "@/components/icons";
import { ExerciseThumb } from "./ExerciseThumb";
import { ExerciseDetail } from "./ExerciseDetail";
import { CustomExerciseForm } from "./CustomExerciseForm";

type View = { kind: "list" } | { kind: "detail"; key: string } | { kind: "create"; name: string };

/**
 * Selector de ejercicios a pantalla completa (F17), como el de Hevy: búsqueda en los dos idiomas,
 * filtros por músculo y material, recientes, ficha de cada ejercicio y «crear ejercicio».
 *
 * - Simple (por defecto): tocar un ejercicio llama a `onSelect(ex)` y después a `onClose()`.
 * - `multiple`: se marcan varios y «Añadir (n)» llama a `onSelect` con cada uno, en el orden en
 *   que se marcaron, y después a `onClose()`.
 * Un ejercicio creado desde aquí se elige al momento (en `multiple`, se marca).
 */
export function ExercisePicker({
  onSelect,
  multiple = false,
  onClose,
}: {
  onSelect: (ex: Exercise) => void;
  multiple?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("exercises");
  const locale = useLocale();
  const { data, isLoading, isError, refetch } = useExercises(locale);
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equipment, setEquipment] = useState("");
  const [picked, setPicked] = useState<Exercise[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [recentKeys] = useState<string[]>(() => loadRecentKeys());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view.kind !== "list") setView({ kind: "list" });
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.kind, onClose]);

  // Sin desplazar la página de debajo mientras el selector está abierto
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const all = useMemo(() => data ?? [], [data]);
  const filtering = !!(q.trim() || muscle || equipment);
  const results = useMemo(() => filterExercises(all, { q, muscle, equipment }), [all, q, muscle, equipment]);
  const recents = useMemo(() => {
    if (filtering) return [];
    const byKey = new Map(all.map((e) => [e.key, e]));
    return recentKeys.map((k) => byKey.get(k)).filter((e): e is Exercise => !!e);
  }, [all, recentKeys, filtering]);

  function finish(list: Exercise[]) {
    if (!list.length) return;
    pushRecentKeys(list.map((e) => e.key));
    list.forEach((e) => onSelect(e));
    onClose();
  }

  function choose(ex: Exercise) {
    if (!multiple) return finish([ex]);
    setPicked((p) => (p.some((e) => e.key === ex.key) ? p.filter((e) => e.key !== ex.key) : [...p, ex]));
  }

  function created(ex: Exercise) {
    setView({ kind: "list" });
    setQ("");
    if (multiple) setPicked((p) => [...p, ex]);
    else finish([ex]);
  }

  const order = (key: string) => picked.findIndex((e) => e.key === key);

  const row = (ex: Exercise) => {
    const n = order(ex.key);
    const selected = n >= 0;
    return (
      <li key={ex.key} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => choose(ex)}
          aria-pressed={multiple ? selected : undefined}
          aria-label={t("picker.select", { name: ex.name })}
          className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${selected ? "bg-[rgba(69,233,255,0.08)]" : ""}`}
        >
          <ExerciseThumb exercise={ex} size={44} />
          <span className="min-w-0 flex-1">
            <span className="t-body block truncate text-sm text-ink">{ex.name}</span>
            <span className="t-body block truncate text-[11px] text-muted">
              {ex.primary_muscles.map((m) => t(`muscles.${m}`)).join(", ")}
              {ex.custom && <span className="badge badge-neon ml-2 px-1.5 py-0 text-[9px]">{t("picker.custom")}</span>}
            </span>
          </span>
          {multiple && (
            <span aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${selected ? "border-transparent bg-[var(--color-neon)] text-[#03101c]" : "border-[rgba(150,190,255,0.25)]"}`}>
              {selected ? n + 1 : ""}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setView({ kind: "detail", key: ex.key })}
          aria-label={t("picker.info", { name: ex.name })}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-neon">
          <InfoIcon className="h-5 w-5" />
        </button>
      </li>
    );
  };

  const title = multiple ? t("picker.titleMultiple") : t("picker.title");

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-[var(--color-bg)]">
      <div role="dialog" aria-modal="true" aria-label={title} data-testid="exercise-picker"
        className="flex h-full w-full max-w-xl flex-col">
        <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {view.kind === "list" ? (
            <h2 className="t-title text-lg text-ink">{title}</h2>
          ) : (
            <button type="button" onClick={() => setView({ kind: "list" })} className="t-label min-h-11 text-muted">
              ← {t("detail.back")}
            </button>
          )}
          <button type="button" onClick={onClose} className="t-label min-h-11 px-2 text-neon">{t("picker.close")}</button>
        </header>

        {view.kind === "detail" && (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <ExerciseDetail exerciseKey={view.key} onDeleted={() => setView({ kind: "list" })} />
            {(() => {
              const ex = all.find((e) => e.key === view.key);
              return ex && order(ex.key) < 0 ? (
                <button type="button" onClick={() => { choose(ex); setView({ kind: "list" }); }}
                  className="btn btn-primary mt-5 min-h-11 w-full">
                  {t("picker.add")}
                </button>
              ) : null;
            })()}
          </div>
        )}

        {view.kind === "create" && (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <h3 className="t-title mb-3 text-base text-ink">{t("form.titleNew")}</h3>
            <CustomExerciseForm initial={{ name: view.name }} submitLabel={t("form.create")}
              onSaved={created} onCancel={() => setView({ kind: "list" })} />
          </div>
        )}

        {view.kind === "list" && (
          <>
            <div className="px-4">
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
              <button type="button" onClick={() => setView({ kind: "create", name: q.trim() })}
                className="btn btn-tonal btn-sm mt-2 min-h-11 w-full">
                + {t("picker.create")}
              </button>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4" data-testid="exercise-picker-list">
              {isLoading && <p className="t-body py-6 text-center text-sm text-muted">{t("picker.loading")}</p>}
              {isError && (
                <div className="py-6 text-center">
                  <p className="t-body text-sm text-muted">{t("picker.error")}</p>
                  <button type="button" onClick={() => refetch()} className="btn btn-tonal btn-sm mt-3 min-h-11">{t("picker.retry")}</button>
                </div>
              )}
              {data && (
                <>
                  {recents.length > 0 && (
                    <section aria-label={t("picker.recent")}>
                      <h3 className="t-label px-2 pt-2 text-muted">{t("picker.recent")}</h3>
                      <ul className="mt-1 flex flex-col gap-0.5">{recents.map(row)}</ul>
                    </section>
                  )}
                  <section aria-label={t("picker.all")}>
                    <h3 className="t-label flex justify-between px-2 pt-3 text-muted">
                      <span>{filtering ? t("picker.results", { n: results.length }) : t("picker.all")}</span>
                    </h3>
                    <ul className="mt-1 flex flex-col gap-0.5">{results.map(row)}</ul>
                    {results.length === 0 && (
                      <div className="py-6 text-center">
                        <p className="t-body text-sm text-muted">{t("picker.noResults")}</p>
                        {q.trim() && (
                          <button type="button" onClick={() => setView({ kind: "create", name: q.trim() })}
                            className="btn btn-tonal btn-sm mt-3 min-h-11">
                            {t("picker.createNamed", { name: q.trim() })}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            {multiple && (
              <div className="border-t border-[rgba(150,190,255,0.12)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
                <button type="button" disabled={!picked.length} onClick={() => finish(picked)}
                  className="btn btn-primary min-h-11 w-full disabled:opacity-50">
                  {picked.length ? t("picker.addN", { n: picked.length }) : t("picker.add")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
