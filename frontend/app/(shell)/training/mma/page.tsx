"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { GloveIcon, InfoIcon, CoachIcon } from "@/components/icons";
import { deleteServerActivities, enqueueActivity } from "@/lib/activities";

// Los valores en español son los ids canónicos que se guardan (local + servidor); lo visible sale de i18n.
const ARTS = ["Boxeo", "Kickboxing", "Muay Thai", "BJJ", "Lucha", "Taekwondo", "Karate", "MMA"] as const;
type Art = (typeof ARTS)[number];
const GRAPPLING: Art[] = ["BJJ", "Lucha"];
const ART_ID: Record<string, string> = {
  Boxeo: "boxing", Kickboxing: "kickboxing", "Muay Thai": "muayThai", BJJ: "bjj",
  Lucha: "wrestling", Taekwondo: "taekwondo", Karate: "karate", MMA: "mma",
};

// Tipo de trabajo: lo que registran los cuadernos de entrenamiento de combate
const WORK_TYPES = ["Sparring", "Drilling", "Pads", "Saco", "Técnica", "Acondicionamiento"] as const;
type WorkType = (typeof WORK_TYPES)[number];
const WT_ID: Record<string, string> = {
  Sparring: "sparring", Drilling: "drilling", Pads: "pads", Saco: "bag", Técnica: "technique", Acondicionamiento: "conditioning",
};

type Tr = ReturnType<typeof useTranslations>;

const artLabel = (t: Tr, art: string) => (ART_ID[art] ? t(`arts.${ART_ID[art]}`) : art);
const workLabel = (t: Tr, type: string) => (WT_ID[type] ? t(`workTypes.${WT_ID[type]}`) : type);

function planFor(t: Tr, art: Art, type: WorkType, minutes: number): string {
  const p = { art: artLabel(t, art), minutes };
  switch (type) {
    case "Sparring":
      return t("plan.sparring", { ...p, rounds: Math.max(3, Math.round(minutes / 6)) });
    case "Drilling":
      return t("plan.drilling", { ...p, kind: GRAPPLING.includes(art) ? "grappling" : "striking" });
    case "Pads":
      return t("plan.pads", p);
    case "Saco":
      return t("plan.bag", p);
    case "Técnica":
      return t("plan.technique", p);
    case "Acondicionamiento":
      return t("plan.conditioning", p);
  }
}
function reminderFor(t: Tr, art: Art): string {
  if (GRAPPLING.includes(art)) return t("reminder.grappling");
  return t(art === "Muay Thai" || art === "Kickboxing" ? "reminder.strikingShins" : "reminder.striking");
}
function coachReply(t: Tr, text: string, art: Art, type: WorkType, minutes: number): string {
  const low = text.toLowerCase();
  const mins = low.match(/(\d{1,3})\s*min/);
  if (/estir|stretch/.test(low)) return t("reply.stretch");
  if (/calent|warm|caliento/.test(low)) return t("reply.warmup");
  if (/hidrat|agua|beb|hydrat|water|drink/.test(low)) return t("reply.hydration");
  if (mins) return `${planFor(t, art, type, Number(mins[1]))} ${reminderFor(t, art)}`;
  if (/qué|que|plan|rutina|hoy|empez|hago|what|routine|today|start|\bdo\b/.test(low)) return `${planFor(t, art, type, minutes)} ${reminderFor(t, art)}`;
  return `${t("reply.ack")} ${planFor(t, art, type, minutes)} ${reminderFor(t, art)}`;
}

type Msg = { role: "coach" | "user"; text?: string }; // sin text = saludo inicial (se resuelve con i18n)
const QUICK_IDS = ["today", "thirtyMin", "stretch"] as const;

type Sess = {
  id: string;
  client_id?: string; // misma identidad en el dispositivo y en el servidor
  art: string;
  type?: string;
  mode?: string; // sesiones antiguas
  minutes: number;
  rpe: number;
  load: number;
  partner?: string | null;
  notes?: string | null;
  ts: number;
};
const KEY = "flp_mma";
const loadSess = (): Sess[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const fmtDate = (ts: number, locale: string, t: Tr) => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? t("date.today", { time })
    : t("date.dateTime", { date: d.toLocaleDateString(locale, { day: "2-digit", month: "short" }), time });
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
  const t = useTranslations("training.mma");
  const locale = useLocale();
  const [art, setArt] = useState<Art>("Boxeo");
  const [workType, setWorkType] = useState<WorkType>("Técnica");
  const [rpeInfo, setRpeInfo] = useState(false);

  // sesión
  const [minutes, setMinutes] = useState(30);
  const [rpe, setRpe] = useState(6);
  const [partner, setPartner] = useState("");
  const [notes, setNotes] = useState("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => setSessions(loadSess()), []);
  const load = minutes * rpe;

  function saveSession() {
    const ts = Date.now();
    const clientId = crypto.randomUUID();
    const s: Sess = {
      id: `${ts}`,
      client_id: clientId,
      art,
      type: workType,
      minutes,
      rpe,
      load,
      partner: partner.trim() || null,
      notes: notes.trim() || null,
      ts,
    };
    const all = [s, ...loadSess()].slice(0, 200);
    localStorage.setItem(KEY, JSON.stringify(all));
    enqueueActivity({
      client_id: clientId,
      kind: "MMA",
      title: art,
      started_at: new Date(ts - minutes * 60_000).toISOString(),
      duration_sec: minutes * 60,
      rpe,
      note: notes.trim().slice(0, 2000),
      detail: { art, work_type: workType, partner: partner.trim() || null },
    });
    setSessions(all);
    setPartner("");
    setNotes("");
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  // stats del mes (sobre el historial local)
  const now = new Date();
  const monthSessions = sessions.filter((s) => {
    const d = new Date(s.ts);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthMin = monthSessions.reduce((a, s) => a + (s.minutes || 0), 0);
  const monthAU = monthSessions.reduce((a, s) => a + (s.load || 0), 0);
  const byArt = monthSessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.art] = (acc[s.art] ?? 0) + (s.minutes || 0);
    return acc;
  }, {});
  const topArts = Object.entries(byArt).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxArtMin = topArts[0]?.[1] ?? 0;

  // chat
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "coach" }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chatOpen) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing, chatOpen]);

  function send(text: string) {
    const msg = text.trim();
    if (!msg) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: msg }]);
    setTyping(true);
    const reply = coachReply(t, msg, art, workType, minutes);
    setTimeout(() => { setMsgs((m) => [...m, { role: "coach", text: reply }]); setTyping(false); }, 650);
  }
  function mockVoice() {
    setListening(true);
    setTimeout(() => { setListening(false); send(t("voiceMessage", { work: workLabel(t, workType).toLowerCase(), art: artLabel(t, art).toLowerCase(), minutes })); }, 1300);
  }

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><GloveIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">MMA</h1>
      </div>

      {/* Arte marcial */}
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="t-label text-muted">{t("martialArt")}</span>
        <select value={art} onChange={(e) => setArt(e.target.value as Art)} className="field px-4 py-3 text-sm">
          {ARTS.map((a) => <option key={a} value={a}>{artLabel(t, a)}</option>)}
        </select>
      </label>

      {/* Tipo de trabajo */}
      <div className="mt-3">
        <span className="t-label text-muted">{t("workType")}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {WORK_TYPES.map((w) => (
            <button key={w} type="button" onClick={() => setWorkType(w)}
              className={`badge ${workType === w ? "badge-neon" : ""}`}>
              {workLabel(t, w)}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-1.5">
          <p className="t-body text-xs text-muted">{t(`hints.${WT_ID[workType]}`)}</p>
          <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label={t("rpeWhat")} className={`shrink-0 ${rpeInfo ? "text-neon" : "text-muted hover:text-neon"}`}><InfoIcon className="h-3.5 w-3.5" /></button>
        </div>
        {rpeInfo && <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{t("rpeInfo")}</p>}
      </div>

      {/* Plan sugerido */}
      <div className="glass neon-edge mt-4 p-4">
        <p className="t-eyebrow text-neon">{t("plan.title")}</p>
        <p className="t-body mt-1.5 text-ink">{planFor(t, art, workType, minutes)}</p>
        <p className="t-body mt-2 text-xs text-muted">⚠️ {reminderFor(t, art)}</p>
        <p className="t-body mt-3 border-t border-[rgba(150,190,255,0.1)] pt-2.5 text-[11px] text-muted">
          {t.rich("plan.note", { ai: (c) => <span className="text-neon">{c}</span> })}
        </p>
      </div>

      {/* Registrar sesión */}
      <div className="mt-4">
        <p className="t-eyebrow text-muted">{t("log.title")}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Stepper label={t("log.duration")} value={minutes} set={setMinutes} min={5} max={240} step={5} suffix={` ${t("log.minUnit")}`} />
          <Stepper label="RPE" value={rpe} set={setRpe} min={1} max={10} />
        </div>
        <input
          value={partner}
          onChange={(e) => setPartner(e.target.value)}
          placeholder={t("log.partnerPlaceholder")}
          className="field mt-3 w-full px-4 py-3 text-sm"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("log.notesPlaceholder")}
          rows={2}
          className="field mt-2 w-full resize-none px-4 py-3 text-sm"
        />
        <div className="glass mt-3 flex items-center justify-between p-4">
          <span className="t-label text-muted">{t("log.estimatedLoad")} <span className="text-[10px]">{t("log.loadFormula")}</span></span>
          <span className="stat text-2xl neon-text">{load} <span className="text-xs text-muted">{t("au")}</span></span>
        </div>
        <button className="btn btn-primary mt-3 w-full" onClick={saveSession}>{savedFlash ? t("log.saved") : t("log.save")}</button>
      </div>

      {/* Stats del mes */}
      {monthSessions.length > 0 && (
        <div className="glass mt-5 p-4">
          <p className="t-eyebrow text-muted">{t("month.title")}</p>
          <div className="mt-2 flex justify-between text-center">
            <div><p className="stat text-xl text-ink">{monthSessions.length}</p><p className="t-label text-muted">{t("month.sessions")}</p></div>
            <div><p className="stat text-xl text-ink">{t("month.hours", { n: (monthMin / 60).toFixed(1) })}</p><p className="t-label text-muted">{t("month.time")}</p></div>
            <div><p className="stat text-xl neon-text">{monthAU}</p><p className="t-label text-muted">{t("au")}</p></div>
          </div>
          {topArts.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.1)] pt-3">
              {topArts.map(([a, min]) => (
                <div key={a} className="flex items-center gap-2">
                  <span className="t-label w-20 shrink-0 text-muted">{artLabel(t, a)}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-[rgba(150,190,255,0.12)]">
                    <div className="h-1.5 rounded-full" style={{ width: `${maxArtMin > 0 ? (min / maxArtMin) * 100 : 0}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }} />
                  </div>
                  <span className="t-body w-12 shrink-0 text-right text-[11px] text-muted">{t("month.minShort", { n: min })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Historial */}
      {sessions.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="t-eyebrow text-muted">{t("history.title")}</p>
            <button onClick={() => { localStorage.removeItem(KEY); setSessions([]); void deleteServerActivities("MMA"); }} className="t-label text-muted">{t("history.delete")}</button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {sessions.map((s) => (
              <div key={s.id} className="glass p-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]"><GloveIcon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="t-label text-ink">{artLabel(t, s.art)} <span className="text-muted">· {s.type ?? s.mode ? workLabel(t, (s.type ?? s.mode) as string) : t("history.session")}</span></p>
                    <p className="t-body text-[11px] text-muted">
                      {fmtDate(s.ts, locale, t)} · {s.minutes} {t("log.minUnit")} · {t("rpe", { n: s.rpe })}{s.partner ? ` · ${t("history.withPartner", { partner: s.partner })}` : ""}
                    </p>
                  </div>
                  <span className="stat shrink-0 text-neon">{s.load ?? "—"} <span className="text-[10px] text-muted">{t("au")}</span></span>
                </div>
                {s.notes && (
                  <p className="t-body mt-2 border-t border-[rgba(150,190,255,0.08)] pt-2 text-xs text-muted">{s.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Burbuja coach IA */}
      <button onClick={() => setChatOpen(true)} aria-label={t("chat.open")}
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
                <p className="t-title text-ink">{t("chat.title")}</p>
                <span className="badge badge-neon">{t("chat.simulated")}</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="t-label text-muted">{t("chat.close")}</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "text-[#03101c]" : "text-ink"}`}
                    style={m.role === "user" ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(150,190,255,0.14)" }}>
                    {m.text ?? t("chat.greeting")}
                  </div>
                </div>
              ))}
              {typing && <div className="flex justify-start"><div className="rounded-2xl border border-[rgba(150,190,255,0.14)] bg-[rgba(255,255,255,0.06)] px-3.5 py-2.5"><span className="pulse text-sm text-muted">{t("chat.typing")}</span></div></div>}
              <div ref={endRef} />
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_IDS.map((q) => <button key={q} onClick={() => send(t(`chat.quick.${q}`))} className="badge">{t(`chat.quick.${q}`)}</button>)}
            </div>
            <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <button type="button" onClick={mockVoice} aria-label={t("chat.speak")} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${listening ? "btn-primary pulse" : "btn-tonal"}`}>🎤</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? t("chat.listening") : t("chat.placeholder")} className="field flex-1 px-3.5 py-2.5 text-sm" />
              <button type="submit" className="btn btn-primary btn-sm shrink-0">{t("chat.send")}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
