"use client";

import { useTranslations } from "next-intl";
import type { SetEntry } from "@/lib/gym";
import { sanitizeDecimal, sanitizeInt, setIssue, type RecordKind } from "@/lib/gym-log";

/** Una fila de serie del gimnasio (F17): tipo (toca para cambiarlo), kg, reps, RPE o RIR y ✓.
    Debajo, «anterior» para copiarla, el aviso si un valor es imposible o raro (F2) y los récords. */
export function SetRow({
  index, label, set, effort, preview, onChange, onCycleType, onDone, onUsePreview, records,
}: {
  index: number;
  label: string; // número entre las normales o el tipo (warmup, drop, failure)
  set: SetEntry;
  effort: "rpe" | "rir";
  preview: string | null;
  onChange: (patch: Partial<SetEntry>) => void;
  onCycleType: () => void;
  onDone: () => void;
  onUsePreview?: () => void;
  records?: RecordKind[];
}) {
  const t = useTranslations("training.gymSession");
  const n = index + 1;
  const issue = setIssue(set);
  const type = set.type ?? "normal";
  const inputCls = `field min-h-11 w-full min-w-0 px-1 py-2 text-center text-base ${set.done ? "opacity-60" : ""} ${issue?.level === "error" ? "border-[#ff6b6b]" : ""}`;
  const typeCls =
    type === "warmup" ? "text-[#ffd08a]" : type === "drop" ? "text-[#c79bff]" : type === "failure" ? "text-[#ff8a8a]" : "text-muted";
  const select = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select();
  const blocked = !set.done && issue?.level === "error";
  return (
    <>
      <button type="button" onClick={onCycleType} data-testid="set-type"
        aria-label={t("setTypeAria", { n, type: t(`setTypes.${type}`) })}
        className={`t-label flex h-11 w-full items-center justify-center rounded-lg text-sm ${typeCls}`}>
        {type === "normal" ? label : t(`setTypeShort.${type}`)}
      </button>
      <input value={set.kg} onChange={(e) => onChange({ kg: sanitizeDecimal(e.target.value) })} onFocus={select}
        inputMode="decimal" placeholder="—" aria-label={t("weightAria", { n })} aria-invalid={issue?.level === "error" || undefined}
        className={inputCls} />
      <input value={set.reps} onChange={(e) => onChange({ reps: sanitizeInt(e.target.value) })} onFocus={select}
        inputMode="numeric" placeholder="—" aria-label={t("repsAria", { n })} className={inputCls} />
      <input value={(effort === "rpe" ? set.rpe : set.rir) ?? ""} onFocus={select}
        onChange={(e) => onChange(effort === "rpe" ? { rpe: sanitizeDecimal(e.target.value).slice(0, 4) } : { rir: sanitizeDecimal(e.target.value).slice(0, 4) })}
        inputMode="decimal" placeholder="—" aria-label={t(effort === "rpe" ? "rpeAria" : "rirAria", { n })} className={inputCls} />
      <button type="button" onClick={onDone} aria-label={t("setDone", { n })} aria-pressed={set.done} disabled={blocked}
        className="flex h-11 w-11 items-center justify-center rounded-full border text-sm transition-colors disabled:opacity-40"
        style={set.done
          ? { background: "#43e8a0", borderColor: "transparent", color: "#03101c" }
          : { borderColor: "rgba(150,190,255,0.25)", color: "var(--color-muted)" }}>
        ✓
      </button>
      {issue && (
        <p role={issue.level === "error" ? "alert" : "status"} data-testid="set-issue"
          className={`t-body col-span-5 -mt-1 text-[11px] ${issue.level === "error" ? "text-[#ff8a8a]" : "text-[#ffd08a]"}`}>
          {t(`issues.${issue.code}`)}
        </p>
      )}
      {records && records.length > 0 && (
        <p data-testid="set-records" className="t-body col-span-5 -mt-1 flex flex-wrap gap-1 text-[11px]">
          {records.map((r) => (
            <span key={r} className="badge badge-neon">{t(`records.${r}`)}</span>
          ))}
        </p>
      )}
      {preview && !set.done && (
        <button type="button" onClick={onUsePreview} className="col-span-5 -mt-1 flex min-h-11 items-center text-left"
          aria-label={t("previousAria", { preview })}>
          <span className="t-body text-[11px] text-muted hover:text-neon">{t("previous", { preview })}</span>
        </button>
      )}
    </>
  );
}
