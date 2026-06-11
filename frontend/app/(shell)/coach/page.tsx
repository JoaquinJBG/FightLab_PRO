"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CoachIcon, BoltIcon, ScaleIcon, MoonIcon, ChevronRight, GloveIcon,
} from "@/components/icons";

/* --- contexto mock del atleta (AIContext; vendrá del backend + sesiones) --- */
const CTX = { acwr: 1.18, readiness: 78, weight: 78.4, weighTarget: 77, weighDays: 9, rhrTrend: "+4 bpm" };

/* --- recomendaciones proactivas --- */
type Rec = {
  id: string;
  icon: "load" | "weigh" | "rest";
  tone: "warn" | "info" | "good";
  title: string;
  why: string;
  action?: { label: string; href?: string };
};
const RECS: Rec[] = [
  {
    id: "acwr",
    icon: "load",
    tone: "warn",
    title: "Tu carga sube rápido (ACWR 1.18)",
    why: "Llevas 3 días seguidos de intensidad. Si sigues así entras en zona de riesgo (>1.3). Hoy te propongo técnica suave.",
    action: { label: "Aplicar al plan" },
  },
  {
    id: "weigh",
    icon: "weigh",
    tone: "info",
    title: `${(CTX.weight - CTX.weighTarget).toFixed(1)} kg sobre el objetivo · pesaje en ${CTX.weighDays} días`,
    why: "Vas bien de margen. Mantén el déficit actual y no recortes agua todavía.",
    action: { label: "Ver plan de pesaje", href: "/nutrition/weigh-in" },
  },
  {
    id: "rest",
    icon: "rest",
    tone: "info",
    title: `FC en reposo ${CTX.rhrTrend} esta semana`,
    why: "Puede ser fatiga acumulada o mal sueño. Prioriza dormir 8 h hoy; si mañana sigue alta, baja el volumen.",
  },
];
const REC_ICON = { load: BoltIcon, weigh: ScaleIcon, rest: MoonIcon } as const;
const TONE_COLOR = { warn: "#ffd25a", info: "#45e9ff", good: "#43e8a0" } as const;

const DISMISS_KEY = "flp_coach_dismissed";

/* --- chat simulado --- */
type Msg = { role: "coach" | "user"; text: string };
const QUICK = ["¿Cómo voy?", "¿Entreno fuerte hoy?", "Hazme la dieta de hoy"];

function coachReply(text: string): string {
  const low = text.toLowerCase();
  if (/dieta|comida|comer|macros|nutri/.test(low))
    return `Para hoy: prioriza proteína en cada comida (~2 g/kg) y carbohidrato alrededor del entreno. Con el pesaje a ${CTX.weighDays} días, mantén el déficit suave — nada agresivo aún. Registra las comidas en Nutrición y lo voy siguiendo.`;
  if (/peso|pesaje|corte/.test(low))
    return `Estás a ${(CTX.weight - CTX.weighTarget).toFixed(1)} kg del objetivo con ${CTX.weighDays} días de margen: ritmo correcto (~0.15 kg/día con déficit moderado). No toques agua ni sodio todavía; eso es solo para las últimas 48-72 h y con cabeza.`;
  if (/fuerte|intens|sparring|entren|hoy/.test(low))
    return `Tu readiness está en ${CTX.readiness} (bien), pero el ACWR en ${CTX.acwr} dice que llevas una subida rápida de carga. Mi llamada: técnica de calidad hoy (RPE 5-6) y guarda la sesión dura para pasado mañana. Ganarás más a 7 días vista.`;
  if (/fatiga|cansad|dolor|recuper/.test(low))
    return `Con la FC en reposo ${CTX.rhrTrend} y la carga alta, hoy manda recuperar: movilidad 15', paseo y 8 h de sueño. Si mañana amaneces igual, recorto el volumen un 30%. La fatiga que ignoras es la lesión que te para un mes.`;
  if (/carga|acwr|riesgo/.test(low))
    return `ACWR ${CTX.acwr}: tu carga de 7 días va por encima de tu media de 28. Aún en zona segura (0.8–1.3), pero al límite. Evita dos picos seguidos esta semana y vuelves a 1.0 sin perder forma.`;
  if (/gracias|ok|vale|genial/.test(low)) return "A trabajar. Registra la sesión cuando acabes y la cuento en tu carga. 🥊";
  return `Te leo. Mi foto de hoy: readiness ${CTX.readiness}, ACWR ${CTX.acwr}, ${(CTX.weight - CTX.weighTarget).toFixed(1)} kg sobre el peso objetivo. Pregúntame por el entreno, la dieta o el pesaje y te doy el plan concreto.`;
}

export default function CoachPage() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "coach", text: `Buenas. He revisado tus números: readiness ${CTX.readiness}, ACWR ${CTX.acwr} y el pesaje a ${CTX.weighDays} días. ¿Hablamos del plan de hoy?` },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]"); if (Array.isArray(d)) setDismissed(d); } catch { /* noop */ }
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  function dismiss(id: string) {
    const n = [...dismissed, id];
    setDismissed(n);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(n));
  }
  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setTyping(true);
    const reply = coachReply(t);
    setTimeout(() => { setMsgs((m) => [...m, { role: "coach", text: reply }]); setTyping(false); }, 700);
  }
  function mockVoice() {
    setListening(true);
    setTimeout(() => { setListening(false); send("¿Entreno fuerte hoy o me lo tomo suave?"); }, 1300);
  }

  const visibleRecs = RECS.filter((r) => !dismissed.includes(r.id));

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><CoachIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Coach</h1>
        <span className="badge badge-neon">IA simulada</span>
      </div>

      {/* Contexto que ve el coach */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge">ACWR {CTX.acwr}</span>
        <span className="badge">Readiness {CTX.readiness}</span>
        <span className="badge">{CTX.weight} kg</span>
        <span className="badge">Pesaje en {CTX.weighDays} d</span>
      </div>

      {/* Briefing de hoy */}
      <section className="glass neon-edge mt-4 p-5">
        <p className="t-eyebrow text-neon">Briefing de hoy</p>
        <p className="t-body mt-2 text-ink">
          Llevas una semana cargando bien, pero el ritmo de subida es alto. Hoy:{" "}
          <span className="text-neon">técnica de calidad</span> (RPE 5-6), proteína en cada comida y
          a la cama temprano. La sesión dura, pasado mañana.
        </p>
        <div className="mt-3 flex gap-2">
          <Link href="/training/mma" className="btn btn-tonal btn-sm"><GloveIcon className="h-4 w-4" /> Ir a entrenar</Link>
          <Link href="/nutrition" className="btn btn-outline btn-sm">Ver nutrición</Link>
        </div>
      </section>

      {/* Recomendaciones proactivas */}
      {visibleRecs.length > 0 && (
        <div className="mt-5">
          <p className="t-eyebrow text-muted">Recomendaciones</p>
          <div className="mt-2 flex flex-col gap-2.5">
            {visibleRecs.map((r) => {
              const Icon = REC_ICON[r.icon];
              const color = TONE_COLOR[r.tone];
              const isApplied = applied.includes(r.id);
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
                        {r.action && (r.action.href ? (
                          <Link href={r.action.href} className="btn btn-tonal btn-sm">{r.action.label} <ChevronRight className="h-3.5 w-3.5" /></Link>
                        ) : (
                          <button onClick={() => setApplied((a) => [...a, r.id])} disabled={isApplied} className="btn btn-tonal btn-sm disabled:opacity-60">
                            {isApplied ? "Aplicado ✓" : r.action.label}
                          </button>
                        ))}
                        <button onClick={() => dismiss(r.id)} className="t-label text-muted">Descartar</button>
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
        <p className="t-eyebrow text-muted">Habla con tu coach</p>
        <div className="glass mt-2 flex h-[46dvh] flex-col overflow-hidden p-3">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {msgs.map((m, i) => (
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
            {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="badge">{q}</button>)}
          </div>
          <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <button type="button" onClick={mockVoice} aria-label="Hablar"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>🎤</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Escuchando…" : "Pregunta a tu coach…"} className="field flex-1 px-3.5 py-2.5 text-sm" />
            <button type="submit" className="btn btn-primary btn-sm shrink-0">Enviar</button>
          </form>
        </div>
        <p className="t-body mt-2 text-center text-[11px] text-muted">
          El coach es orientativo, no es consejo médico. IA simulada · pronto con tus datos reales.
        </p>
      </div>
    </div>
  );
}
