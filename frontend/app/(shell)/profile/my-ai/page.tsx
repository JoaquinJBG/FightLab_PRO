"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import {
  skillApiUrl,
  useCreateMenuToken,
  useMenuTokens,
  useRevokeMenuToken,
  type CreatedToken,
} from "@/lib/menu-ai";

// Instrucciones de instalación de la skill, en el repositorio (público).
const DOCS_URL = "https://github.com/JoaquinJBG/FightLab_PRO/blob/main/docs/menus-con-tu-ia.md";

const noop = () => () => {};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Perfil → Mi IA (fase 14, vía B): tokens personales para la skill de Claude Code del PC. El token
 * se ve una sola vez, al crearlo; luego solo su principio. Revocarlo lo deja inservible al momento. */
export default function MyAiPage() {
  const t = useTranslations("myAi");
  const locale = intlLocale(useLocale());
  const tokens = useMenuTokens();
  const create = useCreateMenuToken();
  const revoke = useRevokeMenuToken();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState<"token" | "url" | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const apiUrl = origin ? skillApiUrl(origin) : "";
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const full = tokens.data ? tokens.data.tokens.length >= tokens.data.max : false;
  const createCode = create.error?.code;

  return (
    <div className="pt-4 pb-6">
      <Link href="/profile" className="t-label text-muted">{t("back")}</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-neon">{t("pc.title")}</p>
        <ol className="t-body mt-2 flex list-decimal flex-col gap-1 pl-4 text-xs text-ink">
          <li>{t("pc.step1")} <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-neon underline">{t("pc.docs")}</a></li>
          <li>{t("pc.step2")}</li>
          <li>{t("pc.step3")}</li>
          <li>{t("pc.step4")}</li>
        </ol>
        {apiUrl && (
          <div className="mt-3">
            <p className="t-label text-muted">{t("pc.url")}</p>
            <div className="mt-1 flex items-center gap-2">
              <code data-testid="my-ai-url" className="field min-w-0 flex-1 truncate px-2 py-1 text-xs">{apiUrl}</code>
              <button type="button" className="btn btn-tonal btn-sm" onClick={async () => setCopied((await copy(apiUrl)) ? "url" : null)}>
                {copied === "url" ? t("copied") : t("copy")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section data-testid="my-ai-tokens" className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{t("tokens.title")}</p>
        <p className="t-body mt-1 text-xs text-muted">{t("tokens.scope")}</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setCreated(null);
            create.mutate(name.trim(), { onSuccess: (row) => { setCreated(row); setName(""); setCopied(null); } });
          }}
        >
          <input data-testid="my-ai-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            placeholder={t("tokens.namePlaceholder")} aria-label={t("tokens.name")} className="field min-w-0 flex-1 px-3 py-2 text-sm" />
          <button type="submit" data-testid="my-ai-create" className="btn btn-primary btn-sm disabled:opacity-60"
            disabled={create.isPending || !name.trim() || full}>
            {t("tokens.create")}
          </button>
        </form>
        {full && <p className="t-body mt-2 text-xs text-warn">{t("tokens.full", { max: tokens.data?.max ?? 5 })}</p>}
        {createCode && (
          <p role="alert" className="t-body mt-2 text-xs text-bad">{create.error?.message || t("tokens.error")}</p>
        )}
        {created && (
          <div data-testid="my-ai-new-token" className="mt-3 rounded-lg border border-[rgba(255,200,90,0.4)] p-3">
            <p className="t-body text-xs text-warn">{t("tokens.once")}</p>
            <code data-testid="my-ai-token-value" className="mt-2 block break-all font-mono text-xs text-ink select-all">{created.token}</code>
            <button type="button" className="btn btn-tonal btn-sm mt-2" onClick={async () => setCopied((await copy(created.token)) ? "token" : null)}>
              {copied === "token" ? t("copied") : t("copy")}
            </button>
          </div>
        )}
        {tokens.isLoading && <p className="t-body mt-3 text-xs text-muted">{t("loading")}</p>}
        {tokens.data && tokens.data.tokens.length === 0 && <p className="t-body mt-3 text-xs text-muted">{t("tokens.none")}</p>}
        <ul className="mt-3 flex flex-col gap-2">
          {tokens.data?.tokens.map((row) => (
            <li key={row.id} data-testid="my-ai-token" className="flex items-center justify-between gap-2 border-b border-[rgba(150,190,255,0.08)] pb-2 last:border-0">
              <div className="min-w-0">
                <p className="t-body truncate text-sm text-ink">{row.name}</p>
                <p className="t-label text-muted">
                  <code>{row.prefix}…</code> · {t("tokens.created", { date: when(row.created_at) })} ·{" "}
                  {row.last_used_at ? t("tokens.used", { date: when(row.last_used_at) }) : t("tokens.unused")}
                </p>
              </div>
              {confirm === row.id ? (
                <button type="button" data-testid="my-ai-revoke-confirm" className="btn btn-sm shrink-0 text-bad"
                  disabled={revoke.isPending} onClick={() => revoke.mutate(row.id, { onSettled: () => setConfirm(null) })}>
                  {t("tokens.revokeConfirm")}
                </button>
              ) : (
                <button type="button" data-testid="my-ai-revoke" className="btn btn-outline btn-sm shrink-0" onClick={() => setConfirm(row.id)}>
                  {t("tokens.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="glass mt-4 p-4">
        <p className="t-eyebrow text-muted">{t("phone.title")}</p>
        <p className="t-body mt-1 text-xs text-ink">{t("phone.body")}</p>
        <Link href="/nutrition/menu" className="btn btn-tonal btn-sm mt-3">{t("phone.cta")}</Link>
      </section>
    </div>
  );
}
