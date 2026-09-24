"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useBiometrics } from "@/lib/hooks";
import { computeRecovery, type Recovery } from "@/lib/recovery";
import { loadMetrics, type LoadMetrics } from "@/lib/load";
import { fetchServerMetrics } from "@/lib/activities";
import { useUserState } from "@/lib/user-state";
import {
  type CoachMemory,
  type CoachMemoryDraft,
  EMPTY_DRAFT,
  FREQUENCY_LABELS,
  TONE_LABELS,
  draftFromMemory,
  isCoachMemoryEmpty,
  memoryFromDraft,
  shouldShowRecForFrequency,
} from "@/lib/coach-memory";
import {
  CoachIcon, BoltIcon, ScaleIcon, MoonIcon, ChevronRight, GloveIcon,
} from "@/components/icons";

type FbEntry = { id: string; useful: boolean; ts: number };

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

/* --------------------- briefing y recomendaciones por reglas -------------- */

function buildBriefing(ctx: Ctx): string {
  const bits: string[] = [];
  if (ctx.recovery?.state === "cuidado") {
    bits.push("Tus señales de recuperación están bajas: hoy manda la técnica suave o el descanso activo.");
  } else if (ctx.metrics?.acwr != null && ctx.metrics.acwr > 1.3) {
    bits.push(`Tu carga sube demasiado rápido (ACWR ${ctx.metrics.acwr.toFixed(2)}): baja el volumen unos días.`);
  } else if (ctx.recovery?.state === "listo") {
    bits.push("Recuperación por encima de tu media: buen día para una sesión exigente.");
  } else if (ctx.metrics && ctx.metrics.weekAU > 0) {
    bits.push(`Semana en marcha: ${ctx.metrics.weekAU} AU acumuladas. Mantén el ritmo y registra cada sesión.`);
  } else {
    bits.push("Aún no te conozco del todo: registra tus entrenos (con RPE) y tus mediciones, y este briefing se volverá tuyo de verdad.");
  }
  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null) {
    const over = ctx.weight - ctx.weighTarget;
    if (over > 0.3 && ctx.weighDays <= 10) {
      bits.push(`Pesaje en ${ctx.weighDays} días y vas ${over.toFixed(1)} kg por encima: déficit suave, sin recortes agresivos todavía.`);
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

function buildRecs(ctx: Ctx): Rec[] {
  const recs: Rec[] = [];
  const m = ctx.metrics;

  if (m?.acwr != null && m.acwr > 1.3) {
    recs.push({
      id: "acwr-alto",
      icon: "load",
      tone: "warn",
      title: `Carga subiendo rápido (ACWR ${m.acwr.toFixed(2)})`,
      why: "Tu semana va muy por encima de tu media. Mete un día de técnica o descanso para volver a tu rango habitual.",
      action: { label: "Ver carga", href: "/training/load" },
    });
  } else if (m?.acwr != null && m.acwr < 0.8 && m.weekAU > 0 && ctx.recovery?.state !== "cuidado") {
    recs.push({
      id: "acwr-bajo",
      icon: "load",
      tone: "info",
      title: `Tienes margen (ACWR ${m.acwr.toFixed(2)})`,
      why: "Vas por debajo de tu media crónica: puedes apretar esta semana sin riesgo añadido.",
      action: { label: "Ir a entrenar", href: "/training" },
    });
  }

  if (ctx.recovery?.state === "cuidado") {
    recs.push({
      id: "recuperacion",
      icon: "rest",
      tone: "warn",
      title: "Señales de recuperación bajas",
      why: `${ctx.recovery.chips.join(" · ")}. Prioriza dormir 8 h; si mañana sigue igual, recorta el volumen.`,
    });
  }

  if (ctx.weighTarget != null && ctx.weighDays != null && ctx.weight != null && ctx.weight - ctx.weighTarget > 0.3) {
    recs.push({
      id: "pesaje",
      icon: "weigh",
      tone: ctx.weighDays <= 5 ? "warn" : "info",
      title: `${(ctx.weight - ctx.weighTarget).toFixed(1)} kg sobre el objetivo · pesaje en ${ctx.weighDays} d`,
      why: ctx.weighDays > 5
        ? "Margen razonable: mantén el déficit y no toques agua ni sodio todavía."
        : "Queda poco: revisa el plan y consulta a tu equipo antes de cualquier corte agresivo.",
      action: { label: "Plan de pesaje", href: "/nutrition/weigh-in" },
    });
  }

  if (ctx.lastWeightDays != null && ctx.lastWeightDays >= 14) {
    recs.push({
      id: "peso-viejo",
      icon: "weigh",
      tone: "info",
      title: `Sin pesarte desde hace ${ctx.lastWeightDays} días`,
      why: "Con un pesaje cada 1-2 semanas tu tendencia y tus macros se mantienen fiables.",
      action: { label: "Apuntar peso", href: "/biometrics/new" },
    });
  }

  if ((m == null || m.weekAU === 0) && recs.length === 0) {
    recs.push({
      id: "empieza",
      icon: "log",
      tone: "info",
      title: "Registra tu primera sesión de la semana",
      why: "Con tus entrenos (duración + RPE) calculo tu carga, tu ACWR y te aviso antes de que te pases o te quedes corto.",
      action: { label: "Ir a entrenar", href: "/training" },
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "ok",
      icon: "load",
      tone: "good",
      title: "Sin avisos: todo en orden 👊",
      // Solo afirma "zona segura y recuperación correcta" si de verdad hay datos de ambas
      why: m?.acwr != null && ctx.recovery
        ? "Carga en zona segura y recuperación correcta. Sigue tu plan y nos vemos mañana."
        : "Sin avisos por ahora. Cuantos más entrenos y mediciones registres, más fino seré.",
    });
  }
  return recs;
}

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

type Msg = { role: "coach" | "user"; text: string };
const QUICK = ["¿Cómo voy?", "¿Entreno fuerte hoy?", "¿Cómo va mi peso?"];

function coachReply(text: string, ctx: Ctx): string {
  const low = text.toLowerCase();
  const m = ctx.metrics;
  const acwrTxt = m?.acwr != null
    ? `ACWR ${m.acwr.toFixed(2)}${m.provisional ? " (provisional)" : ""}`
    : m != null && m.historyDays >= 10 && m.weekAU === 0
      ? "ACWR en pausa (sin sesiones en los últimos 7 días)"
      : "ACWR aún sin calcular (necesito ~10 días de sesiones)";
  if (/peso|pesaje|corte/.test(low)) {
    if (ctx.weight == null) return "Aún no tengo tu peso. Regístralo en Biometría y te sigo la tendencia.";
    if (ctx.weighTarget != null && ctx.weighDays != null) {
      const over = ctx.weight - ctx.weighTarget;
      return over > 0
        ? `Estás a ${over.toFixed(1)} kg del objetivo con ${ctx.weighDays} días de margen. Ritmo razonable: déficit moderado y nada de cortes de agua hasta las últimas 48-72 h, y con cabeza.`
        : `Ya estás en el peso objetivo (${ctx.weighTarget} kg) con ${ctx.weighDays} días de margen. Mantén y llega fresco.`;
    }
    return `Tu último peso es ${ctx.weight.toFixed(1)} kg. Si tienes combate, configura el pesaje en Nutrición y te llevo el plan.`;
  }
  if (/fuerte|intens|sparring|entren|hoy/.test(low)) {
    if (ctx.recovery?.state === "cuidado") return `Hoy no es el día de matarte: ${ctx.recovery.chips.join(" y ")}. Técnica de calidad (RPE 5-6) y a dormir.`;
    if (m?.acwr != null && m.acwr > 1.3) return `Tu ${acwrTxt} dice que llevas una subida fuerte. Mi llamada: sesión técnica hoy y la dura dentro de 2 días.`;
    if (ctx.recovery?.state === "listo") return `Recuperación por encima de tu media y ${acwrTxt}: dale duro hoy, tienes margen. Calienta bien.`;
    return `Con lo que veo (${acwrTxt}), un día normal de plan. Registra la sesión al acabar y ajusto el consejo.`;
  }
  if (/fatiga|cansad|dolor|recuper/.test(low)) {
    return ctx.recovery
      ? `Tus señales: ${ctx.recovery.chips.join(" · ")}. ${ctx.recovery.phrase}`
      : "No tengo tus señales de recuperación aún: registra FC en reposo y HRV unos días y te las leo cada mañana.";
  }
  if (/carga|acwr|riesgo/.test(low)) {
    return m && m.weekAU > 0
      ? `Semana: ${m.weekAU} AU. ${acwrTxt}. Monotonía ${m.monotonia != null ? m.monotonia.toFixed(1) : "—"}. Míralo frente a tu rango habitual, no como un umbral fijo, y evita dos picos seguidos.`
      : "Aún no hay sesiones esta semana. Registra tus entrenos con RPE y te calculo carga, ACWR y avisos.";
  }
  if (/cómo voy|como voy|resumen/.test(low)) {
    const parts: string[] = [];
    if (m && m.weekAU > 0) parts.push(`semana ${m.weekAU} AU, ${acwrTxt}`);
    if (ctx.recovery) parts.push(`recuperación: ${ctx.recovery.label.toLowerCase()}`);
    if (ctx.weight != null) parts.push(`peso ${ctx.weight.toFixed(1)} kg${ctx.weighTarget != null ? ` (objetivo ${ctx.weighTarget})` : ""}`);
    return parts.length > 0 ? `Tu foto de hoy: ${parts.join(" · ")}. ¿Quieres el plan del día?` : "Aún no tengo datos tuyos. Empieza registrando un entreno o tu peso y hablamos.";
  }
  if (/gracias|ok|vale|genial/.test(low)) return "A trabajar. Registra la sesión cuando acabes y la cuento en tu carga. 🥊";
  return `Te leo. Pregúntame por el entreno de hoy, tu carga, tu peso o tu recuperación — te contesto con tus números reales.`;
}

/* --------------------------------- página --------------------------------- */

export default function CoachPage() {
  const { data: logs = [] } = useBiometrics();
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null);
  const [weigh, setWeigh] = useState<{ target: number; date: string } | null>(null);
  const { value: dismissed, setValue: setDismissed } = useUserState<string[]>(bareDismissKey(), []);
  const { value: fb, setValue: setFb } = useUserState<FbEntry[]>("coach_fb", []);
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});

  /* Memoria persistente del coach: lo que el atleta cuenta de sí mismo */
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
    // Pre-existente a este cambio.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetrics(loadMetrics());
    fetchServerMetrics().then((m) => { if (alive && m) setMetrics(m); });
    try {
      const w = JSON.parse(localStorage.getItem("flp_weigh") ?? "null");
      if (w && typeof w.target === "number" && typeof w.date === "string" && !Number.isNaN(new Date(w.date).getTime())) {
        setWeigh(w);
      }
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

  const recs = buildRecs(ctx)
    .filter((r) => !dismissed.includes(r.id))
    .filter((r) => shouldShowRecForFrequency(r.tone, memory.frecuencia_avisos));

  function dismiss(id: string) {
    setDismissed([...dismissed, id]);
  }
  function vote(id: string, useful: boolean) {
    setFeedback((f) => ({ ...f, [id]: useful }));
    setFb([...fb, { id, useful, ts: Date.now() }].slice(-200));
  }

  /* chat */
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([
    { role: "coach", text: "Buenas. Pregúntame por tu entreno, tu carga, tu peso o tu recuperación: te contesto con tus números." },
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
    const t = text.trim();
    if (!t || typing) return;
    setInput("");
    const history: Msg[] = [...chatMsgs, { role: "user", text: t }];
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
      const data = (await res.json()) as { reply?: unknown };
      if (typeof data.reply !== "string" || !data.reply) throw new Error("sin respuesta");
      setChatMsgs((m) => [...m, { role: "coach", text: data.reply as string }]);
      setAiMode("ia");
    } catch {
      if (ctrl.signal.aborted) return; // se salió de la vista: no tocar el estado
      // IA no configurada o caída: respuesta por reglas con los datos locales
      setChatMsgs((m) => [...m, { role: "coach", text: coachReply(t, ctx) }]);
      setAiMode("reglas");
    } finally {
      if (!ctrl.signal.aborted) setTyping(false);
    }
  }
  function mockVoice() {
    setListening(true);
    setTimeout(() => { setListening(false); send("¿Entreno fuerte hoy o me lo tomo suave?"); }, 1300);
  }

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><CoachIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Coach</h1>
      </div>

      {/* Contexto real */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge">{metrics?.acwr != null ? `ACWR ${metrics.acwr.toFixed(2)}${metrics.provisional ? "*" : ""}` : "ACWR —"}</span>
        <span className="badge">Semana {metrics?.weekAU ?? 0} AU</span>
        {weight != null && <span className="badge">{weight.toFixed(1)} kg</span>}
        {weighDays != null && <span className="badge">Pesaje en {weighDays} d</span>}
        {recovery && <span className="badge" style={{ color: recovery.color }}>{recovery.label}</span>}
      </div>

      {/* Briefing por reglas con datos reales */}
      <section className="glass neon-edge mt-4 p-5">
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-neon">Briefing de hoy</p>
          <span className="badge">con tus datos</span>
        </div>
        <p className="t-body mt-2 text-ink">{buildBriefing(ctx)}</p>
        <div className="mt-3 flex gap-2">
          <Link href="/training" className="btn btn-tonal btn-sm"><GloveIcon className="h-4 w-4" /> Ir a entrenar</Link>
          <Link href="/nutrition" className="btn btn-outline btn-sm">Ver nutrición</Link>
        </div>
      </section>

      {/* Recomendaciones por reglas */}
      {recs.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="t-eyebrow text-muted">Recomendaciones</p>
            <span className="t-body text-[10px] text-muted">por reglas · IA real próximamente</span>
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
                          <button onClick={() => dismiss(r.id)} className="t-label text-muted">Descartar</button>
                        )}
                        <span className="ml-auto flex items-center gap-1.5">
                          {voted === undefined ? (
                            <>
                              <button onClick={() => vote(r.id, true)} aria-label="Útil" className="text-muted hover:text-good">👍</button>
                              <button onClick={() => vote(r.id, false)} aria-label="No útil" className="text-muted hover:text-bad">👎</button>
                            </>
                          ) : (
                            <span className="t-body text-[10px] text-muted">{voted ? "¡Gracias! 👍" : "Anotado 👎"}</span>
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
        <div className="flex items-center justify-between">
          <p className="t-eyebrow text-muted">Lo que tu coach sabe de ti</p>
          {!editingMemory && memoryHydrated && (
            <button onClick={openMemoryEdit} className="t-label text-neon">
              {isCoachMemoryEmpty(memory) ? "Contarle a mi coach" : "Editar"}
            </button>
          )}
        </div>

        {editingMemory ? (
          <form className="mt-3 flex flex-col gap-3" onSubmit={saveMemory}>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Lesión o molestia activa</span>
              <input
                value={memoryDraft.lesion}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, lesion: e.target.value }))}
                placeholder="Ej.: molestia en el hombro derecho"
                maxLength={200}
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Fase del campamento o de la temporada</span>
              <input
                value={memoryDraft.fase}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, fase: e.target.value }))}
                placeholder="Ej.: base, pico, fuera de temporada…"
                maxLength={120}
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Fecha de la pelea o competición</span>
              <input
                type="date"
                value={memoryDraft.fechaPelea}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, fechaPelea: e.target.value }))}
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Objetivo de peso (kg)</span>
              <input
                inputMode="decimal"
                value={memoryDraft.objetivoPesoKg}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, objetivoPesoKg: e.target.value }))}
                placeholder="Ej.: 77.5"
                className="field px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Cómo prefieres que te hable</span>
              <select
                value={memoryDraft.tono}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, tono: e.target.value as CoachMemoryDraft["tono"] }))}
                className="field px-3 py-2 text-sm"
              >
                <option value="">Sin preferencia</option>
                {(Object.keys(TONE_LABELS) as (keyof typeof TONE_LABELS)[]).map((t) => (
                  <option key={t} value={t}>{TONE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted">Frecuencia de avisos</span>
              <select
                value={memoryDraft.frecuenciaAvisos}
                onChange={(e) => setMemoryDraft((d) => ({ ...d, frecuenciaAvisos: e.target.value as CoachMemoryDraft["frecuenciaAvisos"] }))}
                className="field px-3 py-2 text-sm"
              >
                <option value="">Sin preferencia</option>
                {(Object.keys(FREQUENCY_LABELS) as (keyof typeof FREQUENCY_LABELS)[]).map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
                ))}
              </select>
            </label>
            <p className="t-body text-[11px] text-muted">
              Esto se guarda en tu cuenta para que el coach lo recuerde entre conversaciones y adapte sus avisos.
              No es información médica ni se comparte con nadie más que tu coach de IA: bórrala cuando quieras.
            </p>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
              <button type="button" onClick={() => setEditingMemory(false)} className="btn btn-outline btn-sm">Cancelar</button>
            </div>
          </form>
        ) : isCoachMemoryEmpty(memory) ? (
          <p className="t-body mt-2 text-xs text-muted">
            Aún no me has contado nada. Cuéntame tu lesión, tu fase, tu próxima pelea, tu objetivo de peso o cómo prefieres
            que te hable, y lo tendré en cuenta en el chat.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {memory.lesion && <span className="badge">Lesión: {memory.lesion}</span>}
            {memory.fase && <span className="badge">Fase: {memory.fase}</span>}
            {memory.fecha_pelea && <span className="badge">Pelea: {memory.fecha_pelea}</span>}
            {memory.objetivo_peso_kg != null && <span className="badge">Objetivo: {memory.objetivo_peso_kg} kg</span>}
            {memory.tono && <span className="badge">Tono: {TONE_LABELS[memory.tono]}</span>}
            {memory.frecuencia_avisos && <span className="badge">Avisos: {FREQUENCY_LABELS[memory.frecuencia_avisos]}</span>}
          </div>
        )}
      </section>

      {/* Chat */}
      <div className="mt-5">
        <div className="flex items-center gap-2">
          <p className="t-eyebrow text-muted">Habla con tu coach</p>
          <span className="badge badge-neon">{aiMode === "ia" ? "IA real" : aiMode === "reglas" ? "por reglas" : "IA"}</span>
        </div>
        <div className="glass mt-2 flex h-[42dvh] flex-col overflow-hidden p-3">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {chatMsgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "text-[#03101c]" : "text-ink"}`}
                  style={m.role === "user" ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(150,190,255,0.14)" }}>
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[rgba(150,190,255,0.14)] bg-[rgba(255,255,255,0.06)] px-3.5 py-2.5">
                  <span className="pulse text-sm text-muted">El coach está escribiendo…</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK.map((qq) => <button key={qq} onClick={() => send(qq)} disabled={typing} className="badge disabled:opacity-50">{qq}</button>)}
          </div>
          <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <button type="button" onClick={mockVoice} aria-label="Hablar"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>🎤</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Escuchando…" : "Pregunta a tu coach…"} className="field flex-1 px-3.5 py-2.5 text-sm" />
            <button type="submit" className="btn btn-primary btn-sm shrink-0">Enviar</button>
          </form>
        </div>
        <p className="t-body mt-2 text-center text-[11px] text-muted">
          {aiMode === "reglas" ? "IA no disponible ahora: te respondo por reglas con tus datos. " : ""}
          {recovery == null && metrics?.weekAU === 0 ? "Cuantos más datos registres, mejor te aconsejo. " : ""}
          El coach es orientativo, no es consejo médico. {metrics?.acwr != null && metrics.provisional ? "*ACWR provisional hasta 4 semanas de historial." : ""}
        </p>
      </div>

    </div>
  );
}
