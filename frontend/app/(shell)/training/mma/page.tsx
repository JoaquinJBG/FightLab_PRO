"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GloveIcon, InfoIcon } from "@/components/icons";

const RPE_INFO = "RPE = Esfuerzo Percibido (escala 1-10): cómo de duro sientes el entreno. 1 = muy suave, 10 = máximo esfuerzo (no puedes más).";

const ARTS = ["Boxeo", "Kickboxing", "Muay Thai", "BJJ", "Lucha", "Taekwondo"] as const;
type Art = (typeof ARTS)[number];
type Mode = "Técnica" | "Intensidad";

const GRAPPLING: Art[] = ["BJJ", "Lucha"];

function planFor(art: Art, mode: Mode, minutes?: number): string {
  const grap = GRAPPLING.includes(art);
  const time = minutes ? `${minutes} min` : "tu sesión";
  if (mode === "Técnica") {
    const body = grap
      ? `drilling lento de una posición concreta (ej. ${art === "BJJ" ? "guardia cerrada o paso de guardia" : "entrada a derribo"}), repeticiones limpias y sin prisa`
      : `sombra centrada en guardia y footwork + saco ligero buscando precisión y combinaciones (no potencia)`;
    return `Para ${art} técnica en ${time}: ${body}. RPE bajo-medio; prioriza la forma sobre el cansancio.`;
  }
  const body = grap
    ? `rounds de ${art === "BJJ" ? "rolling" : "lucha en vivo"} a ritmo alto con descansos cortos`
    : `rounds duros de saco/manoplas y, si puedes, sparring controlado a buen ritmo`;
  return `Para ${art} intensidad en ${time}: ${body}. RPE alto; calienta bien antes y baja pulsaciones al final.`;
}

function reminderFor(art: Art): string {
  if (GRAPPLING.includes(art)) return "Recuerda: uñas cortas e higiene del kimono/rashguard, y cuida codos y rodillas en las palancas.";
  return `Recuerda: ${art === "Muay Thai" || art === "Kickboxing" ? "vendas, espinilleras y bucal" : "vendas y bucal"}, y protege bien las muñecas.`;
}

function coachReply(text: string, art: Art, mode: Mode): string {
  const low = text.toLowerCase();
  const mins = low.match(/(\d{1,3})\s*min/);
  if (/estir|stretch/.test(low)) return "Cierra con 5-8 min de estiramientos suaves (cadera, isquios, hombros y cuello) y respiración. Mantén cada estiramiento 20-30 s sin rebotes.";
  if (/calent|warm|caliento/.test(low)) return "Calienta 8-10 min: movilidad articular, cuerda o trote suave y series progresivas de la técnica del día. No entres en frío al sparring.";
  if (/hidrat|agua|beb/.test(low)) return "Bebe a sorbos durante toda la sesión; en intensidad alta, añade electrolitos. Llega ya hidratado, no esperes a tener sed.";
  if (mins) return `${planFor(art, mode, Number(mins[1]))} ${reminderFor(art)}`;
  if (/qué|que|plan|rutina|hoy|empez|empiezo|hago/.test(low)) return `${planFor(art, mode)} ${reminderFor(art)}`;
  return `Entendido. ${planFor(art, mode)} ${reminderFor(art)}`;
}

type Msg = { role: "coach" | "user"; text: string };
const QUICK = ["¿Qué hago hoy?", "Tengo 30 min", "Recuérdame estirar"];

export default function MmaPage() {
  const [art, setArt] = useState<Art>("Boxeo");
  const [mode, setMode] = useState<Mode>("Técnica");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "coach", text: "¡Listo para entrenar! Dime qué quieres hacer hoy (o usa el micro) y te preparo la sesión." },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [rpeInfo, setRpeInfo] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setTyping(true);
    const reply = coachReply(t, art, mode);
    setTimeout(() => {
      setMsgs((m) => [...m, { role: "coach", text: reply }]);
      setTyping(false);
    }, 650);
  }

  function mockVoice() {
    setListening(true);
    setTimeout(() => {
      setListening(false);
      send(`Hoy quiero hacer ${art.toLowerCase()} de ${mode.toLowerCase()}, unos 30 min`);
    }, 1300);
  }

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><GloveIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">MMA</h1>
        <span className="badge badge-neon">IA simulada</span>
      </div>

      {/* Arte marcial */}
      <div className="mt-3">
        <span className="t-eyebrow text-muted">Arte marcial</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {ARTS.map((a) => (
            <button key={a} onClick={() => setArt(a)}
              className={`badge ${art === a ? "badge-neon" : ""}`}>{a}</button>
          ))}
        </div>
      </div>

      {/* Modo */}
      <div className="mt-3">
        <div className="glass grid grid-cols-2 gap-1 rounded-2xl p-1">
          {(["Técnica", "Intensidad"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
              style={mode === m ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
              {m}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-1.5">
          <p className="t-body text-xs text-muted">
            {mode === "Técnica"
              ? "Trabajo técnico a baja intensidad: precisión, repetición, forma (RPE bajo-medio)."
              : "Acondicionamiento/sparring a alta intensidad: rounds exigentes (RPE alto)."}
          </p>
          <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label="Qué es RPE"
            className={`shrink-0 ${rpeInfo ? "text-neon" : "text-muted hover:text-neon"}`}>
            <InfoIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {rpeInfo && (
          <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">
            {RPE_INFO}
          </p>
        )}
      </div>

      {/* Chat coach IA */}
      <div className="glass mt-4 flex flex-1 flex-col overflow-hidden p-3">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "text-[#03101c]" : "text-ink"}`}
                style={m.role === "user"
                  ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)" }
                  : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(150,190,255,0.14)" }}>
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

        {/* quick replies */}
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} className="badge">{q}</button>
          ))}
        </div>

        {/* input + voz */}
        <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <button type="button" onClick={mockVoice} aria-label="Hablar"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>
            🎤
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Escuchando…" : "Escribe o pulsa el micro…"}
            className="field flex-1 px-3.5 py-2.5 text-sm" />
          <button type="submit" className="btn btn-primary btn-sm shrink-0">Enviar</button>
        </form>
      </div>
    </div>
  );
}
