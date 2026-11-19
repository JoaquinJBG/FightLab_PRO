"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { TrainingIcon } from "@/components/icons";
import { EngineLine } from "@/components/evidence/EngineLine";
import { IMPORTERS, ImportError, MAX_IMPORT_MB, useImportSets, type ImportResult, type ImporterChoice } from "@/lib/gym-import";

// Valores por defecto de los parámetros de los errores (un mensaje del motor puede no traerlos).
const ERROR_DEFAULTS = { line: "?", column: "?", value: "?", columns: "?", mb: MAX_IMPORT_MB, max: "?" };

function Summary({ result }: { result: ImportResult }) {
  const t = useTranslations("gymImport");
  const locale = intlLocale(useLocale());
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const nothing = result.sets.imported === 0;
  return (
    <section data-testid="import-summary" data-dry-run={result.dry_run} className="glass neon-edge mt-4 p-4">
      <p className="t-eyebrow text-neon">{result.dry_run ? t("preview") : t("done")}</p>
      <p className="t-body mt-1 text-[11px] text-muted">{t("summary.importer", { name: t(`formats.${result.importer}`) })}</p>
      {nothing ? (
        <p data-testid="import-nothing-new" className="t-body mt-2 text-sm text-ink">{t("summary.nothingNew")}</p>
      ) : (
        <>
          <p data-testid="import-sets" className="stat mt-2 text-2xl neon-text">{t("summary.sets", { n: result.sets.imported })}</p>
          <p className="t-body mt-1 text-xs text-ink">
            {t("summary.sessionsNew", { n: result.sessions.new })}
            {result.sessions.updated > 0 && ` · ${t("summary.sessionsUpdated", { n: result.sessions.updated })}`}
          </p>
          {result.range && (
            <p className="t-body mt-1 text-xs text-muted">{t("summary.range", { first: day(result.range.first), last: day(result.range.last) })}</p>
          )}
        </>
      )}
      {result.sets.duplicates > 0 && (
        <p data-testid="import-duplicates" className="t-body mt-1 text-xs text-muted">{t("summary.duplicates", { n: result.sets.duplicates })}</p>
      )}
      {result.routines && (
        <p data-testid="import-routines" className="t-body mt-1 text-xs text-ink">
          {t(result.dry_run ? "summary.routinesPreview" : "summary.routines", { n: result.routines.new })}
          {result.routines.existing > 0 && ` · ${t("summary.routinesExisting", { n: result.routines.existing })}`}
          {result.routines.unavailable > 0 && ` · ${t("summary.routinesUnavailable", { n: result.routines.unavailable })}`}
          {!result.dry_run && result.routines.new > 0 && (
            <> · <Link href="/training/routines" className="text-neon">{t("summary.routinesLink")}</Link></>
          )}
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          {result.warnings.map((w) => (
            <li key={w.code} data-testid="import-warning" data-code={w.code} className="t-body text-xs text-[#ffd25a]">
              {t(`warnings.${w.code}`, { n: w.count })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function GymImportPage() {
  const t = useTranslations("gymImport");
  const [importer, setImporter] = useState<ImporterChoice>("auto");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const mutation = useImportSets();

  function run(dryRun: boolean) {
    if (!file) return;
    setResult(null);
    mutation.mutate({ file, importer, dryRun }, { onSuccess: setResult });
  }

  const error = mutation.error instanceof ImportError ? mutation.error : mutation.error ? new ImportError("server") : null;

  return (
    <div className="pt-4 pb-24">
      <Link href="/training/gym" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>
      <p className="t-body mt-1 text-sm text-muted">{t("subtitle")}</p>

      <div className="glass mt-4 p-4">
        <p className="t-label text-ink">{t("format")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {IMPORTERS.map((i) => (
            <button key={i} type="button" onClick={() => { setImporter(i); setResult(null); mutation.reset(); }}
              aria-pressed={importer === i} className={`badge ${importer === i ? "badge-neon" : ""}`}>
              {t(`formats.${i}`)}
            </button>
          ))}
        </div>
        <ul className="t-body mt-3 flex flex-col gap-1.5 text-[11px] text-muted">
          <li>{t("help.hevy")}</li>
          <li>{t("help.generic")}</li>
          <li>{t("help.lyfta")}</li>
        </ul>
      </div>

      <label className="glass mt-3 flex flex-col gap-2 p-4">
        <span className="t-label text-ink">{t("file", { mb: MAX_IMPORT_MB })}</span>
        <input data-testid="import-file" type="file" accept=".csv,text/csv"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); mutation.reset(); }}
          className="t-body text-xs text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[rgba(69,233,255,0.12)] file:px-3 file:py-1.5 file:text-neon" />
        {file && <span className="t-body text-[11px] text-muted">{t("chosen", { name: file.name })}</span>}
      </label>

      <div className="mt-3 flex gap-3">
        <button type="button" onClick={() => run(true)} disabled={!file || mutation.isPending} className="btn btn-outline flex-1 disabled:opacity-60">
          {mutation.isPending && mutation.variables?.dryRun ? t("reading") : t("check")}
        </button>
        <button type="button" onClick={() => run(false)} disabled={!file || mutation.isPending} className="btn btn-primary flex-1 disabled:opacity-60">
          {mutation.isPending && !mutation.variables?.dryRun ? t("reading") : t("import")}
        </button>
      </div>

      {error && (
        <p data-testid="import-error" data-code={error.code} role="alert" className="t-body mt-3 rounded-xl border border-[#ff5a6e] p-3 text-sm text-ink">
          {t(`errors.${error.code}`, { ...ERROR_DEFAULTS, ...error.params })}
        </p>
      )}
      {result && <Summary result={result} />}

      <p className="t-body mt-4 text-[11px] text-muted">{t("noLoad")}</p>
      <EngineLine />
    </div>
  );
}
