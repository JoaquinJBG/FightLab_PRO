"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GloveIcon, InfoIcon, CoachIcon } from "@/components/icons";

const RPE_INFO = "RPE = Esfuerzo Percibido (escala 1-10): cómo de duro sientes el entreno. 1 = muy suave, 10 = máximo esfuerzo (no puedes más).";

const ARTS = ["Boxeo", "Kickboxing", "Muay Thai", "BJJ", "Lucha", "Taekwondo", "Karate", "MMA"] as const;
type Art = (typeof ARTS)[number];
type Mode = "Técnica" | "Intensidad";
const GRAPPLING: Art[] = ["BJJ", "Lucha"];

function planFor(art: Art, mode: Mode, minutes?: number): string {
  const grap = GRAPPLING.includes(art);
  const time = minutes ? `${minutes} min` : "tu sesión";
  if (mode === "Técnica") {
    const body = grap
      ? `drilling lento de una posición concreta (ej. ${art === "BJJ" ? "guardia cerrada o paso de guardia" : "entrada a derribo"}), repeticiones limpias`
      : "sombra centrada en guardia y footwork + saco ligero buscando precisión (no potencia)";
    return `${art} técnica en ${time}: ${body}. RPE bajo-medio; forma sobre cansancio.`;
  }
  const body = grap
    ? `rounds de ${art === "BJJ" ? "rolling" : "lucha en vivo"} a ritmo alto con descansos cortos`
    : "rounds duros de saco/manoplas y sparring controlado a buen ritmo";
  return `${art} intensidad en ${time}: ${body}. RPE alto; calienta bien y baja pulsaciones al final.`;
}
function reminderFor(art: Art): string {
  if (GRAPPLING.includes(art)) return "Uñas cortas, higiene del kimono/rashguard y cuida codos y rodillas.";
  return `Lleva ${art === "Muay Thai" || art === "Kickboxing" ? "vendas, espinilleras y bucal" : "vendas y bucal"}; protege las muñecas.`;
}
function coachReply(text: string, art: Art, mode: Mode): string {
  const low = text.toLowerCase();
  const mins = low.match(/(\d{1,3})\s*min/);
  if (/estir|stretch/.test(low)) return "Cierra con 5-8 min de estiramientos suaves (cadera, isquios, hombros, cuello), 20-30 s cada uno, sin rebotes.";
  if (/calent|warm|caliento/.test(low)) return "Calienta 8-10 min: movilidad, cuerda o trote suave y series progresivas de la técnica del día. No entres en frío al sparring.";
  if (/hidrat|agua|beb/.test(low)) return "Bebe a sorbos toda la sesión; en intensidad alta añade electrolitos. Llega ya hidratado.";
  if (mins) return `${planFor(art, mode, Number(mins[1]))} ${reminderFor(art)}`;
  if (/qué|que|plan|rutina|hoy|empez|hago/.test(low)) return `${planFor(art, mode)} ${reminderFor(art)}`;
  return `Entendido. ${planFor(art, mode)} ${reminderFor(art)}`;
}

type Msg = { role: "coach" | "user"; text: string };
const QUICK = ["¿Qué hago hoy?", "Tengo 30 min", "Recuérdame estirar"];

type Sess = { id: string; art: string; mode: string; minutes: number; rpe: number; load: number; ts: number };
const KEY = "flp_mma";
const loadSess = (): Sess[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const t = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `Hoy · ${t}` : `${d.toLocaleDateString("es", { day: "2-digit", month: "short" })} · ${t}`;
};

function Stepper({ label, value, set, min, max, step = 1, suffix = "" }: {
  label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; suffix?: string;
}) {
  return (
    <div className="glass flex flex-col items-center gap-2 p-3">
      <span className="t-label text-muted">{label}</span>
      <div className="flex w-full items-center justify-between">
        <button type="button" onClick={() => set(Math.max(min, value - step))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
        <span className="stat text-xl text-ink">{value}{suffix}</span>
        <button type="button" onClick={() => set(Math.min(max, value + step))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
      </div>
    </div>
  );
}

export default function MmaPage() {
  const [art, setArt] = useState<Art>("Boxeo");
  const [mode, setMode] = useState<Mode>("Técnica");
  const [rpeInfo, setRpeInfo] = useState(false);

  // sesión
  const [minutes, setMinutes] = useState(30);
  const [rpe, setRpe] = useState(6);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => setSessions(loadSess()), []);
  const load = minutes * rpe;

  function saveSession() {
    const s: Sess = { id: `${Date.now()}`, art, mode, minutes, rpe, load, ts: Date.now() };
    const all = [s, ...loadSess()].slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(all));
    setSessions(all);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  // chat
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "coach", text: "¡Listo para entrenar! Dime qué quieres hacer (o usa el micro) y te preparo la sesión." }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chatOpen) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing, chatOpen]);

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setTyping(true);
    const reply = coachReply(t, art, mode);
    setTimeout(() => { setMsgs((m) => [...m, { role: "coach", text: reply }]); setTyping(false); }, 650);
  }
  function mockVoice() {
    setListening(true);
    setTimeout(() => { setListening(false); send(`Hoy quiero hacer ${art.toLowerCase()} de ${mode.toLowerCase()}, unos ${minutes} min`); }, 1300);
  }

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><GloveIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">MMA</h1>
      </div>

      {/* Arte marcial (select) */}
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="t-label text-muted">Arte marcial</span>
        <select value={art} onChange={(e) => setArt(e.target.value as Art)} className="field px-4 py-3 text-sm">
          {ARTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

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
            {mode === "Técnica" ? "Trabajo técnico a baja intensidad (RPE bajo-medio)." : "Sparring/acondicionamiento a alta intensidad (RPE alto)."}
          </p>
          <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label="Qué es RPE" className={`shrink-0 ${rpeInfo ? "text-neon" : "text-muted hover:text-neon"}`}><InfoIcon className="h-3.5 w-3.5" /></button>
        </div>
        {rpeInfo && <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{RPE_INFO}</p>}
      </div>

      {/* Plan sugerido */}
      <div className="glass neon-edge mt-4 p-4">
        <p className="t-eyebrow text-neon">Plan sugerido</p>
        <p className="t-body mt-1.5 text-ink">{planFor(art, mode, minutes)}</p>
        <p className="t-body mt-2 text-xs text-muted">⚠️ {reminderFor(art)}</p>
        <p className="t-body mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5 text-[11px] text-muted">
          Ahora se basa solo en el arte y el modo. Pronto: <span className="text-neon">personalizada por IA</span> según tu historial y tu carga.
        </p>
      </div>

      {/* Registrar sesión */}
      <div className="mt-4">
        <p className="t-eyebrow text-muted">Registrar sesión</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Stepper label="Duración" value={minutes} set={setMinutes} min={5} max={240} step={5} suffix=" min" />
          <Stepper label="RPE" value={rpe} set={setRpe} min={1} max={10} />
        </div>
        <div className="glass mt-3 flex items-center justify-between p-4">
          <span className="t-label text-muted">Carga estimada <span className="text-[10px]">(min × RPE)</span></span>
          <span className="stat text-2xl neon-text">{load} <span className="text-xs text-muted">AU</span></span>
        </div>
        <button className="btn btn-primary mt-3 w-full" onClick={saveSession}>{savedFlash ? "Guardado ✓" : "Guardar sesión"}</button>
      </div>

      {/* Historial MMA */}
      {sessions.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="t-eyebrow text-muted">Tus sesiones MMA</p>
            <button onClick={() => { localStorage.removeItem(KEY); setSessions([]); }} className="t-label text-muted">Borrar</button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {sessions.map((s) => (
              <div key={s.id} className="glass flex items-center gap-3 p-3.5">
                <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]"><GloveIcon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="t-label text-ink">{s.art} <span className="text-muted">· {s.mode}</span></p>
                  <p className="t-body text-[11px] text-muted">{fmtDate(s.ts)} · {s.minutes} min · RPE {s.rpe}</p>
                </div>
                <span className="stat text-neon">{s.load} <span className="text-[10px] text-muted">AU</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Burbuja coach IA */}
      <button onClick={() => setChatOpen(true)} aria-label="Abrir chat del coach"
        className="btn-neon fixed bottom-28 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ borderRadius: "9999px" }}>
        <CoachIcon className="h-7 w-7" />
      </button>

      {/* Overlay chat */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(2,4,10,0.55)" }} onClick={() => setChatOpen(false)}>
          <div className="glass mx-auto flex h-[78dvh] w-full max-w-md flex-col rounded-t-3xl p-3 safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-neon"><CoachIcon className="h-5 w-5" /></span>
                <p className="t-title text-ink">Coach IA</p>
                <span className="badge badge-neon">simulado</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="t-label text-muted">Cerrar ✕</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "text-[#03101c]" : "text-ink"}`}
                    style={m.role === "user" ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(150,190,255,0.14)" }}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && <div className="flex justify-start"><div className="rounded-2xl border border-[rgba(150,190,255,0.14)] bg-[rgba(255,255,255,0.06)] px-3.5 py-2.5"><span className="pulse text-sm text-muted">El coach está escribiendo…</span></div></div>}
              <div ref={endRef} />
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="badge">{q}</button>)}
            </div>
            <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <button type="button" onClick={mockVoice} aria-label="Hablar" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>🎤</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Escuchando…" : "Escribe o pulsa el micro…"} className="field flex-1 px-3.5 py-2.5 text-sm" />
              <button type="submit" className="btn btn-primary btn-sm shrink-0">Enviar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
