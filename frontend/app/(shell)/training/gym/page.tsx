"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { TrainingIcon, ChevronRight } from "@/components/icons";
import { GYM_LIVE_KEY, FOCUS_KEYS, loadGymSessions, type GymSession, type LiveGym } from "@/lib/gym";
import { useUserState } from "@/lib/user-state";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const FOCI = ["Descanso", "Full body", "Empuje", "Tirón", "Pierna", "Torso", "Pecho", "Espalda", "Hombro", "Brazo", "Cardio"];

const DEFAULT_WEEK: string[] = Array(7).fill("Descanso");

export default function GymPage() {
  const t = useTranslations("training.gym");
  const locale = intlLocale(useLocale());
  const focusLabel = (f: string) => (FOCUS_KEYS[f] ? t(`foci.${FOCUS_KEYS[f]}`) : f);
  function fmtDate(ts: number) {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? t("today")
      : d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  }
  const { value: savedWeek, setValue: setWeek } = useUserState<string[]>("gym_week", DEFAULT_WEEK);
  const week = Array.isArray(savedWeek) && savedWeek.length === 7 ? savedWeek : DEFAULT_WEEK;
  const [live, setLive] = useState<LiveGym | null>(null);
  const [recent, setRecent] = useState<GymSession[]>([]);

  useEffect(() => {
    try {
      const liveRaw = localStorage.getItem(GYM_LIVE_KEY);
      if (liveRaw) {
        const l: LiveGym = JSON.parse(liveRaw);
        // Lectura síncrona de localStorage tras montar. Pre-existente.
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const n = [...week];
    n[i] = v;
    setWeek(n);
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
      <Link href="/training/gym/import" className="btn btn-tonal btn-sm mt-2 w-full">{t("importLink")}</Link>

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
    </div>
  );
}
