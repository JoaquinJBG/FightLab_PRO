"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { TrainingIcon, CoachIcon, ChevronRight } from "@/components/icons";
import { GYM_LIVE_KEY, EXERCISE_KEYS, FOCUS_KEYS, loadGymSessions, type GymSession, type LiveGym } from "@/lib/gym";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const FOCI = ["Descanso", "Full body", "Empuje", "Tirón", "Pierna", "Torso", "Pecho", "Espalda", "Hombro", "Brazo", "Cardio"];

const EXERCISES: Record<string, string[]> = {
  "Full body": ["Sentadilla", "Press banca", "Remo", "Press militar"],
  Empuje: ["Press banca", "Press militar", "Fondos", "Extensión tríceps"],
  Tirón: ["Dominadas", "Remo con barra", "Curl bíceps", "Face pull"],
  Pierna: ["Sentadilla", "Peso muerto rumano", "Prensa", "Gemelos"],
  Torso: ["Press banca", "Remo", "Press militar", "Dominadas"],
  Pecho: ["Press banca", "Press inclinado", "Aperturas", "Fondos"],
  Espalda: ["Dominadas", "Remo", "Jalón al pecho", "Peso muerto"],
  Hombro: ["Press militar", "Elevaciones laterales", "Pájaros", "Face pull"],
  Brazo: ["Curl bíceps", "Extensión tríceps", "Curl martillo", "Fondos"],
};
const SPLITS: Record<string, string[]> = {
  fullBody: ["Full body"],
  upperLower: ["Torso", "Pierna"],
  ppl: ["Empuje", "Tirón", "Pierna"],
  weider: ["Pecho", "Espalda", "Pierna", "Hombro", "Brazo"],
};
const GOALS = ["strength", "hypertrophy", "fatLoss", "maintenance"];
const LEVELS = ["beginner", "intermediate", "advanced"];

const WEEK_KEY = "flp_gym_week";
type RoutineDay = { day: number; focus: string; exercises: string[] };


export default function GymPage() {
  const t = useTranslations("training.gym");
  const locale = useLocale();
  const focusLabel = (f: string) => (FOCUS_KEYS[f] ? t(`foci.${FOCUS_KEYS[f]}`) : f);
  const exLabel = (n: string) => (EXERCISE_KEYS[n] ? t(`exercises.${EXERCISE_KEYS[n]}`) : n);
  function fmtDate(ts: number) {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? t("today")
      : d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  }
  const [view, setView] = useState<"cal" | "ia">("cal");
  const [week, setWeek] = useState<string[]>(() => Array(7).fill("Descanso"));
  const [live, setLive] = useState<LiveGym | null>(null);
  const [recent, setRecent] = useState<GymSession[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WEEK_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length === 7) setWeek(arr); }
      const liveRaw = localStorage.getItem(GYM_LIVE_KEY);
      if (liveRaw) {
        const l: LiveGym = JSON.parse(liveRaw);
        if (l && Date.now() - l.savedAt < 12 * 3600_000) setLive(l);
        else localStorage.removeItem(GYM_LIVE_KEY);
      }
      setRecent(loadGymSessions().slice(0, 3));
    } catch { /* noop */ }
  }, []);

  const todayIdx = (new Date().getDay() + 6) % 7;
  const todayFocus = week[todayIdx];
  const startHref =
    todayFocus && todayFocus !== "Descanso" && todayFocus !== "Cardio"
      ? `/training/gym/session?focus=${encodeURIComponent(todayFocus)}`
      : "/training/gym/session";
  function setDay(i: number, v: string) {
    setWeek((w) => { const n = [...w]; n[i] = v; localStorage.setItem(WEEK_KEY, JSON.stringify(n)); return n; });
  }

  // wizard IA
  const [nivel, setNivel] = useState("intermediate");
  const [dias, setDias] = useState(4);
  const [tipo, setTipo] = useState("ppl");
  const [objetivo, setObjetivo] = useState("hypertrophy");
  const [generating, setGenerating] = useState(false);
  const [routine, setRoutine] = useState<RoutineDay[] | null>(null);

  function generate() {
    setGenerating(true);
    setRoutine(null);
    const seq = SPLITS[tipo];
    setTimeout(() => {
      const r: RoutineDay[] = Array.from({ length: dias }, (_, i) => {
        const focus = seq[i % seq.length];
        return { day: i + 1, focus, exercises: EXERCISES[focus] ?? [] };
      });
      setRoutine(r);
      setGenerating(false);
    }, 1000);
  }
  function applyToCalendar() {
    if (!routine) return;
    const n = Array(7).fill("Descanso");
    routine.forEach((d, i) => { if (i < 7) n[i] = d.focus; });
    setWeek(n);
    localStorage.setItem(WEEK_KEY, JSON.stringify(n));
    setView("cal");
  }

  const selectCls = "field px-3 py-2.5 text-sm";

  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">{t("back")}</Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      </div>

      {/* sesión sin terminar */}
      {live && (
        <div className="glass neon-edge mt-4 flex items-center gap-3 p-4">
          <span className="text-warn"><TrainingIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="t-label text-ink">{t("unfinished")}</p>
            <p className="t-body text-xs text-muted">
              {live.focus ? `${focusLabel(live.focus)} · ` : ""}{t("exerciseCount", { n: live.exercises.length })}
            </p>
          </div>
          <Link href="/training/gym/session" className="btn btn-tonal btn-sm shrink-0">{t("resume")}</Link>
          <button onClick={() => { localStorage.removeItem(GYM_LIVE_KEY); setLive(null); }} aria-label={t("discard")} className="t-label shrink-0 text-muted">✕</button>
        </div>
      )}

      {/* empezar entreno */}
      {!live && (
        <Link href={startHref} className="btn btn-primary mt-4 w-full">
          {todayFocus && todayFocus !== "Descanso" ? t("startWithFocus", { focus: focusLabel(todayFocus) }) : t("start")}
        </Link>
      )}

      {/* toggle */}
      <div className="glass mt-4 grid grid-cols-2 gap-1 rounded-2xl p-1">
        {(["cal", "ia"] as const).map((k) => (
          <button key={k} onClick={() => setView(k)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={view === k ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
            {t(`views.${k}`)}
          </button>
        ))}
      </div>

      {view === "cal" ? (
        <div className="mt-4">
          <p className="t-eyebrow text-muted">{t("yourWeek")}</p>
          <div className="mt-2 flex flex-col gap-2">
            {DAYS.map((d, i) => {
              const rest = week[i] === "Descanso";
              return (
                <div key={d} className="glass flex items-center gap-3 p-3">
                  <span className={`stat w-10 text-sm ${rest ? "text-muted" : "text-neon"}`}>{t(`days.${d}`)}</span>
                  <select value={week[i]} onChange={(e) => setDay(i, e.target.value)} className={`${selectCls} flex-1`}>
                    {FOCI.map((f) => <option key={f} value={f}>{focusLabel(f)}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="t-body mt-3 text-xs text-muted">{t("weekHint")}</p>

          {/* últimos entrenos */}
          {recent.length > 0 && (
            <div className="mt-5">
              <p className="t-eyebrow text-muted">{t("recent")}</p>
              <div className="mt-2 flex flex-col gap-2">
                {recent.map((s) => (
                  <div key={s.id} className="glass flex items-center gap-3 p-3.5">
                    <span className="text-neon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]">
                      <TrainingIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-label text-ink">{s.focus ? focusLabel(s.focus) : t("workout")} <span className="text-muted">· {fmtDate(s.ts)}</span></p>
                      <p className="t-body text-[11px] text-muted">
                        {t("exerciseCount", { n: s.exercises.length })} · {t("setCount", { n: s.exercises.reduce((a, x) => a + x.sets.length, 0) })} · {s.volume.toLocaleString(locale)} kg
                        {s.load ? ` · ${s.load} AU` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="t-eyebrow text-muted">{t("views.ia")}</p>
            <span className="badge badge-neon">{t("simulatedAi")}</span>
          </div>
          <p className="t-body mt-1 text-xs text-muted">{t("wizardIntro")}</p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="t-label text-muted">{t("level")}</span>
              <select value={nivel} onChange={(e) => setNivel(e.target.value)} className={selectCls}>
                {LEVELS.map((o) => <option key={o} value={o}>{t(`levels.${o}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="t-label text-muted">{t("daysPerWeek")}</span>
              <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={selectCls}>
                {[2, 3, 4, 5, 6].map((o) => <option key={o} value={o}>{t("daysOption", { n: o })}</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1.5">
              <span className="t-label text-muted">{t("splitType")}</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}>
                {Object.keys(SPLITS).map((o) => <option key={o} value={o}>{t(`splits.${o}`)}</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1.5">
              <span className="t-label text-muted">{t("goal")}</span>
              <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)} className={selectCls}>
                {GOALS.map((o) => <option key={o} value={o}>{t(`goals.${o}.label`)}</option>)}
              </select>
            </label>
          </div>

          <button className="btn btn-primary mt-4 w-full" onClick={generate} disabled={generating}>
            <CoachIcon className="h-4 w-4" /> {generating ? t("generating") : t("generate")}
          </button>

          {generating && (
            <div className="glass mt-4 p-4"><span className="pulse t-body text-sm text-muted">{t("designing", { level: t(`levels.${nivel}`), days: dias, goal: t(`goals.${objetivo}.label`).toLocaleLowerCase(locale) })}</span></div>
          )}

          {routine && (
            <div className="mt-4">
              <p className="t-eyebrow text-neon">{t("proposed", { reps: t(`goals.${objetivo}.reps`) })}</p>
              <div className="mt-2 flex flex-col gap-2">
                {routine.map((d) => (
                  <div key={d.day} className="glass p-3.5">
                    <p className="t-label text-ink">{t.rich("dayLine", { day: d.day, focus: focusLabel(d.focus), neon: (c) => <span className="text-neon">{c}</span> })}</p>
                    <p className="t-body mt-1 text-xs text-muted">{d.exercises.map(exLabel).join(" · ")}</p>
                  </div>
                ))}
              </div>
              <button className="btn btn-tonal mt-3 w-full" onClick={applyToCalendar}>{t("applyToCalendar")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
