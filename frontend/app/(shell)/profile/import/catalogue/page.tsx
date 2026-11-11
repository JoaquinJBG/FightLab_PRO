"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { RatingBadge } from "@/components/catalogue/RatingBadge";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { intlLocale } from "@/lib/locale";
import {
  CATALOGUE_ACCEPT, CatalogueError, DEFAULT_CHAIN, MAX_FILE_MB, RATINGS, RATING_KEY,
  useChainCatalogue, useDeleteCatalogue, useImportCatalogue, useSubstitutes,
  type Catalogue, type ImportResult, type RatingValue,
} from "@/lib/chain-catalogue";

const ERROR_DEFAULTS = { mb: MAX_FILE_MB, max: "?", columns: "?" };
const LINES_SHOWN = 5;

function useMoney() {
  const locale = intlLocale(useLocale());
  return (value: number) => value.toLocaleString(locale, { style: "currency", currency: "EUR" });
}

function errorText(t: ReturnType<typeof useTranslations>, error: CatalogueError) {
  return t.has(`errors.${error.code}`) ? t(`errors.${error.code}`, { ...ERROR_DEFAULTS, ...error.params }) : t("errors.server");
}

function RatingCounts({ counts }: { counts: Record<string, number> }) {
  const t = useTranslations("chainCatalogue");
  const shown = RATINGS.filter((r) => (counts[r] ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="t-body mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink">
      {shown.map((r) => (
        <li key={r} data-testid="catalogue-rating-count" data-rating={r}>
          {t(`counts.${RATING_KEY[r]}`, { n: counts[r] })}
        </li>
      ))}
    </ul>
  );
}

function Summary({ result }: { result: ImportResult }) {
  const t = useTranslations("chainCatalogue");
  const rating = (value: string) => (RATINGS as readonly string[]).includes(value) ? t(`rating.${RATING_KEY[value as RatingValue]}`) : value;
  return (
    <section data-testid="catalogue-summary" data-dry-run={result.dry_run} className="glass neon-edge mt-4 p-4">
      <p className="t-eyebrow text-neon">{result.dry_run ? t("preview") : t("done")}</p>
      <p className="t-body mt-1 text-[11px] text-muted">
        {t(`formats.${result.format}`)} · {t("rowsRead", { n: result.rows, chain: result.chain })}
      </p>
      <ul className="t-body mt-2 flex flex-col gap-0.5 text-sm text-ink">
        <li data-testid="catalogue-new">{result.dry_run ? t("summary.toAdd", { n: result.new }) : t("summary.added", { n: result.new })}</li>
        <li data-testid="catalogue-updated">{result.dry_run ? t("summary.toUpdate", { n: result.updated }) : t("summary.updatedDone", { n: result.updated })}</li>
        {result.unchanged > 0 && <li data-testid="catalogue-unchanged" className="text-muted">{t("summary.unchanged", { n: result.unchanged })}</li>}
        <li data-testid="catalogue-discarded-total" className={result.discarded_total > 0 ? "text-warn" : "text-muted"}>
          {t("summary.discarded", { n: result.discarded_total })}
        </li>
      </ul>

      {result.discarded.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-2">
          {result.discarded.map((d) => (
            <li key={`${d.code}-${d.field}`} data-testid="catalogue-discarded" data-code={d.code} className="t-body text-xs text-warn">
              {t.has(`discarded.${d.code}`) ? t(`discarded.${d.code}`, { n: d.count, field: d.field }) : t("discarded.generic", { n: d.count })}
              <span className="text-muted"> ({t("discarded.lines", { lines: d.lines.slice(0, LINES_SHOWN).join(", ") })})</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
        <p className="t-label flex flex-wrap items-center gap-2 text-ink">
          {t("ratingsTitle")}
          <EvidenceChip ruleKey={result.rule_key} grade={result.rule_grades[result.rule_key] ?? null} />
        </p>
        <RatingCounts counts={result.ratings} />
        {result.review > 0 && <p data-testid="catalogue-review" className="t-body mt-1 text-xs text-warn">{t("reviewCount", { n: result.review })}</p>}
      </div>

      {result.differences.count > 0 && (
        <div data-testid="catalogue-differences" className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          <p className="t-label text-ink">{t("differences.title", { n: result.differences.count })}</p>
          <p className="t-body text-[11px] text-muted">{t("differences.intro")}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {result.differences.examples.map((d) => (
              <li key={d.line} data-testid="catalogue-difference" className="t-body text-xs text-ink">
                {t("differences.line", { name: d.name, file: rating(d.file), engine: rating(d.engine) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.notices.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-2.5">
          {result.notices.filter((n) => t.has(`notices.${n.code}`)).map((n) => (
            <li key={n.code} data-testid="catalogue-notice" data-code={n.code} className="t-body text-[11px] text-muted">
              {t(`notices.${n.code}`, { n: n.count })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Thresholds({ data }: { data: Catalogue }) {
  const t = useTranslations("chainCatalogue.how");
  const tl = useTranslations("chainCatalogue");
  const highs = data.thresholds.filter((x) => x.key.endsWith(".high"));
  const value = (k: string) => highs.find((x) => x.key === k)?.value ?? "?";
  const others = data.thresholds.filter((x) => !x.key.endsWith(".high") && !x.key.endsWith(".low"));
  return (
    <details data-testid="catalogue-how" className="glass mt-3 p-4">
      <summary className="t-label cursor-pointer text-ink">{t("title")}</summary>
      <ul className="t-body mt-2 flex flex-col gap-1.5 text-xs text-muted">
        <li data-testid="threshold-food">
          {t("food", { sugars: value("food.sugars.high"), saturates: value("food.saturates.high"), salt: value("food.salt.high") })}
          {" "}<span className="text-neon">{t("source.fsa_2016")}</span>
        </li>
        <li data-testid="threshold-drink">
          {t("drink", { sugars: value("drink.sugars.high"), saturates: value("drink.saturates.high"), salt: value("drink.salt.high") })}
          {" "}<span className="text-neon">{t("source.fsa_2016")}</span>
        </li>
        {others.map((x) => (
          <li key={x.key} data-testid="threshold" data-source={x.source}>
            {t.has(`items.${x.key.replace(/\./g, "_")}`) ? t(`items.${x.key.replace(/\./g, "_")}`) : x.key}
            {" "}<span className={x.source === "convention" ? "text-muted" : "text-neon"}>{t(`source.${x.source}`)}</span>
          </li>
        ))}
      </ul>
      <p className="t-body mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {tl("rulesLink")}
        <EvidenceChip ruleKey={data.rule_key} grade={data.rule_grades[data.rule_key] ?? null} />
        <EvidenceChip ruleKey={data.energy_rule_key} grade={data.rule_grades[data.energy_rule_key] ?? null} />
      </p>
    </details>
  );
}

function CatalogueList() {
  const t = useTranslations("chainCatalogue");
  const money = useMoney();
  const [query, setQuery] = useState("");
  const [rating, setRating] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { data, isLoading, isError } = useChainCatalogue(query, rating);
  const remove = useDeleteCatalogue();

  if (isLoading && !data) return <p className="t-body mt-4 text-sm text-muted">{t("loading")}</p>;
  if (isError || !data) return <p className="t-body mt-4 text-sm text-bad">{t("errors.server")}</p>;

  return (
    <section data-testid="catalogue-list" className="mt-6">
      <h2 className="t-display text-lg text-ink">{t("list.title")}</h2>
      {data.total === 0 ? (
        <p data-testid="catalogue-empty" className="t-body mt-1 text-sm text-muted">{t("list.empty")}</p>
      ) : (
        <>
          <p data-testid="catalogue-total" className="t-body mt-1 text-sm text-ink">{t("list.total", { n: data.total, chains: data.chains.join(", ") })}</p>
          <RatingCounts counts={data.ratings} />
          {data.review > 0 && <p className="t-body mt-1 text-xs text-warn">{t("reviewCount", { n: data.review })}</p>}
          <div className="mt-3 flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("list.search")} aria-label={t("list.search")}
              data-testid="catalogue-search" className="field min-w-0 flex-1 px-3 py-2 text-sm" />
            <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label={t("list.filter")} data-testid="catalogue-filter"
              className="field shrink-0 px-2 py-2 text-sm">
              <option value="">{t("list.all")}</option>
              {RATINGS.map((r) => <option key={r} value={r}>{t(`rating.${RATING_KEY[r]}`)}</option>)}
            </select>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {data.products.map((p) => (
              <li key={p.id} data-testid="catalogue-item" className="glass p-3">
                <p className="t-body text-sm text-ink">{p.name}</p>
                <p className="t-body text-[11px] text-muted">
                  {[p.brand, p.pack, p.price_per_kg != null ? t("list.pricePerKg", { price: money(p.price_per_kg), unit: p.per === "100 ml" ? "l" : "kg" }) : null,
                    p.kcal != null ? t("list.kcal", { kcal: Math.round(p.kcal), per: p.per }) : null].filter(Boolean).join(" · ")}
                </p>
                {p.equivalent_of && <p className="t-body text-[11px] text-muted">{t("list.equivalent", { food: p.equivalent_of })}</p>}
                <div className="mt-1.5"><RatingBadge rating={p.rating} check={p.check} ruleKey={p.rule_key} grades={data.rule_grades} bare /></div>
              </li>
            ))}
          </ul>
          {data.matched > data.products.length && <p className="t-body mt-2 text-[11px] text-muted">{t("list.more", { n: data.matched - data.products.length })}</p>}
          {!confirm ? (
            <button type="button" data-testid="catalogue-delete" onClick={() => setConfirm(true)} className="btn btn-outline mt-4 w-full">
              {t("list.delete")}
            </button>
          ) : (
            <div data-testid="catalogue-delete-confirm" className="glass mt-4 p-3">
              <p className="t-body text-sm text-ink">{t("list.deleteConfirm", { n: data.total })}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setConfirm(false)} className="btn btn-outline flex-1">{t("list.cancel")}</button>
                <button type="button" data-testid="catalogue-delete-yes" disabled={remove.isPending}
                  onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirm(false) })}
                  className="btn btn-primary flex-1 disabled:opacity-60">{t("list.deleteYes")}</button>
              </div>
            </div>
          )}
          <Thresholds data={data} />
        </>
      )}
    </section>
  );
}

function SubstitutesCard() {
  const t = useTranslations("chainCatalogue.substitutes");
  const [food, setFood] = useState("");
  const [grams, setGrams] = useState("100");
  const subs = useSubstitutes();
  const g = Number(grams);
  return (
    <section data-testid="substitutes-card" className="glass mt-4 p-4">
      <p className="t-label text-ink">{t("title")}</p>
      <p className="t-body mt-1 text-[11px] text-muted">{t("intro")}</p>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (food.trim() && g > 0) subs.mutate({ food: food.trim(), grams: g }); }}>
        <input value={food} onChange={(e) => setFood(e.target.value)} placeholder={t("food")} aria-label={t("food")}
          data-testid="substitutes-food" className="field min-w-0 flex-1 px-3 py-2 text-sm" />
        <input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" aria-label={t("grams")}
          data-testid="substitutes-grams" className="field w-16 shrink-0 px-2 py-2 text-sm" />
        <button type="submit" disabled={!food.trim() || !(g > 0) || subs.isPending} className="btn btn-tonal btn-sm shrink-0 disabled:opacity-60">{t("go")}</button>
      </form>
      {subs.data === null && <p data-testid="substitutes-unknown" className="t-body mt-2 text-xs text-warn">{t("unknown")}</p>}
      {subs.isError && <p className="t-body mt-2 text-xs text-bad">{t("error")}</p>}
      {subs.data && (
        <div data-testid="substitutes-result" className="mt-3">
          <p className="t-body text-xs text-muted">{t("for", { name: subs.data.food.name, grams: subs.data.food.grams, kcal: subs.data.food.kcal })}</p>
          {subs.data.substitutes.length === 0 && <p className="t-body mt-1 text-xs text-muted">{t("none")}</p>}
          <ul className="mt-1 flex flex-col gap-1.5">
            {subs.data.substitutes.map((s, i) => (
              <li key={`${s.name}-${i}`} data-testid="substitute" data-penalised={s.penalised} className="t-body text-sm text-ink">
                {t("line", { grams: s.grams, name: s.name, kcal: s.kcal, protein: s.protein_g })}
                {s.chain && <span className="text-[11px] text-muted"> · {s.chain}{s.pack ? ` · ${s.pack}` : ""}</span>}
                {s.rating && <span className="ml-1.5"><RatingBadge rating={s.rating} check={s.check} bare /></span>}
              </li>
            ))}
          </ul>
          <p className="t-body mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {t("penaltyNote")}
            <EvidenceChip />
          </p>
        </div>
      )}
    </section>
  );
}

export default function CatalogueImportPage() {
  const t = useTranslations("chainCatalogue");
  const [file, setFile] = useState<File | null>(null);
  const [chain, setChain] = useState(DEFAULT_CHAIN);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const mutation = useImportCatalogue();
  const busy = mutation.isPending;
  const error = mutation.error instanceof CatalogueError ? mutation.error : mutation.error ? new CatalogueError("server") : null;

  function check() {
    setPreview(null);
    setResult(null);
    mutation.mutate({ file, dryRun: true, chain }, { onSuccess: setPreview });
  }

  function run() {
    if (!preview) return;
    mutation.mutate({ file, dryRun: false, chain }, { onSuccess: (r) => { setResult(r); setPreview(null); } });
  }

  return (
    <div className="pt-4 pb-24">
      <Link href="/profile/import" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("subtitle")}</p>

      <div className="glass mt-4 p-4">
        <p className="t-label text-ink">{t("help.title")}</p>
        <ul className="t-body mt-2 flex flex-col gap-1.5 text-[11px] text-muted">
          <li>{t("help.scored")}</li>
          <li>{t("help.table")}</li>
          <li>{t("help.reimport")}</li>
          <li data-testid="catalogue-privacy">{t("help.private")}</li>
        </ul>
      </div>

      <label className="glass mt-3 flex flex-col gap-2 p-4">
        <span className="t-label text-ink">{t("chain")}</span>
        <input value={chain} onChange={(e) => { setChain(e.target.value); setPreview(null); }} maxLength={80}
          data-testid="catalogue-chain" className="field px-3 py-2 text-sm" />
      </label>
      <label className="glass mt-3 flex flex-col gap-2 p-4">
        <span className="t-label text-ink">{t("file", { mb: MAX_FILE_MB })}</span>
        <input data-testid="catalogue-file" type="file" accept={CATALOGUE_ACCEPT}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); mutation.reset(); }}
          className="t-body text-xs text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[rgba(69,233,255,0.12)] file:px-3 file:py-1.5 file:text-neon" />
      </label>

      <button type="button" data-testid="catalogue-check" onClick={check} disabled={!file || busy} className="btn btn-outline mt-3 w-full disabled:opacity-60">
        {busy && mutation.variables?.dryRun ? t("reading") : t("check")}
      </button>

      {error && (
        <p data-testid="catalogue-error" data-code={error.code} role="alert" className="t-body mt-3 rounded-xl border border-bad p-3 text-sm text-ink">
          {errorText(t, error)}
        </p>
      )}

      {preview && (
        <>
          <Summary result={preview} />
          <button type="button" data-testid="catalogue-import" onClick={run} disabled={busy || preview.new + preview.updated === 0}
            className="btn btn-primary mt-3 w-full disabled:opacity-60">
            {busy ? t("importing") : t("import")}
          </button>
        </>
      )}
      {!preview && !result && file && !error && <p className="t-body mt-2 text-[11px] text-muted">{t("checkFirst")}</p>}
      {result && <Summary result={result} />}

      <CatalogueList />
      <SubstitutesCard />
    </div>
  );
}
