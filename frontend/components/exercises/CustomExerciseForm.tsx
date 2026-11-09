"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  EQUIPMENT,
  MUSCLES,
  ExerciseApiError,
  createCustomExercise,
  updateCustomExercise,
  type CustomExerciseInput,
  type Exercise,
} from "@/lib/exercises";

/**
 * Crear o editar un ejercicio propio (sin límite, como en Hevy Pro): nombre, músculo principal,
 * secundarios, material y notas. Al guardar refresca la lista de la biblioteca.
 */
export function CustomExerciseForm({
  initial,
  editId,
  submitLabel,
  onSaved,
  onCancel,
}: {
  initial?: Partial<CustomExerciseInput>;
  /** Id del ejercicio propio que se edita; sin él, se crea uno nuevo. */
  editId?: number;
  submitLabel?: string;
  onSaved: (ex: Exercise) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("exercises");
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [primary, setPrimary] = useState(initial?.primary_muscles?.[0] ?? "");
  const [secondary, setSecondary] = useState<string[]>(initial?.secondary_muscles ?? []);
  const [equipment, setEquipment] = useState(initial?.equipment?.[0] ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const toggleSecondary = (m: string) =>
    setSecondary((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = t("form.nameRequired");
    if (!primary) local.primary_muscles = t("form.primaryRequired");
    setErrors(local);
    if (Object.keys(local).length) return;
    const body: CustomExerciseInput = {
      name: name.trim(),
      primary_muscles: [primary],
      secondary_muscles: secondary.filter((m) => m !== primary),
      equipment: equipment ? [equipment] : [],
      notes: notes.trim(),
    };
    setSaving(true);
    try {
      const saved = editId !== undefined ? await updateCustomExercise(editId, body) : await createCustomExercise(body);
      await qc.invalidateQueries({ queryKey: ["exercises"] });
      await qc.invalidateQueries({ queryKey: ["exercise", saved.key] });
      onSaved(saved);
    } catch (err) {
      const fields = err instanceof ExerciseApiError ? err.fields : {};
      const mapped = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]]));
      setErrors(Object.keys(mapped).length ? mapped : { form: t("form.error") });
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) =>
    errors[k] ? <p role="alert" className="t-body mt-1 text-xs text-[#ff8a8a]">{errors[k]}</p> : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div>
        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">{t("form.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder={t("form.namePlaceholder")} className="field w-full px-4 py-3 text-base" autoFocus />
        </label>
        {err("name")}
      </div>

      <div>
        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">{t("form.primary")}</span>
          <select value={primary} onChange={(e) => setPrimary(e.target.value)} className="field min-h-11 w-full px-3 py-2 text-base">
            <option value="">—</option>
            {MUSCLES.map((m) => <option key={m} value={m}>{t(`muscles.${m}`)}</option>)}
          </select>
        </label>
        {err("primary_muscles")}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="t-label mb-1 text-muted">{t("form.secondary")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {MUSCLES.filter((m) => m !== primary).map((m) => {
            const on = secondary.includes(m);
            return (
              <button key={m} type="button" onClick={() => toggleSecondary(m)} aria-pressed={on}
                className={`badge min-h-9 ${on ? "badge-neon" : ""}`}>
                {t(`muscles.${m}`)}
              </button>
            );
          })}
        </div>
        {err("secondary_muscles")}
      </fieldset>

      <div>
        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">{t("form.equipment")}</span>
          <select value={equipment} onChange={(e) => setEquipment(e.target.value)} className="field min-h-11 w-full px-3 py-2 text-base">
            <option value="">—</option>
            {EQUIPMENT.map((q) => <option key={q} value={q}>{t(`equipment.${q}`)}</option>)}
          </select>
        </label>
        {err("equipment")}
      </div>

      <div>
        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">{t("form.notes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3}
            placeholder={t("form.notesPlaceholder")} className="field w-full px-4 py-3 text-base" />
        </label>
        {err("notes")}
      </div>

      {err("form")}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="btn btn-outline min-h-11 flex-1">{t("form.cancel")}</button>
        <button type="submit" disabled={saving} className="btn btn-primary min-h-11 flex-1">
          {saving ? t("form.saving") : (submitLabel ?? t("form.save"))}
        </button>
      </div>
    </form>
  );
}
