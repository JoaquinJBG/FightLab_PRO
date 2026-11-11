"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MealKey } from "@/lib/menu";
import { buildPrompt, copyLater, errorInfo, errorRejected, fetchContext, usePasteMenu, type PasteResponse } from "@/lib/menu-ai";
import { RejectedDays } from "./MenuView";

type Copy = { state: "idle" | "working" | "copied" | "manual" | "error"; text?: string; start?: string; days?: number; error?: string };

/** Fase 14, vía C: preparar el menú con la IA del usuario desde el móvil, sin instalar nada.
 * «Prepararlo con mi IA» copia las instrucciones y los datos (lo mismo que descarga la skill del
 * PC); el JSON que devuelve la IA se pega aquí y pasa por el importador y el motor. */
export function AiMenuCard({ days, meals, tupper, onSaved }: {
  days: number;
  meals: MealKey[];
  tupper: MealKey[];
  onSaved?: (id: number) => void;
}) {
  const t = useTranslations("menu.ai");
  const paste = usePasteMenu();
  const [copy, setCopy] = useState<Copy>({ state: "idle" });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [done, setDone] = useState<PasteResponse | null>(null);
  const code = paste.error?.code;
  const info = errorInfo(paste.error);
  const params = ((paste.error?.data as { params?: Record<string, number | string> } | null)?.params) ?? {};
  const rejected = errorRejected(paste.error);

  async function onCopy() {
    setCopy({ state: "working" });
    const ctx = fetchContext({ days, meals, tupper: tupper.filter((m) => meals.includes(m)) });
    // El portapapeles se pide ya, dentro del toque (Safari), con el texto que llegará después.
    const prompt = ctx.then((c) => buildPrompt(c, t("dataTitle")));
    try {
      const { text: value, copied } = await copyLater(prompt);
      const c = await ctx;
      setCopy({ state: copied ? "copied" : "manual", text: value, start: c.request.start, days: c.request.days });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setCopy({ state: "error", error: err.code && t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : err.message || t("errors.generic") });
    }
  }

  function save(value: string, replaceStart = false) {
    setDone(null);
    paste.mutate({ text: value, replaceStart }, {
      onSuccess: (res) => {
        setPending(null);
        setDone(res);
        setText("");
        onSaved?.(res.menu.id);
      },
      onError: (e) => setPending(e.code === "start_taken" ? value : null),
    });
  }

  return (
    <section data-testid="menu-ai" className="glass neon-edge mt-4 p-4">
      <p className="t-eyebrow text-neon">{t("title")}</p>
      <p className="t-body mt-1 text-xs text-muted">{t("intro")}</p>

      <button type="button" data-testid="menu-ai-copy" className="btn btn-primary btn-sm mt-3 w-full disabled:opacity-60"
        disabled={copy.state === "working" || meals.length === 0} onClick={onCopy}>
        {copy.state === "working" ? t("copying") : t("copy")}
      </button>
      {copy.state === "copied" && (
        <p role="status" data-testid="menu-ai-copied" className="t-body mt-2 text-xs text-good">
          {t("copied", { days: copy.days ?? days, start: copy.start ?? "" })}
        </p>
      )}
      {copy.state === "manual" && (
        <div className="mt-2">
          <p role="status" className="t-body text-xs text-warn">{t("copyManual")}</p>
          <textarea data-testid="menu-ai-prompt" readOnly value={copy.text} rows={4}
            className="field mt-1 w-full px-2 py-1 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {copy.state === "error" && <p role="alert" className="t-body mt-2 text-xs text-bad">{copy.error}</p>}

      <label className="mt-4 block">
        <span className="t-label text-ink">{t("pasteLabel")}</span>
        <textarea data-testid="menu-ai-paste" value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder={t("pastePlaceholder")} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          className="field mt-1 w-full px-2 py-1 font-mono text-xs" />
      </label>
      <button type="button" data-testid="menu-ai-save" className="btn btn-tonal btn-sm mt-2 w-full disabled:opacity-60"
        disabled={paste.isPending || !text.trim()} onClick={() => save(text)}>
        {paste.isPending ? t("saving") : t("save")}
      </button>

      {code === "start_taken" && pending && (
        <div data-testid="menu-ai-confirm" className="mt-3">
          {/* R4-1: solo se pregunta con al menos un día válido; dice cuántos tiene cada menú */}
          <p role="alert" className="t-body text-xs text-warn">
            {typeof params.new_ok === "number"
              ? t("startTakenCounts", { old: params.old_ok ?? 0, oldDays: params.old_days ?? 0, new: params.new_ok, newDays: params.new_days ?? 0 })
              : t("startTaken")}
          </p>
          <button type="button" className="btn btn-primary btn-sm mt-2" onClick={() => save(pending, true)}>{t("replace")}</button>
        </div>
      )}
      {code && code !== "start_taken" && (
        <div role="alert" data-testid="menu-ai-error" data-code={code} className="mt-2">
          <p className="t-body text-xs text-bad">
            {t.has(`errors.${code}`) ? t(`errors.${code}`, { line: params.line ?? "?", column: params.column ?? "?", max: params.max ?? 35, days: params.days ?? rejected.length }) : paste.error?.message || t("errors.generic")}
          </p>
          {rejected.length > 0 && (
            <div data-testid="menu-ai-rejected" className="mt-1">
              <p className="t-label text-[11px] text-ink">{t("rejectedTitle")}</p>
              <RejectedDays rejected={rejected} />
            </div>
          )}
          {info && code !== "paste_not_json" && code !== "no_valid_days" && <p className="t-body mt-1 text-[11px] text-muted">{t("where", { info })}</p>}
          <p className="t-body mt-1 text-[11px] text-muted">{t("askAgain")}</p>
        </div>
      )}
      {done && (
        <div role="status" data-testid="menu-ai-done" data-replaced={done.replaced ? "true" : "false"} data-failing={done.days_failing.length} className="mt-3">
          <p className="t-body text-sm text-good">
            {t(done.replaced ? "replaced" : "saved", { title: done.summary.title || done.summary.menu_id, days: done.summary.days })}
          </p>
          {done.checked && (
            <p className={`t-body mt-1 text-xs ${done.days_failing.length ? "text-warn" : "text-good"}`}>
              {done.days_failing.length
                ? t("failing", { ok: done.days_ok, days: done.summary.days + done.rejected.length, dates: done.days_failing.join(", ") })
                : t("allOk", { days: done.summary.days })}
            </p>
          )}
          {done.rejected.length > 0 && (
            <div data-testid="menu-ai-rejected" className="mt-1">
              <p className="t-label text-[11px] text-ink">{t("rejectedTitle")}</p>
              <RejectedDays rejected={done.rejected} />
            </div>
          )}
        </div>
      )}
      <Link href="/profile/my-ai" data-testid="menu-ai-skill-link" className="t-label mt-3 block text-neon underline">{t("skillLink")}</Link>
    </section>
  );
}
