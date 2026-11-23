"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  deleteCustomExercise,
  forgetRecentKey,
  useExercise,
  type Exercise,
  type ExerciseImage,
} from "@/lib/exercises";
import { ExerciseIcon } from "./ExerciseThumb";
import { CustomExerciseForm } from "./CustomExerciseForm";

const FRAME_MS = 1100;

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Fotogramas del ejercicio. Con dos o más se alternan (como los de everkinetic: relajación y
 * tensión) salvo que el sistema pida menos movimiento; siempre se puede parar. */
function Frames({ images, name }: { images: ExerciseImage[]; name: string }) {
  const t = useTranslations("exercises.detail");
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(() => images.length > 1 && !prefersReducedMotion());
  useEffect(() => {
    if (!playing || images.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % images.length), FRAME_MS);
    return () => clearInterval(id);
  }, [playing, images.length]);
  // Todos los fotogramas se cargan a la vez y se apilan: al alternar no hay parpadeo.
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#f4f7fb]">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-sm">
        {images.map((img, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={img.url} src={img.url} aria-hidden={n !== i}
            alt={n === i ? `${name} · ${t("frame", { n: n + 1, total: images.length })}` : ""}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${n === i ? "opacity-100" : "opacity-0"}`} />
        ))}
      </div>
      {images.length > 1 && (
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}
          className="badge absolute bottom-2 right-2 min-h-11"
          style={{ background: "rgba(2,4,10,0.8)", color: "var(--color-ink)" }}>
          {playing ? t("pause") : t("play")}
        </button>
      )}
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-neon underline">
      {children}
    </a>
  );
}

const SOURCE_NAMES: Record<string, string> = { wger: "wger", everkinetic: "Everkinetic" };

/** Pie de créditos: un renglón por autor y licencia de las imágenes, y el del texto. */
export function ExerciseCredits({ exercise }: { exercise: Exercise }) {
  const t = useTranslations("exercises.detail");
  // «Everkinetic» si el autor es la propia fuente; si no, «autor vía wger».
  const who = (author: string, source: string) => {
    const name = SOURCE_NAMES[source] ?? source;
    return author === name ? author : t("via", { author, source: name });
  };
  const seen = new Set<string>();
  const images = exercise.images.filter((img) => {
    const id = `${img.author}|${img.license}|${img.source_url}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const tc = exercise.text_credit;
  if (!images.length && !tc) return null;
  return (
    <section className="mt-4" aria-label={t("credits")}>
      <h3 className="t-label text-muted">{t("credits")}</h3>
      <ul className="t-body mt-1 space-y-1 text-xs text-muted">
        {images.map((img) => (
          <li key={`${img.author}|${img.source_url}`}>
            <Ext href={img.source_url}>{t("imageCredit", { who: who(img.author, img.source) })}</Ext>
            {" · "}<Ext href={img.license_url}>{img.license}</Ext>
            {img.modified ? <span> · {t("modified", { modified: img.modified })}</span> : null}
          </li>
        ))}
        {tc && tc.source !== "fightlab" && tc.author && tc.license && (
          <li>
            <Ext href={tc.source_url ?? "https://wger.de/"}>{t("textCredit", { who: who(tc.author, tc.source) })}</Ext>
            {tc.license_url ? <> · <Ext href={tc.license_url}>{tc.license}</Ext></> : null}
            {tc.modified ? <span> · {t("modified", { modified: tc.modified })}</span> : null}
          </li>
        )}
        {tc?.source === "fightlab" && <li>{t("ownText")}</li>}
      </ul>
    </section>
  );
}

/** La ficha de un ejercicio: fotogramas o icono, músculos, material, pasos y créditos. Los propios
 * se pueden editar y borrar aquí mismo. */
export function ExerciseDetail({
  exerciseKey,
  onDeleted,
}: {
  exerciseKey: string;
  onDeleted?: () => void;
}) {
  const t = useTranslations("exercises");
  const locale = useLocale();
  const qc = useQueryClient();
  const { data: ex, isLoading, isError, refetch } = useExercise(exerciseKey, locale);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  if (isLoading) return <p className="t-body py-6 text-center text-sm text-muted">{t("picker.loading")}</p>;
  if (isError)
    return (
      <div className="py-6 text-center">
        <p className="t-body text-sm text-muted">{t("detail.error")}</p>
        <button type="button" onClick={() => refetch()} className="btn btn-tonal btn-sm mt-3 min-h-11">{t("picker.retry")}</button>
      </div>
    );
  if (!ex) return <p className="t-body py-6 text-center text-sm text-muted">{t("detail.notFound")}</p>;

  if (editing && ex.custom && ex.id !== undefined) {
    return (
      <div>
        <h2 className="t-title text-lg text-ink">{t("form.titleEdit")}</h2>
        <div className="mt-3">
          <CustomExerciseForm editId={ex.id} initial={ex}
            onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </div>
      </div>
    );
  }

  async function remove() {
    if (ex?.id === undefined) return;
    setDeleteError(false);
    try {
      await deleteCustomExercise(ex.id);
      forgetRecentKey(ex.key);
      await qc.invalidateQueries({ queryKey: ["exercises"] });
      onDeleted?.();
    } catch {
      setDeleteError(true);
    }
  }

  const muscle = (m: string) => t(`muscles.${m}`);
  const stepsNotice =
    ex.instructions.length > 0 && ex.instructions_lang && ex.instructions_lang !== locale
      ? ex.instructions_lang === "en" ? t("detail.stepsInEnglish") : t("detail.stepsInSpanish")
      : null;

  return (
    <article>
      {ex.images.length > 0 ? (
        <Frames images={ex.images} name={ex.name} />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-[rgba(69,233,255,0.05)] text-neon">
          <ExerciseIcon category={ex.category} className="h-14 w-14" />
          {!ex.custom && <p className="t-body px-4 text-center text-xs text-muted">{t("detail.noImage")}</p>}
        </div>
      )}

      <h2 className="t-display mt-4 text-xl text-ink">{ex.name}</h2>
      <p className="t-body mt-1 text-xs text-muted">
        {ex.custom ? t("detail.custom") : t(`categories.${ex.category}`)}
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="t-label text-muted">{t("detail.primary")}</dt>
        <dd className="t-body text-ink">{ex.primary_muscles.map(muscle).join(", ") || "—"}</dd>
        {ex.secondary_muscles.length > 0 && (
          <>
            <dt className="t-label text-muted">{t("detail.secondary")}</dt>
            <dd className="t-body text-ink">{ex.secondary_muscles.map(muscle).join(", ")}</dd>
          </>
        )}
        <dt className="t-label text-muted">{t("detail.equipment")}</dt>
        <dd className="t-body text-ink">{ex.equipment.map((q) => t(`equipment.${q}`)).join(", ") || "—"}</dd>
      </dl>

      {ex.custom ? (
        ex.notes && (
          <section className="mt-4">
            <h3 className="t-label text-muted">{t("detail.notes")}</h3>
            <p className="t-body mt-1 whitespace-pre-line text-sm text-ink">{ex.notes}</p>
          </section>
        )
      ) : (
        <section className="mt-4">
          <h3 className="t-label text-muted">{t("detail.steps")}</h3>
          {stepsNotice && <p className="t-body mt-1 text-xs text-[#ffd479]" role="note">{stepsNotice}</p>}
          {ex.instructions.length > 0 ? (
            <ol className="t-body mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink"
              lang={ex.instructions_lang ?? undefined}>
              {ex.instructions.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : (
            <p className="t-body mt-1 text-sm text-muted">{t("detail.noSteps")}</p>
          )}
        </section>
      )}

      <ExerciseCredits exercise={ex} />

      {ex.custom && (
        <div className="mt-5">
          {confirmDelete ? (
            <div role="alertdialog" aria-label={t("detail.deleteConfirm", { name: ex.name })} className="glass p-4">
              <p className="t-body text-sm text-ink">{t("detail.deleteConfirm", { name: ex.name })}</p>
              {deleteError && <p role="alert" className="t-body mt-2 text-xs text-[#ff8a8a]">{t("detail.deleteError")}</p>}
              <div className="mt-3 flex gap-3">
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-outline min-h-11 flex-1">{t("form.cancel")}</button>
                <button type="button" onClick={remove} className="btn btn-primary min-h-11 flex-1">{t("detail.deleteYes")}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditing(true)} className="btn btn-tonal min-h-11 flex-1">{t("detail.edit")}</button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-outline min-h-11 flex-1">{t("detail.delete")}</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
