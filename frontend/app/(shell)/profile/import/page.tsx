"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import {
  CONFLICT_MODES, HISTORY_ACCEPT, HistoryImportError, MAX_FILE_MB, MAX_HISTORY_FILES, useImportHistory,
  type ConflictMode, type HistoryResult,
} from "@/lib/history-import";

// Parámetros por defecto de los textos de error (el servidor puede no mandarlos).
const ERROR_DEFAULTS = { max: "?", mb: MAX_FILE_MB, line: "?", column: "?", value: "?", columns: "?", format: "?" };
const CONFLICTS_SHOWN = 8;

function useLabels() {
  const t = useTranslations("historyImport");
  const locale = intlLocale(useLocale());
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const field = (name: string) => (t.has(`fields.${name}`) ? t(`fields.${name}`) : name);
  return { t, day, field };
}

function FileErrors({ result }: { result: HistoryResult }) {
  const { t } = useLabels();
  const tg = useTranslations("gymImport");
  const failed = [
    ...result.files.filter((f) => f.error).map((f) => ({ name: f.name, error: f.error! })),
    ...result.sets.filter((s) => s.error).map((s) => ({ name: s.name, error: s.error! })),
  ];
  if (failed.length === 0) return null;
  // Los errores de los CSV de gimnasio son los de la fase 9: se reutilizan sus textos.
  const text = (code: string, params: Record<string, string | number>) => {
    const values = { ...ERROR_DEFAULTS, ...params };
    if (t.has(`fileErrors.${code}`)) return t(`fileErrors.${code}`, values);
    if (tg.has(`errors.${code}`)) return tg(`errors.${code}`, values);
    return t("fileErrors.generic");
  };
  return (
    <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
      <p className="t-label text-ink">{t("fileErrors.title")}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {failed.map((f, i) => (
          <li key={`${f.name}-${i}`} data-testid="history-file-error" data-code={f.error.code} className="t-body text-xs text-bad">
            {f.name}: {text(f.error.code, f.error.params)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ result }: { result: HistoryResult }) {
  const { t, day, field } = useLabels();
  const d = result.days;
  const items = Object.entries(result.items).filter(([, n]) => n > 0);
  const reviewLines = (["new", "conflict", "unchanged", "kept_app"] as const).filter((k) => result.reviews[k] > 0);
  const sets = result.sets.filter((s) => s.result);
  const nothing = d.written === 0 && d.conflict === 0 && result.reviews.written === 0 && result.reviews.conflict === 0 && sets.every((s) => s.result!.sets.imported === 0);
  const read = result.files.filter((f) => f.kind);
  return (
    <section data-testid="history-summary" data-dry-run={result.dry_run} className="glass neon-edge mt-4 p-4">
      <p className="t-eyebrow text-neon">{result.dry_run ? t("preview") : t("done")}</p>
      {read.length > 0 && (
        <ul className="t-body mt-1 flex flex-col gap-0.5 text-[11px] text-muted">
          {read.map((f, i) => (
            <li key={`${f.name}-${i}`} data-testid="history-file" data-kind={f.kind}>
              {f.name}: {t(`kinds.${f.kind}`)}
              {f.days > 0 && ` · ${t("fileDays", { n: f.days })}`}
            </li>
          ))}
        </ul>
      )}

      {nothing ? (
        <p data-testid="history-nothing" className="t-body mt-2 text-sm text-ink">{t("nothing")}</p>
      ) : (
        <p data-testid="history-written" className="stat mt-2 text-2xl neon-text">
          {result.dry_run ? t("summary.toWrite", { n: d.written }) : t("summary.written", { n: d.written })}
        </p>
      )}
      {result.range && <p className="t-body mt-1 text-xs text-muted">{t("summary.range", { first: day(result.range.first), last: day(result.range.last) })}</p>}
      <ul className="t-body mt-2 flex flex-col gap-0.5 text-xs text-ink">
        {(["new", "filled", "conflict", "unchanged"] as const).filter((k) => d[k] > 0).map((k) => (
          <li key={k} data-testid={`history-days-${k}`}>{t(`summary.${k}`, { n: d[k] })}</li>
        ))}
      </ul>

      {items.length > 0 && (
        <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          <p className="t-label text-ink">{t("items.title")}</p>
          <ul className="t-body mt-1 flex flex-col gap-0.5 text-xs text-muted">
            {items.map(([k, n]) => <li key={k} data-testid="history-item" data-item={k}>{t(`items.${k}`, { n })}</li>)}
          </ul>
        </div>
      )}
      {(reviewLines.length > 0 || sets.length > 0) && (
        <ul className="t-body mt-2 flex flex-col gap-0.5 text-xs text-muted">
          {reviewLines.map((k) => <li key={k} data-testid={`history-reviews-${k}`}>{t(`reviews.${k}`, { n: result.reviews[k] })}</li>)}
          {sets.map((s, i) => (
            <li key={`${s.name}-${i}`} data-testid="history-sets">
              {t("sets.line", { name: s.name, n: s.result!.sets.imported })}
              {s.result!.sets.duplicates > 0 && ` · ${t("sets.duplicates", { n: s.result!.sets.duplicates })}`}
            </li>
          ))}
        </ul>
      )}

      {result.weight_blocked.count > 0 && (
        <p data-testid="history-blocked" className="t-body mt-3 rounded-xl border border-[rgba(255,210,90,0.4)] p-2.5 text-xs text-ink">
          {t("blocked", { n: result.weight_blocked.count })}
        </p>
      )}

      {result.discarded.length > 0 && (
        <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          <p className="t-label text-ink">{t("discarded.title")}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {result.discarded.map((x) => (
              <li key={`${x.code}-${x.field}`} data-testid="history-discarded" data-code={x.code} data-field={x.field} className="t-body text-xs text-[#ffd25a]">
                {t.has(`discarded.${x.code}`)
                  ? t(`discarded.${x.code}`, { n: x.count, field: field(x.field) })
                  : t("discarded.generic", { n: x.count, field: field(x.field) })}
                {x.examples.length > 0 && <span className="text-muted"> ({t("discarded.examples", { dates: x.examples.join(", ") })})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.notices.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          {result.notices.filter((n) => t.has(`notices.${n.code}`)).map((n) => (
            <li key={n.code} data-testid="history-notice" data-code={n.code} className="t-body text-[11px] text-muted">
              {t(`notices.${n.code}`, { n: n.count })}
            </li>
          ))}
        </ul>
      )}
      <FileErrors result={result} />
    </section>
  );
}

function Conflicts({ result, mode, onMode }: { result: HistoryResult; mode: ConflictMode; onMode: (m: ConflictMode) => void }) {
  const { t, day, field } = useLabels();
  const shown = result.conflicts.slice(0, CONFLICTS_SHOWN);
  const more = result.days.conflict - shown.length;
  return (
    <fieldset data-testid="history-conflicts" className="glass mt-3 p-4">
      <legend className="t-label px-1 text-ink">{t("conflicts.title")}</legend>
      <p className="t-body text-xs text-muted">{t("conflicts.intro")}</p>
      <ul className="t-body mt-2 flex flex-col gap-0.5 text-xs text-ink">
        {shown.map((c) => (
          <li key={c.date} data-testid="history-conflict" data-date={c.date}>
            {day(c.date)}: {c.fields.map(field).join(", ")}
          </li>
        ))}
        {more > 0 && <li className="text-muted">{t("conflicts.more", { n: more })}</li>}
      </ul>
      <div className="mt-3 flex flex-col gap-2">
        {CONFLICT_MODES.map((m) => (
          <label key={m} className="t-body flex items-start gap-2 text-sm text-ink">
            <input type="radio" name="on-conflict" value={m} data-testid={`history-mode-${m}`} checked={mode === m} onChange={() => onMode(m)} className="mt-1" />
            <span>
              {t(`conflicts.${m}`)}
              <span className="block text-[11px] text-muted">{t(`conflicts.${m}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function HistoryImportPage() {
  const t = useTranslations("historyImport");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<ConflictMode>("keep");
  const [preview, setPreview] = useState<HistoryResult | null>(null);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const mutation = useImportHistory();

  function check() {
    setPreview(null);
    setResult(null);
    mutation.mutate({ files, dryRun: true, onConflict: mode }, { onSuccess: setPreview });
  }

  function run() {
    if (!preview) return;
    mutation.mutate({ files, dryRun: false, onConflict: mode }, { onSuccess: (r) => { setResult(r); setPreview(null); } });
  }

  const error = mutation.error instanceof HistoryImportError ? mutation.error : mutation.error ? new HistoryImportError("server") : null;
  const busy = mutation.isPending;

  return (
    <div className="pt-4 pb-24">
      <Link href="/profile" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("subtitle")}</p>

      <div className="glass mt-4 p-4">
        <p className="t-label text-ink">{t("help.title")}</p>
        <ul className="t-body mt-2 flex flex-col gap-1.5 text-[11px] text-muted">
          <li>{t("help.backup")}</li>
          <li>{t("help.weekly")}</li>
          <li>{t("help.coach")}</li>
          <li>{t("help.later")}</li>
        </ul>
      </div>

      <label className="glass mt-3 flex flex-col gap-2 p-4">
        <span className="t-label text-ink">{t("files", { max: MAX_HISTORY_FILES, mb: MAX_FILE_MB })}</span>
        <input data-testid="history-files" type="file" multiple accept={HISTORY_ACCEPT}
          onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setPreview(null); setResult(null); mutation.reset(); }}
          className="t-body text-xs text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[rgba(69,233,255,0.12)] file:px-3 file:py-1.5 file:text-neon" />
        {files.length > 0 && <span data-testid="history-chosen" className="t-body text-[11px] text-muted">{t("chosen", { n: files.length })}</span>}
      </label>

      <button type="button" onClick={check} disabled={files.length === 0 || busy} className="btn btn-outline mt-3 w-full disabled:opacity-60">
        {busy && mutation.variables?.dryRun ? t("reading") : t("check")}
      </button>

      {error && (
        <p data-testid="history-error" data-code={error.code} role="alert" className="t-body mt-3 rounded-xl border border-[#ff5a6e] p-3 text-sm text-ink">
          {t.has(`errors.${error.code}`) ? t(`errors.${error.code}`, { ...ERROR_DEFAULTS, ...error.params }) : t("errors.server")}
        </p>
      )}

      {preview && (
        <>
          <Summary result={preview} />
          {preview.days.conflict > 0 && <Conflicts result={preview} mode={mode} onMode={setMode} />}
          <button type="button" data-testid="history-import" onClick={run} disabled={busy} className="btn btn-primary mt-3 w-full disabled:opacity-60">
            {busy ? t("importing") : t("import")}
          </button>
        </>
      )}
      {!preview && !result && files.length > 0 && !error && <p className="t-body mt-2 text-[11px] text-muted">{t("checkFirst")}</p>}
      {result && <Summary result={result} />}
    </div>
  );
}
