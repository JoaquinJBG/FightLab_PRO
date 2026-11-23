"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CitedText, type Citation } from "@/components/evidence/CitedText";
import { useVisualViewportBox } from "@/lib/viewport";

export type ChatMsg = { role: "coach" | "user"; text: string; citations?: Citation[] };

const QUICK_KEYS = ["how", "hard", "weight"] as const;

/* Chat del coach (F4 de la prueba en móvil).
 *
 * En la página se ve como una tarjeta. Al tocar el campo, una pregunta rápida o «Ampliar», el
 * mismo bloque pasa a ocupar toda la zona visible (la de `visualViewport`, que ya descuenta el
 * teclado): la conversación llena la pantalla, el campo queda justo encima del teclado y la
 * última respuesta se ve sin hacer scroll. Por encima de la barra de navegación (z-50). Es el
 * mismo árbol en los dos modos, así que el campo no pierde el foco al ampliarse. */
export function ChatPanel({
  msgs,
  typing,
  input,
  onInput,
  onSend,
  modeLabel,
}: {
  msgs: ChatMsg[];
  typing: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
  modeLabel: ReactNode;
}) {
  const t = useTranslations("coach.chat");
  const [expanded, setExpanded] = useState(false);
  const box = useVisualViewportBox(expanded);
  const listRef = useRef<HTMLDivElement>(null);

  // Siempre al final de la conversación: al llegar un mensaje, al ampliar y cuando el teclado
  // cambia la altura. Solo se mueve la lista: `scrollIntoView` arrastraba también la página.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing, expanded, box?.height]);

  // Ampliado, el fondo no se desplaza por debajo y Escape lo cierra.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  function send(text: string) {
    setExpanded(true);
    onSend(text);
  }

  return (
    <div
      data-testid="coach-chat"
      data-expanded={expanded ? "true" : "false"}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? t("heading") : undefined}
      className={
        expanded
          ? "fixed inset-x-0 z-50 mx-auto flex w-full max-w-md flex-col bg-[#05070e] px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
          : "glass mt-2 flex h-[min(62dvh,560px)] min-h-[320px] flex-col overflow-hidden p-3"
      }
      style={expanded ? { top: box?.top ?? 0, height: box ? box.height : "100dvh" } : undefined}
    >
      <div className={expanded ? "mb-2 flex items-center gap-2" : "mb-1 flex items-center justify-end"}>
        {expanded && (
          <>
            <p className="t-eyebrow min-w-0 flex-1 truncate text-muted">{t("heading")}</p>
            <span className="badge badge-neon">{modeLabel}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="t-label shrink-0 text-neon"
        >
          {expanded ? t("collapse") : t("expand")}
        </button>
      </div>

      <div
        ref={listRef}
        data-testid="coach-chat-log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
      >
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "text-[#03101c]" : "text-ink"}`}
              style={m.role === "user" ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(150,190,255,0.14)" }}>
              <CitedText text={m.text} citations={m.citations} />
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[rgba(150,190,255,0.14)] bg-[rgba(255,255,255,0.06)] px-3.5 py-2.5">
              <span className="pulse text-sm text-muted">{t("typing")}</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK_KEYS.map((k) => (
          <button key={k} type="button" onClick={() => send(t(`quick.${k}`))} disabled={typing} className="badge disabled:opacity-50">
            {t(`quick.${k}`)}
          </button>
        ))}
      </div>
      <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder={t("placeholder")}
          enterKeyHint="send"
          className="field flex-1 px-3.5 py-2.5 text-sm"
        />
        <button type="submit" className="btn btn-primary btn-sm shrink-0">{t("send")}</button>
      </form>
    </div>
  );
}
