"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useBiometrics, useSafety, useWeighIn } from "@/lib/hooks";
import { CitedText, type Citation } from "@/components/evidence/CitedText";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { comparisonRule, loadBadge, ruleCitations } from "@/lib/load-texts";
import { computeRecovery } from "@/lib/recovery";
import { latestWeightKg } from "@/lib/body-inputs";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { buildBriefing, buildRecs, coachReply, injuryAreas, num, recoveryText, type CoachTr, type Ctx } from "@/lib/coach-rules";
import { fetchServerMetrics } from "@/lib/activities";
import { useUserState } from "@/lib/user-state";
import {
  type CoachMemory,
  type CoachMemoryDraft,
  COACH_FREQUENCIES,
  COACH_TONES,
  EMPTY_DRAFT,
  draftFromMemory,
  isCoachMemoryEmpty,
  memoryFromDraft,
  shouldShowRecForFrequency,
} from "@/lib/coach-memory";
import {
  CoachIcon, BoltIcon, ScaleIcon, MoonIcon, ChevronRight, GloveIcon,
} from "@/components/icons";

type FbEntry = { id: string; useful: boolean; ts: number };

const REC_ICON = { load: BoltIcon, weigh: ScaleIcon, rest: MoonIcon, log: GloveIcon } as const;
const TONE_COLOR = { warn: "#ffd25a", info: "#45e9ff", good: "#43e8a0" } as const;

// Clave "pelada" (sin el prefijo flp_): es la que espera useUserState, que
// añade el prefijo por dentro para leer/escribir localStorage.
const bareDismissKey = () => {
  const d = new Date();
  return `coach_dismissed_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dismissKey = () => `flp_${bareDismissKey()}`;

/* --------------------------------- chat ----------------------------------- */

type Msg = { role: "coach" | "user"; text: string; citations?: Citation[] };
const QUICK_KEYS = ["how", "hard", "weight"] as const;

/* --------------------------------- página --------------------------------- */

export default function CoachPage() {
  const t = useTranslations("coach");
  const tl = useTranslations("load");
  const tc = useTranslations("combat");
  const locale = useLocale();
  const listFmt = new Intl.ListFormat(locale, { type: "conjunction" });
  const { data: logs = [] } = useBiometrics();
  const { data: safety } = useSafety();
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null);
  const { value: dismissed, setValue: setDismissed } = useUserState<string[]>(bareDismissKey(), []);
  const { value: fb, setValue: setFb } = useUserState<FbEntry[]>("coach_fb", []);
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const tr: CoachTr = { t, tl, tc };

  /* Memoria persistente del coach (P0.3): lo que el atleta cuenta de sí mismo */
  const { value: memory, setValue: setMemory, hydrated: memoryHydrated } = useUserState<CoachMemory>("coach_memory", {});
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState<CoachMemoryDraft>(EMPTY_DRAFT);

  // El borrador se rellena al ABRIR la edición (evento), no en un efecto: así
  // no hay parpadeo si el servidor todavía no ha terminado de hidratar.
  function openMemoryEdit() {
    setMemoryDraft(draftFromMemory(memory));
    setEditingMemory(true);
  }
  function saveMemory(e: FormEvent) {
    e.preventDefault();
    setMemory(memoryFromDraft(memoryDraft));
    setEditingMemory(false);
  }

  useEffect(() => {
    let alive = true;
    // Pintura inmediata desde local; el servidor sobreescribe al llegar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetrics(loadMetrics());
    fetchServerMetrics().then((m) => { if (alive && m) setMetrics(m); });
    try {
      // Limpia los descartes de días anteriores para que no se acumulen
      const today = dismissKey();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("flp_coach_dismissed_") && k !== today) localStorage.removeItem(k);
      }
    } catch { /* noop */ }
    return () => { alive = false; };
  }, []);

  // El pesaje sale del servidor (`/coach/weigh-in`), no de localStorage. Con `no_weight_targets`
  // no hay peso, ni pesaje, ni avisos de pesarse (spec §8.3); con el déficit bloqueado sigue la
  // cuenta atrás pero no la distancia al objetivo. Mientras carga, se oculta: es lo seguro.
  const { data: weighIn } = useWeighIn();
  const weightHidden = !weighIn || weighIn.blocked;
  // El objetivo de peso de la memoria sigue la misma regla: con `no_weight_targets` ni se pide ni se enseña
  const memoryWeightHidden = weightHidden || !safety || !!safety.flags.no_weight_targets;

  const recovery = computeRecovery(logs);
  const lastWeightLog = weightHidden ? undefined : logs.find((l) => num(l.weight_kg ?? null) !== null);
  // F28: con dos pesajes el mismo día cuenta la media del día, como en Biometría, Hoy y la tendencia
  const weight = lastWeightLog ? latestWeightKg(logs) : null;
  const lastWeightDays = lastWeightLog
    ? Math.round((new Date().setHours(0, 0, 0, 0) - new Date(lastWeightLog.timestamp).setHours(0, 0, 0, 0)) / 86_400_000)
    : null;

  // Pesaje ya pasado (días negativos) → null: no tiene sentido seguir avisando
  const weighDaysRaw = weightHidden ? null : weighIn.days_left;
  const weighDays = weighDaysRaw != null && weighDaysRaw >= 0 ? weighDaysRaw : null;
  const weighTarget = weightHidden || weighIn.deficit_blocked ? null : weighIn.goal_weight_kg;

  const ctx: Ctx = {
    metrics,
    recovery,
    weight,
    lastWeightDays,
    weighTarget,
    weighDays,
    cutAllowed: !!safety && !["no_cut_content", "no_weight_targets", "no_deficit", "hold_deficit"].some((f) => safety.flags[f]),
    minor: !!safety?.flags.no_cut_content,
    // F26: el golpe en la cabeza y las lesiones (del perfil y de la memoria del coach) cuentan al momento
    noContact: !!safety?.flags.no_contact,
    injuries: injuryAreas(safety?.reasons ?? [], memory.lesion),
  };

  const recs = buildRecs(ctx, tr, listFmt)
    // El aviso del golpe en la cabeza no se descarta: se quita con el alta de un clínico
    .filter((r) => r.id === "golpe" || !dismissed.includes(r.id))
    .filter((r) => shouldShowRecForFrequency(r.tone, memory.frecuencia_avisos));
  const briefing = buildBriefing(ctx, tr, listFmt);

  function dismiss(id: string) {
    setDismissed([...dismissed, id]);
  }
  function vote(id: string, useful: boolean) {
    setFeedback((f) => ({ ...f, [id]: useful }));
    setFb([...fb, { id, useful, ts: Date.now() }].slice(-200));
  }

  /* chat */
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([
    { role: "coach", text: t("chat.greeting") },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
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
            semana_vs_media_pct: ctx.metrics?.weekVsAvgPct ?? null,
            dias_para_ratio: ctx.metrics?.ratioDaysLeft ?? null,
            historial_con_huecos: ctx.metrics?.gaps ?? false,
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
      const reply = coachReply(txt, ctx, tr, listFmt);
      setChatMsgs((m) => [...m, { role: "coach", text: reply, citations: ruleCitations(reply) }]);
      setAiMode("reglas");
    } finally {
      if (!ctrl.signal.aborted) setTyping(false);
    }
  }

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><CoachIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>

      {/* Contexto real */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge" data-testid="coach-load-badge">{loadBadge(metrics, tl)}</span>
        {comparisonRule(metrics) && <EvidenceChip ruleKey={comparisonRule(metrics)!.key} grade={comparisonRule(metrics)!.grade} />}
        <span className="badge">{t("badges.week", { au: metrics?.weekAU ?? 0 })}</span>
        {weight != null && <span className="badge">{weight.toFixed(1)} kg</span>}
        {weighDays != null && <span className="badge">{t("badges.weighIn", { days: weighDays })}</span>}
        {/* R3-3: la cabecera sale del mismo estado de seguridad que el briefing: con un golpe en la
            cabeza activo no dice «Listo para entrenar» */}
        {ctx.noContact ? (
          <span data-testid="coach-safety-badge" className="badge" style={{ color: "#ff5a6e" }}>{t("badges.headBlow")}</span>
        ) : (
          recovery && <span data-testid="coach-recovery-badge" className="badge" style={{ color: recovery.color }}>{recoveryText(recovery, t).label}</span>
        )}
      </div>

      {/* Briefing por reglas con datos reales */}
      <section className="glass neon-edge mt-4 p-5">
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-neon">{t("briefing.eyebrow")}</p>
          <span className="badge">{t("briefing.withData")}</span>
        </div>
        <p className="t-body mt-2 text-ink">
          {briefing.text}
          {briefing.rules.map((r) => <span key={r.key}> <EvidenceChip ruleKey={r.key} grade={r.grade} /></span>)}
        </p>
        <div className="mt-3 flex gap-2">
          {briefing.blocked ? (
            <Link href="/training/mma" data-testid="briefing-head-blow" className="btn btn-tonal btn-sm">{t("briefing.headBlowAction")}</Link>
          ) : (
            <Link href="/training" className="btn btn-tonal btn-sm"><GloveIcon className="h-4 w-4" /> {t("briefing.train")}</Link>
          )}
          <Link href="/nutrition" className="btn btn-outline btn-sm">{t("briefing.nutrition")}</Link>
        </div>
      </section>

      {/* Recomendaciones por reglas */}
      {recs.length > 0 && (
        <div className="mt-5">
          <p className="t-eyebrow text-muted">{t("recs.heading")}</p>
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
                      {r.rule !== undefined && <div className="mt-1.5"><EvidenceChip ruleKey={r.rule?.key} grade={r.rule?.grade} /></div>}
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

      {/* Memoria del coach */}
      <section className="glass mt-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="t-eyebrow min-w-0 text-muted">{t("memory.title")}</p>
          {!editingMemory && memoryHydrated && (
            <button onClick={openMemoryEdit} className="t-label shrink-0 whitespace-nowrap text-neon">
              {isCoachMemoryEmpty(memory) ? t("memory.tell") : t("memory.edit")}
            </button>
          )}
        </div>

        {editingMemory ? (
          <form className="mt-3 flex flex-col gap-3" onSubmit={saveMemory}>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("memory.injury.label")}</span>
              <input
                value={memoryDraft.lesion}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, lesion: e.target.value }))}
                placeholder={t("memory.injury.placeholder")}
                maxLength={200}
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("memory.phase.label")}</span>
              <input
                value={memoryDraft.fase}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, fase: e.target.value }))}
                placeholder={t("memory.phase.placeholder")}
                maxLength={120}
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("memory.fightDate.label")}</span>
              <input
                type="date"
                value={memoryDraft.fechaPelea}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, fechaPelea: e.target.value }))}
                className="field px-3 py-2 text-sm"
              />
            </label>
            {!memoryWeightHidden && (
              <label className="flex flex-col gap-1">
                <span className="t-label text-muted">{t("memory.weightGoal.label")}</span>
                <input
                  inputMode="decimal"
                  value={memoryDraft.objetivoPesoKg}
                  onChange={(e) => setMemoryDraft((d) => ({ ...d, objetivoPesoKg: e.target.value }))}
                  placeholder={t("memory.weightGoal.placeholder")}
                  className="field px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("memory.tone.label")}</span>
              <select
                value={memoryDraft.tono}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, tono: e.target.value as CoachMemoryDraft["tono"] }))}
                className="field px-3 py-2 text-sm"
              >
                <option value="">{t("memory.noPreference")}</option>
                {COACH_TONES.map((v) => <option key={v} value={v}>{t(`memory.tones.${v}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">{t("memory.frequency.label")}</span>
              <select
                value={memoryDraft.frecuenciaAvisos}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, frecuenciaAvisos: e.target.value as CoachMemoryDraft["frecuenciaAvisos"] }))}
                className="field px-3 py-2 text-sm"
              >
                <option value="">{t("memory.noPreference")}</option>
                {COACH_FREQUENCIES.map((v) => <option key={v} value={v}>{t(`memory.frequencies.${v}`)}</option>)}
              </select>
            </label>
            <p className="t-body text-[11px] text-muted">{t("memory.privacy")}</p>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm">{t("memory.save")}</button>
              <button type="button" onClick={() => setEditingMemory(false)} className="btn btn-outline btn-sm">{t("memory.cancel")}</button>
            </div>
          </form>
        ) : isCoachMemoryEmpty(memory) ? (
          <p className="t-body mt-2 text-xs text-muted">{t("memory.empty")}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {memory.lesion && <span className="badge">{t("memory.chips.injury", { value: memory.lesion })}</span>}
            {memory.fase && <span className="badge">{t("memory.chips.phase", { value: memory.fase })}</span>}
            {memory.fecha_pelea && <span className="badge">{t("memory.chips.fight", { value: memory.fecha_pelea })}</span>}
            {memory.objetivo_peso_kg != null && !memoryWeightHidden && (
              <span className="badge">{t("memory.chips.weightGoal", { kg: memory.objetivo_peso_kg })}</span>
            )}
            {memory.tono && <span className="badge">{t("memory.chips.tone", { value: t(`memory.tones.${memory.tono}`) })}</span>}
            {memory.frecuencia_avisos && (
              <span className="badge">{t("memory.chips.alerts", { value: t(`memory.frequencies.${memory.frecuencia_avisos}`) })}</span>
            )}
          </div>
        )}
      </section>

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
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("chat.placeholder")} className="field flex-1 px-3.5 py-2.5 text-sm" />
            <button type="submit" className="btn btn-primary btn-sm shrink-0">{t("chat.send")}</button>
          </form>
        </div>
        <p className="t-body mt-2 text-center text-[11px] text-muted">
          {aiMode === "reglas" ? `${t("chat.rulesNotice")} ` : ""}
          {recovery == null && metrics?.weekAU === 0 ? `${t("chat.moreData")} ` : ""}
          {t("chat.disclaimer")}
        </p>
        {/* Detalle para quien lo quiera: el ratio solo existe con 28 días de historial (E.5) */}
        {(metrics?.acwr != null || metrics?.monotonia != null) && (
          <details className="mt-2 text-center">
            <summary className="t-label cursor-pointer text-muted">{t("advanced.title")}</summary>
            <p className="t-body mt-1 text-[11px] text-muted">
              {[
                metrics.acwr != null ? tl("ratio", { value: metrics.acwr.toFixed(2) }) : null,
                metrics.monotonia != null ? `${tl("monotony")} ${metrics.monotonia.toFixed(1)}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </details>
        )}
      </div>

    </div>
  );
}
