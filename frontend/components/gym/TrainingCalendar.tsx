"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import type { ActivityKind, ServerActivity } from "@/lib/activities";
import { fetchCalendar, type CalendarDays } from "@/lib/gym-api";

const KIND_COLOR: Record<ActivityKind, string> = { GYM: "#45e9ff", MMA: "#ff8a8a", SPORT: "#43e8a0" };
const KINDS: ActivityKind[] = ["GYM", "MMA", "SPORT"];

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dayKey = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Calendario mensual con los días entrenados (F17, F1), del servidor: un punto por tipo
    (gimnasio, MMA y deporte). Al tocar un día se ven sus sesiones; las de gimnasio abren su detalle. */
export function TrainingCalendar() {
  const t = useTranslations("training.calendar");
  const locale = intlLocale(useLocale());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [days, setDays] = useState<CalendarDays | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<ServerActivity[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCalendar(monthKey(month)).then((d) => {
      if (!alive) return;
      setDays(d ?? {});
      setFailed(d === null);
    });
    return () => { alive = false; };
  }, [month]);

  useEffect(() => {
    if (!picked) return;
    let alive = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    fetch(`/api/proxy/activities?from=${picked}&to=${picked}&tz=${encodeURIComponent(tz)}&limit=50`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setDayItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setDayItems([]); });
    return () => { alive = false; };
  }, [picked]);

  const y = month.getFullYear();
  const m = month.getMonth();
  const first = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
  const count = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "narrow" }));
  const trained = days ? Object.keys(days).length : 0;
  const today = new Date();

  return (
    <div className="glass mt-4 p-4" data-testid="training-calendar">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { setMonth(new Date(y, m - 1, 1)); setPicked(null); }} aria-label={t("prev")} className="flex h-11 w-11 items-center justify-center text-muted">‹</button>
        <div className="text-center">
          <p className="t-label text-ink">{month.toLocaleDateString(locale, { month: "long", year: "numeric" })}</p>
          <p className="t-body text-[11px] text-muted">{failed ? t("offline") : t("trainedDays", { n: trained })}</p>
        </div>
        <button type="button" onClick={() => { setMonth(new Date(y, m + 1, 1)); setPicked(null); }} aria-label={t("next")} className="flex h-11 w-11 items-center justify-center text-muted">›</button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w, i) => <span key={i} className="t-label text-[10px] text-muted">{w}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const key = dayKey(y, m, d);
          const kinds = days?.[key];
          const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
          return (
            <button key={key} type="button" disabled={!kinds} onClick={() => setPicked(picked === key ? null : key)}
              aria-pressed={picked === key}
              aria-label={kinds ? t("dayAria", { date: new Date(y, m, d).toLocaleDateString(locale, { day: "numeric", month: "long" }), n: Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0) }) : undefined}
              className={`flex min-h-11 flex-col items-center justify-center rounded-lg text-xs ${kinds ? "text-ink" : "text-muted"} ${picked === key ? "bg-[rgba(69,233,255,0.15)]" : ""} ${isToday ? "border border-[rgba(69,233,255,0.4)]" : ""}`}>
              <span>{d}</span>
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {KINDS.filter((k) => kinds?.[k]).map((k) => <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-center gap-3">
        {KINDS.map((k) => (
          <span key={k} className="t-body flex items-center gap-1 text-[10px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />{t(`kinds.${k}`)}
          </span>
        ))}
      </div>
      {picked && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.1)] pt-3" data-testid="calendar-day">
          {dayItems === null && <li className="t-body text-xs text-muted">{t("loading")}</li>}
          {dayItems?.map((a) => {
            const label = `${t(`kinds.${a.kind}`)} · ${a.title || t("untitled")} · ${Math.round(a.duration_sec / 60)} min`;
            return (
              <li key={a.id} className="t-body text-xs text-ink">
                {a.kind === "GYM" ? <Link href={`/training/gym/history/${a.id}`} className="text-neon">{label}</Link> : label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
