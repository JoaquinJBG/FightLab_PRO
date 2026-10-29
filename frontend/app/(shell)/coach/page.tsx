"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useBiometrics } from "@/lib/hooks";
import { CitedText, type Citation } from "@/components/evidence/CitedText";
import { computeRecovery, type Recovery } from "@/lib/recovery";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import {
  CoachIcon, BoltIcon, ScaleIcon, MoonIcon, ChevronRight, GloveIcon,
} from "@/components/icons";

/* ------------------- contexto real del atleta (local) -------------------- */

type Ctx = {
  metrics: LoadMetrics | null;
  recovery: Recovery | null;
  weight: number | null;
  lastWeightDays: number | null;
  weighTarget: number | null;
  weighDays: number | null;
};

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/* --------------------- traducción de datos de recuperación ---------------- */

type Tr = ReturnType<typeof useTranslations>;

/** Etiqueta, frase y chips de recuperación en el idioma activo (computeRecovery los da en español). */
function recoveryText(r: Recovery, t: Tr) {
  const chips: string[] = [];
  if (r.rhrDelta !== undefined) chips.push(t("recovery.chipRhr", { delta: (r.rhrDelta > 0 ? "+" : "") + r.rhrDelta }));
  if (r.hrvPct !== undefined) chips.push(t("recovery.chipHrv", { delta: (r.hrvPct > 0 ? "+" : "") + r.hrvPct }));
  return { label: t(`recovery.${r.state}.label`), phrase: t(`recovery.${r.state}.phrase`), chips };
}

/* --------------------- briefing y recomendaciones por reglas -------------- */

function buildBriefing(ctx: Ctx, t: Tr): string {
  const bits: string[] = [];
  if (ctx.recovery?.state === "cuidado") {
    bits.push(t("briefing.care"));
  } else if (ctx.metrics?.acwr != null && ctx.metrics.acwr > 1.3) {
    bits.push(t("briefing.acwrHigh", { acwr: ctx.metrics.acwr.toFixed(2) }));
  } else if (ctx.recovery?.state === "listo") {
    bits.push(t("briefing.ready"));
  } else if (ctx.metrics && ctx.metrics.weekAU > 0) {
    bits.push(t("briefing.week", { au: ctx.metrics.weekAU }));
  } else {
    bits.push(t("briefing.unknown"));
  }
  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null) {
    const over = ctx.weight - ctx.weighTarget;
    if (over > 0.3 && ctx.weighDays <= 10) {
      bits.push(t("briefing.weigh", { days: ctx.weighDays, over: over.toFixed(1) }));
    }
  }
  return bits.join(" ");
}

type Rec = {
  id: string;
  icon: "load" | "weigh" | "rest" | "log";
  tone: "warn" | "info" | "good";
  title: string;
  why: string;
  action?: { label: string; href: string };
};

function buildRecs(ctx: Ctx, t: Tr): Rec[] {
  const recs: Rec[] = [];
  const m = ctx.metrics;

  if (m?.acwr != null && m.acwr > 1.3) {
    recs.push({
      id: "acwr-alto",
      icon: "load",
      tone: "warn",
      title: t("recs.acwrHigh.title", { acwr: m.acwr.toFixed(2) }),
      why: t("recs.acwrHigh.why"),
      action: { label: t("recs.acwrHigh.action"), href: "/training/load" },
    });
  } else if (m?.acwr != null && m.acwr < 0.8 && m.weekAU > 0 && ctx.recovery?.state !== "cuidado") {
    recs.push({
      id: "acwr-bajo",
      icon: "load",
      tone: "info",
      title: t("recs.acwrLow.title", { acwr: m.acwr.toFixed(2) }),
      why: t("recs.acwrLow.why"),
      action: { label: t("recs.acwrLow.action"), href: "/training" },
    });
  }

  if (ctx.recovery?.state === "cuidado") {
    recs.push({
      id: "recuperacion",
      icon: "rest",
      tone: "warn",
      title: t("recs.recovery.title"),
      why: t("recs.recovery.why", { chips: recoveryText(ctx.recovery, t).chips.join(" · ") }),
    });
  }

  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null && ctx.weight - ctx.weighTarget > 0.3) {
    recs.push({
      id: "pesaje",
      icon: "weigh",
      tone: ctx.weighDays <= 5 ? "warn" : "info",
      title: t("recs.weigh.title", { over: (ctx.weight - ctx.weighTarget).toFixed(1), days: ctx.weighDays }),
      why: ctx.weighDays > 5 ? t("recs.weigh.whyFar") : t("recs.weigh.whyNear"),
      action: { label: t("recs.weigh.action"), href: "/nutrition/weigh-in" },
    });
  }

  if (ctx.lastWeightDays != null && ctx.lastWeightDays >= 14) {
    recs.push({
      id: "peso-viejo",
      icon: "weigh",
      tone: "info",
      title: t("recs.oldWeight.title", { days: ctx.lastWeightDays }),
      why: t("recs.oldWeight.why"),
      action: { label: t("recs.oldWeight.action"), href: "/biometrics/new" },
    });
  }

  if ((m == null || m.weekAU === 0) && recs.length === 0) {
    recs.push({
      id: "empieza",
      icon: "log",
      tone: "info",
      title: t("recs.start.title"),
      why: t("recs.start.why"),
      action: { label: t("recs.start.action"), href: "/training" },
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "ok",
      icon: "load",
      tone: "good",
      title: t("recs.ok.title"),
      // Solo afirma "zona segura y recuperación correcta" si de verdad hay datos de ambas
      why: m?.acwr != null && ctx.recovery ? t("recs.ok.whyData") : t("recs.ok.whyNoData"),
    });
  }
  return recs;
}

const REC_ICON = { load: BoltIcon, weigh: ScaleIcon, rest: MoonIcon, log: GloveIcon } as const;
const TONE_COLOR = { warn: "#ffd25a", info: "#45e9ff", good: "#43e8a0" } as const;

const dismissKey = () => {
  const d = new Date();
  return `flp_coach_dismissed_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* --------------------------------- chat ----------------------------------- */

type Msg = { role: "coach" | "user"; text: string; citations?: Citation[] };
const QUICK_KEYS = ["how", "hard", "weight"] as const;

function coachReply(text: string, ctx: Ctx, t: Tr, listFmt: Intl.ListFormat): string {
  const low = text.toLowerCase();
  const m = ctx.metrics;
  const acwrTxt = m?.acwr != null
    ? t(m.provisional ? "reply.acwrProvisional" : "reply.acwr", { value: m.acwr.toFixed(2) })
    : m != null && m.historyDays >= 10 && m.weekAU === 0
      ? t("reply.acwrPaused")
      : t("reply.acwrPending");
  const rec = ctx.recovery ? recoveryText(ctx.recovery, t) : null;
  // Las palabras clave cubren es y en: el texto del usuario puede estar en cualquiera.
  if (/peso|pesaje|corte|weight|weigh|cut/.test(low)) {
    if (ctx.weight == null) return t("reply.weightNone");
    if (ctx.weighTarget != null && ctx.weighDays != null) {
      const over = ctx.weight - ctx.weighTarget;
      return over > 0
        ? t("reply.weightOver", { over: over.toFixed(1), days: ctx.weighDays })
        : t("reply.weightAt", { target: ctx.weighTarget, days: ctx.weighDays });
    }
    return t("reply.weightLast", { weight: ctx.weight.toFixed(1) });
  }
  if (/fuerte|intens|sparring|entren|hoy|hard|train|today/.test(low)) {
    if (rec && ctx.recovery?.state === "cuidado") return t("reply.hardCare", { chips: listFmt.format(rec.chips) });
    if (m?.acwr != null && m.acwr > 1.3) return t("reply.hardHigh", { acwr: acwrTxt });
    if (ctx.recovery?.state === "listo") return t("reply.hardReady", { acwr: acwrTxt });
    return t("reply.hardNormal", { acwr: acwrTxt });
  }
  if (/fatiga|cansad|dolor|recuper|fatigue|tired|sore|pain|recover/.test(low)) {
    return rec ? t("reply.fatigue", { chips: rec.chips.join(" · "), phrase: rec.phrase }) : t("reply.fatigueNone");
  }
  if (/carga|acwr|riesgo|load|risk/.test(low)) {
    return m && m.weekAU > 0
      ? t("reply.load", { au: m.weekAU, acwr: acwrTxt, mono: m.monotonia != null ? m.monotonia.toFixed(1) : "—" })
      : t("reply.loadNone");
  }
  if (/cómo voy|como voy|resumen|how am i|summary/.test(low)) {
    const parts: string[] = [];
    if (m && m.weekAU > 0) parts.push(t("reply.summaryWeek", { au: m.weekAU, acwr: acwrTxt }));
    if (rec) parts.push(t("reply.summaryRecovery", { label: rec.label.toLowerCase() }));
    if (ctx.weight != null) {
      parts.push(ctx.weighTarget != null
        ? t("reply.summaryWeightTarget", { weight: ctx.weight.toFixed(1), target: ctx.weighTarget })
        : t("reply.summaryWeight", { weight: ctx.weight.toFixed(1) }));
    }
    return parts.length > 0 ? t("reply.summary", { parts: parts.join(" · ") }) : t("reply.summaryNone");
  }
  if (/gracias|ok|vale|genial|thanks|great/.test(low)) return t("reply.thanks");
  return t("reply.default");
}

/* --------------------------------- página --------------------------------- */

export default function CoachPage() {
  const t = useTranslations("coach");
  const locale = useLocale();
  const listFmt = new Intl.ListFormat(locale, { type: "conjunction" });
  const { data: logs = [] } = useBiometrics();
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null);
  const [weigh, setWeigh] = useState<{ target: number; date: string } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    setMetrics(loadMetrics()); // pintura inmediata; el servidor sobreescribe al llegar
    fetchServerMetrics().then((m) => { if (alive && m) setMetrics(m); });
    try {
      const w = JSON.parse(localStorage.getItem("flp_weigh") ?? "null");
      if (w && typeof w.target === "number" && typeof w.date === "string" && !Number.isNaN(new Date(w.date).getTime())) {
        setWeigh(w);
      }
      const d = JSON.parse(localStorage.getItem(dismissKey()) ?? "[]");
      if (Array.isArray(d)) setDismissed(d);
      // Limpia los descartes de días anteriores para que no se acumulen
      const today = dismissKey();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("flp_coach_dismissed_") && k !== today) localStorage.removeItem(k);
      }
    } catch { /* noop */ }
    return () => { alive = false; };
  }, []);

  const recovery = computeRecovery(logs);
  const lastWeightLog = logs.find((l) => num(l.weight_kg ?? null) !== null);
  const weight = lastWeightLog ? num(lastWeightLog.weight_kg ?? null) : null;
  const lastWeightDays = lastWeightLog
    ? Math.round((new Date().setHours(0, 0, 0, 0) - new Date(lastWeightLog.timestamp).setHours(0, 0, 0, 0)) / 86_400_000)
    : null;

  // Pesaje ya pasado (días negativos) → null: no tiene sentido seguir avisando
  const weighDaysRaw = weigh
    ? Math.round((new Date(weigh.date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
    : null;
  const weighDays = weighDaysRaw != null && weighDaysRaw >= 0 ? weighDaysRaw : null;

  const ctx: Ctx = {
    metrics,
    recovery,
    weight,
    lastWeightDays,
    weighTarget: weigh?.target ?? null,
    weighDays,
  };

  const recs = buildRecs(ctx, t).filter((r) => !dismissed.includes(r.id));

  function dismiss(id: string) {
    const n = [...dismissed, id];
    setDismissed(n);
    try { localStorage.setItem(dismissKey(), JSON.stringify(n)); } catch { /* noop */ }
  }
  function vote(id: string, useful: boolean) {
    setFeedback((f) => ({ ...f, [id]: useful }));
    try {
      const arr = JSON.parse(localStorage.getItem("flp_coach_fb") ?? "[]");
      localStorage.setItem("flp_coach_fb", JSON.stringify([...(Array.isArray(arr) ? arr : []), { id, useful, ts: Date.now() }].slice(-200)));
    } catch { /* noop */ }
  }

  /* chat */
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([
    { role: "coach", text: t("chat.greeting") },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [aiMode, setAiMode] = useState<"ia" | "reglas" | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs, typing]);
  useEffect(() => () => abortRef.current?.abort(), []); // corta la petición al salir de la vista

  async function send(text: string) {
    const txt = text.trim();
    if (!txt || typing) return;
    setInput("");
    const history: Msg[] = [...chatMsgs, { role: "user", text: txt }];
    setChatMsgs(history);
    setTyping(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/proxy/ai/coach/chat", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-10).map((m) => ({ role: m.role === "coach" ? "assistant" : "user", content: m.text })),
          context: {
            semana_au: ctx.metrics?.weekAU ?? 0,
            acwr: ctx.metrics?.acwr ?? null,
            acwr_provisional: ctx.metrics?.provisional ?? null,
            dias_historial_carga: ctx.metrics?.historyDays ?? 0,
            monotonia: ctx.metrics?.monotonia ?? null,
            recuperacion: ctx.recovery ? { estado: ctx.recovery.state, seniales: ctx.recovery.chips } : null,
            peso_kg: ctx.weight,
            dias_desde_ultimo_peso: ctx.lastWeightDays,
            pesaje: ctx.weighTarget != null ? { objetivo_kg: ctx.weighTarget, en_dias: ctx.weighDays } : null,
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { reply?: unknown; citations?: Citation[] };
      if (typeof data.reply !== "string" || !data.reply) throw new Error("sin respuesta");
      setChatMsgs((m) => [...m, { role: "coach", text: data.reply as string, citations: data.citations }]);
      setAiMode("ia");
    } catch {
      if (ctrl.signal.aborted) return; // se salió de la vista: no tocar el estado
      // IA no configurada o caída: respuesta por reglas con los datos locales
      setChatMsgs((m) => [...m, { role: "coach", text: coachReply(txt, ctx, t, listFmt) }]);
      setAiMode("reglas");
    } finally {
      if (!ctrl.signal.aborted) setTyping(false);
    }
  }
  function mockVoice() {
    setListening(true);
    setTimeout(() => { setListening(false); send(t("chat.voiceQuestion")); }, 1300);
  }

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><CoachIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>

      {/* Contexto real */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge">{metrics?.acwr != null ? `ACWR ${metrics.acwr.toFixed(2)}${metrics.provisional ? "*" : ""}` : t("badges.acwrNone")}</span>
        <span className="badge">{t("badges.week", { au: metrics?.weekAU ?? 0 })}</span>
        {weight != null && <span className="badge">{weight.toFixed(1)} kg</span>}
        {weighDays != null && <span className="badge">{t("badges.weighIn", { days: weighDays })}</span>}
        {recovery && <span className="badge" style={{ color: recovery.color }}>{recoveryText(recovery, t).label}</span>}
      </div>

      {/* Briefing por reglas con datos reales */}
      <section className="glass neon-edge mt-4 p-5">
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-neon">{t("briefing.eyebrow")}</p>
          <span className="badge">{t("briefing.withData")}</span>
        </div>
        <p className="t-body mt-2 text-ink">{buildBriefing(ctx, t)}</p>
        <div className="mt-3 flex gap-2">
          <Link href="/training" className="btn btn-tonal btn-sm"><GloveIcon className="h-4 w-4" /> {t("briefing.train")}</Link>
          <Link href="/nutrition" className="btn btn-outline btn-sm">{t("briefing.nutrition")}</Link>
        </div>
      </section>

      {/* Recomendaciones por reglas */}
      {recs.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="t-eyebrow text-muted">{t("recs.heading")}</p>
            <span className="t-body text-[10px] text-muted">{t("recs.byRules")}</span>
          </div>
          <div className="mt-2 flex flex-col gap-2.5">
            {recs.map((r) => {
              const Icon = REC_ICON[r.icon];
              const color = TONE_COLOR[r.tone];
              const voted = feedback[r.id];
              return (
                <div key={r.id} className="glass p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color, background: `${color}14` }}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-label text-ink">{r.title}</p>
                      <p className="t-body mt-1 text-xs text-muted">{r.why}</p>
                      <div className="mt-2.5 flex items-center gap-3">
                        {r.action && (
                          <Link href={r.action.href} className="btn btn-tonal btn-sm">{r.action.label} <ChevronRight className="h-3.5 w-3.5" /></Link>
                        )}
                        {r.tone !== "good" && (
                          <button onClick={() => dismiss(r.id)} className="t-label text-muted">{t("recs.dismiss")}</button>
                        )}
                        <span className="ml-auto flex items-center gap-1.5">
                          {voted === undefined ? (
                            <>
                              <button onClick={() => vote(r.id, true)} aria-label={t("recs.useful")} className="text-muted hover:text-good">👍</button>
                              <button onClick={() => vote(r.id, false)} aria-label={t("recs.notUseful")} className="text-muted hover:text-bad">👎</button>
                            </>
                          ) : (
                            <span className="t-body text-[10px] text-muted">{voted ? t("recs.thanks") : t("recs.noted")}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="mt-5">
        <div className="flex items-center gap-2">
          <p className="t-eyebrow text-muted">{t("chat.heading")}</p>
          <span className="badge badge-neon">{aiMode === "ia" ? t("chat.modeAi") : aiMode === "reglas" ? t("chat.modeRules") : t("chat.modeDefault")}</span>
        </div>
        <div className="glass mt-2 flex h-[42dvh] flex-col overflow-hidden p-3">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {chatMsgs.map((m, i) => (
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
                  <span className="pulse text-sm text-muted">{t("chat.typing")}</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_KEYS.map((k) => <button key={k} onClick={() => send(t(`chat.quick.${k}`))} disabled={typing} className="badge disabled:opacity-50">{t(`chat.quick.${k}`)}</button>)}
          </div>
          <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <button type="button" onClick={mockVoice} aria-label={t("chat.voice")}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>🎤</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? t("chat.listening") : t("chat.placeholder")} className="field flex-1 px-3.5 py-2.5 text-sm" />
            <button type="submit" className="btn btn-primary btn-sm shrink-0">{t("chat.send")}</button>
          </form>
        </div>
        <p className="t-body mt-2 text-center text-[11px] text-muted">
          {aiMode === "reglas" ? `${t("chat.rulesNotice")} ` : ""}
          {recovery == null && metrics?.weekAU === 0 ? `${t("chat.moreData")} ` : ""}
          {t("chat.disclaimer")} {metrics?.acwr != null && metrics.provisional ? t("chat.provisionalNote") : ""}
        </p>
      </div>

    </div>
  );
}
