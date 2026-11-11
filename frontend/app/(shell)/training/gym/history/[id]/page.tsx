"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { TrainingIcon } from "@/components/icons";
import { EXERCISE_KEYS, gymSets, savedExercises, sessionTotals, type ExerciseEntry, type SetEntry } from "@/lib/gym";
import { nextSetType, setLabels, supersetGroups } from "@/lib/gym-log";
import { deleteActivity, exerciseId, exercisesFromServerSets, fetchActivityDetail, patchActivity } from "@/lib/gym-api";
import { firstReason, type ServerActivityDetail } from "@/lib/activities";
import { SetRow } from "@/components/gym/SetRow";

/** Detalle de un entreno de gimnasio (F17): lo guardado en el servidor, editable y borrable. */
export default function GymHistoryDetailPage() {
  const t = useTranslations("training.gymHistory");
  const ts = useTranslations("training.gymSession");
  const tg = useTranslations("training.gym");
  const locale = intlLocale(useLocale());
  const exLabel = (n: string) => (EXERCISE_KEYS[n] ? tg(`exercises.${EXERCISE_KEYS[n]}`) : n);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<ServerActivityDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ExerciseEntry[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchActivityDetail(id).then((d) => {
      if (!alive) return;
      if (!d) setMissing(true);
      else setData(d);
    });
    return () => { alive = false; };
  }, [id]);

  function startEdit() {
    if (!data) return;
    setDraft(exercisesFromServerSets(data.sets));
    setTitle(data.title);
    setNote(data.note);
    setRpe(data.rpe);
    setError(null);
    setEditing(true);
  }
  const patchSet = (ei: number, si: number, patch: Partial<SetEntry>) =>
    setDraft((xs) => xs.map((x, i) => (i !== ei ? x : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })) })));

  async function save() {
    setBusy(true);
    setError(null);
    // Al editar, todas las series cuentan como hechas: las vacías o imposibles no se envían
    const sets = gymSets(savedExercises(draft.map((x) => ({ ...x, sets: x.sets.map((s) => ({ ...s, done: true })) }))));
    const res = await patchActivity(id, { title: title.trim().slice(0, 80), note: note.slice(0, 2000), rpe, sets });
    setBusy(false);
    if (!res.ok) {
      setError(firstReason(res.errors) ?? t("saveError"));
      return;
    }
    setData(res.data);
    setEditing(false);
  }
  async function remove() {
    setBusy(true);
    const ok = await deleteActivity(id);
    setBusy(false);
    if (ok) router.push("/training/gym");
    else setError(t("deleteError"));
  }

  if (missing) {
    return (
      <div className="pt-4">
        <Link href="/training/gym" className="t-label text-muted">{t("back")}</Link>
        <p className="t-body mt-4 text-sm text-muted">{t("notFound")}</p>
      </div>
    );
  }
  if (!data) return <div className="pt-6 text-center"><p className="t-body text-muted">{ts("loading")}</p></div>;

  const exercises = editing ? draft : exercisesFromServerSets(data.sets);
  const groups = supersetGroups(exercises);
  const totals = sessionTotals(savedExercises(exercises));
  const start = new Date(data.started_at);

  return (
    <div className="pt-4 pb-24">
      <Link href="/training/gym" className="t-label inline-flex min-h-11 items-center text-muted">{t("back")}</Link>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("titleAria")} className="field min-h-11 flex-1 px-3 text-base" />
        ) : (
          <h1 className="t-display text-2xl text-ink">{data.title || tg("workout")}</h1>
        )}
      </div>
      <p className="t-body mt-1 text-xs text-muted">
        {start.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
        {" · "}{Math.round(data.duration_sec / 60)} min{data.rpe ? ` · RPE ${data.rpe}` : ""}{data.source === "IMPORT" ? ` · ${t("imported")}` : ""}
      </p>
      <div className="glass mt-3 flex justify-between p-4 text-center">
        <div><p className="stat text-xl text-ink">{exercises.length}</p><p className="t-label text-muted">{t("exercises")}</p></div>
        <div><p data-testid="detail-sets" className="stat text-xl text-ink">{totals.totalSets}</p><p className="t-label text-muted">{ts("setsLabel", { n: totals.totalSets })}</p></div>
        <div><p className="stat text-xl neon-text">{totals.volume.toLocaleString(locale)}</p><p className="t-label text-muted">{ts("totalKg")}</p></div>
      </div>

      {editing ? (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} aria-label={t("noteAria")} rows={2} className="field mt-3 w-full px-3 py-2 text-sm" />
      ) : data.note ? (
        <p className="t-body mt-3 text-sm text-muted">{data.note}</p>
      ) : null}
      {editing && (
        <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label={ts("sessionEffort")}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" aria-pressed={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}
              className={`badge min-h-11 justify-center ${rpe === n ? "badge-neon" : ""}`}>{n}</button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {exercises.map((x, ei) => {
          const labels = setLabels(x.sets);
          const group = x.superset != null ? groups[x.superset] : undefined;
          return (
            <div key={ei} className={`glass p-4 ${group ? "border-l-4 border-l-[#c79bff]" : ""}`}>
              {group && <p className="t-label text-[11px] text-[#c79bff]">{ts("supersetLabel", { group })}</p>}
              <Link href={`/training/gym/exercise?id=${encodeURIComponent(exerciseId(x))}&name=${encodeURIComponent(x.name)}`} className="t-title text-ink">{exLabel(x.name)}</Link>
              {x.notes && !editing && <p className="t-body mt-1 text-xs text-muted">{x.notes}</p>}
              {editing ? (
                <div className="mt-3 grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_2.75rem] items-center gap-1.5">
                  {x.sets.map((s, si) => (
                    <SetRow key={si} index={si} label={labels[si]} set={{ ...s, done: false }} effort={s.rir !== undefined && s.rpe === undefined ? "rir" : "rpe"} preview={null}
                      onChange={(p) => patchSet(ei, si, p)}
                      onCycleType={() => patchSet(ei, si, { type: nextSetType(s.type) })}
                      onDone={() => {}}
                      onRemove={() => setDraft((xs) => xs.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) })))} />
                  ))}
                  <button type="button" className="btn btn-tonal btn-sm col-span-5 mt-1 min-h-11"
                    onClick={() => setDraft((xs) => xs.map((e, i) => (i !== ei ? e : { ...e, sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? { kg: "", reps: "" }), done: true, pr: undefined }] })))}>
                    {t("addSet")}
                  </button>
                </div>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {x.sets.map((s, si) => (
                    <li key={si} className="t-body flex justify-between text-sm text-ink">
                      <span className="w-8 text-muted">{s.type && s.type !== "normal" ? ts(`setTypeShort.${s.type}`) : labels[si]}</span>
                      <span className="flex-1">{s.kg ? ts("previewKg", { kg: s.kg, reps: s.reps }) : ts("previewReps", { reps: s.reps })}</span>
                      <span className="text-muted">{s.rpe ? `RPE ${s.rpe}` : s.rir ? `RIR ${s.rir}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {editing && <p className="t-body mt-2 text-[11px] text-muted">{t("editHint")}</p>}

      {error && <p role="alert" className="t-body mt-3 rounded-xl border border-[rgba(255,107,107,0.4)] p-3 text-sm text-[#ff8a8a]">{error}</p>}

      <div className="mt-4 flex gap-3">
        {editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-outline min-h-11 flex-1">{ts("cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={busy} className="btn btn-primary min-h-11 flex-1">{ts("save")}</button>
          </>
        ) : (
          <button type="button" onClick={startEdit} className="btn btn-tonal min-h-11 flex-1">{t("edit")}</button>
        )}
      </div>
      {!editing && (confirmDelete ? (
        <div role="alertdialog" aria-label={t("deleteConfirm")} className="glass mt-3 p-4">
          <p className="t-body text-sm text-ink">{t("deleteConfirm")}</p>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-outline min-h-11 flex-1">{ts("cancel")}</button>
            <button type="button" onClick={() => void remove()} disabled={busy} className="btn btn-primary min-h-11 flex-1">{t("delete")}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} className="t-label mt-3 min-h-11 w-full text-center text-muted">{t("delete")}</button>
      ))}
    </div>
  );
}
